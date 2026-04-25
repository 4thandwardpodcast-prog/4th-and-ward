/**
 * One-shot cleanup: removes "no photo available" placeholder image URLs
 * from every stadium's photos[] array in Firestore.
 *
 * Confirmed placeholder URL patterns:
 *   - https://stadiumconnection.com/simages/nopic.jpg  ← StadiumConnection
 *   - .../simages/nophoto*                              ← variant guess
 *   - .../blank.gif                                     ← already filtered at parse
 *
 * Run:
 *   node scripts/clean-placeholder-photos.js --dry-run   # preview
 *   node scripts/clean-placeholder-photos.js             # apply
 */

const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'firebase-admin-key.json');
const BATCH_SIZE = 400;

const PLACEHOLDER_PATTERNS = [
  /\/simages\/nopic\.jpg/i,
  /\/simages\/nophoto/i,
  /\/blank\.gif$/i,
];

function isPlaceholder(url) {
  if (!url) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(KEY_PATH)) {
    console.error(`Service account key not found: ${KEY_PATH}`);
    console.error('See scripts/import-stadiums.js header for setup instructions.');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();

  console.log('Fetching all stadiums…');
  const snap = await db.collection('stadiums').get();
  console.log(`Loaded ${snap.size} stadiums.`);

  const updates = [];
  let totalRemoved = 0;

  snap.forEach((d) => {
    const data = d.data();
    const photos = Array.isArray(data.photos) ? data.photos : [];
    if (!photos.length) return;
    const filtered = photos.filter((p) => !isPlaceholder(p?.url));
    if (filtered.length === photos.length) return;
    totalRemoved += photos.length - filtered.length;
    updates.push({
      slug: d.id,
      name: data.stadiumName || '(unnamed)',
      before: photos.length,
      after: filtered.length,
      photos: filtered,
    });
  });

  console.log(`\nFound ${updates.length} stadiums with placeholder photos.`);
  console.log(`Total placeholder photos to remove: ${totalRemoved}\n`);

  if (updates.length) {
    console.log('Examples (first 15):');
    updates.slice(0, 15).forEach((u) =>
      console.log(`  ${u.slug.padEnd(48)} ${u.name}  (${u.before} → ${u.after} photos)`)
    );
  }

  if (dryRun) {
    console.log('\n[--dry-run] Not writing. Re-run without --dry-run to apply.');
    return;
  }
  if (!updates.length) {
    console.log('Nothing to clean.');
    return;
  }

  console.log(`\nWriting cleaned photos in batches of ${BATCH_SIZE}…`);
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + BATCH_SIZE);
    chunk.forEach((u) => {
      batch.update(db.collection('stadiums').doc(u.slug), {
        photos: u.photos,
        primaryPhotoIndex: u.photos.length ? 0 : null,
      });
    });
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
  }
  console.log(`\n✓ Cleaned ${updates.length} stadiums.`);
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
