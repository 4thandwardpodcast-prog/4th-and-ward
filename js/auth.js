// Auth helpers for 4th & Ward.
// Wraps Firebase Auth (Google + email/password) and bootstraps a user profile
// document in Firestore on first sign-in.

import { auth, db } from './firebase-init.js';
import {
  GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification,
  updateProfile, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const googleProvider = new GoogleAuthProvider();

// ── User profile doc bootstrap ──────────────────────────────────────
// Called on every sign-in. Creates the users/{uid} doc on first login,
// updates lastLoginAt otherwise. Stores only fields the user is allowed
// to write per firestore.rules; admin-controlled fields (role, points,
// badges, streak) are set by Cloud Functions or admins only.
async function bootstrapUserDoc(user, extras = {}) {
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email || null,
      displayName: user.displayName || extras.displayName || (user.email ? user.email.split('@')[0] : 'Member'),
      photoURL: user.photoURL || null,
      provider: user.providerData?.[0]?.providerId || 'password',
      birthYear: extras.birthYear || null,
      ageVerified: extras.ageVerified === true,
      parentalConsent: extras.parentalConsent === true,
      acceptedPrivacyAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, { lastLoginAt: serverTimestamp() });
  }
  return ref;
}

// ── Public API ──────────────────────────────────────────────────────
export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await bootstrapUserDoc(cred.user);
  return cred.user;
}

export async function signUpWithEmail({ email, password, displayName, birthYear, parentalConsent }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  await bootstrapUserDoc(cred.user, {
    displayName, birthYear, ageVerified: true, parentalConsent
  });
  // Fire-and-forget verification email; don't block UI on failure.
  sendEmailVerification(cred.user).catch(() => {});
  return cred.user;
}

export async function signInWithEmail({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await bootstrapUserDoc(cred.user);
  return cred.user;
}

export async function sendResetEmail(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function signOutCurrent() {
  return signOut(auth);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function getUserDoc(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Human-readable error messages for the common Firebase Auth codes.
export function authErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/email-already-in-use': 'An account with that email already exists. Try logging in.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'No account with that email — try signing up.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'auth/popup-closed-by-user': 'Sign-in cancelled.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  return map[code] || err?.message || 'Something went wrong. Try again.';
}
