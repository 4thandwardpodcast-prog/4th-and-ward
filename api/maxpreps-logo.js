// api/maxpreps-logo.js
// Vercel serverless function
// Searches MaxPreps for a school and returns the mascot logo URL.
// Called by totw.html when a new nomination is submitted.
//
// Usage: GET /api/maxpreps-logo?q=Lone+Pine+High+School+Lone+Pine+CA
// Returns: { logoUrl: "https://image.maxpreps.io/..." } or { logoUrl: "" }

export default async function handler(req, res) {
  // CORS headers so the browser can call this from 4thandward.com
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const q = req.query.q || '';
  if (!q) return res.status(400).json({ logoUrl: '' });

  try {
    // MaxPreps school search API
    const searchUrl = 'https://www.maxpreps.com/api/school/search/query?q=' +
      encodeURIComponent(q) + '&limit=1';

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 4thAndWard/1.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.maxpreps.com'
      }
    });

    if (!response.ok) {
      // Try alternate MaxPreps search endpoint
      return await tryAlternateSearch(q, res);
    }

    const data = await response.json();

    // MaxPreps returns array of schools — grab first result's mascot image
    const schools = data?.data?.schools || data?.schools || data?.results || [];

    if (schools.length > 0) {
      const school = schools[0];

      // Try different possible logo URL fields
      const schoolId = school.schoolId || school.id || school.athleticSchoolId;
      const mascotId = school.mascotId || school.schoolMascotId;

      let logoUrl = '';

      // Method 1: Direct mascot image from school object
      if (school.mascotUrl) {
        logoUrl = school.mascotUrl;
      } else if (school.logoUrl) {
        logoUrl = school.logoUrl;
      } else if (schoolId) {
        // Method 2: Construct MaxPreps image URL from school ID
        // This is the standard format MaxPreps uses for mascot images
        logoUrl = `https://image.maxpreps.io/school-mascot/${schoolId}.gif?width=64&height=64&auto=webp&format=pjpg`;
      }

      return res.status(200).json({ logoUrl, schoolName: school.name || '' });
    }

    // No results found
    return res.status(200).json({ logoUrl: '' });

  } catch (e) {
    console.error('maxpreps-logo error:', e.message);
    return res.status(200).json({ logoUrl: '' });
  }
}

// Fallback: try MaxPreps' public suggest/autocomplete endpoint
async function tryAlternateSearch(q, res) {
  try {
    const url = 'https://www.maxpreps.com/api/school/search/autocomplete?q=' +
      encodeURIComponent(q) + '&limit=1';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 4thAndWard/1.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.maxpreps.com'
      }
    });

    if (!response.ok) return res.status(200).json({ logoUrl: '' });

    const data = await response.json();
    const items = data?.items || data?.data || data?.results || [];

    if (items.length > 0) {
      const item = items[0];
      const logoUrl = item.mascotUrl || item.logoUrl || item.imageUrl || '';
      return res.status(200).json({ logoUrl, schoolName: item.name || '' });
    }

    return res.status(200).json({ logoUrl: '' });
  } catch(e) {
    return res.status(200).json({ logoUrl: '' });
  }
}
