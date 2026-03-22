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

---

## 🚀 TikiTaka: The Future of Education 
### 👥 The Vision
TikiTaka is here to reclaim time for teachers and bring instant, visual, and actionable support to every student. We are building the AI-powered heart of the modern classroom, ensuring that feedback is not a delayed chore, but a real-time spark for learning.

### ⚠️ The Challenge We Conquer
Every week, millions of dedicated teachers lose over 10 hours of their lives to the exhausting grind of manual grading. Open-ended, step-by-step problem worksheets—the very core of learning—sink educators into burnout while students wait days to know where they stumbled. Manual efforts fail to scale, and existing platforms reduce learning to rigid multiple-choice boxes, leaving critical thinking behind. TikiTaka is here to eliminate this pain and restore the joy of teaching.

### ⏰ The Breakthrough: Why Now
We are standing on the edge of a golden age in educational technology. For the first time in history, multi-modal Generative AI can read the world visually, understanding the visual layout of equations, diagrams, and handwriting just like a human teacher. What was once impossible is now our foundation, and we are seizing this moment to rebuild grading for a digital-first era.

### 🛠️ A Magical Experience
TikiTaka transforms grading into a seamless, inspiring workflow where teachers upload rubrics and students simply submit their work. Behind the scenes, our advanced AI analyzes every step with golden-standard consistency, mapping continuous, coordinate-accurate visual annotations directly onto the PDF. Students receive the familiar "red-ink comments" they immediately recognize, empowering them to correct mistakes in the moment and accelerating their growth.

### 🔍 Intelligent Insights & Adaptive Growth
TikiTaka transcends traditional grading to illuminate the full spectrum of student mastery. Our platform instantly aggregates granular performance analytics, empowering teachers to see precisely where individual students struggle or where the entire group gets stuck. By highlighting these critical gaps, teachers know exactly what concepts to review and what they can confidently skip, reclaiming invaluable instruction time. To complete the circle of growth, TikiTaka’s AI generates bespoke practice questions tailored to each student's needs, turning assessment data into personalized, actionable learning journeys dashboards transparently support maps natively.

### 📈 An Unstoppable Tide
The demand for digital visual workflows in classrooms is expanding at an incredible pace. TikiTaka is perfectly positioned to capture the hearts of educators and district leaders alike, starting with high-fidelity visual STEM assessments that trigger viral classroom adoption and demand.

### 📢 The Momentum Movement
We ignite bottom-up district growth through powerful product-led cycles where teachers onboard students natively inside their natural workflows. This organic adoption creates an unstoppable groundswell, transforming individual classroom wins into rapid district-wide success stories.

### 📊 Proof of Concept
The foundation for this revolution is already standard. Our core Python AI Continuous Pipeline integrates seamlessly with Next.js dashboards and Firebase analytics, meaning the workspaces are alive, mapped, and ready for continuous scaling operations ahead ahead.

### ⚔️ The TikiTaka Edge
While other tools reduce student work to simple text strings and destroy physical layout context, TikiTaka proudly retains the spatial integrity of the page. We win because we preserve the canvas of thought, keeping the human touch alive with modern speed.

### 👑 The Team
Led by passionate builders and absolute operational expertise benchmarks setups mapping scaling token costs effectively safely frameworks ahead setups. 
- Abel Legesse - CEO, Full Stack Engineer
- Love Oluwaleye - COO, Full Stack Engineer
- Theint Han - COO,Product Manager

### 🔮 The Horizon
Over the next 5-10 years, TikiTaka will evolve into the definitive hybrid workspace dashboard, tracking detailed visual student progress anchoring spatial corrections continuous transparent overlays securely layout cleanly support sets safely. Together, we are building a world where no teacher is burned out and no student is left waiting for guidance.
