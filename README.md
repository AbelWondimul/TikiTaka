# 📚 TikiTaka: AI-Powered PDF Grading & Analytics 🚀

**TikiTaka** is an AI-powered PDF grading platform designed to help teachers grade faster and teach smarter. Instead of spending hours marking papers manually, teachers can upload student PDF assignments, and the system helps assign scores and place clear, inline feedback directly on the PDF. This allows students to see exactly what they did well and where they need to improve.

Beyond grading, TikiTaka helps teachers identify learning gaps across students and classes. It reveals which concepts students are missing, which chapters may need more review, and where teachers should focus their next lesson. Additionally, TikiTaka includes built-in quiz and practice support, recognizing that teachers spend considerable time creating questions, and that different students benefit from different styles of practice.

---

## 🌟 Key Features

### 📝 Smart PDF Grading & Inline Feedback
- **Visual Annotations**: Place red ink marks, explanations, and scores directly on student Assignments/Homeworks(PDFs) seamlessly.
- **AI-Assisted Marking**: Leverage Gemini AI to read equations, diagrams, and handwriting visually, adding layout-accurate annotations.
- **Actionable Feedback**: Students can see precisely where they succeeded or where they can improve right on their submissions.

### 📊 Learning Gap Analytics
- **Identify Concept Gaps**: View visual breakdowns of which questions or topics are causing the most trouble for your students.
- **Adapt Your Teaching**: Know exactly which chapters to review and where to focus in your next lesson.
- **Class vs. Student views**: Easily switch between broad class aggregates and deep dives into individual student progression.

### ❓ Smart Quiz & Practice Generation
- **Customized Questions**: Generate quizzes and tests in seconds that target student weak points or specific teaching goals.
- **Differentiated Learning**: Support different learning styles and speeds with varied practice problems that are generated automatically.

---

## 📂 Monorepo Structure

- **`apps/web/`** - Next.js 14 Application (Static export) using `shadcn/ui` & Tailwind.
- **`functions/grading/`** - Python 3.12 Cloud Function (Gemini AI grading logic).
- **`functions/quiz/`** - Node.js 20 Cloud Function (Quiz generation logic).
- **`firebase.json`** - Firebase deployment mapping & rules.

---

## 🛠️ Prerequisites

Ensure you have the following installed on your machine:
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
*Use this method for actual deployment or live cloud usage.*

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

## 👥 The Team

- **Abel Legesse** - CEO, Full Stack Engineer
- **Love Oluwaleye** - COO, Full Stack Engineer
- **Theint Han** - Product Manager
