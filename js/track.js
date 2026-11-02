// Site analytics, loaded on every page through js/user-menu.js.
// Totals only: daily counts per page and per feature, never tied to a person.
// Also loads Vercel Analytics, which is plain HTML-friendly and needs no package.

import { db } from './firebase-init.js';
import { doc, setDoc, increment }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const isLive = !['localhost', '127.0.0.1'].includes(location.hostname);

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// /stadium/some-slug -> "stadium", /jimmysandjoes/prospect/x -> "jimmysandjoes-prospect"
function pageName() {
  const parts = location.pathname.toLowerCase().replace(/\.html$/, '').split('/').filter(Boolean);
  const name = ['jimmysandjoes', 'coach'].includes(parts[0]) && parts[1]
    ? `${parts[0]}-${parts[1]}`
    : (parts[0] || 'index');
  return name.replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'index';
}

function isNewVisitor() {
  try {
    if (localStorage.getItem('4ward_vid')) return false;
    localStorage.setItem('4ward_vid', 'v_' + Math.random().toString(36).slice(2) + Date.now());
    return true;
  } catch { return false; }
}

// Pages call window.trackEvent?.('name'), so a blocked tracker can't break a feature.
window.trackEvent = function trackEvent(name) {
  if (!isLive) return;
  const date = todayKey();
  setDoc(doc(db, 'analytics_events', `${name}_${date}`),
    { name, date, count: increment(1) }, { merge: true }).catch(() => {});
};

if (isLive) {
  const page = pageName();
  const date = todayKey();
  setDoc(doc(db, 'pageviews', `${page}_${date}`), {
    page, date,
    views: increment(1),
    allTime: increment(1),
    newVisitors: increment(isNewVisitor() ? 1 : 0),
  }, { merge: true }).catch(() => {});

  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
}
