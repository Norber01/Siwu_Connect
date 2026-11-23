import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!config.apiKey || !config.projectId) {
  throw new Error('Firebase is not configured. Copy apps/web/.env.example and fill in your project values.');
}

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (usingEmulators) {
  const host = window.location.hostname === 'localhost' ? 'localhost' : '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
