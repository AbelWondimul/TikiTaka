# 🚀 setup and Deployment Guide

This guide details how to install, configure, and deploy the new features related to the **AI Grading Engine** includes Python Cloud Functions, Firestore Security Rules, and Composite Indexes.

---

## 📋 1. Prerequisites
- [ ] [Firebase CLI](https://firebase.google.com/docs/cli) installed and logged in (`firebase login`)
- [ ] [Python 3.12+](https://www.python.org/downloads/) installed on your machine
- [ ] Node.js 18+ for the frontend app

---

## 🐍 2. Cloud Functions Setup (Python)

The core grading pipeline resides in `functions/grading/main.py`.

### 📦 A. Install Dependencies
Navigate into the functions directory and ensure requirements are up-to-date:
```bash
cd functions/grading
pip install -r requirements.txt
```
*If you are using a virtual environment (Venv), activate it first:*
```bash
source venv/bin/activate
pip install -r requirements.txt
```

### 🔑 B. Configure API Keys (Secrets)
The grading engine uses **Gemini 2.5** and requires an API key setup using Firebase Secrets Manager:
```bash
firebase functions:secrets:set GEMINI_API_KEY
```
When prompted, paste your **Google AI Studio** API Key string.

---

## 🚀 3. Deploying to Firebase

You can deploy the grading engine using the standard deployment commands:

### 🔥 A. Deploy Cloud Functions
To deploy the background triggers (`grade_pdf`) and other callable hooks:
```bash
firebase deploy --only functions:grade_pdf
```

### 🔒 B. Deploy Security Rules
To apply the updated client-side permissions (allowing teachers to access overrides panels):
```bash
firebase deploy --only firestore:rules
```

### 📊 C. Deploy Composite Indexes
To optimize queries for students viewing grading summaries sequentially:
```bash
firebase deploy --only firestore:indexes
```

### 🗄️ D. Deploy Storage Rules
To apply the updated permissions allowing assignment uploads:
```bash
firebase deploy --only storage
```

---

## 🖥 4. Local Frontend Testing (Next.js)

To run the web application detailing Student and Teacher views:
```bash
# Navigate to web root
cd apps/web

# Install dependencies if you haven't already
npm install

# Start the Node.js server
npm run dev
```

The server will be live at `http://localhost:3000`. 

### 💡 Troubleshooting
If you experience "Missing or Insufficient Permissions" on Grade overrides:
1. Double-check that `firestore.rules` rule updates are fully deployed.
2. Confirm the user authenticated role is set to `teacher` accurately.
