/**
 * Generate Friday Night Pulse + Drip or Drown SEO sitemaps from Firestore.
 *
 * Outputs (at repo root, committed to git so Vercel serves as static):
 *   sitemap-stadiums.xml — every published HS-venue stadium URL
 *   sitemap-schools.xml  — every drip-submitted school URL
 *
 * Run after seed/import/approval or any catalog change:
 *   node scripts/generate-sitemaps.js
 */

const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'firebase-admin-key.json');
const STADIUMS_OUT = path.join(__dirname, '..', 'sitemap-stadiums.xml');
const SCHOOLS_OUT  = path.join(__dirname, '..', 'sitemap-schools.xml');
const SITE = 'https://4thandward.com';

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateStadiums(db) {
  console.log('Fetching stadiums…');
  const snap = await db.collection('stadiums')
    .where('isHsVenue', '==', true)
    .where('isPublished', '==', true)
    .get();
  console.log(`  Loaded ${snap.size} HS stadiums.`);

  const urls = [];
  snap.forEach((d) => {
    const data = d.data();
    const lastMod = data.lastEditedAt || data.lastRatedAt || data.seededAt || Date.now();
    urls.push({
      slug: d.id,
      lastmod: new Date(lastMod).toISOString().split('T')[0],
      hasRatings: (data.ratingsCount || 0) > 0,
    });
  });
  urls.sort((a, b) => Number(b.hasRatings) - Number(a.hasRatings));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url>
    <loc>${SITE}/stadium/${escapeXml(u.slug)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.hasRatings ? 'weekly' : 'monthly'}</changefreq>
    <priority>${u.hasRatings ? '0.8' : '0.5'}</priority>
  </url>`),
    '</urlset>',
    '',
  ].join('\n');

  fs.writeFileSync(STADIUMS_OUT, xml);
  console.log(`  ✓ Wrote ${urls.length} URLs to ${path.relative(process.cwd(), STADIUMS_OUT)}`);
}

async function generateSchools(db) {
  console.log('Fetching drip submissions for schools…');
  const snap = await db.collection('drip_submissions')
    .where('approved', '==', true)
    .get();
  console.log(`  Loaded ${snap.size} approved submissions.`);

  // Aggregate unique schools by schoolKey (the slug used in URL filtering)
  const schoolMap = new Map();
  snap.forEach((d) => {
    const data = d.data();
    const key = data.schoolKey;
    if (!key) return;
    const prev = schoolMap.get(key);
    const ts   = data.submittedAt || 0;
    if (!prev || ts > prev.lastmod) {
      schoolMap.set(key, { slug: key, teamName: data.teamName, lastmod: ts });
    }
  });
  const schools = [...schoolMap.values()];
  schools.sort((a, b) => b.lastmod - a.lastmod);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...schools.map((s) => `  <url>
    <loc>${SITE}/dripordrown/${escapeXml(s.slug)}</loc>
    <lastmod>${new Date(s.lastmod || Date.now()).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`),
    '</urlset>',
    '',
  ].join('\n');

  fs.writeFileSync(SCHOOLS_OUT, xml);
  console.log(`  ✓ Wrote ${schools.length} URLs to ${path.relative(process.cwd(), SCHOOLS_OUT)}`);
}

async function main() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`Service account key not found: ${KEY_PATH}`);
    process.exit(1);
  }
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();

  await generateStadiums(db);
  await generateSchools(db);
}

main().catch((err) => {
  console.error('Sitemap generation failed:', err);
  process.exit(1);
});
