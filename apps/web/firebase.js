import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

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

if (typeof window !== "undefined" && !getApps().length && firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  
  const siteKey = "6Lewy5MsAAAAADhQ1f0VgnE0LoYVF4N25dTJ-w5f"; // Replace with your reCAPTCHA v3 site key
  if (siteKey && siteKey !== "YOUR_RECAPTCHA_V3_SITE_KEY") {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
  }
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
} else if (getApps().length > 0) {
  app = getApp();
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app);
}

export { app, auth, db, storage, functions };
export default app;
