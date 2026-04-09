/**
 * /api/school-logo
 * Accepts EITHER:
 *   ?school=...&mascot=...&city=...&state=...   (structured — used by totw.html)
 *   ?q=...                                      (legacy single query string)
 *
 * Returns: { logoUrl, maxprepsUrl, slug, schoolColors }
 * schoolColors: { primary: '#hex', secondary: '#hex'|null } or null
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

  // ── Parse params — support both calling conventions ──────────────────
  let school = req.query.school || '';
  let mascot = req.query.mascot || '';
  let city   = req.query.city   || '';
  let state  = req.query.state  || '';

  // Legacy single-query fallback: ?q=Westlake High School Austin TX
  if (!school && req.query.q) {
    const parts = req.query.q.trim().split(/\s+/);
    if (parts.length >= 3) {
      state  = parts[parts.length - 1];
      city   = parts[parts.length - 2];
      school = parts.slice(0, parts.length - 2).join(' ');
    } else {
      school = req.query.q;
    }
  }

  if (!school) {
    return res.status(400).json({ error: 'Missing school name' });
  }

  try {
    // ── Build MaxPreps slug ───────────────────────────────────────────────
    const citySlug  = (city || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').trim();
    const stateSlug = (state || '').toLowerCase().trim();

    const schoolClean = school
      .replace(/\s+(High\s+School|Senior\s+High\s+School|Senior\s+High|High)\s*$/i, '')
      .trim().toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');

    const mascotClean = mascot
      ? mascot.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-')
      : '';

    const slug = mascotClean ? `${schoolClean}-${mascotClean}` : schoolClean;

    const urlsToTry = [];
    if (stateSlug && citySlug) {
      urlsToTry.push(`https://www.maxpreps.com/${stateSlug}/${citySlug}/${slug}/`);
      urlsToTry.push(`https://www.maxpreps.com/${stateSlug}/${citySlug}/${schoolClean}/`);
    }
    const mainUrl = urlsToTry[0] || '';

    let logoUrl     = null;
    let colors      = null;
    let maxprepsUrl = mainUrl;

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });
        if (!response.ok) continue;
        const html = await response.text();
        maxprepsUrl = url;

        // Strategy 1: Parse __NEXT_DATA__ JSON
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
          try {
            const jsonStr = nextDataMatch[1]; // parse as string for regex — avoids huge object traversal
            const logoKeys = ['"logoUrl"', '"teamLogoUrl"', '"schoolLogoUrl"', '"logoImageUrl"'];
            for (const key of logoKeys) {
              const m = jsonStr.match(new RegExp(key.replace('"','\\"') + '\\s*:\\s*"(https?:\\/\\/[^"]+)"'));
              if (m?.[1] && !m[1].includes('placeholder') && !m[1].includes('default')) {
                logoUrl = m[1]; break;
              }
            }
            // Colors
            const c1m = jsonStr.match(/"(?:primaryColor|schoolColor1|color1)"\s*:\s*"(#[0-9a-fA-F]{3,6})"/);
            const c2m = jsonStr.match(/"(?:secondaryColor|schoolColor2|color2)"\s*:\s*"(#[0-9a-fA-F]{3,6})"/);
            if (c1m?.[1]) colors = { primary: c1m[1], secondary: c2m?.[1] || null };
          } catch (_) {}
        }

        // Strategy 2: og:image
        if (!logoUrl) {
          const ogM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                   || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
          if (ogM?.[1] && ogM[1].includes('maxpreps')) logoUrl = ogM[1];
        }

        // Strategy 3: bare img tag
        if (!logoUrl) {
          const imgM = html.match(/https?:\/\/images\.maxpreps\.com\/[^"'\s]*(?:logo|school|team)[^"'\s]*\.(?:png|jpg|jpeg|webp)/i);
          if (imgM) logoUrl = imgM[0];
        }

        if (logoUrl) break;
      } catch (_) { continue; }
    }

    return res.json({
      logoUrl:      logoUrl || null,
      maxprepsUrl,
      slug,
      schoolColors: colors || null,
    });

  } catch (e) {
    return res.json({ logoUrl: null, error: e.message });
  }
}
