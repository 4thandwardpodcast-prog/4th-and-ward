export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate'); // cache 24hrs

  const { school, mascot, city, state } = req.query;
  if (!school || !state || !city) {
    return res.status(400).json({ error: 'Missing params' });
  }

  try {
    // Build MaxPreps slug: lowercase, spaces to hyphens, remove special chars
    const citySlug = city.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
    const stateSlug = state.toLowerCase().trim();

    // School name slug: remove "High School", lowercase, hyphenate
    const schoolClean = school
      .replace(/High School/gi, '').replace(/HS$/gi, '')
      .trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');

    const mascotClean = mascot
      ? mascot.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-')
      : '';

    const slug = mascotClean
      ? `${schoolClean}-${mascotClean}`
      : schoolClean;

    const maxprepsUrl = `https://www.maxpreps.com/${stateSlug}/${citySlug}/${slug}/`;

    const response = await fetch(maxprepsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const html = await response.text();

    // Try to find logo image in page source
    // MaxPreps embeds school data in __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/"logoUrl"\s*:\s*"([^"]+)"/);
    const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
    const imageMatch = html.match(/images\.maxpreps\.com\/[^"'\s]+(?:logo|school)[^"'\s]*\.(?:png|jpg|webp)/i);

    const logoUrl = nextDataMatch?.[1] || imageMatch?.[0] || null;

    return res.json({
      logoUrl: logoUrl ? (logoUrl.startsWith('http') ? logoUrl : 'https://' + logoUrl) : null,
      maxprepsUrl,
      slug,
    });

  } catch (e) {
    return res.json({ logoUrl: null, error: e.message });
  }
}
