// Dynamic sitemap for the Jimmys & Joes recruiting database.
// Pulls every approved prospect via the Firestore REST API (anonymous,
// rate-limited by status=='approved' rule) and emits a standard sitemap.xml
// of /jimmysandjoes/prospect/<slug> URLs.
//
// Wire-up:
//   - /sitemap-jimmys.xml  (rewritten in vercel.json)
//   - Reference from /sitemap.xml index entry
//   - Cached at the edge for 1 hour

const FIRESTORE_PROJECT = 'th-and-ward-b8f1c';
const FIRESTORE_KEY     = 'AIzaSyB5EJMsZT4WsfJjaFQ-srIdNwAINr7Q2yY';
const BASE_URL          = 'https://4thandward.com';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

  try {
    const prospects = await fetchApprovedProspects();
    const urls = prospects.map(p => ({
      loc: `${BASE_URL}/jimmysandjoes/prospect/${encodeURIComponent(p.slug)}`,
      lastmod: isoDate(p.lastRatedAt || p.submittedAt),
      changefreq: 'weekly',
      priority: '0.7',
    }));

    // Also include the J&J hub + sub-pages so they're explicitly indexed.
    const staticUrls = [
      { loc: `${BASE_URL}/jimmysandjoes`,                changefreq: 'daily',  priority: '0.9' },
      { loc: `${BASE_URL}/jimmysandjoes/leaderboards`,   changefreq: 'daily',  priority: '0.8' },
      { loc: `${BASE_URL}/jimmysandjoes/rankings`,       changefreq: 'daily',  priority: '0.8' },
      { loc: `${BASE_URL}/jimmysandjoes/scouts`,         changefreq: 'daily',  priority: '0.6' },
      { loc: `${BASE_URL}/jimmysandjoes/how-it-works`,   changefreq: 'monthly',priority: '0.5' },
      { loc: `${BASE_URL}/coach`,                        changefreq: 'monthly',priority: '0.5' },
    ];

    const xml = renderXml([...staticUrls, ...urls]);
    res.status(200).send(xml);
  } catch (err) {
    console.error('[jj-sitemap]', err);
    // Always emit *something* valid so search engines don't error out.
    res.status(200).send(renderXml([
      { loc: `${BASE_URL}/jimmysandjoes`, changefreq: 'daily', priority: '0.9' },
    ]));
  }
}

async function fetchApprovedProspects() {
  // Use the Firestore REST `:runQuery` endpoint. Field selection keeps
  // payload small. Pagination via `startAt` would be needed past ~1000;
  // for now, one query is plenty.
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery?key=${FIRESTORE_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'prospects' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'approved' },
        },
      },
      select: {
        fields: [
          { fieldPath: 'slug' },
          { fieldPath: 'lastRatedAt' },
          { fieldPath: 'submittedAt' },
        ],
      },
      limit: 5000,
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`firestore runQuery ${r.status}`);
  const arr = await r.json();
  const out = [];
  arr.forEach(row => {
    const fields = row.document?.fields;
    if (!fields) return;
    out.push({
      slug:        fields.slug?.stringValue || '',
      submittedAt: parseInt(fields.submittedAt?.integerValue || '0', 10),
      lastRatedAt: parseInt(fields.lastRatedAt?.integerValue || '0', 10),
    });
  });
  return out.filter(p => p.slug);
}

function isoDate(ms) {
  if (!ms) return new Date().toISOString().slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]
  ));
}

function renderXml(urls) {
  const items = urls.map(u => `
  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq || 'weekly'}</changefreq>
    <priority>${u.priority || '0.5'}</priority>
  </url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}
</urlset>`;
}
