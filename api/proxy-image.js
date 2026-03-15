export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  // Only allow maxpreps image domains
  if (!url.includes('maxpreps') && !url.includes('maxpreps.io')) {
    return res.status(403).send('Domain not allowed');
  }

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.maxpreps.com/',
      }
    });

    if (!response.ok) return res.status(response.status).send('Failed to fetch image');

    const contentType = response.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch(e) {
    res.status(500).send('Proxy error: ' + e.message);
  }
}
