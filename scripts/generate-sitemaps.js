/**
 * Generate sitemap-stadiums.xml from Firestore.
 *
 * Lists every published HS-venue stadium as a clean URL
 * (https://4thandward.com/stadium/<slug>) for Google to crawl.
 *
 * Run after seed/import or after any catalog change:
 *   node scripts/generate-sitemaps.js
 *
 * Output: sitemap-stadiums.xml at the repo root (committed to git so
 * Vercel serves it as a static file).
 */

const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'firebase-admin-key.json');
const OUT_PATH = path.join(__dirname, '..', 'sitemap-stadiums.xml');
const SITE = 'https://4thandward.com';

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

  console.log('Fetching stadiums…');
  const snap = await db.collection('stadiums')
    .where('isHsVenue', '==', true)
    .where('isPublished', '==', true)
    .get();
  console.log(`Loaded ${snap.size} HS stadiums.`);

  const urls = [];
  snap.forEach((d) => {
    const data = d.data();
    const slug = d.id;
    const lastMod = data.lastEditedAt || data.lastRatedAt || data.seededAt || Date.now();
    urls.push({
      slug,
      lastmod: new Date(lastMod).toISOString().split('T')[0],
      hasRatings: (data.ratingsCount || 0) > 0,
    });
  });

  // Most "interesting" pages first (rated stadiums) — Google may prefer these
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

  fs.writeFileSync(OUT_PATH, xml);
  console.log(`✓ Wrote ${urls.length} URLs to ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error('Sitemap generation failed:', err);
  process.exit(1);
});
