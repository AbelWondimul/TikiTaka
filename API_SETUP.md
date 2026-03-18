# Environment Setup Guide

To get the application fully functional, we need to connect the frontend to the new Firebase project (`grader-engine-app-2026`). 

Please follow the instructions below to find your API keys and paste them into this file:

### Firebase Client Credentials (for the Web Frontend)
These are found in the Firebase Console:
1. Go to Project Settings (the gear icon next to "Project Overview").
2. Scroll down to the "Your apps" section.
3. If there are no apps, click the `</>` (Web) icon to add a web app.
4. Name the app "Web Client" and register it.
5. In the configuration block that appears, you will find the `firebaseConfig` object.

Paste the values here:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=grader-engine-app-2026
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

### Additional Keys
1. **Teacher Invite Token:** A secret string used to grant "teacher" roles to users on sign up.
```env
TEACHER_INVITE_TOKEN=
```

2. **Google Generative AI Key (Gemini):** Used by the `grade_pdf` Cloud Function.
```env
GEMINI_API_KEY=
```

---
*Note: Once you fill out the values above, let me know and I will copy them over to the appropriate `.env.local` frontend and backend configuration!*
