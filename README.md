# 📚 Automated PDF Grading Engine

The Automated PDF Grading Engine is a monorepo containing a Next.js 14 frontend and Firebase Cloud Functions backend powered by Node.js and Python. It uses Gemini AI to visually grade student submissions with spatial coordinates.

---

## 🚀 Vision & Core Concept

**TikiTaka** reclaim time for teachers and bring instant, visual, and actionable support to every student. By leveraging multi-modal Generative AI, we can read equations, diagrams, and handwriting visually, adding layout-accurate annotations directly to student PDFs.

---

## 📂 Monorepo Structure

- `apps/web/` - Next.js 14 Application (Static export)
- `functions/grading/` - Python 3.12 Cloud Function (Gemini AI grading)
- `functions/quiz/` - Node.js 20 Cloud Function (Quiz generation)
- `firebase.json` - Firebase deployment mapping

---

## 🛠️ Prerequisites

Ensure you have the following installed:
- **Node.js**: 20+
- **Python**: 3.12+
- **Firebase CLI**: `npm install -g firebase-tools`

---

## 💻 Setup & Installation

### 1. General Workspace Initialization

1. Clone the repository and navigate to the project root.
2. Install frontend dependencies:
   ```bash
   cd apps/web
   npm install
   ```
3. Install Node backend dependencies:
   ```bash
   cd ../../functions/quiz
   npm install
   ```
4. Install Python backend dependencies:
   ```bash
   cd ../grading
   python3.12 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

---

## 🟢 Option 1: Setup with Firebase Account (Real Backend)
*Use this method for actual deployment or if you are not running local test emulators.*

### 1. Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and follow the setup steps.
3. Enable the following services in the console:
   - **Firestore Database**
   - **Authentication** (Enable Email/Password or preferred methods)
   - **Storage**
   - **Functions** (Requires Blaze pay-as-you-go plan for deployment)

### 2. Environment Variables Setup
Copy the example environment file and fill in your keys:
```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Open `apps/web/.env.local` and configure your credentials:
- `NEXT_PUBLIC_FIREBASE_API_KEY`: Your Firebase project Web API Key
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: `<your-project-id>.firebaseapp.com`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: `<your-project-id>`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: `<your-project-id>.firebasestorage.app`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Your Sender ID
- `NEXT_PUBLIC_FIREBASE_APP_ID`: Your Web App ID
- `TEACHER_INVITE_TOKEN`: Arbitrary token for auth gates
- `GEMINI_API_KEY`: Your Google AI Studio Gemini API Key

### 3. Deployment
```bash
# Build the Next.js static site
npm run build --prefix apps/web

# Deploy to Firebase
firebase deploy
```

---

## 🟡 Option 2: Local Development with Firebase Emulators
*Use this method to test locally without deploying to a live account.*

1. **Build the web app first** (The Firebase emulator serves the static export build):
   ```bash
   npm run build --prefix apps/web
   ```
2. **Start the Firebase emulators**:
   From the project root, run:
   ```bash
   firebase emulators:start
   ```
   This will start emulators for Functions, Hosting, Firestore, and Auth.

---

## 🚢 CI/CD & Automation

A GitHub Actions workflow is provided in `.github/workflows/deploy.yml`. Upon pushing to `main`, it builds and deploys using a configured `FIREBASE_TOKEN`.

---

## 👥 The Team

- **Abel Legesse** - CEO, Full Stack Engineer
- **Love Oluwaleye** - COO, Full Stack Engineer
- **Theint Han** - Product Manager
