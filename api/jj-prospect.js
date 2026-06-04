// Server-rendered prospect page handler.
//
// Why this exists:
//   The site is otherwise static HTML. Social-media crawlers (Twitter,
//   Facebook, iMessage, LinkedIn) read the raw HTML head — they don't run
//   JS. So we can't set per-prospect og:image / title / description from
//   client-side JS and expect rich-preview cards to work.
//
//   This function intercepts /jimmysandjoes/prospect/<slug>, looks up the
//   prospect via the public Firestore REST API, and serves the static
//   template with the head meta tags rewritten to point at /api/jj-og
//   with the prospect's data baked into the query string.
//
//   The page body is unchanged — the existing client JS still loads the
//   profile from Firestore for the in-page render.
//
// Wire-up: see vercel.json — `/jimmysandjoes/prospect/<slug>` is routed
// here instead of directly to jimmysandjoes-prospect.html.

import fs from 'node:fs';
import path from 'node:path';

const FIRESTORE_PROJECT = 'th-and-ward-b8f1c';
const FIRESTORE_KEY     = 'AIzaSyB5EJMsZT4WsfJjaFQ-srIdNwAINr7Q2yY';
const BASE_URL          = 'https://4thandward.com';
const TEMPLATE_PATH     = path.join(process.cwd(), 'jimmysandjoes-prospect.html');

const POSITION_LABEL = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End',
  OL: 'Offensive Line', DL: 'Defensive Line', EDGE: 'Edge / DE', LB: 'Linebacker',
  CB: 'Cornerback', S: 'Safety', ATH: 'Athlete', K: 'Kicker', P: 'Punter', LS: 'Long Snapper',
};

export default async function handler(req, res) {
  // The slug comes from the Vercel rewrite as ?slug=…
  const slug = (req.query.slug || '').toString();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  // Always read the template so the response body is identical to the
  // static file — we only mutate the <head> meta tags.
  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    console.error('[jj-prospect] template read failed:', err);
    res.status(500).send('Server error');
    return;
  }

  // No slug? Just serve the template as-is — client JS will show the
  // "No prospect specified" empty state.
  if (!slug) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
    return;
  }

  // Look up the prospect via Firestore REST. Public reads succeed if
  // status=='approved' per firestore.rules. We tolerate failures: if the
  // lookup throws we serve the template unmodified rather than 500ing
  // (so the client-side fetch can still try).
  let prospect = null;
  try {
    prospect = await fetchProspect(slug);
  } catch (err) {
    console.warn('[jj-prospect] firestore lookup failed:', slug, err.message);
  }

  if (prospect) {
    html = injectMeta(html, prospect, slug);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(prospect ? 200 : 200).send(html);
}

async function fetchProspect(slug) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/prospects/${encodeURIComponent(slug)}?key=${FIRESTORE_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  return unwrap(data);
}

// Firestore REST returns documents with typed wrapper objects:
//   { fields: { foo: { stringValue: "bar" }, count: { integerValue: "5" } } }
// We collapse that to a plain object for templating.
function unwrap(doc) {
  if (!doc?.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = unwrapValue(v);
  }
  return out;
}
function unwrapValue(v) {
  if (!v) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(unwrapValue);
  if ('mapValue'       in v) {
    const out = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) out[k] = unwrapValue(vv);
    return out;
  }
  return null;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

function buildOgUrl(p) {
  const params = new URLSearchParams();
  params.set('n', p.fullName || '');
  params.set('p', p.primaryPosition || '');
  params.set('c', p.classYear || '');
  params.set('s', p.schoolName || '');
  if (typeof p.jjRating === 'number' && p.jjRating > 0) params.set('r', p.jjRating.toFixed(1));
  // Measurables blurb (short — fits on the OG card)
  const meas = [];
  if (typeof p.heightInches === 'number') {
    const ft = Math.floor(p.heightInches / 12);
    const inc = p.heightInches - ft * 12;
    meas.push(`${ft}'${inc}"`);
  }
  if (typeof p.weightLbs === 'number') meas.push(`${p.weightLbs} lbs`);
  const forty = p.testing?.fortyElectronic ?? p.testing?.fortyHand;
  if (typeof forty === 'number') meas.push(`${forty.toFixed(2)}s`);
  if (meas.length) params.set('m', meas.join(' · '));
  return `${BASE_URL}/api/jj-og?${params.toString()}`;
}

function injectMeta(html, p, slug) {
  const positionLabel = POSITION_LABEL[p.primaryPosition] || p.primaryPosition || '';
  const title = `${p.fullName} · ${p.primaryPosition || ''} · ${p.classYear || ''} — Jimmys & Joes`;
  const desc  = `${p.fullName}, ${positionLabel}, class of ${p.classYear || '—'}, ${p.schoolName || ''} (${p.city || ''}${p.city && p.state ? ', ' : ''}${p.state || ''}) — community-rated highlight reel and player profile on 4th & Ward.`;
  const canonical = `${BASE_URL}/jimmysandjoes/prospect/${encodeURIComponent(slug)}`;
  const ogImage = buildOgUrl(p);

  // Title
  html = html.replace(
    /<title[^>]*>[\s\S]*?<\/title>/,
    `<title id="page-title">${escapeAttr(title)}</title>`
  );
  // Description
  html = html.replace(
    /<meta id="meta-description"[^>]*>/,
    `<meta id="meta-description" name="description" content="${escapeAttr(desc)}">`
  );
  // OG title / desc / image / url
  html = html.replace(
    /<meta id="og-title"[^>]*>/,
    `<meta id="og-title" property="og:title" content="${escapeAttr(title)}">`
  );
  html = html.replace(
    /<meta id="og-description"[^>]*>/,
    `<meta id="og-description" property="og:description" content="${escapeAttr(desc)}">`
  );
  html = html.replace(
    /<meta id="og-image"[^>]*>/,
    `<meta id="og-image" property="og:image" content="${escapeAttr(ogImage)}">`
  );

  // Inject canonical + Twitter card tags + JSON-LD just before </head>.
  // Adding rather than replacing keeps the original template clean.
  const extra = `
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(desc)}">
  <meta name="twitter:image" content="${escapeAttr(ogImage)}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.fullName,
    jobTitle: `${positionLabel} (Class of ${p.classYear || '—'})`,
    affiliation: p.schoolName ? { '@type': 'EducationalOrganization', name: p.schoolName } : undefined,
    address: (p.city || p.state) ? {
      '@type': 'PostalAddress',
      addressLocality: p.city || undefined,
      addressRegion: p.state || undefined,
      addressCountry: 'US',
    } : undefined,
    aggregateRating: (typeof p.jjRating === 'number' && p.jjRating > 0 && p.ratingCount > 0) ? {
      '@type': 'AggregateRating',
      ratingValue: p.jjRating.toFixed(2),
      ratingCount: p.ratingCount,
      bestRating: 5, worstRating: 0,
    } : undefined,
    url: canonical,
  })}</script>
</head>`;
  html = html.replace(/<\/head>/, extra);

  return html;
}
