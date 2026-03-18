# Testing Guide — Automated PDF Grading Engine

This guide outlines the **manual verification steps** to test each feature currently implemented in the codebase. Since automated test suites are not yet configured in `package.json`, debugging focuses on live-reload validations and console log outputs.

---

## 🔑 1. Authentication & Session (Done ✅)
- **Status**: Tested by User.
- **Retests**: 
  - Ensure logging in directs to `/teacher/dashboard` for teacher nodes and `/student/dashboard` for student nodes.

---

## 👨‍🏫 2. Teacher Workspace Features

### A. Teacher Dashboard
1. **Action**: Log in as a Teacher account to view the dashboard (`/teacher/dashboard`).
2. **Expected Verification**:
   - Verify that all classes created by the specific user load dynamically in a Grid list without full-page crashes.
   - Click a "Class node" button leading to `/teacher/class/[classId]`.

### B. Knowledge Base / Reference Material Uploads
1. **Action**: Inside a Class detail page, locate the uploaded Knowledge Base modules.
2. **Expected Verification**:
   - Upload a sample PDF corresponding to reference course materials.
   - Verify file triggers successful upload states (Check Firestore `classes/{classId}/materials` collections OR console logs output matching successful buckets triggers).
   - Ensure deleting the material removes it seamlessly from the list.

---

## 🧑‍🎓 3. Student Workspace Features

### A. Student Dashboard
1. **Action**: Log in with Student Credentials to view `/student/dashboard`.
2. **Expected Verification**:
   - Verify that only enrolled course containers display in the viewport.
   - Verify that clicking an enrollment navigates into the `/student/class/[classId]` pane properly.

### B. Submissions & Assignments (Grade view placeholders)
1. **Action**: Navigate to assignment items in the Student interface.
2. **Expected Verification**:
   - Verify that the layout loads smoothly presenting previous grades or grading timelines anchors.
   - Upload sample assignments and ensure triggers correspond to active state changes (Skeleton animations rendering seamlessly).

---

## ⚙️ 4. AI Node triggers (Firebase Backend Functions)

### A. Automated PDF Grading Function (`functions/grading/`)
1. **Action**: Trigger grading flow manually or via Firestore Emulator pushes.
2. **Expected Verification**:
   - Requires Cloud Functions Emulators started on correct ports (`firebase emulators:start`).
   - Trigger the trigger endpoint mapped to student submission triggers.
   - Check function execution logs in Emulator UI (`http://localhost:4000`) for Gemini prompting outputs and `PyMuPDF` parsing logs.

### B. Quiz Generation Function (`functions/quiz/`)
1. **Action**: Generate placeholders quiz outputs from Dashboard.
2. **Expected Verification**:
   - Check standard output on Firebase Functions logging node for `functions/quiz/` matching requested scope ID calibrations without timeout exits.

---

## 🛠️ Testing Environment Checklist
- **Command**: `npm run dev --prefix apps/web` (Renders frontend validation accurately with fast-reload).
- **Emulators Setup**: `firebase emulators:start` (Used to calibrate backend triggers safely on local environments).
- **Firestore Views**: Ensure data triggers update correctly in Emulator UI dashboards before validating triggers endpoints.
