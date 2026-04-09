/**
 * /api/proxy-image
 * Proxies school logo / stadium images from approved domains.
 * This is needed because MaxPreps and CDN images block direct browser requests
 * but allow server-to-server fetches with the right headers.
 */
export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  // Expanded allowlist — MaxPreps uses multiple CDN domains
  const ALLOWED = [
    'maxpreps.com',
    'maxpreps.io',
    'images.maxpreps.com',
    'fastly.net',        // MaxPreps CDN
    'akamaihd.net',      // MaxPreps CDN
    'cloudfront.net',    // AWS CDN (many school sites)
    'postimg.cc',        // Used for 4th & Ward logo
    'i.postimg.cc',
    'postimages.org',
  ];

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch (_) {
    return res.status(400).send('Invalid URL');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowed  = ALLOWED.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!allowed) {
    return res.status(403).json({ error: 'Domain not allowed', hostname });
  }

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':    'https://www.maxpreps.com/',
        'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });

    if (!response.ok) return res.status(response.status).send('Failed to fetch image');

    const contentType = response.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send('Proxy error: ' + e.message);
  }
}
