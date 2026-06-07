# TikiTaka — Automated PDF Grading Engine

TikiTaka is an AI-powered grading platform for teachers and students. Teachers upload rubrics and reference materials; students submit PDF or typed homework. A Python Cloud Function uses Gemini 2.5 Flash to grade submissions with spatially-annotated feedback drawn directly onto each PDF page — handling handwriting, equations, and diagrams.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Monorepo Structure](#monorepo-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Option 1 — Real Firebase Backend](#option-1--real-firebase-backend)
- [Option 2 — Local Emulators](#option-2--local-emulators)
- [Deployment](#deployment)
- [Feature Reference — Students](#feature-reference--students)
- [Feature Reference — Teachers](#feature-reference--teachers)
- [Feature Reference — TAs](#feature-reference--tas)
- [Cloud Functions Reference](#cloud-functions-reference)
- [Auth Flow](#auth-flow)
- [Firestore Data Model](#firestore-data-model)
- [Storage Paths](#storage-paths)
- [Key Utilities & Components](#key-utilities--components)
- [Testing Guide](#testing-guide)
- [CI/CD](#cicd)
- [Troubleshooting](#troubleshooting)
- [The Team](#the-team)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Next.js 14 Frontend                   │
│          (Static Export → Firebase Hosting)             │
│   Pages Router · ShadCN/Radix · Tailwind · TipTap       │
└────────────────────────┬────────────────────────────────┘
                         │ Firebase SDK (Auth, Firestore, Storage, Callable)
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌─────────────────────┐     ┌─────────────────────────────┐
│  functions/grading/ │     │       functions/quiz/       │
│   Python 3.12       │     │       Node.js 20            │
│                     │     │                             │
│  grade_pdf          │     │  submitQuiz (callable)      │
│  generate_quiz      │     │  onUserCreate (auth trigger)│
│  generate_rubric    │     │  getClassPerformance        │
│  tika_chat          │     │  getCalendarToken           │
│  confusion_heatmap  │     │  calendarFeed (public HTTP) │
│                     │     │  sendEmailNotification      │
│  Config:            │     │  sendPushNotification       │
│  540s timeout       │     └─────────────────────────────┘
│  1 GB memory        │
└─────────────────────┘
          │
          ▼
   Gemini 2.5 Flash / Pro · Resend API · Firebase FCM
   Firebase Storage · Firestore
```

### Grading pipeline (PDF)

1. Student submits PDF → stored at `raw/{uid}/{jobId}` in Storage
2. Firestore document written to `gradingJobs/{jobId}` with `status: 'queued'`
3. Python `grade_pdf` function triggers, downloads PDF, renders pages at 120 DPI via PyMuPDF
4. Fetches cached knowledge-base text from `kbCache/{classId}` (MD5 hash invalidation)
5. Sends rubric + page images + KB context to Gemini 2.5 Flash
6. **Edge-case escalation**: if 3+ questions have low confidence, re-sends those to Gemini 2.5 Pro
7. Parses structured JSON: per-question scores, spatial coordinates (`pageEstimatePercent_X/Y`), feedback
8. Draws spatially-positioned green checkmarks (correct) and red X marks (wrong) + point deduction labels directly on PDF pages; screen-only feedback annotations added separately
9. Recompiles annotated PDF, uploads to `results/{uid}/{jobId}`
10. Updates `gradingJobs/{jobId}` → `status: 'complete'`, `score`, `totalPoints`, `gradedQuestions[]`, `hasEdgeCases`
11. Writes a `notifications` document to trigger email/push delivery

### Grading pipeline (Text)

1. Student submits rich-text (HTML + KaTeX) → stored in `gradingJobs/{jobId}` as `submissionText`
2. Python function sends text directly to Gemini (no PDF rendering); same scoring and feedback structure

### Progress tracking

`progress` (0–100) and `progress_text` ("Waiting for AI Grader…", "Evaluated student submission", etc.) are written to the job document as the function advances, allowing the frontend to show a live progress bar.

---

## Monorepo Structure

```
Grader/
├── apps/
│   └── web/                        # Next.js 14 frontend (static export)
│       ├── components/
│       │   ├── editor/             # RichMathEditor, MathRenderer, EquationModal, MathExtension
│       │   ├── layout/             # with-auth.js HOC, Header, StudentNavTabs, NotificationDropdown
│       │   ├── TikaChatbot.js      # Floating AI tutor widget
│       │   └── ui/                 # ShadCN/Radix primitives
│       ├── lib/
│       │   ├── auth-context.js     # useAuth() hook
│       │   ├── classUtils.js       # class CRUD helpers
│       │   ├── storageUtils.js     # upload/delete with progress
│       │   └── useTA.js            # TA role hook
│       └── pages/
│           ├── index.tsx           # Landing page
│           ├── login.js            # Auth & registration
│           ├── teacher/            # Teacher dashboard, class detail, gradebook, analytics, etc.
│           └── student/            # Student dashboard, class detail, submissions, quizzes, etc.
├── functions/
│   ├── grading/                    # Python 3.12 — AI grading engine (all Gemini-backed functions)
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── fonts/                  # Caveat font for handwritten-style annotations
│   └── quiz/                       # Node.js 20 — quiz scoring, user setup, notifications, calendar
│       ├── index.js
│       ├── notifications.js
│       └── package.json
├── firebase.json                   # Hosting rewrites, function codebase mapping
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
└── firestore-schema.js             # Developer reference — not deployed
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Python | 3.12+ |
| Firebase CLI | latest (`npm install -g firebase-tools`) |
| Firebase plan | **Blaze (pay-as-you-go)** — required for Cloud Functions, Secrets Manager, outbound networking (Gemini, Resend), and extended timeouts/memory |

---

## Installation

### 1. Clone and install frontend dependencies

```bash
git clone <repo-url>
cd Grader

cd apps/web
npm install
```

### 2. Install Node quiz-function dependencies

```bash
cd ../../functions/quiz
npm install
```

### 3. Install Python grading-function dependencies

```bash
cd ../grading
python3.12 -m venv venv

# macOS/Linux
source venv/bin/activate

# Windows
venv\Scripts\activate

pip install -r requirements.txt
```

---

## Environment Variables

Copy the example file, then fill in the values:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Open `apps/web/.env.local`:

```env
# Firebase — Web Client credentials
# Firebase Console → Project Settings → Your apps → Web app config
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=           # <project-id>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=            # e.g. grader-engine-app-2026
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=        # <project-id>.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Auth gate — arbitrary secret shared with teachers at sign-up
TEACHER_INVITE_TOKEN=

# Google AI Studio — injected into Python function via Secrets Manager (see Deployment)
GEMINI_API_KEY=
```

The following keys are set as **Firebase Secrets** (not in `.env.local`) for use by Cloud Functions:

```bash
firebase functions:secrets:set GEMINI_API_KEY   # Google AI Studio key
firebase functions:secrets:set RESEND_API_KEY   # Resend.com email API key
```

**Finding Firebase credentials**: Firebase Console → gear icon → **Project Settings** → **Your apps** → register a Web app named "Web Client" → copy values from the `firebaseConfig` object.

---

## Option 1 — Real Firebase Backend

Use this for staging or production deployments against a live Firebase project.

### 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**
2. Enable: **Firestore** (Native mode), **Authentication** (Email/Password + Google OAuth), **Storage**, **Functions** (Blaze plan required)

### 2. Log in and select project

```bash
firebase login
firebase use <your-project-id>
```

### 3. Set secrets

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set RESEND_API_KEY
```

### 4. Deploy everything

```bash
npm run build --prefix apps/web
firebase deploy
```

---

## Option 2 — Local Emulators

Use this for local development without touching a live Firebase project.

### 1. Build the frontend first

```bash
npm run build --prefix apps/web
```

### 2. Start all emulators

```bash
firebase emulators:start
```

| Service | Local URL |
|---------|-----------|
| Frontend (hosting) | http://localhost:5000 |
| Emulator UI | http://localhost:4000 |
| Firestore | http://localhost:8080 |
| Auth | http://localhost:9099 |
| Storage | http://localhost:9199 |

### 3. Frontend hot-reload (dev mode)

```bash
npm run dev --prefix apps/web   # http://localhost:3000
```

> In dev mode the frontend talks to the real Firebase project unless emulator environment variables are set. Function triggers require emulators or a deployed function.

---

## Deployment

### Deploy individual surfaces

```bash
# All functions
firebase deploy --only functions

# Single function
firebase deploy --only functions:grade_pdf

# Firestore security rules
firebase deploy --only firestore:rules

# Firestore composite indexes
firebase deploy --only firestore:indexes

# Storage rules
firebase deploy --only storage

# Frontend hosting only
firebase deploy --only hosting
```

### Check function logs

```bash
firebase functions:log --codebase grading
firebase functions:log --only functions:submitQuiz
```

### Storage management

```bash
gsutil du -sh gs://<bucket>.firebasestorage.app/
gsutil -m rm -r gs://<bucket>.firebasestorage.app/results/   # delete graded PDFs — caution
gsutil -m rm -r gs://<bucket>.firebasestorage.app/raw/       # delete raw submissions — caution
```

---

## Feature Reference — Students

### Registration & Authentication
- Sign up with email/password or Google OAuth, selecting role (Student or Teacher).
- Students enter a 6-character class code at sign-up to pre-enroll in a class.
- After sign-up a `registration_payloads/{uid}` document is written; the `onUserCreate` function processes it within ~10 s to set role and create the user profile.
- Dark-mode toggle available on login page and throughout the app, persisted in `localStorage`.

### Dashboard (`/student/dashboard`)
- **Welcome card**: greeting with name, count of assignments due this week.
- **Enrolled classes**: grid of class cards showing class code, instructor name, "Open" and "Course Info" (syllabus link) buttons; class menu includes "Leave Class".
- **TA classes**: if the student is a TA for any class, a separate section shows those classes with an "Open TA View" button.
- **Upcoming assignments**: sorted by due date; shows class badge, urgency-coded due date (overdue / due soon), points, extension badge if applicable, and a "Start Assignment" link.
- **Recent submissions**: horizontal scrollable cards showing the last 5 grading jobs — status badge (GRADED / PENDING), date, assignment title, score/total.
- **Join class form**: enter a 6-character code to enroll; validates code exists and prevents double-enrollment.

### Class Detail & Assignment Submission (`/student/class/[classId]`)
- **Active assignments**: list with title, class code badge, urgency-coded due date, points, submission count vs. maximum allowed.
- **Submission type toggle**: if the assignment allows both types (`submissionType: 'both'`), student chooses PDF Upload or Text Entry.
- **PDF submission**: drag-and-drop or click-to-browse file dropzone, 20 MB limit, upload progress bar, error alert.
- **Text submission** (Rich Math Editor): TipTap editor with LaTeX/KaTeX math support, auto-draft saving to Firestore every 2 seconds (debounced), "Save Draft" button, draft status indicator; draft is reloaded if student returns before submitting.
- **Extension passes**: if teacher enabled extension passes for the class, student can claim a +1-day extension per assignment (limited by `extensionPassesTotal`).
- **Multiple submissions**: if `maxSubmissions > 1`, past submissions are listed with scores and status; student can resubmit up to the limit.
- **Live grading progress**: after submission a real-time progress bar and status text appear ("Waiting for AI Grader…", "Evaluated student submission…") updating as the Cloud Function writes `progress` and `progress_text` to the job document. On completion a green success alert shows score and an embedded iframe of the annotated PDF.
- **Right sidebar**: links to Class Quizzes, Quiz History, Weekly Modules, Office Hours, Anonymous Forum.
- **What-If grade calculator** (collapsible in sidebar): shows current actual grade %; inputs for each ungraded assignment (hypothetical score entry) update the projected overall grade in real time without writing to Firestore.
- **Recent activity**: last 5 submissions with score badges.

### Submission Results & Grade Appeal (`/student/submission/[jobId]`)
- **Performance overview**: circular progress ring showing score/total, percentage accuracy.
- **Per-question breakdown**: each question shows points earned/possible, AI feedback text.
- **Annotated PDF viewer**: embedded iframe of the graded PDF with green checkmarks and red X marks drawn at spatial coordinates; screen-only feedback annotations visible but won't appear when printed. Download button included.
- **Text submission display**: renders submission HTML + KaTeX math via MathRenderer (DOMPurify-sanitized).
- **Detailed feedback modal**: grid of question cards with status (correct/partial/wrong), points, and feedback; color-coded backgrounds.
- **Edge case notice**: alert shown if `hasEdgeCases: true` indicating the AI flagged handwriting ambiguity for teacher review.
- **Grade appeal**: when job is complete, student can click "Appeal Grade", enter a reason, and submit. The job moves to `status: 'disputed'`; teacher receives a notification. A "Re-grade Pending" badge appears. If teacher responds, the appeal response text is displayed.

### All Submissions (`/student/submissions`)
- Table of all grading jobs, filterable by class and status (All / Graded / Pending).
- Summary stats: count graded, count pending, average score percentage.
- Clickable rows navigate to the submission detail page.

### Quizzes (`/student/quizzes`, `/student/quiz/[classId]`, `/student/quizzes/[classId]/history`)

**Overview page** (`/student/quizzes`)
- Stats cards: total attempts, average score % (color-coded green / amber / red), best score.
- Available quizzes grid: title, description, best score badge, attempt count, "Start" / "Retry" button.
- Recent attempts list: quiz title, class, relative time, score %; clickable to history.
- Class filter dropdown.

**Quiz-taking interface** (`/student/quiz/[classId]`)
- Preview phase → calls `generate_quiz` cloud function (spinner + "Generating your personalized quiz…").
- Quiz phase: fixed header with circular progress (Q n of 10); question card with 4 MCQ options (selected = teal + checkmark); optional hint below options; fixed bottom nav (Previous / Next / Submit).
- Results phase: large score display (X / 10 correct), "Topics to Review" pills from `topicGaps[]`, per-question breakdown (student vs. correct answer, color-coded), "Take Another Quiz" button.

**History page** (`/student/quizzes/[classId]/history`)
- All past attempts for the class: title, date, score, performance trends.

### Tika AI Chatbot
- Floating "Sparkles" button (bottom-right), expanding to a 380 px side panel (full-screen on mobile).
- Builds context from enrolled classes, all assignments (title, class, due date, submission status, score), recent grades, and grade calculation data before calling the `tika_chat` function.
- Answers questions grounded only in student's own class and grade data (not general knowledge).
- Supports what-if grade calculations ("What if I get 85 on Exam 1?") and backwards calculations ("What grade do I need to reach 80%?").
- Togglable via `settings.chatbotEnabled`; only rendered if the setting is on.

### iCalendar Subscription
- Student calls `getCalendarToken` once to receive a unique token.
- Public endpoint `/calendarFeed?token=<token>` returns a `.ics` file containing all enrolled classes' assignment due dates and schedule blocks.
- Per-student extension due dates are respected in the feed.
- Google Calendar / Outlook can subscribe to the URL for automatic hourly refresh.

### Additional Student Pages
- `/student/progress` — learning analytics (quiz performance trends, topic mastery)
- `/student/schedule` — class schedule blocks
- `/student/messages` — messaging with teacher / classmates
- `/student/settings` — preferences (chatbot toggle, email/push notification opt-out)
- `/student/class/[classId]/modules` — weekly course modules
- `/student/class/[classId]/office-hours` — TA office hours scheduling
- `/student/class/[classId]/forum` — anonymous Q&A forum

---

## Feature Reference — Teachers

### Class Management
- Create classes; share the 6-character enrollment code with students.
- View and remove enrolled students; designate students as TAs by adding their UID to `taIds[]`.
- Configure extension passes: set `extensionPassesTotal` per class so students can claim +1-day extensions.
- Enable/disable attendance grade, drop-lowest-assignment options.
- Disable class invites (`invitesDisabled`) to prevent new enrollment.
- Archive students without fully removing them.

### Knowledge Base / Reference Materials
- Upload PDFs to the class knowledge base; mark one as the syllabus (`isSyllabus: true`).
- Knowledge base text is cached in `kbCache/{classId}` with MD5 hash-based invalidation to reduce Gemini API calls across grading jobs.
- KB materials are used by the grading engine as reference context and by `generate_quiz` for question generation.

### Assignment Creation
- Set title, due date, point value, submission type (PDF / Text / Both), maximum submissions.
- Optionally attach an assignment PDF for students to download.
- **Rubric auto-generation** (`generate_rubric`): upload a homework PDF image and Gemini identifies every question/sub-question, assigns point values (defaults to 1 pt if not printed), and generates model answers — produces a ready-to-use rubric JSON.

### Grading Oversight
- Monitor live grading status (queued / processing / complete / error) in the submissions list.
- Review each submission: annotated PDF with spatial marks, per-question AI scores and feedback.
- **Score override**: teacher can adjust any question's score after reviewing.
- **Grade appeal response**: when a student disputes a grade (`status: 'disputed'`), teacher sees the appeal reason and can write a justification response; the student's submission is updated with `appealResponse` and they receive a notification.

### Class Analytics (`/teacher/class/[classId]/analytics`)
- **Confusion heatmap** (from `confusion_heatmap` function): analyzes quiz topic gaps and grading feedback across the entire class; returns topics with severity (high / medium / low), count of affected students, and reteaching suggestions — plus an executive summary.
- **Grade distribution**: histogram buckets (0–59, 60–69, 70–79, 80–89, 90–100).
- **Average assignment grade** and **average quiz score** across the class.
- **Top student weak topics** ranked by frequency from quiz `topicGaps[]`.

### Assignment Builder (`/teacher/assignment-builder/[classId]`)
- Drag-and-drop block canvas powered by `@dnd-kit/core` + `@dnd-kit/sortable`.
- Five block types: question (rich math), image (drag/drop/paste), PDF page (rendered from assignment PDF), divider, spacer.
- Left toolbox to add blocks; live preview panel on the right with DOMPurify-sanitized rendering.
- Auto-saves draft to Firestore every 2 s via debounced ref pattern (stale-closure safe).
- `extract_pdf_pages` callable renders assignment PDF pages as JPEGs stored at `assignment_pages/{assignmentId}/`.

### Quick Generate with AI
- "⚡ Generate with AI" button on the class detail page opens a modal.
- Single natural-language prompt → `generate_quick_content` callable → structured quiz or assignment content returned.
- Results are cached in `quizCache/{cacheId}` (keyed by prompt hash + classId) to avoid duplicate Gemini calls.
- On success, navigates to the assignment builder pre-populated with the generated content.

### Post-Grading Insights
- After all grading jobs for an assignment complete, `grade_pdf` automatically calls `compute_insights`.
- Insights are written once (race-safe via Firestore `create()` + `AlreadyExists`) to `assignmentInsights/{assignmentId}`.
- **InsightsPanel** on the gradebook shows: class average/median, per-question fail-rate bar chart (color-coded red/amber/green), top 3 most-missed questions with common mistakes, students needing support.
- "Generate re-teaching quiz" button on any question prefills the Quick Generate modal with the question's topic.

### Gradebook (`/teacher/class/[classId]/gradebook`)
- Spreadsheet view of all students × assignments with scores, paginated at 25 rows.
- Inline score editing (click any cell); creates a stub `gradingJobs` doc if none exists.
- Download as `.xlsx` (Excel) via SheetJS or `.csv`.
- InsightsPanel and Quick Generate modal integrated at the top.

### Individual Student View (`/teacher/class/[classId]/student/[uid]`)
- Per-student gradebook, full submission history, attendance record.

### Announcements & Messaging
- Schedule announcements (stored in `scheduledAnnouncements`) that trigger email notifications to enrolled students.
- Direct messaging via `conversations/{conversationId}` with `/messages` subcollection.

### Additional Teacher Pages
- `/teacher/class/[classId]/attendance` — attendance tracking
- `/teacher/class/[classId]/forum` — moderate anonymous forum posts
- `/teacher/class/[classId]/office-hours` — schedule/manage office hour blocks
- `/teacher/class/[classId]/quiz/[quizId]` — create/edit quizzes, view student attempt analytics
- `/teacher/resources` — manage knowledge base materials
- `/teacher/submissions` — cross-class submissions view (searchable, sortable)
- `/teacher/students` — bulk student management
- `/teacher/schedule` and `/teacher/settings` — class schedule and platform settings

---

## Feature Reference — TAs

A student designated as a TA for a class (`taIds[]` on the class document) gets:
- "TA Dashboard" button in the header.
- Full teacher-view access (gradebook, analytics, submissions list, student list) for their assigned classes via the `withAuth(Component, ['teacher', 'ta'])` HOC pattern.
- TAs cannot delete classes or manage TA assignments (teacher-only operations).

---

## Cloud Functions Reference

### `functions/grading/` (Python 3.12, 540 s timeout, 1 GB memory)

| Function | Trigger | Purpose |
|----------|---------|---------|
| `grade_pdf` | Firestore trigger on `gradingJobs/{jobId}` | Full PDF/text grading pipeline (see Architecture) |
| `generate_quiz` | HTTPS Callable | Adaptive 10-question MCQ quiz targeting student weak topics |
| `generate_rubric` | HTTPS Callable | Analyzes homework PDF image → structured rubric JSON |
| `tika_chat` | HTTPS Callable | AI tutor answering student questions about their class data |
| `confusion_heatmap` | HTTPS Callable | Class-wide topic difficulty analysis with reteaching suggestions |

#### `generate_quiz` detail
- Reads last 5 quiz attempts for the student; ranks weak topics by frequency.
- Fetches knowledge base materials (excluding specified `excludedDocIds[]`).
- Calls Gemini 2.5 Flash to generate 10 MCQs with 4 options (A/B/C/D), correct answer, hint, and topic classification per question.
- Returns the questions array directly to the frontend — no Firestore write until student submits.

#### `generate_rubric` detail
- Accepts a PDF homework image (base64).
- Returns `{ questions: [{ questionText, points, modelAnswer }], totalPoints, topic }`.
- Question point values default to 1 if not printed on the page.

#### `tika_chat` detail
- Grounded exclusively in student's own enrollment, assignment, submission, and grade data passed as context.
- Supports what-if calculations ("What if I get 85 on Exam 1?") and backwards-target calculations ("What grade do I need on the final to reach 80%?").
- Responds with a warm, supportive tone.

#### `confusion_heatmap` detail
- Aggregates quiz `topicGaps[]` and grading feedback across all students in a class.
- Returns: `{ executiveSummary: string, topics: [{ name, severity, affectedCount, reteachingSuggestion }] }`.

#### Knowledge base caching (`grade_pdf`)
- KB text is stored in `kbCache/{classId}` with an MD5 hash of all doc IDs + timestamps.
- On each grading job the hash is compared; if unchanged, cached text is reused without re-fetching from Storage.

#### Edge case escalation (`grade_pdf`)
- If Gemini 2.5 Flash returns 3 or more questions with low confidence, those questions are automatically re-sent to Gemini 2.5 Pro for higher-accuracy re-evaluation.
- Sets `hasEdgeCases: true` on the job document so the frontend can display a notice.

#### Usage tracking (`grade_pdf`)
- Increments `usage/stats` with daily call counts for billing monitoring.

### `functions/quiz/` (Node.js 20)

| Function | Trigger | Purpose |
|----------|---------|---------|
| `submitQuiz` | HTTPS Callable | Score 10-question quiz, save `quizAttempts` doc |
| `onUserCreate` | Auth trigger | Set role claim, create user doc, clean up payload |
| `getClassPerformance` | HTTPS Callable | Class-level analytics (avg grades, quiz scores, topic gaps, distribution) |
| `getCalendarToken` | HTTPS Callable | Generate or retrieve student's unique iCal token |
| `calendarFeed` | Public HTTP | Serve `.ics` feed for a student's assignments and schedules |
| `sendEmailNotification` | Firestore trigger on `notifications/{id}` | Send templated email via Resend API |
| `sendPushNotification` | Firestore trigger on `notifications/{id}` | Send push via Firebase Cloud Messaging |

#### `submitQuiz` detail
- Compares student answers to correct answers; collects wrong-answer topics as `topicGaps[]`.
- Stores `quizAttempts/{attemptId}` with `score`, `topicGaps`, and enriched questions (including `studentAnswer` and `correct` booleans).
- Also fetches `teacherId` from the class for easier cross-querying.

#### `onUserCreate` detail
- Retry loop (5 × with 2 s delays) because the client-written `registration_payloads/{uid}` document may not appear immediately after Auth account creation.
- Sets Firebase custom claims: `{ role: 'teacher' | 'student' }`.

#### Notification email templates (`sendEmailNotification`)
- `grade_released` — score + link to submission
- `due_reminder` — assignment title + submission link
- `grade_appeal` — student appeal reason to teacher
- `appeal_response` — teacher's response to student
- `class_invite` — enrollment invite
- `announcement` — body of scheduled announcement

Respects `users/{uid}.settings.emailNotifications` opt-out toggle. Logs to emulator console if `RESEND_API_KEY` is not set (safe for local dev). Records sent emails in `sentEmails/{emailId}`.

#### Push notifications (`sendPushNotification`)
- Reads FCM tokens from `users/{uid}/private/notifications.fcmTokens[]`.
- Cleans up invalid or expired tokens after each send.
- Respects `users/{uid}.settings.pushNotifications` opt-out toggle.

---

## Auth Flow

```
Client sign-up
    │
    ├─ Teacher: submits TEACHER_INVITE_TOKEN + credentials
    │       └─ writes payload to registration_payloads/{uid}
    │
    └─ Student: submits class code + credentials
            └─ writes payload to registration_payloads/{uid}
                    │
                    ▼
        onUserCreate trigger (Node function, 5-retry loop)
            ├─ reads registration_payloads/{uid}
            ├─ sets Firebase custom claims: { role: 'teacher' | 'student' }
            ├─ creates users/{uid} doc
            └─ deletes payload
                    │
                    ▼
        auth-context.js refreshes token (3 retries, 2s delay)
            └─ useAuth() returns { user, role, loading }
                    │
                    ▼
        withAuth(Component, allowedRoles) HOC
            └─ redirects if unauthenticated or role mismatch
               allows 'student' role through for 'ta' routes;
               page verifies TA status via isTAForClass(classId)
```

---

## Firestore Data Model

### `users/{uid}`

| Field | Type | Notes |
|-------|------|-------|
| `uid` | string | Firebase Auth UID |
| `email` | string | |
| `displayName` | string | |
| `role` | `'teacher' \| 'student'` | Set by `onUserCreate` |
| `settings.chatbotEnabled` | boolean | Show Tika chatbot widget |
| `settings.emailNotifications` | boolean | Opt-out of email notifications |
| `settings.pushNotifications` | boolean | Opt-out of push notifications |
| `createdAt` | timestamp | |

**Subcollections**
- `users/{uid}/private/calendar` — `{ calendarToken, uid }`
- `users/{uid}/private/notifications` — `{ fcmTokens: string[] }`

### `classes/{classId}`

| Field | Type | Notes |
|-------|------|-------|
| `classId` | string | |
| `teacherId` | string | |
| `name` | string | |
| `classCode` | string | 6-char alphanumeric join code |
| `studentIds` | string[] | Enrolled student UIDs |
| `taIds` | string[] | TA student UIDs |
| `archivedStudents` | string[] | Soft-removed students |
| `extensionPassesTotal` | number | Max 1-day extensions per student |
| `extensionPassesUsed` | map | `{ [uid]: count }` |
| `extensionDueDates` | map | `{ [uid_assignmentId]: Date }` |
| `attendanceGradeEnabled` | boolean | |
| `dropLowest` | boolean | Drop lowest assignment from grade |
| `invitesDisabled` | boolean | Block new enrollment |
| `gradeSettings` | object | Additional grade weighting config |
| `createdAt` | timestamp | |

### `assignments/{assignmentId}`

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | |
| `classId` | string | |
| `dueDate` | timestamp | |
| `totalPoints` | number | |
| `submissionType` | `'pdf' \| 'text' \| 'both'` | |
| `maxSubmissions` | number | Retry limit |
| `rubric` | object | `{ questions[], totalPoints, topic }` |
| `rubricType` | string | |
| `pdfUrl` | string | Optional assignment handout |
| `createdAt` | timestamp | |

### `gradingJobs/{jobId}`

| Field | Type | Notes |
|-------|------|-------|
| `jobId` | string | |
| `classId` | string | |
| `assignmentId` | string | |
| `assignmentTitle` | string | |
| `studentId` | string | |
| `teacherId` | string | |
| `submissionType` | `'pdf' \| 'text'` | |
| `rawPdfUrl` | string | Student PDF in Storage |
| `resultPdfUrl` | `string \| null` | Annotated PDF in Storage |
| `submissionText` | `string \| null` | HTML for text submissions |
| `rubric` | string | |
| `status` | `'queued' \| 'processing' \| 'complete' \| 'error' \| 'disputed'` | |
| `progress` | number (0–100) | Live progress tracking |
| `progress_text` | string | Live status text |
| `score` | `number \| null` | Points earned |
| `totalPoints` | `number \| null` | Max possible points |
| `feedback` | `string \| null` | Overall summary feedback |
| `gradedQuestions` | array | Per-question results with spatial coordinates |
| `hasEdgeCases` | boolean | AI flagged low-confidence questions |
| `draw_errors` | array | Annotation rendering errors, if any |
| `appealReason` | `string \| null` | Student's appeal text |
| `appealResponse` | `string \| null` | Teacher's response |
| `createdAt` | timestamp | |
| `submittedAt` | timestamp | |
| `completedAt` | `timestamp \| null` | |

`gradedQuestions[]` item shape:
```js
{
  questionNumber: number,
  pointsEarned: number,
  pointsPossible: number,
  correct: boolean,        // or 'partial'
  feedback: string,
  pageEstimatePercent_X: number,  // 0–100 horizontal annotation position
  pageEstimatePercent_Y: number,  // 0–100 vertical annotation position
  confidence: 'high' | 'low'
}
```

### `quizAttempts/{attemptId}`

| Field | Type | Notes |
|-------|------|-------|
| `studentId` | string | |
| `classId` | string | |
| `teacherId` | string | Copied from class for querying |
| `quizId` | string | |
| `score` | number | Percentage (0–100) |
| `topicGaps` | string[] | Topics answered incorrectly |
| `questions` | array | Enriched with `studentAnswer` and `correct` |
| `createdAt` | timestamp | |

`questions[]` item shape:
```js
{
  question: string,
  options: string[],      // 4 choices
  answer: string,         // correct answer text
  hint: string,
  topic: string,
  studentAnswer: string | null,
  correct: boolean
}
```

### `quizzes/{quizId}`

| Field | Type | Notes |
|-------|------|-------|
| `classId` | string | |
| `title` | string | |
| `description` | string | |
| `timeLimit` | `number \| null` | Minutes |
| `isActive` | boolean | Visible to students |
| `excludedDocIds` | string[] | KB docs excluded from question generation |
| `createdAt` | timestamp | |

### `knowledgeBase/{docId}`

| Field | Type | Notes |
|-------|------|-------|
| `docId` | string | |
| `classId` | string | |
| `teacherId` | string | |
| `title` | string | |
| `storageUrl` | string | PDF in Storage |
| `isSyllabus` | boolean | Used for student "Course Info" link |
| `uploadedAt` | timestamp | |

### `kbCache/{classId}`

| Field | Type | Notes |
|-------|------|-------|
| `hash` | string | MD5 of KB doc IDs + timestamps |
| `text` | string | Extracted KB text |
| `updatedAt` | timestamp | |

### `notifications/{notificationId}`

| Field | Type | Notes |
|-------|------|-------|
| `recipientId` | string | |
| `senderId` | string | |
| `notifType` | string | `grade_released \| due_reminder \| grade_appeal \| appeal_response \| class_invite \| announcement` |
| `type` | string | `email \| push` |
| `title` | string | |
| `body` | string | |
| `sendEmail` | boolean | |
| `sendPush` | boolean | |
| `data` | object | Template variables |
| `read` | boolean | |
| `createdAt` | timestamp | |

### Other collections

| Collection | Purpose |
|-----------|---------|
| `registration_payloads/{uid}` | Temporary bridge between client sign-up and `onUserCreate` trigger |
| `submissionDrafts/{userId}_{assignmentId}` | Auto-saved student text drafts (`content` HTML, `updatedAt`) |
| `sentEmails/{emailId}` | Records of sent emails (`to`, `subject`, `type`, `resendId`, `sentAt`) |
| `scheduledAnnouncements/{id}` | Future-dated announcements |
| `conversations/{conversationId}` | Messaging threads (with `/messages` subcollection) |
| `usage/stats` | Daily grading call counts for billing monitoring |

---

## Storage Paths

| Path | Contents |
|------|---------|
| `raw/{uid}/{jobId}` | Student submission PDFs (20 MB limit) |
| `results/{uid}/{jobId}` | Graded/annotated PDFs (written by Cloud Function) |
| `knowledgeBase/{classId}/{docId}` | Teacher reference material PDFs |
| `assignments/{classId}/{fileId}` | Assignment handout PDFs distributed by teacher |
| `assignment_pages/{assignmentId}/{page}` | Rendered JPEG images of assignment pages (used by assignment builder) |

---

## Key Utilities & Components

### Hooks & context

| File | Export | Returns |
|------|--------|---------|
| `lib/auth-context.js` | `useAuth()` | `{ user, role, loading }` |
| `lib/useTA.js` | `useTA()` | `{ taClasses, isTA, isTAForClass, isTALoading }` |

### HOC

`components/layout/with-auth.js` — `withAuth(Component, allowedRoles)`

- `allowedRoles`: `'student'`, `'teacher'`, `'ta'`, or an array like `['teacher', 'ta']`
- Shows a spinner while auth resolves
- Redirects to `/login` if unauthenticated; redirects to `/{role}/dashboard` on role mismatch
- For `'ta'` routes: allows students through; the page verifies class-level TA status via `isTAForClass(classId)`

### Class helpers (`lib/classUtils.js`)

| Function | Purpose |
|----------|---------|
| `getClassById(classId)` | Fetch a single class document |
| `getClassByCode(code)` | Look up class by 6-char join code |
| `getStudentClasses(uid)` | Classes a student is enrolled in |
| `getClassesAsTA(uid)` | Classes where student is a TA |
| `getAccessibleClasses(uid, role)` | Merged list for teacher dashboard |

### Storage (`lib/storageUtils.js`)
- Upload with real-time progress callback
- File deletion

### Editor components

| Component | Notes |
|-----------|-------|
| `components/editor/RichMathEditor.js` | TipTap + KaTeX math nodes, auto-draft save, symbol palette. **Always import with `dynamic(() => import(...), { ssr: false })`** |
| `components/editor/MathRenderer.js` | Read-only HTML + KaTeX renderer, DOMPurify-sanitized |
| `components/editor/EquationModal.js` | Modal LaTeX equation editor with live preview and symbol palette |
| `components/editor/MathExtension.js` | Custom TipTap extension for inline and block math node types |

### Tika chatbot (`components/TikaChatbot.js`)
- Floating button → 380 px side panel (full-screen on mobile)
- Builds context string from all class/assignment/grade data before calling `tika_chat`
- Message history with loading dots animation
- Only rendered when `settings.chatbotEnabled === true`

### Key npm packages

| Package | Purpose |
|---------|---------|
| `@tiptap/react`, `@tiptap/starter-kit` | Rich text editor |
| `katex` | LaTeX math rendering |
| `dompurify` | Sanitize user-generated HTML |
| `xlsx` | Excel gradebook export |
| `recharts` | Analytics charts |

---

## Testing Guide

Automated test suites are not yet configured. All verification is manual.

### 1. Authentication

- Sign up as **teacher** (requires correct `TEACHER_INVITE_TOKEN`); confirm redirect to `/teacher/dashboard`
- Sign up as **student** (requires valid class code); confirm redirect to `/student/dashboard`
- Sign out and back in; confirm session restores correctly
- Verify dark mode toggle persists across refresh

### 2. Teacher features

| Feature | Expected |
|---------|---------|
| Dashboard | All teacher's classes load in grid with no crashes |
| Class detail | `/teacher/class/[classId]` shows student list, TA list, class code, settings |
| KB upload | PDF appears in KB list; Firestore `knowledgeBase` doc created; `kbCache` updated |
| KB delete | Item removed from Firestore and Storage |
| Rubric generation | Upload homework PDF → structured rubric JSON returned with questions and point values |
| Assignment creation | Assignment appears for enrolled students with correct due date and submission type |
| Gradebook | All student scores rendered; Excel download opens a valid `.xlsx` |
| Confusion heatmap | Analytics page shows topics with severity and reteaching suggestions |
| Grade appeal | `status: 'disputed'` job shows appeal reason; teacher can write `appealResponse` |
| Score override | Adjusted score persists on the job document |

### 3. Student features

| Feature | Expected |
|---------|---------|
| Dashboard | Only enrolled classes shown; upcoming assignments sorted by urgency |
| PDF submission | File upload triggers `gradingJobs` doc with `status: 'queued'`; progress bar updates live |
| Text submission | Draft auto-saves every 2 s; resumes if student navigates away and returns |
| Extension claim | Due date updates by 1 day; extension badge appears; remaining passes decremented |
| Grading complete | Annotated PDF embedded in iframe; per-question breakdown visible; score shown |
| Edge case notice | Alert shown when `hasEdgeCases: true` |
| Grade appeal | Submitting moves job to `disputed`; "Re-grade Pending" badge shown |
| What-If calculator | Hypothetical score inputs update projected grade in sidebar without Firestore writes |
| Quiz generation | "Generating…" spinner → 10 personalized MCQ questions loaded |
| Quiz results | Score %, `topicGaps[]` pills, per-question breakdown shown |
| Tika chatbot | Opens side panel; answers assignment/grade questions; what-if math is correct |
| iCal feed | `getCalendarToken` returns token; `.ics` URL contains all due dates including extensions |

### 4. Grading function log checkpoints

```bash
firebase functions:log --codebase grading
```

Expected log sequence:
1. Job document detected (`status: queued`)
2. PDF downloaded from Storage
3. Pages rendered to PNG (PyMuPDF)
4. KB cache hit or miss logged
5. Gemini 2.5 Flash API call made
6. (If edge cases) Gemini 2.5 Pro escalation
7. Annotations drawn; annotated PDF uploaded
8. Job updated to `status: complete`
9. Notification document written

### 5. Notification pipeline

Write a test `notifications` document with `sendEmail: true` and verify:
- `sentEmails` document created
- Resend API call logged (or emulator log if no `RESEND_API_KEY`)
- `sendPush: true` → FCM token fetched and push attempted

### Quick command reference

```bash
npm run dev --prefix apps/web        # Frontend at localhost:3000 (hot reload)
npm run build --prefix apps/web      # Static export to apps/web/out/
npm run lint --prefix apps/web       # ESLint
firebase emulators:start             # All emulators (UI at localhost:4000)
firebase functions:log --codebase grading
```

---

## CI/CD

GitHub Actions workflow at `.github/workflows/deploy.yml` triggers on push to `main`:

1. Builds the Next.js static export (`npm run build`)
2. Installs quiz function dependencies (`npm install`)
3. Deploys to Firebase (`firebase deploy`)

**Required GitHub Secrets**:
- `FIREBASE_TOKEN` — from `firebase login:ci`
- All `NEXT_PUBLIC_FIREBASE_*` env vars
- `TEACHER_INVITE_TOKEN`

---

## Troubleshooting

### "Missing or Insufficient Permissions" on grade overrides
1. Redeploy Firestore rules: `firebase deploy --only firestore:rules`
2. Verify the user's `role` custom claim is `'teacher'` (Firebase Console → Authentication → user → custom claims)

### Grading function stuck in `queued` / not triggering
- Check logs: `firebase functions:log --codebase grading`
- Verify function is deployed: `firebase deploy --only functions:grade_pdf`
- Confirm secret is set: `firebase functions:secrets:access GEMINI_API_KEY`

### Edge case escalation causing timeouts
- Gemini 2.5 Pro calls take longer; consider increasing function timeout in `firebase.json` if you see 540 s exceeded on complex submissions.

### PyMuPDF / PDF rendering errors
- Ensure Python 3.12 and the virtual environment are active: `source venv/bin/activate`
- Re-run `pip install -r requirements.txt` in `functions/grading/`

### Static export 404s on dynamic routes (e.g., `/teacher/class/[classId]`)
- Each dynamic route needs a rewrite rule in `firebase.json` pointing to the exported `.html` file. After any change, redeploy: `firebase deploy --only hosting`

### RichMathEditor SSR crash
- Always use `dynamic(() => import('../components/editor/RichMathEditor'), { ssr: false })`. TipTap cannot render server-side in Next.js static export mode.

### Email notifications not sending
- Confirm `RESEND_API_KEY` secret is set: `firebase functions:secrets:access RESEND_API_KEY`
- Check that the recipient has `settings.emailNotifications !== false`
- In emulator mode, emails log to console instead of sending — this is expected.

### iCalendar feed empty or stale
- Confirm `getCalendarToken` was called and a token stored in `users/{uid}/private/calendar`
- The `calendarFeed` endpoint is public (no auth) but keyed by the token — verify the URL uses the correct token

---

## Contributing

1. Fork the repo and create a feature branch off `main`
2. Follow existing patterns — components in `apps/web/components/`, pages in `apps/web/pages/`
3. All teacher-facing pages must use `withAuth(Component, 'teacher')` as the default export
4. All new Firestore collections need Security Rules written before any frontend reads/writes
5. Python dependencies must be pinned to exact versions in `requirements.txt`
6. Do not use `localStorage` or `sessionStorage` in the Next.js app (auth state is managed via Firebase + context)
7. Open a pull request against `main` with a clear description

---

## License

[MIT](LICENSE)

---

## The Team

| Name | Role |
|------|------|
| Abel Legesse | CEO, Full Stack Engineer |
| Love Oluwaleye | COO, Full Stack Engineer |
| Theint Han | Product Manager |
