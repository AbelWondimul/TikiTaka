import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Next.js build evaluates this file. We need to prevent it from crashing 
// if env vars aren't provided (e.g., during GitHub Actions static build).
let app, auth, db, storage, functions;

const connectToEmulators = (authInstance, dbInstance, storageInstance, functionsInstance) => {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && typeof window !== 'undefined') {
    if (global._firebaseEmulatorsConnected) return;
    try {
      connectAuthEmulator(authInstance, 'http://localhost:9099', { disableWarnings: true });
      connectFirestoreEmulator(dbInstance, 'localhost', 8081);
      connectStorageEmulator(storageInstance, 'localhost', 9199);
      connectFunctionsEmulator(functionsInstance, 'localhost', 5001);
      global._firebaseEmulatorsConnected = true;
      console.log('Successfully connected to Firebase Emulators');
    } catch (e) {
      console.warn("Firebase emulators already connected or failed to connect:", e);
    }
  }
};

if (typeof window !== "undefined" && !getApps().length && firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
  connectToEmulators(auth, db, storage, functions);
} else if (getApps().length > 0) {
  app = getApp();
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
  connectToEmulators(auth, db, storage, functions);
}

export { app, auth, db, storage, functions };
export default app;
