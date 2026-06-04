// Jimmys & Joes — shared utility helpers (slug, embeds, formatters).

// ── Slug generation ─────────────────────────────────────────────────
// "John Doe" + "QB" + "2027" => "john-doe-qb-2027"
// Caller must check uniqueness against existing prospect docs and append
// "-2", "-3" etc on collision (done in submission flow).
export function buildSlug(fullName, positionCode, classYear) {
  const name = String(fullName || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const pos  = String(positionCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const year = String(classYear || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [name, pos, year].filter(Boolean).join('-');
}

// ── Visitor ID (matches the existing site-wide pattern) ──────────────
export function getOrCreateVisitorId() {
  let v = localStorage.getItem('4ward_vid');
  if (!v) {
    v = 'v_' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem('4ward_vid', v);
  }
  return v;
}

// ── Height/weight formatters ────────────────────────────────────────
export function inchesToFeetInches(totalInches) {
  if (totalInches == null || isNaN(totalInches)) return '—';
  const ft = Math.floor(totalInches / 12);
  const inc = totalInches - ft * 12;
  return `${ft}'${inc}"`;
}

export function feetInchesToInches(ft, inc) {
  const f = parseInt(ft, 10);
  const i = parseInt(inc, 10);
  if (isNaN(f) || isNaN(i)) return null;
  return f * 12 + i;
}

export function formatWeight(lbs) {
  return lbs == null || isNaN(lbs) ? '—' : `${lbs} lbs`;
}

// ── Video embed parsing ─────────────────────────────────────────────
// Returns { type: 'youtube'|'hudl'|null, embedUrl, thumbUrl, rawId }
// Supports common YouTube URL shapes and Hudl share-link shapes.
export function parseHighlightUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  // ── YouTube ───────────────────────────────────────────────────────
  // youtu.be/<id> | youtube.com/watch?v=<id> | /shorts/<id> | /embed/<id>
  const yt =
    url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/))([A-Za-z0-9_-]{11})/);
  if (yt) {
    const id = yt[1];
    return {
      type: 'youtube',
      rawId: id,
      embedUrl: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`,
      thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }

  // ── Hudl ──────────────────────────────────────────────────────────
  // Long-share:  hudl.com/video/<a>/<b>/<id>  (b is the team/series id, not 0)
  // Short-share: hudl.com/v/<id>
  // The embed URL mirrors the path: /video/X → /embed/video/X. We store
  // the *full* suffix as the embedId so render-time doesn't have to
  // reconstruct the team segment.
  const hudlPath = url.match(/hudl\.com\/(?:video|embed\/video)\/([^?#]+?)\/?(?:[?#]|$)/);
  if (hudlPath) {
    const suffix = hudlPath[1];                       // "3/18397992/6a105e..."
    const lastSeg = suffix.split('/').pop();
    return {
      type: 'hudl',
      rawId: suffix,                                  // full path under /video/
      embedUrl: `https://www.hudl.com/embed/video/${suffix}`,
      thumbUrl: null,
      _legacyLastSeg: lastSeg,                        // for back-compat sniffs
    };
  }
  const hudlShort = url.match(/hudl\.com\/v\/([A-Za-z0-9_-]+)/);
  if (hudlShort) {
    const id = hudlShort[1];
    return {
      type: 'hudl',
      rawId: id,
      embedUrl: `https://www.hudl.com/embed/video/${id}`,
      thumbUrl: null,
    };
  }

  return null;
}

// ── HTML escaping ───────────────────────────────────────────────────
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ── Star rendering ──────────────────────────────────────────────────
// Renders a 0–5 star display (allowing halves) as HTML span content.
// `value` is a number 0–5; `count` is optional total raters.
export function renderStars(value, count = null) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const full  = Math.floor(v);
  const half  = (v - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const parts = [
    '★'.repeat(full),
    half ? '☆' : '',         // simple half-glyph (CSS can style if desired)
    '☆'.repeat(empty),
  ].join('');
  const countHtml = count != null ? ` <span class="jj-stars-count">(${count})</span>` : '';
  return `<span class="jj-stars" aria-label="${v.toFixed(1)} out of 5">${parts}</span>${countHtml}`;
}

// ── Average of a numeric array, safe for empty/missing ──────────────
export function safeAvg(arr) {
  const vals = (arr || []).filter(n => typeof n === 'number' && !isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
