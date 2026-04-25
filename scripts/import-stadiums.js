/**
 * Friday Night Pulse — one-time Firestore import.
 *
 * Reads scripts/data/stadiums.json (output of seed-stadiums.js),
 * scrubs junk, generates URL-safe slugs (collision-safe), normalizes
 * fields to camelCase to match the Drip-or-Drown convention, and
 * writes to the `stadiums` collection in batches of 400.
 *
 * Idempotent — re-running updates existing docs by slug.
 *
 * SETUP (one-time):
 *   1. Firebase Console → Project Settings → Service Accounts
 *   2. "Generate new private key" → download JSON
 *   3. Save as scripts/firebase-admin-key.json (gitignored)
 *   4. node scripts/import-stadiums.js
 *
 * Flags:
 *   --dry-run    parse and print stats, don't write to Firestore
 *   --limit=N    only import the first N records (debugging)
 */

const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'firebase-admin-key.json');
const INPUT = path.join(__dirname, 'data', 'stadiums.json');
const BATCH_SIZE = 400; // Firestore limit is 500, leave headroom

// ── junk scrubbing ────────────────────────────────────────────────────────────

const JUNK_NAME_PATTERNS = [
  /where do you play/i,
  /^arctic\s+tundra$/i,
  /^test\s+stadium/i,
];
const JUNK_CITY_VALUES = ['any where', 'anywhere', 'unknown', ''];

function isJunk(r) {
  if (!r.stadium_name || !r.city) return true;
  if (JUNK_CITY_VALUES.includes(r.city.toLowerCase().trim())) return true;
  if (JUNK_NAME_PATTERNS.some((re) => re.test(r.stadium_name))) return true;
  return false;
}

// ── slug generation ───────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeSlug(record, takenSlugs) {
  const base = [
    slugify(record.stadium_name),
    slugify(record.city),
    record.state.toLowerCase(),
  ].filter(Boolean).join('-');

  if (!takenSlugs.has(base)) {
    takenSlugs.add(base);
    return base;
  }
  // Collision — disambiguate with source_id
  const withId = `${base}-${record.source_id}`;
  takenSlugs.add(withId);
  return withId;
}

// ── HS-venue heuristic ────────────────────────────────────────────────────────
// Sources label any stadium booked for HS games (incl. state championships at
// college/pro venues) as "High School". Filter to PRIMARY HS use:
//   - capacity > 25,000 → almost certainly multi-use (Rose Bowl, Legion Field, etc.)
//   - owner contains University/Bowl/City of/Park & Rec → not primary HS
//   - carve-outs for "College Station ISD", "College Prep" HS, etc.

const COLLEGE_OK_PATTERNS = [
  /college station/i,         // city in TX
  /college prep/i,            // some HS names contain "College Prep"
  /college park/i,            // city/region name
  /college area school/i,     // State College Area School District (PA)
];

function isLikelyHsVenue(r) {
  const owner = String(r.owner || '');

  // School-district / private-HS override — primary HS use even if capacity is
  // unusually large or "College" appears in the name.
  const isHsOwned =
    /\b(ISD|school district|city schools?|county schools?|catholic schools?|board of education|public schools?|parish schools?|diocese|archdiocese)\b/i.test(owner)
    || /\b(SD|CSD|USD|CISD|SISD|MISD|GISD|HISD|BISD|EISD|JISD|LISD|NISD|PISD|RISD|TISD|WISD|YISD)\b/.test(owner)
    || /\b(high school|academy|preparatory|\bprep\b)\b/i.test(owner);
  if (isHsOwned) {
    // Still flag if a UNIVERSITY is the dominant party (e.g. LSU Cub Complex)
    if (/\b(state university|\buniv\b)\b/i.test(owner) && !/\bisd\b|\bschool district\b/i.test(owner)) return false;
    return true;
  }

  // Cap > 25K and NOT a school district = almost certainly multi-use
  if (r.capacity && r.capacity > 25000) return false;

  // Universities + colleges (with carve-outs for false positives)
  if (/\b(university|\bcollege\b)/i.test(owner)) {
    if (!COLLEGE_OK_PATTERNS.some((re) => re.test(owner))) return false;
  }
  // Event-promoter / entertainment-group ownership
  if (/\b(anschutz|entertainment group|sports group|bowl[,.]?\s*(inc|llc|foundation))\b/i.test(owner)) return false;
  // State-owned, rarely primary HS
  if (/^state of\b/i.test(owner)) return false;

  return true;
}

// ── shape conversion: snake_case seed → camelCase Firestore ───────────────────

function toFirestoreDoc(record, slug) {
  return {
    slug,
    legacyId: record.stadium_id,
    sourceProvider: record.source.provider,
    sourceId: record.source_id,

    stadiumName: record.stadium_name,
    secondaryName: record.secondary_name || null,
    stadiumType: record.stadium_type,
    owner: record.owner || null,
    homeTeams: record.home_teams || [],

    city: record.city,
    state: record.state,
    county: record.county || null,
    street: record.street || null,
    postalCode: record.postal_code || null,
    googleMapsUrl: record.google_maps_url || null,

    capacity: record.capacity || null,
    yearOpened: record.year_opened || null,
    surface: record.surface || null,
    hasTrack: record.has_track,
    hasSoccer: record.has_soccer,
    hasVideoScoreboard: record.has_video_scoreboard,
    hasPressBoxElevator: record.has_press_box_elevator,
    wheelchairAccess: record.wheelchair_access || null,
    comments: record.comments || null,

    // Photos — convert seed → camelCase, preserve all fields
    photos: (record.photos || []).map((p) => ({
      url: p.url,
      source: p.source,
      credit: p.credit || null,
      sourcePage: p.source_page,
      uploaderName: null,
      caption: null,
      approved: true, // seeded photos auto-approved
      addedAt: Date.now(),
    })),
    primaryPhotoIndex: record.primary_photo_index,

    // Pulse aggregates — empty until first rating
    pulseScore: null,
    bayesianScore: null,
    ratingsCount: 0,
    ratingsAvg: null,
    lastRatedAt: null,

    // Moderation
    isPublished: true, // seeded stadiums are public; user submissions start false
    isFeatured: false,
    // Primary-HS-use heuristic. Frontend filters where this is true.
    // Admin can manually flip via the moderation UI.
    isHsVenue: isLikelyHsVenue(record),

    // Provenance
    seededAt: Date.now(),
    originLastUpdated: record.source.origin_last_updated || null,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.replace('--limit=', '')) : null;

  // Load data
  if (!fs.existsSync(INPUT)) {
    console.error(`Input not found: ${INPUT}`);
    console.error('Run seed-stadiums.js first.');
    process.exit(1);
  }
  let records = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  console.log(`Loaded ${records.length} records from stadiums.json`);

  // Scrub junk
  const beforeScrub = records.length;
  const junk = records.filter(isJunk);
  records = records.filter((r) => !isJunk(r));
  console.log(`Scrubbed ${beforeScrub - records.length} junk records:`);
  junk.forEach((r) => console.log(`  - ${r.stadium_name} (${r.city}, ${r.state})`));

  // Apply limit
  if (limit) {
    records = records.slice(0, limit);
    console.log(`Limited to first ${limit} records`);
  }

  // Generate slugs + convert
  const takenSlugs = new Set();
  const docs = records.map((r) => {
    const slug = makeSlug(r, takenSlugs);
    return { slug, doc: toFirestoreDoc(r, slug) };
  });
  console.log(`Generated ${docs.length} docs with unique slugs`);

  // Stats
  const byState = {};
  docs.forEach(({ doc: d }) => byState[d.state] = (byState[d.state] || 0) + 1);
  console.log('\nState breakdown:');
  Object.entries(byState).sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${s}: ${n}`));
  const withPhoto = docs.filter(({ doc: d }) => d.photos.length > 0).length;
  console.log(`Photo coverage: ${withPhoto}/${docs.length} (${Math.round(withPhoto / docs.length * 100)}%)`);

  // HS-venue heuristic stats
  const flagged = docs.filter(({ doc: d }) => d.isHsVenue === false);
  console.log(`\nHS-venue filter: ${docs.length - flagged.length} primary HS, ${flagged.length} flagged out (admin can re-include manually)`);
  if (flagged.length) {
    console.log('Flagged out (top 30 by capacity):');
    flagged.slice().sort((a, b) => (b.doc.capacity || 0) - (a.doc.capacity || 0)).slice(0, 30)
      .forEach(({ doc: d }) => console.log(`  cap=${(d.capacity || '—').toString().padStart(6)}  owner=${(d.owner || '?').slice(0, 50).padEnd(52)} ${d.stadiumName} (${d.city}, ${d.state})`));
  }

  if (dryRun) {
    console.log('\n[--dry-run] not writing to Firestore. Sample doc:');
    console.log(JSON.stringify(docs[0].doc, null, 2));
    return;
  }

  // Connect to Firestore
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`\nService account key not found: ${KEY_PATH}`);
    console.error('See setup instructions in scripts/import-stadiums.js header.');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH)),
  });
  const db = admin.firestore();

  // Batch write
  console.log(`\nWriting ${docs.length} docs to stadiums/ in batches of ${BATCH_SIZE}...`);
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach(({ slug, doc }) => {
      batch.set(db.collection('stadiums').doc(slug), doc, { merge: true });
    });
    await batch.commit();
    written += chunk.length;
    console.log(`  ${written}/${docs.length}`);
  }
  console.log(`\n✓ Imported ${written} stadiums to Firestore.`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
