// Jimmys & Joes — "Rate a Random Jimmy" reusable module.
//
// Any <button data-jj-random> in the page auto-mounts a click handler that
// opens a small filter popover (Class / Position / Diamonds-only), picks
// one approved prospect at random, and navigates to their profile with
// `?from=random` (so the Cloud Function can later award a roll bonus).
//
// To seed from an existing in-memory list (e.g. on the hub page that has
// already fetched all approved prospects), call seedRandomCache(list).

import { db } from './firebase-init.js';
import {
  collection, query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { POSITIONS, classYearOptions, MIN_RATINGS_FOR_STARS } from './jj-config.js';

const CACHE_TTL_MS = 60 * 1000;
const FETCH_LIMIT  = 300;
let _cache = null;

export function seedRandomCache(list) {
  if (!Array.isArray(list)) return;
  _cache = { at: Date.now(), list: list.slice() };
}

async function fetchPool() {
  if (_cache && (Date.now() - _cache.at) < CACHE_TTL_MS) return _cache.list;
  const q = query(
    collection(db, 'prospects'),
    where('status', '==', 'approved'),
    orderBy('submittedAt', 'desc'),
    limit(FETCH_LIMIT)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  _cache = { at: Date.now(), list };
  return list;
}

export function applyRandomFilters(list, { classYear, position, diamondsOnly } = {}) {
  let pool = (list || []).slice();
  if (classYear) pool = pool.filter(p => p.classYear === classYear);
  if (position) pool = pool.filter(p =>
    p.primaryPosition === position ||
    (Array.isArray(p.secondaryPositions) && p.secondaryPositions.includes(position))
  );
  if (diamondsOnly) pool = pool.filter(p =>
    (p.jjRating || 0) >= 3.5 &&
    (p.ratingCount || 0) >= MIN_RATINGS_FOR_STARS &&
    (Array.isArray(p.offers) ? p.offers.length : 0) <= 2
  );
  return pool;
}

export async function rollRandomProspect(filters = {}, opts = {}) {
  const list = await fetchPool();
  let pool = applyRandomFilters(list, filters);
  if (opts.excludeSlug && pool.length > 1) {
    pool = pool.filter(p => p.slug !== opts.excludeSlug);
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function currentSlug() {
  // Prospect pages use ?slug=…; if present, we won't roll the same one.
  return new URLSearchParams(window.location.search).get('slug') || null;
}

// ── Popover UI ─────────────────────────────────────────────────────
// One popover per button; lazily built on first click, then reused.
function mountRandomButton(button) {
  if (!button || button._jjRandomMounted) return;
  button._jjRandomMounted = true;

  let popover = null;
  const state = { classYear: '', position: '', diamondsOnly: false };

  function buildPopover() {
    const pop = document.createElement('div');
    pop.className = 'jj-random-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Rate a Random Jimmy');
    pop.innerHTML = `
      <div class="jj-random-pop-head">
        <span>🎲 Roll a Random Jimmy</span>
        <button type="button" class="jj-random-pop-close" aria-label="Close">×</button>
      </div>
      <div class="jj-random-pop-body">
        <label class="jj-random-pop-field">
          <span>Class</span>
          <select data-field="classYear">
            <option value="">Any class</option>
            ${classYearOptions().map(y => `<option value="${y}">${y}</option>`).join('')}
          </select>
        </label>
        <label class="jj-random-pop-field">
          <span>Position</span>
          <select data-field="position">
            <option value="">Any position</option>
            ${POSITIONS.map(p => `<option value="${p.code}">${p.code} — ${p.label}</option>`).join('')}
          </select>
        </label>
        <label class="jj-random-pop-check">
          <input type="checkbox" data-field="diamondsOnly">
          <span>💎 Diamonds only <small>(high rated, ≤2 offers)</small></span>
        </label>
      </div>
      <div class="jj-random-pop-msg" hidden></div>
      <div class="jj-random-pop-foot">
        <button type="button" class="btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="btn-gold"  data-action="roll">🎲 Roll</button>
      </div>
    `;
    document.body.appendChild(pop);

    pop.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        const k = el.dataset.field;
        state[k] = (el.type === 'checkbox') ? el.checked : el.value;
      });
    });
    pop.querySelector('.jj-random-pop-close').addEventListener('click', closePopover);
    pop.querySelector('[data-action=cancel]').addEventListener('click', closePopover);
    pop.querySelector('[data-action=roll]').addEventListener('click', doRoll);
    pop.addEventListener('click', e => e.stopPropagation());

    return pop;
  }

  function positionPopover() {
    const POP_W = 300;
    const rect = button.getBoundingClientRect();
    const top  = rect.bottom + window.scrollY + 8;
    let left   = rect.left + window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - POP_W - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < window.scrollX + 12) left = window.scrollX + 12;
    popover.style.top  = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function openPopover() {
    if (!popover) popover = buildPopover();
    positionPopover();
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    document.addEventListener('click', outsideClickHandler);
    document.addEventListener('keydown', escHandler);
  }

  function closePopover() {
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    document.removeEventListener('click', outsideClickHandler);
    document.removeEventListener('keydown', escHandler);
  }

  function outsideClickHandler(e) {
    if (!popover || !popover.classList.contains('open')) return;
    if (e.target === button || button.contains(e.target)) return;
    if (popover.contains(e.target)) return;
    closePopover();
  }
  function escHandler(e) { if (e.key === 'Escape') closePopover(); }

  async function doRoll() {
    const rollBtn = popover.querySelector('[data-action=roll]');
    const msg = popover.querySelector('.jj-random-pop-msg');
    msg.hidden = true;
    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling…';
    try {
      const pick = await rollRandomProspect(state, { excludeSlug: currentSlug() });
      if (!pick) {
        msg.hidden = false;
        msg.textContent = 'No matching prospects. Try wider filters.';
        return;
      }
      const slug = encodeURIComponent(pick.slug);
      window.location.href = `/jimmysandjoes/prospect/${slug}?from=random`;
    } catch (err) {
      console.warn('[jj-random] roll failed:', err);
      msg.hidden = false;
      msg.textContent = 'Could not roll right now. Try again.';
    } finally {
      rollBtn.disabled = false;
      rollBtn.textContent = '🎲 Roll';
    }
  }

  button.addEventListener('click', e => {
    e.stopPropagation();
    if (popover && popover.classList.contains('open')) closePopover();
    else openPopover();
  });

  window.addEventListener('resize', () => {
    if (popover && popover.classList.contains('open')) positionPopover();
  });
}

// ── Auto-mount on DOM ready ────────────────────────────────────────
function autoMount() {
  document.querySelectorAll('[data-jj-random]').forEach(mountRandomButton);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount);
} else {
  autoMount();
}

// Re-scan when new buttons are inserted (the prospect page renders its
// action bar after fetching the prospect doc, so the buttons aren't in
// the DOM at script-load time).
const _observer = new MutationObserver(muts => {
  for (const m of muts) {
    m.addedNodes.forEach(n => {
      if (!(n instanceof HTMLElement)) return;
      if (n.matches?.('[data-jj-random]')) mountRandomButton(n);
      n.querySelectorAll?.('[data-jj-random]').forEach(mountRandomButton);
    });
  }
});
_observer.observe(document.body, { childList: true, subtree: true });

export { mountRandomButton };
