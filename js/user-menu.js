// Renders the header user menu (login button when signed-out,
// avatar dropdown when signed-in) and the auth modal (Google + email).
//
// Mount: any page that loads this module gets the user menu injected into
// <li id="nav-user-slot"></li> in the header nav, and the auth modal
// appended to <body>. Other pages can also call openAuthModal() directly.

import {
  signInWithGoogle, signUpWithEmail, signInWithEmail,
  sendResetEmail, signOutCurrent, onAuthChange, authErrorMessage,
  getUserDoc
} from './auth.js';

const CURRENT_YEAR = new Date().getFullYear();

let modalOverlay;
let currentUser = null;
let currentUserDoc = null;
let modalMode = 'login'; // 'login' | 'signup' | 'reset'

// ── Header menu ─────────────────────────────────────────────────────
function renderMenu() {
  const slot = document.getElementById('nav-user-slot');
  if (!slot) return;
  if (!currentUser) {
    slot.innerHTML = `
      <button type="button" class="user-menu-login" id="open-auth-modal">Log In</button>
    `;
    document.getElementById('open-auth-modal')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }
  const name = currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Member');
  const initial = (name[0] || 'M').toUpperCase();
  const avatar = currentUser.photoURL
    ? `<span class="user-menu-avatar"><img src="${escapeAttr(currentUser.photoURL)}" alt=""></span>`
    : `<span class="user-menu-avatar">${escapeHtml(initial)}</span>`;
  slot.innerHTML = `
    <div class="user-menu">
      <button type="button" class="user-menu-trigger" id="user-menu-trigger">
        ${avatar}
        <span>${escapeHtml(name)}</span>
        <span class="user-menu-caret">▾</span>
      </button>
      <div class="user-menu-dropdown" id="user-menu-dropdown" role="menu">
        <div class="user-menu-dropdown-header">
          <div class="user-menu-dropdown-name">${escapeHtml(name)}</div>
          <div class="user-menu-dropdown-email">${escapeHtml(currentUser.email || '')}</div>
        </div>
        <a href="/account" role="menuitem">My Account</a>
        ${currentUserDoc?.role === 'coach'
          ? `<a href="/coach/dashboard" role="menuitem">Coach Dashboard</a>`
          : `<a href="/coach" role="menuitem">For Coaches</a>`}
        <button type="button" id="user-menu-signout" role="menuitem">Sign Out</button>
      </div>
    </div>
  `;
  const trigger  = document.getElementById('user-menu-trigger');
  const dropdown = document.getElementById('user-menu-dropdown');
  trigger?.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!dropdown?.contains(e.target) && e.target !== trigger) {
      dropdown?.classList.remove('open');
    }
  });
  document.getElementById('user-menu-signout')?.addEventListener('click', async () => {
    try { await signOutCurrent(); } catch (_) {}
    dropdown?.classList.remove('open');
  });
}

// ── Auth modal ──────────────────────────────────────────────────────
function buildModal() {
  if (modalOverlay) return;
  modalOverlay = document.createElement('div');
  modalOverlay.className = 'auth-modal-overlay';
  modalOverlay.id = 'auth-modal-overlay';
  modalOverlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button type="button" class="auth-modal-close" id="auth-modal-close" aria-label="Close">×</button>
      <div id="auth-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modalOverlay);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeAuthModal();
  });
  document.getElementById('auth-modal-close').addEventListener('click', closeAuthModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeAuthModal();
  });
}

export function openAuthModal(mode = 'login') {
  buildModal();
  modalMode = mode;
  renderModalBody();
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeAuthModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

function renderModalBody() {
  const body = document.getElementById('auth-modal-body');
  if (!body) return;
  if (modalMode === 'signup')      body.innerHTML = signupHtml();
  else if (modalMode === 'reset')  body.innerHTML = resetHtml();
  else                              body.innerHTML = loginHtml();
  attachModalHandlers();
}

function loginHtml() {
  return `
    <h2 class="auth-modal-title" id="auth-modal-title">Log In</h2>
    <p class="auth-modal-sub">Welcome back to 4th &amp; Ward.</p>

    <div class="auth-error" id="auth-error" hidden></div>

    <button type="button" class="auth-google-btn" id="auth-google">
      ${googleIconSvg()}
      Continue with Google
    </button>

    <div class="auth-divider">or</div>

    <form id="auth-login-form" novalidate>
      <div class="auth-field">
        <label for="auth-login-email">Email</label>
        <input id="auth-login-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="auth-login-password">Password</label>
        <input id="auth-login-password" type="password" autocomplete="current-password" required>
      </div>
      <button type="button" class="auth-reset-link" id="auth-show-reset">Forgot password?</button>
      <button type="submit" class="auth-submit">Log In</button>
    </form>

    <div class="auth-swap">
      New here? <button type="button" id="auth-show-signup">Create an account</button>
    </div>
  `;
}

function signupHtml() {
  const yearOptions = [''].concat(
    Array.from({ length: 90 }, (_, i) => CURRENT_YEAR - 12 - i)
  ).map(y => `<option value="${y}">${y || 'Select year…'}</option>`).join('');
  return `
    <h2 class="auth-modal-title" id="auth-modal-title">Create Account</h2>
    <p class="auth-modal-sub">Join the 4th &amp; Ward community.</p>

    <div class="auth-error" id="auth-error" hidden></div>

    <button type="button" class="auth-google-btn" id="auth-google">
      ${googleIconSvg()}
      Continue with Google
    </button>

    <div class="auth-divider">or</div>

    <form id="auth-signup-form" novalidate>
      <div class="auth-field">
        <label for="auth-signup-name">Display name</label>
        <input id="auth-signup-name" type="text" autocomplete="nickname" required minlength="2" maxlength="40">
      </div>
      <div class="auth-field">
        <label for="auth-signup-email">Email</label>
        <input id="auth-signup-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="auth-signup-password">Password (8+ characters)</label>
        <input id="auth-signup-password" type="password" autocomplete="new-password" required minlength="8">
      </div>
      <div class="auth-field">
        <label for="auth-signup-birthyear">Birth year</label>
        <select id="auth-signup-birthyear" required>${yearOptions}</select>
      </div>
      <label class="auth-checkbox" id="auth-parental-wrap" style="display:none;">
        <input type="checkbox" id="auth-parental">
        <span>I have a parent or guardian's permission to use this site.</span>
      </label>
      <label class="auth-checkbox">
        <input type="checkbox" id="auth-tos" required>
        <span>I agree to the <a href="/privacy" target="_blank">Privacy Policy &amp; Terms</a>.</span>
      </label>
      <button type="submit" class="auth-submit">Create Account</button>
    </form>

    <div class="auth-swap">
      Already a member? <button type="button" id="auth-show-login">Log in</button>
    </div>
  `;
}

function resetHtml() {
  return `
    <h2 class="auth-modal-title" id="auth-modal-title">Reset Password</h2>
    <p class="auth-modal-sub">We'll email you a link to set a new one.</p>

    <div class="auth-error"   id="auth-error"   hidden></div>
    <div class="auth-success" id="auth-success" hidden></div>

    <form id="auth-reset-form" novalidate>
      <div class="auth-field">
        <label for="auth-reset-email">Email</label>
        <input id="auth-reset-email" type="email" autocomplete="email" required>
      </div>
      <button type="submit" class="auth-submit">Send Reset Link</button>
    </form>

    <div class="auth-swap">
      <button type="button" id="auth-show-login">Back to log in</button>
    </div>
  `;
}

function attachModalHandlers() {
  document.getElementById('auth-show-login')?.addEventListener('click', () => { modalMode = 'login';  renderModalBody(); });
  document.getElementById('auth-show-signup')?.addEventListener('click', () => { modalMode = 'signup'; renderModalBody(); });
  document.getElementById('auth-show-reset')?.addEventListener('click',  () => { modalMode = 'reset';  renderModalBody(); });

  document.getElementById('auth-google')?.addEventListener('click', async () => {
    showError(null);
    try {
      await signInWithGoogle();
      closeAuthModal();
    } catch (e) {
      showError(authErrorMessage(e));
    }
  });

  // Toggle the parental-consent checkbox based on birth year (under 18).
  const birthSelect = document.getElementById('auth-signup-birthyear');
  birthSelect?.addEventListener('change', () => {
    const y = parseInt(birthSelect.value, 10);
    const age = isNaN(y) ? null : CURRENT_YEAR - y;
    const wrap = document.getElementById('auth-parental-wrap');
    if (wrap) wrap.style.display = (age != null && age < 18) ? 'flex' : 'none';
  });

  document.getElementById('auth-login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showError(null);
    const submit = e.target.querySelector('.auth-submit');
    submit.disabled = true;
    try {
      await signInWithEmail({
        email: document.getElementById('auth-login-email').value.trim(),
        password: document.getElementById('auth-login-password').value
      });
      closeAuthModal();
    } catch (err) {
      showError(authErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('auth-signup-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showError(null);

    const name = document.getElementById('auth-signup-name').value.trim();
    const email = document.getElementById('auth-signup-email').value.trim();
    const password = document.getElementById('auth-signup-password').value;
    const birthYear = parseInt(document.getElementById('auth-signup-birthyear').value, 10);
    const tosOk = document.getElementById('auth-tos').checked;
    const parentalOk = document.getElementById('auth-parental')?.checked;

    if (!name || name.length < 2)   { showError('Please enter a display name.'); return; }
    if (password.length < 8)         { showError('Password must be at least 8 characters.'); return; }
    if (!birthYear)                  { showError('Please select your birth year.'); return; }
    if (!tosOk)                      { showError('You must agree to the Privacy Policy & Terms to continue.'); return; }

    const age = CURRENT_YEAR - birthYear;
    if (age < 13)                    { showError('You must be at least 13 to create an account.'); return; }
    if (age < 18 && !parentalOk)     { showError('Users under 18 need a parent or guardian’s permission.'); return; }

    const submit = e.target.querySelector('.auth-submit');
    submit.disabled = true;
    try {
      await signUpWithEmail({
        email, password, displayName: name, birthYear,
        parentalConsent: age < 18 ? !!parentalOk : false
      });
      closeAuthModal();
    } catch (err) {
      showError(authErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('auth-reset-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    showError(null);
    showSuccess(null);
    const submit = e.target.querySelector('.auth-submit');
    submit.disabled = true;
    try {
      await sendResetEmail(document.getElementById('auth-reset-email').value.trim());
      showSuccess('Check your email for a reset link.');
    } catch (err) {
      showError(authErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });
}

function showError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = msg; el.hidden = false;
}
function showSuccess(msg) {
  const el = document.getElementById('auth-success');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = msg; el.hidden = false;
}

// ── Boot ────────────────────────────────────────────────────────────
onAuthChange(async user => {
  currentUser = user || null;
  currentUserDoc = null;
  renderMenu();
  // Fire the event right away so pages don't have to wait on the user-doc fetch.
  window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: currentUser } }));
  // Fetch the user doc so the dropdown can show the "Coach Dashboard" link.
  if (user) {
    try {
      currentUserDoc = await getUserDoc(user.uid);
      renderMenu();   // rerender once we know the role
    } catch (_) { /* no-op */ }
  }
});

// Allow other code to programmatically open the modal.
window.openAuthModal = openAuthModal;

// ── Mobile hamburger nav ────────────────────────────────────────────
// Injects a hamburger button into the page's <nav> and toggles a
// .nav-open class for CSS to swap to drawer mode. Closes on outside
// click, link tap, or Escape.
function mountMobileNav() {
  const nav = document.querySelector('nav');
  if (!nav || nav.querySelector('.nav-mobile-btn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-mobile-btn';
  btn.setAttribute('aria-label', 'Toggle menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';

  // Sit right after the logo so it's the rightmost element on mobile.
  const links = nav.querySelector('.nav-links');
  if (links) nav.insertBefore(btn, links);
  else nav.appendChild(btn);

  function close() {
    nav.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function toggle() {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // Close on outside click
  document.addEventListener('click', e => {
    if (!nav.classList.contains('nav-open')) return;
    if (nav.contains(e.target)) return;
    close();
  });
  // Close on link tap so navigation feels natural
  links?.addEventListener('click', e => {
    if (e.target.closest('a')) close();
  });
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('nav-open')) close();
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountMobileNav);
} else {
  mountMobileNav();
}

// ── Utilities ───────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function googleIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
  </svg>`;
}
