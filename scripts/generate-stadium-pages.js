/**
 * Generate static SEO landing pages — one per stadium — at /stadium/<slug>.html.
 *
 * Why: pulse-stadium.html sets per-stadium title/description via JS, which
 * Google can pick up but only on its second-pass renderer. Static stubs are
 * crawlable on the first pass, get indexed faster, and rank for queries like
 * "Eagle Stadium Allen TX" or "Friday Night Pulse Forney HS".
 *
 * Each stub is ~3 KB:
 *   - Full per-stadium <title>, meta description, OpenGraph + Twitter Card
 *   - JSON-LD SportsActivityLocation with AggregateRating when ratings exist
 *   - A small static body with the photo, h1, stats, and a "Rate this stadium"
 *     CTA pointing at the dynamic /pulse-stadium.html?slug=<slug>
 *
 * Run after seed/import or whenever stadium data changes:
 *   node scripts/generate-stadium-pages.js
 *
 * Output: stadium/<slug>.html files at the repo root, served by Vercel as
 * /stadium/<slug>.
 */

const fs = require('fs');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'firebase-admin-key.json');
const OUT_DIR  = path.join(__dirname, '..', 'stadium');
const SITE     = 'https://4thandward.com';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

function fmtCapacity(n) {
  if (!n) return null;
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

function buildStubHtml(s) {
  const slug    = s.slug || s.id;
  const url     = `${SITE}/stadium/${slug}`;
  const dynUrl  = `/pulse-stadium.html?slug=${encodeURIComponent(slug)}`;
  const teams   = (s.homeTeams || []).slice(0, 4).filter(Boolean);
  const cityLoc = `${s.city || ''}${s.state ? ', ' + s.state : ''}`;
  const photo   = s.photos?.[s.primaryPhotoIndex || 0]?.url || `${SITE}/logo.png`;

  const title = `${s.stadiumName} (${cityLoc}) — Friday Night Pulse | 4th & Ward`;
  const desc  = teams.length
    ? `Rate ${s.stadiumName} in ${cityLoc}, home of the ${teams.join(', ')}. Friday Night Pulse — atmosphere, crowd noise, home-field advantage.`
    : `Rate ${s.stadiumName} in ${cityLoc} on Friday Night Pulse — atmosphere, crowd noise, and home-field advantage.`;

  const stats = [];
  const cap = fmtCapacity(s.capacity);
  if (cap)            stats.push(`<li><strong>Capacity:</strong> ${escapeHtml(cap)}</li>`);
  if (s.yearOpened)   stats.push(`<li><strong>Built:</strong> ${escapeHtml(String(s.yearOpened))}</li>`);
  if (s.surface)      stats.push(`<li><strong>Surface:</strong> ${escapeHtml(s.surface)}</li>`);
  if (s.hasTrack === false) stats.push(`<li><strong>Track:</strong> No (no-track bonus)</li>`);
  else if (s.hasTrack === true) stats.push(`<li><strong>Track:</strong> Yes</li>`);
  if (s.county)       stats.push(`<li><strong>County:</strong> ${escapeHtml(s.county)}</li>`);
  if (s.owner)        stats.push(`<li><strong>Owner:</strong> ${escapeHtml(s.owner)}</li>`);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: s.stadiumName,
    url,
    image: photo,
    ...(s.city && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: s.city,
        addressRegion: s.state,
        ...(s.postalCode && { postalCode: s.postalCode }),
        addressCountry: 'US',
      },
    }),
    ...(typeof s.bayesianScore === 'number' && (s.ratingsCount || 0) > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: s.bayesianScore.toFixed(1),
        ratingCount: s.ratingsCount,
        bestRating: '10',
        worstRating: '1',
      },
    }),
  };

  const ratingBlurb = (s.ratingsCount || 0) > 0 && typeof s.bayesianScore === 'number'
    ? `<p class="score"><strong>Friday Night Pulse:</strong> ${s.bayesianScore.toFixed(1)} / 10 <span class="muted">· ${s.ratingsCount} rating${s.ratingsCount === 1 ? '' : 's'}</span></p>`
    : `<p class="score muted">No ratings yet — be the first to rate this stadium's pulse.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(desc)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="4th &amp; Ward">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(desc)}">
  <meta property="og:image" content="${escapeAttr(photo)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(desc)}">
  <meta name="twitter:image" content="${escapeAttr(photo)}">
  <link rel="icon" href="/logo.png">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700;800&family=Barlow+Condensed:wght@800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #080808; color: #F4F2ED; font-family: 'Barlow', sans-serif; line-height: 1.6; }
    a { color: inherit; }
    .nav { padding: 18px 24px; border-bottom: 1px solid #252525; }
    .nav a { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; color: #F5C518; text-decoration: none; font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 36px 24px 60px; }
    .hero-img { width: 100%; aspect-ratio: 16/10; object-fit: cover; background: #0a0a0a; border-radius: 8px; margin-bottom: 24px; }
    .eyebrow { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 12px; letter-spacing: 0.32em; text-transform: uppercase; color: #F5C518; margin-bottom: 10px; }
    h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: clamp(36px, 6vw, 56px); line-height: 0.95; letter-spacing: -0.01em; text-transform: uppercase; margin-bottom: 8px; }
    .city { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; color: #888884; margin-bottom: 20px; }
    .city .pill { display: inline-block; background: rgba(245,197,24,0.12); color: #F5C518; padding: 2px 8px; border-radius: 3px; font-size: 13px; margin-left: 6px; border: 1px solid rgba(245,197,24,0.3); }
    .teams { font-size: 14px; color: #888884; margin-bottom: 20px; }
    .teams strong { color: #F4F2ED; }
    .score { font-size: 16px; padding: 12px 16px; background: #111; border: 1px solid #252525; border-radius: 6px; margin-bottom: 24px; }
    .score strong { color: #F5C518; }
    .muted { color: #888884; }
    ul.stats { list-style: none; padding: 16px; background: #111; border: 1px solid #252525; border-radius: 6px; margin-bottom: 28px; }
    ul.stats li { padding: 6px 0; border-bottom: 1px dashed #1a1a1a; font-size: 14px; }
    ul.stats li:last-child { border-bottom: none; }
    ul.stats strong { color: #888884; font-weight: 700; margin-right: 8px; letter-spacing: 0.04em; }
    .cta { display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(180deg, #FFE066 0%, #F5C518 50%, #D9AC10 100%); color: #0a0a0a; padding: 14px 28px; border: 1px solid rgba(255,215,64,0.5); border-radius: 4px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 14px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; box-shadow: 0 6px 20px rgba(245,197,24,0.32); }
    .cta:hover { transform: translateY(-2px); }
    .meta-foot { margin-top: 28px; font-size: 12px; color: #888884; padding-top: 18px; border-top: 1px solid #252525; }
    .meta-foot a { color: #F5C518; text-decoration: underline; }
  </style>
</head>
<body>
  <header class="nav"><a href="/">4th &amp; Ward</a> &nbsp;·&nbsp; <a href="/pulse">Friday Night Pulse</a></header>
  <main class="wrap">
    <img class="hero-img" src="${escapeAttr(photo)}" alt="${escapeAttr(s.stadiumName)}" loading="eager">
    <div class="eyebrow">Friday Night Pulse</div>
    <h1>${escapeHtml(s.stadiumName)}</h1>
    <div class="city">${escapeHtml(s.city || '')}<span class="pill">${escapeHtml(s.state || '')}</span></div>
    ${teams.length ? `<p class="teams">Home of: <strong>${teams.map(escapeHtml).join('</strong>, <strong>')}</strong></p>` : ''}
    ${ratingBlurb}
    ${stats.length ? `<ul class="stats">${stats.join('')}</ul>` : ''}
    <a class="cta" href="${dynUrl}">⚡ Rate, comment, view photos →</a>
    <p class="meta-foot">
      ${escapeHtml(s.stadiumName)} is a high school football venue${cityLoc ? ` in ${escapeHtml(cityLoc)}` : ''}${teams.length ? `, home of the ${teams.map(escapeHtml).join(' and ')}` : ''}.
      Help build the Friday Night Pulse leaderboard by rating its atmosphere, crowd noise, and home-field advantage.
      <a href="${dynUrl}">Open the live page →</a>
    </p>
  </main>
</body>
</html>
`;
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
    .where('isHsVenue',   '==', true)
    .where('isPublished', '==', true)
    .get();
  console.log(`Loaded ${snap.size} HS stadiums.`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let totalBytes = 0;
  snap.forEach((d) => {
    const data = d.data();
    const slug = d.id;
    const html = buildStubHtml({ ...data, slug });
    const outPath = path.join(OUT_DIR, `${slug}.html`);
    fs.writeFileSync(outPath, html);
    written++;
    totalBytes += html.length;
    if (written % 500 === 0) console.log(`  ${written}/${snap.size}`);
  });

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`\n✓ Generated ${written} stadium pages (${mb} MB) in ${path.relative(process.cwd(), OUT_DIR)}/`);
  console.log('  Commit them + push so Vercel serves them at /stadium/<slug>.');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
