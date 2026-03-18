# Automated PDF Grading Engine

This repository contains the monorepo for the Automated PDF Grading Engine, featuring a Next.js 14 frontend and a Firebase Cloud Functions backend powered by Node.js and Python.

## Monorepo Structure

- `apps/web/` - Next.js 14 application configured for static export (`out/`). Uses shadcn/ui and Tailwind CSS.
- `functions/grading/` - Python 3.12 Cloud Function designed for PDF grading via Gemini AI.
- `functions/quiz/` - Node.js 20 Cloud Function designed for quiz generation.
- `firebase.json` - Configuration mapping the deployments for hosting and the multiple function codebases.

## Prerequisites

- Node.js 20+
- Python 3.12+
- Firebase CLI (`npm install -g firebase-tools`)

## Setup

1. **Clone the repository** and navigate to the project root.
2. **Install web frontend dependencies**:
   ```bash
   cd apps/web
   npm install
   ```
3. **Environment Variables**:
   Copy `apps/web/.env.local.example` to `apps/web/.env.local` and fill in your Firebase project configuration.
   ```bash
   cp apps/web/.env.local.example apps/web/.env.local
   ```
4. **Install backend dependencies**:
   ```bash
   # For Node.js functions
   cd functions/quiz
   npm install
   
   # For Python functions (create virtual environment first)
   cd ../grading
   python3.12 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

## Local Development & Emulators

To run the entire suite locally including the Next.js frontend and Cloud Functions backend:

1. **Build the web app first** (Firebase emulator serves the static export build):
   ```bash
   npm run build --prefix apps/web
   ```
2. **Start the Firebase emulators**:
   From the project root, run:
   ```bash
   firebase emulators:start
   ```
   This will start emulators for Functions, Hosting, Firestore, etc.

## Deployment

A GitHub Actions workflow is provided in `.github/workflows/deploy.yml`. Upon pushing to `main`, it will build the Next.js static site and deploy both hosting and functions to Firebase. Ensure you have added the necessary `FIREBASE_TOKEN` and Firebase env vars to your GitHub Repository Secrets.

Alternatively, to deploy manually:
```bash
# Ensure the web app is built
npm run build --prefix apps/web

# Deploy Hosting and Functions
firebase deploy --only hosting,functions
```
