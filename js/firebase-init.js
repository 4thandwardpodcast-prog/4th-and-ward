// Shared Firebase initialisation for 4th & Ward.
// Loaded once per page; subsequent imports reuse the same app instance.
//
// Includes the Firebase config (the web config is safe to expose publicly —
// security is enforced by Firestore rules, not by hiding these strings).

import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyB5EJMsZT4WsfJjaFQ-srIdNwAINr7Q2yY",
  authDomain: "th-and-ward-b8f1c.firebaseapp.com",
  projectId: "th-and-ward-b8f1c",
  storageBucket: "th-and-ward-b8f1c.firebasestorage.app",
  messagingSenderId: "499057353962",
  appId: "1:499057353962:web:18f42748c242a6e0be2393"
};

export const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
