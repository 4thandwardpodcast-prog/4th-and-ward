/**
 * Friday Night Pulse — multi-source stadium seed pipeline.
 *
 * Sources (all use stadium.php?id=N detail pages with similar HTML templates):
 *   - texasbob       → texasbob.com (Texas, ~963 HS stadiums)
 *   - sc-{state}     → stadiumconnection.com/{state} for AL/AR/CA/GA/LA/NM/OK/PA/TN/WV
 *
 * Discovery strategy:
 *   - texasbob:   school_list.php?sort=1..26 (alphabetical chunks)
 *   - sc-{state}: region_index.php?region=1..15, auto-stops on consecutive empties
 *
 * Output: per-source JSON in scripts/data/stadiums-{source}.json + a combined
 *         stadiums.json built from whatever per-source files exist.
 *
 * Resumable per source via .seed-progress-{source}.json. Rate-limited.
 *
 * Run:
 *   node scripts/seed-stadiums.js --source=texasbob
 *   node scripts/seed-stadiums.js --source=sc-al
 *   node scripts/seed-stadiums.js --source=all          # runs every source
 *   node scripts/seed-stadiums.js --source=sc-al --ids=5189,5395    # smoke test
 *   node scripts/seed-stadiums.js --source=sc-al --reset
 *   node scripts/seed-stadiums.js --combine             # rebuild stadiums.json
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const UA = '4thAndWardSeeder/1.0 (+https://4thandward.com; contact: hello@4thandward.com)';
const DELAY_MS = 1500;
const MAX_RETRIES = 3;

const DATA_DIR = path.join(__dirname, 'data');
const SCRIPTS_DIR = __dirname;

// ── source configs ────────────────────────────────────────────────────────────

const SOURCES = {
  'texasbob': {
    base: 'https://texasbob.com/stadium',
    state: 'TX',
    photos: true,
    discovery: { type: 'sort', max: 26 },
  },
  'sc-al': scState('al', 'AL', true),
  'sc-ar': scState('ar', 'AR', false), // robots.txt blocks /ar/photo/
  'sc-ca': scState('ca', 'CA', false), // robots.txt blocks /ca/photo/
  'sc-ga': scState('ga', 'GA', true),
  'sc-la': scState('la', 'LA', true),
  'sc-nm': scState('nm', 'NM', true),
  'sc-ok': scState('ok', 'OK', true),
  'sc-pa': scState('pa', 'PA', true),
  'sc-tn': scState('tn', 'TN', true),
  'sc-wv': scState('wv', 'WV', true),
};

function scState(slug, code, allowPhotos) {
  return {
    base: `https://stadiumconnection.com/${slug}`,
    state: code,
    photos: allowPhotos,
    discovery: { type: 'region', max: 15, emptyStreakStop: 3 },
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 404) return null;
    if (res.status === 403) throw new Error('403 Forbidden — stop and review.');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    const backoff = 2000 * attempt;
    console.warn(`  retry ${attempt}/${MAX_RETRIES - 1} after ${backoff}ms — ${err.message}`);
    await sleep(backoff);
    return fetchHtml(url, attempt + 1);
  }
}

// ── discovery ─────────────────────────────────────────────────────────────────

async function discoverIds(source, sourceName) {
  const ids = new Set();
  const { discovery, base } = source;

  if (discovery.type === 'sort') {
    for (let n = 1; n <= discovery.max; n++) {
      const url = `${base}/school_list.php?sort=${n}`;
      process.stdout.write(`[${sourceName}] discover sort=${n}/${discovery.max} `);
      const html = await fetchHtml(url);
      const before = ids.size;
      if (html) [...html.matchAll(/stadium\.php\?id=(\d+)/g)].forEach((m) => ids.add(parseInt(m[1])));
      console.log(`+${ids.size - before} (total ${ids.size})`);
      await sleep(DELAY_MS);
    }
  } else if (discovery.type === 'region') {
    let emptyStreak = 0;
    for (let n = 1; n <= discovery.max; n++) {
      const url = `${base}/region_index.php?region=${n}`;
      process.stdout.write(`[${sourceName}] discover region=${n} `);
      const html = await fetchHtml(url);
      const before = ids.size;
      if (html) [...html.matchAll(/stadium\.php\?id=(\d+)/g)].forEach((m) => ids.add(parseInt(m[1])));
      const added = ids.size - before;
      console.log(`+${added} (total ${ids.size})`);
      if (added === 0) {
        emptyStreak++;
        if (emptyStreak >= discovery.emptyStreakStop) {
          console.log(`[${sourceName}] stopping discovery — ${emptyStreak} empty regions in a row`);
          break;
        }
      } else {
        emptyStreak = 0;
      }
      await sleep(DELAY_MS);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

// ── parse ─────────────────────────────────────────────────────────────────────

function textAfterLabel($, label) {
  let result = null;
  $('strong').each((_, el) => {
    if (result) return;
    const labelText = $(el).text().trim().replace(/:$/, '').toLowerCase();
    if (labelText === label.toLowerCase()) {
      const node = el.nextSibling;
      if (node && node.type === 'text') result = node.data.trim();
    }
  });
  return result;
}

function yesNoToBool(s) {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === 'yes') return true;
  if (t === 'no') return false;
  return null;
}

function resolvePhotoUrl(rawSrc, source, texasbobId) {
  if (!rawSrc) return null;
  if (/blank\.gif|nophoto/i.test(rawSrc)) return null;
  if (rawSrc.startsWith('http')) {
    // SC has a typo bug: "https://stadiumconnection/simages/..." — patch it
    return rawSrc.replace(/^https:\/\/stadiumconnection\//, 'https://stadiumconnection.com/');
  }
  // Relative path like "simages/1023.jpg" — resolve against source base
  const clean = rawSrc.replace(/^\.\//, '').replace(/^\//, '');
  return `${source.base}/${clean}`;
}

function parseStadiumPage(html, texasbobId, source, sourceName) {
  const $ = cheerio.load(html);

  let ld = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try { ld = JSON.parse($(el).html()); } catch {}
  });

  const stadiumName = (ld.name || $('h1 strong').first().text() || '').trim();
  if (!stadiumName) return { error: 'no-name', texasbobId };

  const secondaryName = ($('h2[align="center"]').first().text() || '').replace(/^at\s+/i, '').trim() || null;

  const stadiumType = textAfterLabel($, 'Stadium Type');
  const owner = textAfterLabel($, 'Owner');
  const county = $('a[href*="county_list.php"], a[href*="county_index.php"]').first().text().trim() || null;
  const capacityStr = textAfterLabel($, 'Capacity');
  const yearStr = textAfterLabel($, 'Year Opened');
  const surface = textAfterLabel($, 'Playing Surface');
  const wheelchair = textAfterLabel($, 'Wheelchair Access');

  const hasTrack = yesNoToBool(textAfterLabel($, 'Track'));
  const hasSoccer = yesNoToBool(textAfterLabel($, 'Soccer'));
  const hasVideoScoreboard = yesNoToBool(textAfterLabel($, 'Video Scoreboard'));
  const hasPressBoxElevator = yesNoToBool(textAfterLabel($, 'Press Box Elevator'));

  // Address from goo.gl/maps anchor
  const mapsAnchor = $('a[href*="goo.gl/maps"], a[href*="google.com/maps"]').first();
  const googleMapsUrl = mapsAnchor.attr('href') || null;
  const addressLine = mapsAnchor.text().trim().replace(/\s+/g, ' ');
  const addrMatch = addressLine.match(/^(.+?)\s+--\s+([^,]+),\s+([A-Za-z ]+?)\s+(\d{5})?\s*$/);
  const street = addrMatch?.[1] || null;
  const city = addrMatch?.[2] || ld.address?.addressLocality?.split(',')[0]?.trim() || null;
  // Trust source.state over parsed state name
  const state = source.state;
  const postalCode = addrMatch?.[4] || ld.address?.postalCode || null;

  // Home teams
  const homeTeams = [];
  $('strong').each((_, el) => {
    if ($(el).text().trim() === 'Home Teams:') {
      const block = $(el).closest('div, section, body');
      block.find('.col-lg-6').each((__, td) => {
        const v = $(td).text().trim();
        if (v) homeTeams.push(v);
      });
    }
  });
  const uniqueTeams = [...new Set(homeTeams.filter((t) => t && t.length > 1 && t.length < 80))];

  const comments = textAfterLabel($, 'Comments');
  const lastUpdated = textAfterLabel($, 'Last update');
  const photoCredit = textAfterLabel($, 'Photo Credit');

  // Photo URL — try JSON-LD, then og:image, then <img>
  let photoUrl = null;
  if (source.photos) {
    const candidates = [
      ld.image,
      $('meta[property="og:image"]').attr('content'),
      $('img.img-fluid[src*="simages"]').attr('src'),
    ].filter(Boolean);
    for (const c of candidates) {
      const resolved = resolvePhotoUrl(c, source, texasbobId);
      if (resolved) { photoUrl = resolved; break; }
    }
  }

  return {
    stadium_id: `${sourceName}-${texasbobId}`,
    source_id: texasbobId,
    stadium_name: stadiumName,
    secondary_name: secondaryName,
    stadium_type: stadiumType,
    owner: owner || null,
    home_teams: uniqueTeams,
    city,
    state,
    county,
    street,
    postal_code: postalCode,
    google_maps_url: googleMapsUrl,
    capacity: capacityStr ? parseInt(capacityStr.replace(/[^\d]/g, '')) || null : null,
    year_opened: yearStr ? parseInt(yearStr) || null : null,
    surface: surface || null,
    has_track: hasTrack,
    has_soccer: hasSoccer,
    has_video_scoreboard: hasVideoScoreboard,
    has_press_box_elevator: hasPressBoxElevator,
    wheelchair_access: wheelchair || null,
    comments: comments || null,
    photos: photoUrl ? [{
      url: photoUrl,
      source: sourceName,
      credit: photoCredit || null,
      source_page: `${source.base}/stadium.php?id=${texasbobId}`,
      status: 'approved',
      added_at: new Date().toISOString(),
    }] : [],
    primary_photo_index: photoUrl ? 0 : null,
    source: {
      provider: sourceName,
      id: texasbobId,
      fetched_at: new Date().toISOString(),
      origin_last_updated: lastUpdated || null,
    },
  };
}

// ── detail fetches ────────────────────────────────────────────────────────────

async function fetchDetails(ids, progress, source, sourceName) {
  const remaining = ids.filter((id) => !progress.done.includes(id));
  console.log(`[${sourceName}] ${remaining.length} of ${ids.length} stadiums to fetch`);

  for (let i = 0; i < remaining.length; i++) {
    const id = remaining[i];
    const url = `${source.base}/stadium.php?id=${id}`;
    process.stdout.write(`[${sourceName}] [${i + 1}/${remaining.length}] id=${id} `);

    try {
      const html = await fetchHtml(url);
      if (!html) { console.log('404'); progress.done.push(id); saveProgress(progress, sourceName); continue; }

      const record = parseStadiumPage(html, id, source, sourceName);
      if (record.error) {
        console.log(`skip (${record.error})`);
        progress.errors.push({ id, error: record.error });
      } else if (record.stadium_type !== 'High School') {
        console.log(`skip (${record.stadium_type || 'unknown type'})`);
      } else {
        progress.records.push(record);
        console.log(`✓ ${record.stadium_name} (${record.city}, ${record.state})`);
      }
      progress.done.push(id);
      if (i % 10 === 0) saveProgress(progress, sourceName);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      progress.errors.push({ id, error: err.message });
      saveProgress(progress, sourceName);
      if (err.message.includes('403')) {
        console.error(`[${sourceName}] hard stop — 403. Review and resume.`);
        process.exit(1);
      }
    }
    await sleep(DELAY_MS);
  }
  saveProgress(progress, sourceName);
}

// ── progress ──────────────────────────────────────────────────────────────────

function progressPath(sourceName) {
  return path.join(SCRIPTS_DIR, `.seed-progress-${sourceName}.json`);
}
function outputPath(sourceName) {
  return path.join(DATA_DIR, `stadiums-${sourceName}.json`);
}
function errorsPath(sourceName) {
  return path.join(DATA_DIR, `stadiums-${sourceName}-errors.json`);
}

function loadProgress(sourceName) {
  const p = progressPath(sourceName);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { discoveredIds: null, done: [], records: [], errors: [] };
}
function saveProgress(progress, sourceName) {
  fs.writeFileSync(progressPath(sourceName), JSON.stringify(progress, null, 2));
}

// ── combine ───────────────────────────────────────────────────────────────────

function combineAll() {
  const combined = [];
  for (const sourceName of Object.keys(SOURCES)) {
    const p = outputPath(sourceName);
    if (fs.existsSync(p)) {
      const records = JSON.parse(fs.readFileSync(p, 'utf8'));
      combined.push(...records);
      console.log(`  + ${records.length} from ${sourceName}`);
    }
  }
  const out = path.join(DATA_DIR, 'stadiums.json');
  fs.writeFileSync(out, JSON.stringify(combined, null, 2));
  console.log(`\n✓ wrote ${combined.length} total to ${path.relative(process.cwd(), out)}`);
}

// ── runner ────────────────────────────────────────────────────────────────────

async function runSource(sourceName, opts) {
  const source = SOURCES[sourceName];
  if (!source) throw new Error(`unknown source: ${sourceName}`);

  if (opts.reset && fs.existsSync(progressPath(sourceName))) fs.unlinkSync(progressPath(sourceName));
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const progress = loadProgress(sourceName);

  let ids;
  if (opts.ids) {
    ids = opts.ids;
    console.log(`[${sourceName}] smoke-test — IDs: ${ids.join(', ')}`);
  } else if (progress.discoveredIds) {
    ids = progress.discoveredIds;
    console.log(`[${sourceName}] resume — ${ids.length} IDs from prior discovery`);
  } else {
    ids = await discoverIds(source, sourceName);
    progress.discoveredIds = ids;
    saveProgress(progress, sourceName);
    console.log(`[${sourceName}] discovery done — ${ids.length} unique IDs`);
  }

  await fetchDetails(ids, progress, source, sourceName);

  fs.writeFileSync(outputPath(sourceName), JSON.stringify(progress.records, null, 2));
  fs.writeFileSync(errorsPath(sourceName), JSON.stringify(progress.errors, null, 2));
  console.log(`[${sourceName}] ✓ ${progress.records.length} HS stadiums, ${progress.errors.length} errors`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--combine')) { combineAll(); return; }

  const sourceArg = args.find((a) => a.startsWith('--source='))?.replace('--source=', '');
  if (!sourceArg) {
    console.log('Usage: node scripts/seed-stadiums.js --source=<name>');
    console.log('Available sources:', Object.keys(SOURCES).join(', '), 'or all');
    console.log('Other flags: --reset, --ids=1,2,3, --combine');
    process.exit(1);
  }

  const reset = args.includes('--reset');
  const idsArg = args.find((a) => a.startsWith('--ids='));
  const ids = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

  const sourceList = sourceArg === 'all' ? Object.keys(SOURCES) : [sourceArg];
  for (const sn of sourceList) {
    await runSource(sn, { reset, ids });
  }
  combineAll();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
