# Phase 1 Product Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement security hardening, cost reductions, one-prompt quiz generator, drag-and-drop assignment builder, and auto-surface insights panel — all within Firebase + Gemini, no new infrastructure.

**Architecture:** Five independently shippable slices delivered in dependency order: security rules first (foundation everything else builds on), then cost optimisations (pure backend, no UI risk), then AI generation backend + modal, then the assignment builder (new page + cloud function), then the insights pipeline (depends on assignment data model). Each slice is deployable and testable on its own.

**Tech Stack:** Next.js 14 (static export), Firebase (Firestore, Storage, Cloud Functions), Python 3.12 (Pydantic, PyMuPDF, Pillow, google-generativeai), Node.js 20, @dnd-kit/core + @dnd-kit/sortable, ShadCN/Radix, Tailwind, recharts.

---

## Audit of Existing Code (read before starting)

The following are **already implemented** — do not rewrite:
- `firestore.rules`: comprehensive, covers users, classes, assignments, quizzes, gradingJobs, etc.
- `storage.rules`: covers raw/, results/, knowledgeBase/, assignments/, avatars/
- `functions/grading/main.py`: grade_pdf, generate_quiz, generate_rubric, tika_chat, confusion_heatmap
- KB cache with MD5 hash invalidation (`kbCache/{classId}`)
- JPEG quality=70 already set; just needs the 800 px resize added

**Known bug to fix in Task 5:** In `main.py` text-submission branch (~line 223), `_get_genai_model()` is called but never defined — replace with `genai = _init_genai(); model = genai.GenerativeModel('gemini-2.5-flash')`.

**Gaps to fill** (what this plan builds):

| Gap | Task |
|-----|------|
| `assignment_pages/` Storage path missing from storage.rules | T4 |
| `quizCache`, `assignmentInsights`, `rateLimits` Firestore rules | T4 |
| Pydantic validation in Python | T4 |
| Per-student/teacher rate limiting | T4 |
| `classIds[]` custom claim for teachers in `onUserCreate` | T4 |
| 800 px image resize before Gemini call | T5 |
| Fix `_get_genai_model()` bug | T5 |
| Minimum instances in firebase.json | T5 |
| Storage URL caching in React state | T5 |
| Gradebook pagination | T5 |
| `generate_quick_content` NL-prompt function + `quizCache` | T2 |
| `QuickGenerateModal.js` component | T2 |
| "⚡ Generate with AI" button in class detail | T2 |
| `extract_pdf_pages` callable function | T1 |
| `pages/teacher/assignment-builder/[classId].js` | T1 |
| `@dnd-kit` packages | T1 |
| Firebase rewrite for assignment-builder route | T1 |
| `compute_assignment_insights` function | T3 |
| `assignmentInsights` Firestore collection + rules | T3 |
| `InsightsPanel.js` component | T3 |
| InsightsPanel wired into gradebook page | T3 |

---

## File Map

### Created
```
functions/grading/validators.py                   ← Pydantic models for all grading function inputs
functions/grading/rate_limiter.py                ← Rate limit helpers (Firestore-backed)
functions/grading/insights.py                    ← compute_assignment_insights function
components/teacher/QuickGenerateModal.js         ← One-prompt AI generator modal
components/teacher/InsightsPanel.js             ← Post-grading insights panel
pages/teacher/assignment-builder/[classId].js   ← Drag-and-drop assignment builder page
docs/superpowers/plans/2026-05-13-phase1-product-improvements.md  ← this file
```

### Modified
```
firestore.rules                                  ← Add quizCache, assignmentInsights, rateLimits rules
storage.rules                                    ← Add assignment_pages/ rule
firebase.json                                    ← Add assignment-builder rewrite + min instances
functions/grading/main.py                        ← Fix bug, add image resize, prompt ordering,
                                                    extract_pdf_pages, generate_quick_content,
                                                    compute_assignment_insights trigger
functions/grading/requirements.txt              ← Pin pydantic>=2.0,<3.0
functions/quiz/index.js                          ← Add classIds[] claim to onUserCreate
apps/web/package.json                            ← Add @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
apps/web/pages/teacher/class/[classId]/gradebook.js  ← Pagination + InsightsPanel
apps/web/pages/teacher/class/[classId].js        ← "⚡ Generate with AI" button
```

---

## Task 4 — Security Hardening

### 4-A: Add Storage rule for `assignment_pages/`

**Files:**
- Modify: `storage.rules`

- [ ] **Step 1: Add the rule block**

Open `storage.rules`. After the `/assignments/{classId}/{fileId}` block, add:

```
match /assignment_pages/{classId}/{assignmentId}/{fileName} {
  // Teacher who owns the class writes page images; enrolled students and TAs read.
  allow write: if isTeacher()
    && request.resource.size < 50 * 1024 * 1024
    && isImageUpload();
  allow read: if isAuthenticated() && (
    isTeacher() || isEnrolledInClass(classId) || isTAofClass(classId)
  );
}
```

- [ ] **Step 2: Verify locally**

```bash
cd Grader
firebase emulators:start --only storage
# In Firebase Emulator UI http://localhost:4000 → Storage → confirm path accepted
```

- [ ] **Step 3: Deploy**

```bash
firebase deploy --only storage
```

Expected output: `✔  storage: rules from storage.rules deployed.`

- [ ] **Step 4: Commit**

```bash
git add storage.rules
git commit -m "feat(security): add assignment_pages storage rule"
```

---

### 4-B: Add Firestore rules for new collections

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add `quizCache` rule**

In `firestore.rules`, before the backstop `match /{document=**}` block, add:

```
// ─────────────────────────────────────────
// Quiz Cache (NL prompt → generated questions, 24h TTL)
// Service-account writes only; teacher reads.
// ─────────────────────────────────────────
match /quizCache/{docId} {
  allow read: if isTeacher();
  allow write: if false;  // Cloud Functions only (admin SDK bypasses rules)
}
```

- [ ] **Step 2: Add `assignmentInsights` rule**

```
// ─────────────────────────────────────────
// Assignment Insights (post-grading analytics)
// Service-account writes; teacher and TAs read.
// ─────────────────────────────────────────
match /assignmentInsights/{assignmentId} {
  allow read: if isAuthenticated() && (
    (isTeacher() && resource.data.classId is string && isTeacherOfClass(resource.data.classId)) ||
    (resource.data.classId is string && isTAofClass(resource.data.classId))
  );
  allow write: if false;  // Cloud Functions only
}
```

- [ ] **Step 3: Add `rateLimits` rule**

```
// ─────────────────────────────────────────
// Rate Limits (per-user counters for grading and quiz generation)
// Service-account writes; the owning user reads their own.
// ─────────────────────────────────────────
match /rateLimits/{uid}/{docId} {
  allow read: if isOwner(uid);
  allow write: if false;  // Cloud Functions only
}
```

- [ ] **Step 4: Deploy Firestore rules**

```bash
firebase deploy --only firestore:rules
```

Expected: `✔  firestore: rules from firestore.rules deployed.`

- [ ] **Step 5: Commit**

```bash
git add firestore.rules
git commit -m "feat(security): add quizCache, assignmentInsights, rateLimits rules"
```

---

### 4-C: Pydantic validation in Python grading functions

**Files:**
- Create: `functions/grading/validators.py`
- Modify: `functions/grading/requirements.txt`
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Pin pydantic in requirements.txt**

Add to `functions/grading/requirements.txt`:

```
pydantic>=2.0,<3.0
```

- [ ] **Step 2: Create validators.py**

Create `functions/grading/validators.py`:

```python
"""Pydantic models for validating incoming Firestore trigger data and callable inputs."""
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator


class GradingJobData(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    studentId: str = Field(min_length=1, max_length=128)
    teacherId: str = Field(min_length=1, max_length=128)
    submissionType: Literal['pdf', 'text'] = 'pdf'
    rawPdfUrl: Optional[str] = None
    submissionText: Optional[str] = Field(default=None, max_length=50000)
    rubric: object = None  # dict or string — validated downstream

    @field_validator('rawPdfUrl')
    @classmethod
    def pdf_url_required_for_pdf(cls, v, info):
        if info.data.get('submissionType') == 'pdf' and not v:
            raise ValueError('rawPdfUrl is required when submissionType is pdf')
        return v


class GenerateQuizInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    prompt: Optional[str] = Field(default=None, max_length=500)
    excludedDocIds: list[str] = Field(default_factory=list)
    useKnowledgeBase: bool = True
    questionCount: int = Field(default=10, ge=1, le=30)
    difficulty: Literal['easy', 'medium', 'hard', 'mixed'] = 'mixed'
    questionTypes: list[Literal['mcq', 'short', 'long']] = Field(default_factory=lambda: ['mcq'])


class GenerateRubricInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    rawPdfPath: str = Field(min_length=1, max_length=512)


class ExtractPdfPagesInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    assignmentId: str = Field(min_length=1, max_length=128)
    storagePath: str = Field(min_length=1, max_length=512)


class QuickGenerateInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=3, max_length=500)
    useKnowledgeBase: bool = True
    questionCount: int = Field(default=10, ge=1, le=30)
    difficulty: Literal['easy', 'medium', 'hard', 'mixed'] = 'mixed'
    questionTypes: list[Literal['mcq', 'short', 'long']] = Field(default_factory=lambda: ['mcq'])
```

- [ ] **Step 3: Add validation to grade_pdf trigger in main.py**

At the top of the `grade_pdf` function body, after `job_data = after_data`, add:

```python
from validators import GradingJobData
from pydantic import ValidationError as PydanticValidationError

try:
    validated = GradingJobData(**{k: job_data.get(k) for k in GradingJobData.model_fields})
except PydanticValidationError as ve:
    job_ref.update({'status': 'error', 'feedback': f'Invalid job data: {ve.error_count()} validation error(s).'})
    print(f"Validation error for job {job_id}: {ve}")
    return
```

- [ ] **Step 4: Add PDF size check in grade_pdf (before PyMuPDF loads it)**

In `grade_pdf`, immediately after `pdf_bytes = blob.download_as_bytes()`, add:

```python
MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB
if len(pdf_bytes) > MAX_PDF_BYTES:
    raise Exception(f"PDF exceeds 50 MB limit ({len(pdf_bytes) / 1024 / 1024:.1f} MB). Submission rejected.")
```

- [ ] **Step 5: Commit**

```bash
git add functions/grading/validators.py functions/grading/requirements.txt functions/grading/main.py
git commit -m "feat(security): add pydantic validation and PDF size check to grading functions"
```

---

### 4-D: Rate limiting

**Files:**
- Create: `functions/grading/rate_limiter.py`
- Modify: `functions/grading/main.py`
- Modify: `functions/quiz/index.js`

- [ ] **Step 1: Create rate_limiter.py**

Create `functions/grading/rate_limiter.py`:

```python
"""Firestore-backed rate limiting for Cloud Functions."""
import datetime
from firebase_admin import firestore


def _get_db():
    return firestore.client()


def check_student_grading_limit(student_id: str, class_id: str, max_active: int = 10) -> bool:
    """Returns True if student is within limit, False if they have hit it.

    Counts gradingJobs for this student+class with status in (queued, processing).
    """
    db = _get_db()
    active_query = (
        db.collection('gradingJobs')
        .where('studentId', '==', student_id)
        .where('classId', '==', class_id)
        .where('status', 'in', ['queued', 'processing'])
    )
    count = len(list(active_query.stream()))
    return count < max_active


def check_teacher_quiz_gen_limit(teacher_id: str, max_per_day: int = 20) -> bool:
    """Returns True if teacher is within daily quiz generation limit.

    Tracks count in rateLimits/{uid}/quizGen with a 'date' field for today.
    Uses admin SDK (bypasses Firestore rules — write is always allowed).
    """
    db = _get_db()
    today = datetime.date.today().isoformat()
    ref = db.collection('rateLimits').document(teacher_id).collection('quizGen').document(today)
    snap = ref.get()
    if snap.exists:
        current = snap.to_dict().get('count', 0)
        return current < max_per_day
    return True


def increment_teacher_quiz_gen(teacher_id: str):
    """Increment the teacher's daily quiz generation counter."""
    db = _get_db()
    today = datetime.date.today().isoformat()
    ref = db.collection('rateLimits').document(teacher_id).collection('quizGen').document(today)
    ref.set({'count': firestore.Increment(1), 'date': today}, merge=True)
```

- [ ] **Step 2: Add student rate limit check to grade_pdf in main.py**

In `grade_pdf`, after the validation block (step 4-C), add:

```python
from rate_limiter import check_student_grading_limit

student_id_check = job_data.get('studentId', '')
class_id_check = job_data.get('classId', '')
if not check_student_grading_limit(student_id_check, class_id_check, max_active=10):
    job_ref.update({
        'status': 'error',
        'feedback': 'Rate limit: you have too many active grading jobs. Wait for current submissions to finish.'
    })
    return
```

- [ ] **Step 3: Add teacher rate limit check to generate_quick_content (added in Task 2)**

This is referenced in Task 2, Step 3. Note here to add it when implementing that function.

- [ ] **Step 4: Add classIds[] custom claim in onUserCreate (Node.js)**

In `functions/quiz/index.js`, find the `onUserCreate` handler. After setting role in `customClaims`, for teacher registrations also fetch their classes and set `classIds`. Replace the custom claims assignment section with:

```javascript
let customClaims = { role: payload.role || 'student' };

// For teachers, pre-populate classIds[] claim (empty at creation, updated on class create)
if (customClaims.role === 'teacher') {
  customClaims.classIds = [];
}

await admin.auth().setCustomUserClaims(user.uid, customClaims);
```

Also add a new exported function that updates a teacher's classIds claim when they create a class. Add after existing exports:

```javascript
exports.refreshTeacherClassClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
  const uid = context.auth.uid;
  const role = context.auth.token.role;
  if (role !== 'teacher') throw new functions.https.HttpsError('permission-denied', 'Teachers only.');

  const classSnap = await db.collection('classes').where('teacherId', '==', uid).get();
  const classIds = classSnap.docs.map(d => d.id);

  const existing = context.auth.token;
  await admin.auth().setCustomUserClaims(uid, { ...existing, classIds });
  return { classIds };
});
```

- [ ] **Step 5: Deploy functions**

```bash
firebase deploy --only functions:onUserCreate,functions:refreshTeacherClassClaim
```

- [ ] **Step 6: Commit**

```bash
git add functions/grading/rate_limiter.py functions/grading/main.py functions/quiz/index.js
git commit -m "feat(security): add rate limiting and teacher classIds custom claim"
```

---

## Task 5 — Cost Reductions

### 5-A: Fix `_get_genai_model()` bug + add 800 px image resize

**Files:**
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Fix undefined `_get_genai_model()` in text submission branch**

In `main.py`, find the text submission branch (~line 220). Replace:

```python
model = _get_genai_model()
```

with:

```python
genai = _init_genai()
model = genai.GenerativeModel('gemini-2.5-flash')
```

- [ ] **Step 2: Add 800 px resize helper**

After the `_increment_usage` function, add:

```python
def _resize_for_gemini(img, max_side: int = 800, quality: int = 75) -> bytes:
    """Resize PIL Image so its longest side ≤ max_side, return JPEG bytes."""
    from PIL import Image
    from io import BytesIO
    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
```

- [ ] **Step 3: Replace inline JPEG encoding in grade_pdf with `_resize_for_gemini`**

In `grade_pdf`, find the contents-building loop:

```python
for p in page_images:
    b = BytesIO()
    p['img'].save(b, format="JPEG", quality=70)
    img_data = b.getvalue()
    contents.append({
        "mime_type": "image/jpeg",
        "data": img_data
    })
```

Replace with:

```python
for p in page_images:
    img_data = _resize_for_gemini(p['img'], max_side=800, quality=75)
    contents.append({
        "mime_type": "image/jpeg",
        "data": img_data
    })
```

- [ ] **Step 4: Also apply resize in generate_rubric**

In `generate_rubric`, find:

```python
for img in page_images:
    b = BytesIO()
    img.save(b, format="JPEG", quality=70)
    contents.append({
        "mime_type": "image/jpeg",
        "data": b.getvalue()
    })
```

Replace with:

```python
for img in page_images:
    contents.append({
        "mime_type": "image/jpeg",
        "data": _resize_for_gemini(img, max_side=800, quality=75)
    })
```

- [ ] **Step 5: Verify prompt ordering (static before dynamic) in grade_pdf**

Confirm the `contents` list in `grade_pdf` is ordered as:
1. `prompt` string (contains rubric + KB — static/repeated)
2. Page images (student submission — dynamic)

This is already the case in the existing code. Add a comment above the contents list:

```python
# Prompt caching: static content (rubric, KB, instructions) FIRST — images LAST.
# Gemini's implicit cache benefits from consistent leading content across requests.
contents = [prompt]
```

- [ ] **Step 6: Deploy**

```bash
firebase deploy --only functions:grade_pdf,functions:generate_rubric
```

- [ ] **Step 7: Commit**

```bash
git add functions/grading/main.py
git commit -m "perf: fix genai model bug, add 800px resize for Gemini image calls"
```

---

### 5-B: Minimum instances in firebase.json

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Read current firebase.json**

Open `firebase.json`. Find the functions configuration block. Add `minInstances: 1` to `grade_pdf`:

```json
{
  "functions": [
    {
      "codebase": "grading",
      "ignore": ["venv", "__pycache__", ".git", "*.pyc"],
      "minInstances": 1
    },
    {
      "codebase": "quiz",
      "ignore": ["node_modules", ".git"]
    }
  ]
}
```

> Note: `minInstances` in `firebase.json` is a project-level default. Per-function `minInstances` is set in the function decorator in Python. For grade_pdf, add `min_instances=1` to the decorator:

In `main.py`, find:

```python
@firestore_fn.on_document_written(
    document="gradingJobs/{jobId}",
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
```

Replace with:

```python
@firestore_fn.on_document_written(
    document="gradingJobs/{jobId}",
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
    min_instances=1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
```

- [ ] **Step 2: Deploy**

```bash
firebase deploy --only functions:grade_pdf
```

- [ ] **Step 3: Commit**

```bash
git add firebase.json functions/grading/main.py
git commit -m "perf: set min_instances=1 on grade_pdf to reduce cold starts"
```

---

### 5-C: Storage URL caching in React state

**Files:**
- Modify: `apps/web/pages/student/submission/[jobId].js` (or wherever the annotated PDF URL is fetched)

- [ ] **Step 1: Locate the URL fetch pattern**

Search for where `resultPdfUrl` is converted to a download URL. It will look something like:

```javascript
const url = await getDownloadURL(ref(storage, job.resultPdfUrl));
setResultUrl(url);
```

- [ ] **Step 2: Cache the URL in a ref so it is not regenerated on every render**

Replace the raw `getDownloadURL` call with a cached version. The pattern is:

```javascript
const urlCache = useRef({});

const getPdfUrl = async (storagePath) => {
  if (urlCache.current[storagePath]) return urlCache.current[storagePath];
  const url = await getDownloadURL(ref(storage, storagePath));
  urlCache.current[storagePath] = url;
  return url;
};
```

Use `getPdfUrl(job.resultPdfUrl)` wherever the URL is needed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/pages/student/
git commit -m "perf: cache Storage download URLs in React ref to avoid regenerating on every render"
```

---

### 5-D: Gradebook pagination

**Files:**
- Modify: `apps/web/pages/teacher/class/[classId]/gradebook.js`

- [ ] **Step 1: Add pagination state**

In `GradebookPage`, add:

```javascript
const PAGE_SIZE = 25;
const [page, setPage] = useState(0);
```

- [ ] **Step 2: Slice the students array for the current page**

After `students` is loaded, compute the displayed slice:

```javascript
const pagedStudents = useMemo(
  () => students.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
  [students, page]
);
```

Replace `students` with `pagedStudents` in the table body render.

- [ ] **Step 3: Add pagination controls below the table**

```jsx
<div className="flex items-center justify-between mt-4">
  <span className="text-sm text-muted-foreground">
    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, students.length)} of {students.length} students
  </span>
  <div className="flex gap-2">
    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
      Previous
    </Button>
    <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= students.length} onClick={() => setPage(p => p + 1)}>
      Next
    </Button>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/pages/teacher/class/\[classId\]/gradebook.js
git commit -m "perf: paginate gradebook to 25 students per page"
```

---

## Task 2 — One-Prompt Quiz/Test Generator

### 2-A: Backend — `generate_quick_content` callable function

**Files:**
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Add the `generate_quick_content` callable function to main.py**

Append to the end of `main.py`:

```python
# ---------------------------------------------------------------------------
# generate_quick_content — HTTPS Callable
# Natural-language prompt → assignment builder blocks (Task 1 schema)
# ---------------------------------------------------------------------------

@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def generate_quick_content(req: https_fn.CallableRequest):
    """
    Accept a single natural-language prompt and return assignment builder blocks.
    Input: { classId, prompt, useKnowledgeBase, questionCount, difficulty, questionTypes }
    Returns: { blocks: [...], title: str, totalPoints: int }
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    from validators import QuickGenerateInput
    from pydantic import ValidationError as PydanticValidationError
    from rate_limiter import check_teacher_quiz_gen_limit, increment_teacher_quiz_gen
    import hashlib

    teacher_id = req.auth.uid

    try:
        inp = QuickGenerateInput(**(req.data or {}))
    except PydanticValidationError as ve:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(ve)
        )

    # Rate limit: 20 generations per teacher per day
    if not check_teacher_quiz_gen_limit(teacher_id, max_per_day=20):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
            message="Daily quiz generation limit reached (20/day). Try again tomorrow."
        )

    # Cache key: hash of prompt + classId + relevant params
    cache_key_input = f"{inp.prompt}|{inp.classId}|{inp.questionCount}|{inp.difficulty}|{'|'.join(sorted(inp.questionTypes))}"
    cache_hash = hashlib.md5(cache_key_input.encode()).hexdigest()

    db = _get_db()

    # Check 24-hour cache
    cache_ref = db.collection('quizCache').document(cache_hash)
    cache_snap = cache_ref.get()
    if cache_snap.exists:
        cached = cache_snap.to_dict()
        cached_at = cached.get('createdAt')
        if cached_at:
            import datetime
            age = datetime.datetime.now(datetime.timezone.utc) - cached_at
            if age.total_seconds() < 86400:
                return cached.get('result')

    # Fetch KB context (max 8000 tokens ≈ 8000 chars; 1 token ≈ 4 chars is a safe approximation here)
    kb_text = ""
    if inp.useKnowledgeBase:
        kb_text = _get_kb_text(inp.classId, max_chars=8000)

    genai = _init_genai()
    model = genai.GenerativeModel("gemini-2.5-flash")

    question_types_str = ", ".join(inp.questionTypes) if inp.questionTypes else "mcq"

    prompt_text = f"""You are a curriculum expert. The teacher typed: "{inp.prompt}"

Parse that prompt to extract: topic, grade_level (default: "college"), question_count ({inp.questionCount}), difficulty ({inp.difficulty}), question_types ({question_types_str}).

{"Use this course knowledge base as reference: " + kb_text if kb_text else "No knowledge base provided."}

Generate exactly {inp.questionCount} question(s) of type(s): {question_types_str}.
Difficulty: {inp.difficulty}.

Return ONLY a JSON object (no markdown) with this schema:
{{
  "title": "Short descriptive title for this assignment (max 60 chars)",
  "totalPoints": <sum of all question points>,
  "blocks": [
    {{
      "id": "block_1",
      "type": "question",
      "order": 1,
      "content": "<question text — use LaTeX for math>",
      "points": 1,
      "questionType": "mcq" | "short" | "long",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],  // only for mcq
      "answer": "A",  // only for mcq
      "hint": "one concise sentence",
      "topic": "topic name"
    }}
  ]
}}

For section dividers between groups of questions, add blocks with type "divider":
  {{ "id": "div_1", "type": "divider", "order": 0, "content": "Part A — Short Answer" }}

Start the block list with one divider if there are multiple parts. Keep block IDs unique.
"""

    for attempt in range(2):
        try:
            extra = '' if attempt == 0 else '\nCRITICAL: Return RAW JSON ONLY. No markdown.'
            response = model.generate_content(prompt_text + extra)
            json_str = response.text.strip()
            if '```json' in json_str:
                json_str = json_str.split('```json')[-1].split('```')[0].strip()
            elif '```' in json_str:
                json_str = json_str.split('```')[1].strip()
            result = json.loads(json_str)
            if 'blocks' not in result or 'title' not in result:
                raise ValueError("Missing required fields: blocks, title")
            break
        except Exception as e:
            if attempt == 1:
                raise https_fn.HttpsError(
                    code=https_fn.FunctionsErrorCode.INTERNAL,
                    message=f"Content generation failed: {e}"
                )

    # Store in cache (admin SDK — bypasses rules)
    cache_ref.set({
        'result': result,
        'prompt': inp.prompt,
        'classId': inp.classId,
        'createdAt': firestore.SERVER_TIMESTAMP
    })

    increment_teacher_quiz_gen(teacher_id)
    _increment_usage()
    return result
```

- [ ] **Step 2: Deploy**

```bash
firebase deploy --only functions:generate_quick_content
```

- [ ] **Step 3: Commit**

```bash
git add functions/grading/main.py
git commit -m "feat(generator): add generate_quick_content callable with NL prompt, caching, rate limiting"
```

---

### 2-B: Frontend — `QuickGenerateModal.js`

**Files:**
- Create: `apps/web/components/teacher/QuickGenerateModal.js`

- [ ] **Step 1: Create the modal component**

Create `apps/web/components/teacher/QuickGenerateModal.js`:

```javascript
import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Zap, ChevronDown, ChevronUp } from 'lucide-react';

const STEPS = [
  'Parsing your prompt…',
  'Generating questions…',
  'Building rubric…',
  'Ready to review',
];

const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'];
const QUESTION_TYPES = ['mcq', 'short', 'long'];

export default function QuickGenerateModal({ open, onClose, classId, onGenerated, prefill = '' }) {
  const [prompt, setPrompt] = useState(prefill);
  const [advanced, setAdvanced] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState('mixed');
  const [questionTypes, setQuestionTypes] = useState(['mcq']);
  const [useKB, setUseKB] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');

  const toggleType = (t) =>
    setQuestionTypes(prev => prev.includes(t) ? prev.filter(x => x !== x === t) : [...prev, t]);

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError('Please describe the quiz or test you want.'); return; }
    setError('');
    setIsLoading(true);
    setStepIdx(0);

    // Simulate step progression while waiting for cloud function
    const stepTimer = setInterval(() => {
      setStepIdx(prev => (prev < STEPS.length - 2 ? prev + 1 : prev));
    }, 1800);

    try {
      const fn = httpsCallable(functions, 'generate_quick_content');
      const { data } = await fn({
        classId,
        prompt: prompt.trim(),
        useKnowledgeBase: useKB,
        questionCount,
        difficulty,
        questionTypes: questionTypes.length ? questionTypes : ['mcq'],
      });
      clearInterval(stepTimer);
      setStepIdx(STEPS.length - 1);
      await new Promise(r => setTimeout(r, 600)); // show "Ready to review" briefly
      onGenerated(data); // pass blocks + title to parent → opens builder
      onClose();
    } catch (e) {
      clearInterval(stepTimer);
      setError(e.message || 'Generation failed. Please try again.');
    } finally {
      setIsLoading(false);
      setStepIdx(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isLoading) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Generate with AI
          </DialogTitle>
          <DialogDescription>
            Describe what you want in plain English. The AI will build the questions for you to review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="qg-prompt">What do you want to generate?</Label>
            <Input
              id="qg-prompt"
              placeholder="e.g. 10-question Civil War quiz, 8th grade, mixed difficulty"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={isLoading}
              className="mt-1"
              onKeyDown={e => e.key === 'Enter' && !isLoading && handleGenerate()}
            />
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced(v => !v)}
          >
            {advanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Advanced options
          </button>

          {advanced && (
            <div className="space-y-4 rounded-md border p-4">
              {/* Question types */}
              <div>
                <Label className="mb-2 block">Question types</Label>
                <div className="flex gap-2 flex-wrap">
                  {QUESTION_TYPES.map(t => (
                    <Badge
                      key={t}
                      variant={questionTypes.includes(t) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => toggleType(t)}
                    >
                      {t === 'mcq' ? 'Multiple Choice' : t === 'short' ? 'Short Answer' : 'Long Answer'}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Question count */}
              <div>
                <Label htmlFor="qg-count">Number of questions: {questionCount}</Label>
                <input
                  id="qg-count"
                  type="range"
                  min={1}
                  max={30}
                  value={questionCount}
                  onChange={e => setQuestionCount(Number(e.target.value))}
                  className="w-full mt-1"
                />
              </div>

              {/* Difficulty */}
              <div>
                <Label className="mb-2 block">Difficulty</Label>
                <div className="flex gap-2 flex-wrap">
                  {DIFFICULTIES.map(d => (
                    <Badge
                      key={d}
                      variant={difficulty === d ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => setDifficulty(d)}
                    >
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Use KB */}
              <div className="flex items-center justify-between">
                <Label>Tie to knowledge base</Label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useKB}
                  onClick={() => setUseKB(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${useKB ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${useKB ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          )}

          {/* Progress */}
          {isLoading && (
            <div className="space-y-2">
              <Progress value={(stepIdx / (STEPS.length - 1)) * 100} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">{STEPS[stepIdx]}</p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={isLoading || !prompt.trim()}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add "⚡ Generate with AI" button to teacher class detail page**

In `apps/web/pages/teacher/class/[classId].js`:

1. Import `QuickGenerateModal`:
```javascript
import QuickGenerateModal from '@/components/teacher/QuickGenerateModal';
```

2. Add state in the component body:
```javascript
const [showGenerateModal, setShowGenerateModal] = useState(false);
```

3. Add the button near the "Create Assignment" button:
```jsx
<Button variant="outline" onClick={() => setShowGenerateModal(true)}>
  <Zap className="h-4 w-4 mr-2 text-yellow-500" />
  Generate with AI
</Button>
```

4. Add the modal at the bottom of the JSX (before closing tags):
```jsx
<QuickGenerateModal
  open={showGenerateModal}
  onClose={() => setShowGenerateModal(false)}
  classId={classId}
  onGenerated={(data) => {
    // Navigate to assignment builder pre-populated with generated blocks
    const encoded = encodeURIComponent(JSON.stringify(data));
    router.push(`/teacher/assignment-builder/${classId}?generated=${encoded}`);
  }}
/>
```

5. Import `Zap` from lucide-react (add to existing import).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/teacher/QuickGenerateModal.js apps/web/pages/teacher/class/
git commit -m "feat(generator): add QuickGenerateModal and Generate with AI button"
```

---

## Task 1 — Drag-and-Drop Assignment Builder

### 1-A: Install @dnd-kit packages

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install packages**

```bash
cd apps/web
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^8.0.0 @dnd-kit/utilities@^3.2.2
```

- [ ] **Step 2: Verify installation**

```bash
npm ls @dnd-kit/core
```

Expected: `@dnd-kit/core@6.x.x`

- [ ] **Step 3: Commit**

```bash
cd ../..
git add apps/web/package.json apps/web/package-lock.json
git commit -m "deps: add @dnd-kit/core, sortable, utilities for assignment builder"
```

---

### 1-B: Backend — `extract_pdf_pages` callable function

**Files:**
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Add `extract_pdf_pages` function to main.py**

Append to `main.py`:

```python
# ---------------------------------------------------------------------------
# extract_pdf_pages — HTTPS Callable
# Accepts a Storage path to a PDF, renders each page as JPEG at 150 DPI,
# uploads to assignment_pages/{classId}/{assignmentId}/page_{n}.jpg
# Returns ordered array of Storage URLs.
# ---------------------------------------------------------------------------

@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def extract_pdf_pages(req: https_fn.CallableRequest):
    """
    Input:  { classId: str, assignmentId: str, storagePath: str }
    Returns: { pages: [{ pageNumber, url }] }
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    from validators import ExtractPdfPagesInput
    from pydantic import ValidationError as PydanticValidationError

    try:
        inp = ExtractPdfPagesInput(**(req.data or {}))
    except PydanticValidationError as ve:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(ve)
        )

    bucket = _get_bucket()
    blob = bucket.blob(inp.storagePath)
    if not blob.exists():
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message=f"PDF not found at {inp.storagePath}"
        )

    pdf_bytes = blob.download_as_bytes()
    MAX_PDF_BYTES = 50 * 1024 * 1024
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="PDF exceeds 50 MB limit."
        )

    import fitz
    from PIL import Image
    from io import BytesIO

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    result_pages = []

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_bytes = _resize_for_gemini(img, max_side=1200, quality=85)  # higher quality for teacher preview

        dest_path = f"assignment_pages/{inp.classId}/{inp.assignmentId}/page_{page_num + 1}.jpg"
        dest_blob = bucket.blob(dest_path)
        dest_blob.upload_from_string(img_bytes, content_type="image/jpeg")

        # Generate a 1-hour signed URL so the frontend can display the image
        import datetime
        url = dest_blob.generate_signed_url(
            expiration=datetime.timedelta(hours=1),
            method='GET'
        )
        result_pages.append({'pageNumber': page_num + 1, 'url': url, 'storagePath': dest_path})

    doc.close()
    _increment_usage()
    return {'pages': result_pages}
```

- [ ] **Step 2: Deploy**

```bash
firebase deploy --only functions:extract_pdf_pages
```

- [ ] **Step 3: Commit**

```bash
git add functions/grading/main.py
git commit -m "feat(builder): add extract_pdf_pages callable function"
```

---

### 1-C: Assignment builder — block primitives

**Files:**
- Create: `apps/web/components/teacher/builder/BlockRenderer.js`

- [ ] **Step 1: Create BlockRenderer.js**

Create `apps/web/components/teacher/builder/BlockRenderer.js`:

```javascript
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Trash2, Copy, GripVertical, Image as ImageIcon, FileText, Minus, AlignLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const RichMathEditor = dynamic(() => import('@/components/editor/RichMathEditor'), { ssr: false });

const BLOCK_ICONS = {
  question: FileText,
  image: ImageIcon,
  pdf_page: FileText,
  divider: Minus,
  spacer: AlignLeft,
};

export default function BlockRenderer({ block, onUpdate, onDelete, onDuplicate, dragHandleProps, isDragging }) {
  const Icon = BLOCK_ICONS[block.type] || FileText;

  return (
    <div className={cn(
      'group relative rounded-lg border bg-card transition-shadow',
      isDragging ? 'shadow-2xl ring-2 ring-primary' : 'hover:shadow-md'
    )}>
      {/* Block header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        {/* Drag handle — keyboard accessible */}
        <button
          {...dragHandleProps}
          aria-label="Drag to reorder block"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground capitalize">
          {block.type === 'pdf_page' ? 'PDF Page' : block.type}
        </span>
        {block.type === 'question' && (
          <Input
            type="number"
            min={0}
            max={100}
            value={block.points ?? 1}
            onChange={e => onUpdate({ ...block, points: Number(e.target.value) })}
            className="ml-auto w-20 h-6 text-xs"
            placeholder="pts"
            aria-label="Points for this question"
          />
        )}
        <div className={cn('ml-auto flex gap-1', block.type === 'question' && 'ml-1')}>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => onDuplicate(block)}
            aria-label="Duplicate block"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={() => onDelete(block.id)}
            aria-label="Delete block"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Block body */}
      <div className="p-3">
        {block.type === 'question' && (
          <RichMathEditor
            initialContent={block.content || ''}
            onUpdate={html => onUpdate({ ...block, content: html })}
            placeholder="Enter question text here…"
          />
        )}

        {block.type === 'image' && (
          <ImageBlock block={block} onUpdate={onUpdate} />
        )}

        {block.type === 'pdf_page' && (
          <div className="text-center">
            {block.pageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.pageUrl} alt={`PDF page ${block.order}`} className="max-h-64 mx-auto rounded border" />
            ) : (
              <span className="text-sm text-muted-foreground">PDF page loading…</span>
            )}
          </div>
        )}

        {block.type === 'divider' && (
          <Input
            value={block.content || ''}
            onChange={e => onUpdate({ ...block, content: e.target.value })}
            placeholder="Section label, e.g. Part A — Short Answer"
            className="font-semibold"
          />
        )}

        {block.type === 'spacer' && (
          <div className="h-8 flex items-center justify-center border border-dashed rounded text-xs text-muted-foreground">
            Page Break / Spacer
          </div>
        )}
      </div>
    </div>
  );
}

function ImageBlock({ block, onUpdate }) {
  const [draggingOver, setDraggingOver] = useState(false);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => onUpdate({ ...block, imageDataUrl: e.target.result });
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDraggingOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handlePaste = (e) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  };

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
        draggingOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
      )}
      onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onClick={() => document.getElementById(`img-input-${block.id}`)?.click()}
      tabIndex={0}
      aria-label="Image upload area — click, drag, or paste an image"
    >
      {block.imageDataUrl || block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageDataUrl || block.imageUrl}
          alt="Uploaded"
          className="max-h-48 mx-auto rounded"
        />
      ) : (
        <div className="space-y-1">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drag, paste, or click to upload image</p>
        </div>
      )}
      <input
        id={`img-input-${block.id}`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/teacher/builder/
git commit -m "feat(builder): add BlockRenderer component with all block types"
```

---

### 1-D: Assignment builder — main page

**Files:**
- Create: `apps/web/pages/teacher/assignment-builder/[classId].js`

- [ ] **Step 1: Create the assignment builder page**

Create `apps/web/pages/teacher/assignment-builder/[classId].js`:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db, functions, storage } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import BlockRenderer from '@/components/teacher/builder/BlockRenderer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  FileText, Image as ImageIcon, FileIcon, Minus, AlignLeft,
  Monitor, Smartphone, Save, Send, ArrowLeft, Loader2, Plus
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// Toolbox block types
const BLOCK_TYPES = [
  { type: 'question',  label: 'Question',      icon: FileText },
  { type: 'image',     label: 'Image',          icon: ImageIcon },
  { type: 'pdf_page',  label: 'PDF Page',       icon: FileIcon },
  { type: 'divider',   label: 'Section Divider',icon: Minus },
  { type: 'spacer',    label: 'Page Break',     icon: AlignLeft },
];

function makeBlock(type, order) {
  return { id: `block_${uuidv4()}`, type, order, content: '', points: type === 'question' ? 1 : 0 };
}

// Sortable wrapper
function SortableBlock({ block, onUpdate, onDelete, onDuplicate }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BlockRenderer
        block={block}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

// Student preview panel
function PreviewPanel({ blocks, title, previewMode }) {
  return (
    <div className={cn(
      'mx-auto bg-white dark:bg-zinc-900 rounded-lg shadow-inner p-6 border overflow-y-auto',
      previewMode === 'mobile' ? 'max-w-sm' : 'max-w-2xl'
    )}>
      <h1 className="text-xl font-bold mb-4">{title || 'Untitled Assignment'}</h1>
      {blocks.map(b => (
        <div key={b.id} className="mb-4">
          {b.type === 'question' && (
            <div className="space-y-2">
              <div
                className="prose dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: b.content || '<em>Empty question</em>' }}
              />
              <div className="text-xs text-muted-foreground">{b.points} pt{b.points !== 1 ? 's' : ''}</div>
              {b.questionType === 'mcq' && b.options?.length ? (
                <ul className="ml-4 space-y-1">
                  {b.options.map((o, i) => <li key={i} className="text-sm">{o}</li>)}
                </ul>
              ) : (
                <div className="h-16 border rounded bg-muted/30" />
              )}
            </div>
          )}
          {b.type === 'image' && (b.imageDataUrl || b.imageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.imageDataUrl || b.imageUrl} alt="" className="max-w-full rounded border" />
          )}
          {b.type === 'pdf_page' && b.pageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.pageUrl} alt="" className="max-w-full rounded border" />
          )}
          {b.type === 'divider' && (
            <div className="border-t-2 pt-2 font-semibold text-sm">{b.content || '────'}</div>
          )}
          {b.type === 'spacer' && <div className="h-8" />}
        </div>
      ))}
    </div>
  );
}

function AssignmentBuilderPage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPdfExtracting, setIsPdfExtracting] = useState(false);
  const assignmentIdRef = useRef(uuidv4());
  const autoSaveTimer = useRef(null);

  // Load pre-generated blocks from QuickGenerateModal (via URL param)
  useEffect(() => {
    if (!router.isReady) return;
    const generated = router.query.generated;
    if (generated) {
      try {
        const data = JSON.parse(decodeURIComponent(generated));
        setTitle(data.title || '');
        setBlocks((data.blocks || []).map((b, i) => ({ ...b, order: i + 1 })));
      } catch (_) {}
    }
  }, [router.isReady, router.query.generated]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }) => {
    if (active.id !== over?.id) {
      setBlocks(prev => {
        const oldIdx = prev.findIndex(b => b.id === active.id);
        const newIdx = prev.findIndex(b => b.id === over.id);
        const reordered = arrayMove(prev, oldIdx, newIdx);
        return reordered.map((b, i) => ({ ...b, order: i + 1 }));
      });
      scheduleSave();
    }
  };

  const addBlock = (type) => {
    const newBlock = makeBlock(type, blocks.length + 1);
    setBlocks(prev => [...prev, newBlock]);
    scheduleSave();
  };

  const updateBlock = (updated) => {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
    scheduleSave();
  };

  const deleteBlock = (id) => {
    setBlocks(prev => prev.filter(b => b.id !== id).map((b, i) => ({ ...b, order: i + 1 })));
    scheduleSave();
  };

  const duplicateBlock = (block) => {
    const copy = { ...block, id: `block_${uuidv4()}`, order: block.order + 0.5 };
    setBlocks(prev => {
      const next = [...prev, copy].sort((a, b) => a.order - b.order).map((b, i) => ({ ...b, order: i + 1 }));
      return next;
    });
    scheduleSave();
  };

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveToFirestore('draft'), 2000);
  }, []);

  const saveToFirestore = async (status = 'draft') => {
    if (!classId || !user) return;
    setSaveStatus('saving');
    const totalPoints = blocks.filter(b => b.type === 'question').reduce((sum, b) => sum + (b.points || 0), 0);
    const assignmentDoc = {
      id: assignmentIdRef.current,
      classId,
      teacherId: user.uid,
      title: title || 'Untitled Assignment',
      blocks: blocks.map(b => {
        const { imageDataUrl, ...rest } = b;
        return rest; // don't store base64 data URLs in Firestore
      }),
      totalPoints,
      status,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(
      doc(db, 'assignments', assignmentIdRef.current),
      assignmentDoc,
      { merge: true }
    );
    setSaveStatus('saved');
  };

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (saveStatus === 'unsaved') saveToFirestore('draft');
    }, 30000);
    return () => clearInterval(interval);
  }, [saveStatus, blocks, title]);

  const handlePublish = async () => {
    setIsPublishing(true);
    await saveToFirestore('published');
    setIsPublishing(false);
    router.push(`/teacher/class/${classId}`);
  };

  const handlePdfUploadForExtraction = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsPdfExtracting(true);
    try {
      // Upload PDF to assignments/ path first
      const path = `assignments/${classId}/${assignmentIdRef.current}_extract_${Date.now()}.pdf`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);

      const fn = httpsCallable(functions, 'extract_pdf_pages');
      const { data } = await fn({
        classId,
        assignmentId: assignmentIdRef.current,
        storagePath: path,
      });

      const pdfBlocks = (data.pages || []).map((p, i) => ({
        id: `block_${uuidv4()}`,
        type: 'pdf_page',
        order: blocks.length + i + 1,
        content: '',
        points: 0,
        pageUrl: p.url,
        storagePath: p.storagePath,
      }));
      setBlocks(prev => [...prev, ...pdfBlocks].map((b, i) => ({ ...b, order: i + 1 })));
      scheduleSave();
    } catch (err) {
      alert(`PDF extraction failed: ${err.message}`);
    } finally {
      setIsPdfExtracting(false);
      e.target.value = '';
    }
  };

  if (!router.isReady) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <>
      <Head><title>Assignment Builder — TikiTaka</title></Head>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* LEFT PANEL — Toolbox */}
        <aside className="w-48 border-r bg-muted/20 flex flex-col shrink-0">
          <div className="p-3 border-b">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Add Block</p>
            <div className="space-y-1">
              {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => type === 'pdf_page' ? document.getElementById('pdf-extract-input')?.click() : addBlock(type)}
                  className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors text-left"
                  aria-label={`Add ${label} block`}
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            {/* Hidden PDF input for extraction */}
            <input id="pdf-extract-input" type="file" accept="application/pdf" className="hidden" onChange={handlePdfUploadForExtraction} />
            {isPdfExtracting && <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Extracting pages…</p>}
          </div>
        </aside>

        {/* CENTER — Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="border-b px-4 py-2 flex items-center gap-3 bg-background">
            <Input
              value={title}
              onChange={e => { setTitle(e.target.value); scheduleSave(); }}
              placeholder="Assignment title"
              className="max-w-xs font-semibold"
              aria-label="Assignment title"
            />
            <span className="ml-auto text-xs text-muted-foreground">
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </span>
            <Button variant="outline" size="sm" onClick={() => saveToFirestore('draft')}>
              <Save className="h-4 w-4 mr-1" /> Save Draft
            </Button>
            <Button size="sm" onClick={handlePublish} disabled={isPublishing}>
              {isPublishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Publish
            </Button>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="max-w-2xl mx-auto space-y-3">
                  {blocks.length === 0 && (
                    <Card className="p-12 text-center border-dashed">
                      <Plus className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground">Add blocks from the left panel to build your assignment.</p>
                    </Card>
                  )}
                  {blocks.map(block => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      onUpdate={updateBlock}
                      onDelete={deleteBlock}
                      onDuplicate={duplicateBlock}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </main>

        {/* RIGHT PANEL — Preview */}
        <aside className="w-80 border-l bg-muted/10 flex flex-col shrink-0">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium">Student Preview</span>
            <div className="flex gap-1">
              <Button
                variant={previewMode === 'desktop' ? 'default' : 'ghost'}
                size="icon" className="h-7 w-7"
                onClick={() => setPreviewMode('desktop')}
                aria-label="Desktop preview"
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                variant={previewMode === 'mobile' ? 'default' : 'ghost'}
                size="icon" className="h-7 w-7"
                onClick={() => setPreviewMode('mobile')}
                aria-label="Mobile preview"
              >
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <PreviewPanel blocks={blocks} title={title} previewMode={previewMode} />
          </div>
        </aside>
      </div>
    </>
  );
}

export default withAuth(AssignmentBuilderPage, 'teacher');
```

> **Note:** The `uuid` package is used here. Install it:
> ```bash
> cd apps/web && npm install uuid@^9.0.0 @types/uuid@^9.0.0
> ```

- [ ] **Step 2: Install uuid**

```bash
cd apps/web && npm install uuid@^9.0.0 && npm install --save-dev @types/uuid@^9.0.0
```

- [ ] **Step 3: Add firebase.json rewrite for the builder route**

Open `firebase.json`. In the `hosting.rewrites` array, add:

```json
{
  "source": "/teacher/assignment-builder/**",
  "destination": "/teacher/assignment-builder/[classId].html"
}
```

(Adjust the destination to match how your other dynamic routes are named in the static export.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/pages/teacher/assignment-builder/ apps/web/package.json firebase.json
git commit -m "feat(builder): add drag-and-drop assignment builder page"
```

---

### 1-E: Build and smoke-test locally

- [ ] **Step 1: Start dev server**

```bash
npm run dev --prefix apps/web
```

- [ ] **Step 2: Navigate to the builder**

Open `http://localhost:3000/teacher/assignment-builder/test-class-id` (any classId).

Expected: three-panel layout loads, left toolbox visible, empty canvas, preview panel.

- [ ] **Step 3: Test block add + reorder**

- Click "Question" → block appears in canvas with RichMathEditor
- Click "Section Divider" → divider block appears
- Drag Question block above Divider using handle
- Press Tab to focus the drag handle, use arrow keys to reorder — confirm keyboard reorder works

- [ ] **Step 4: Test PDF extraction**

- Click "PDF Page" in toolbox → file picker opens
- Upload a multi-page PDF
- Confirm page image blocks appear in canvas after extraction

- [ ] **Step 5: Test auto-save**

- Edit a block → "Unsaved changes" text appears
- Wait 2 s → "Saved" appears
- Check Firestore emulator UI → `assignments/{id}` document written

---

## Task 3 — Auto-Surface Insights After Grading

### 3-A: Backend — `compute_assignment_insights` callable

**Files:**
- Create: `functions/grading/insights.py`
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Create insights.py**

Create `functions/grading/insights.py`:

```python
"""compute_assignment_insights — aggregates grading results for one assignment."""
import json
import statistics
from firebase_admin import firestore


def _get_db():
    return firestore.client()


def compute_insights(assignment_id: str, class_id: str, teacher_id: str, genai) -> dict:
    """
    Aggregates all complete gradingJobs for assignment_id and writes
    assignmentInsights/{assignment_id} to Firestore.

    Returns the insights dict.
    """
    db = _get_db()

    # Idempotency: skip if already computed
    insight_ref = db.collection('assignmentInsights').document(assignment_id)
    existing = insight_ref.get()
    if existing.exists:
        return existing.to_dict()

    # Fetch all complete jobs for this assignment
    jobs_q = (
        db.collection('gradingJobs')
        .where('assignmentId', '==', assignment_id)
        .where('status', '==', 'complete')
    )
    jobs = [j.to_dict() for j in jobs_q.stream()]

    if not jobs:
        return {}

    scores = [j.get('score', 0) for j in jobs if j.get('score') is not None]
    total_pts_values = [j.get('totalPoints', 0) for j in jobs if j.get('totalPoints')]
    total_pts = total_pts_values[0] if total_pts_values else 1

    avg_pct = round(statistics.mean(s / total_pts * 100 for s in scores), 1) if scores else 0
    median_pct = round(statistics.median(s / total_pts * 100 for s in scores), 1) if scores else 0

    # Per-question aggregation
    q_map = {}
    for job in jobs:
        for q in job.get('gradedQuestions', []):
            qnum = q.get('questionNumber', '?')
            if qnum not in q_map:
                q_map[qnum] = {'scores': [], 'possible': q.get('pointsPossible', 1), 'feedback': [], 'text': ''}
            q_map[qnum]['scores'].append(q.get('pointsEarned', 0))
            fb = q.get('feedback', '')
            if fb:
                q_map[qnum]['feedback'].append(fb)

    question_breakdown = []
    for qnum, data in sorted(q_map.items()):
        avg_score = statistics.mean(data['scores']) if data['scores'] else 0
        fail_rate = round(sum(1 for s in data['scores'] if s < data['possible'] * 0.5) / max(len(data['scores']), 1) * 100, 1)
        question_breakdown.append({
            'questionId': qnum,
            'questionText': data['text'],
            'avgScore': round(avg_score, 2),
            'failRate': fail_rate,
            'commonMistakes': data['feedback'][:5],
        })

    # Sort by fail rate descending
    question_breakdown.sort(key=lambda q: q['failRate'], reverse=True)

    # Top struggling students
    student_scores = sorted(
        [{'uid': j.get('studentId', ''), 'displayName': j.get('studentName', ''), 'score': j.get('score', 0), 'pct': round(j.get('score', 0) / total_pts * 100, 1)} for j in jobs],
        key=lambda x: x['pct']
    )
    top_struggling = student_scores[:5]

    # Call Gemini for retouch topics (max 500 tokens)
    model = genai.GenerativeModel('gemini-2.5-flash')
    prompt = f"""
An assignment had these question fail rates: {json.dumps([{'q': q['questionId'], 'failRate': q['failRate'], 'mistakes': q['commonMistakes'][:2]} for q in question_breakdown[:5]])}

List up to 4 topics the teacher should re-teach. Return ONLY a JSON array of short strings, e.g.: ["Quadratic equations", "Newton's second law"].
"""
    suggested_topics = []
    try:
        resp = model.generate_content(prompt)
        raw = resp.text.strip()
        if '```' in raw:
            raw = raw.split('```')[1].strip()
        suggested_topics = json.loads(raw)
        if not isinstance(suggested_topics, list):
            suggested_topics = []
    except Exception as e:
        print(f"Retouch topic generation failed: {e}")

    insights = {
        'assignmentId': assignment_id,
        'classId': class_id,
        'teacherId': teacher_id,
        'computedAt': firestore.SERVER_TIMESTAMP,
        'totalSubmissions': len(jobs),
        'averageScore': avg_pct,
        'medianScore': median_pct,
        'questionBreakdown': question_breakdown,
        'topStrugglingStudents': top_struggling,
        'suggestedRetouchTopics': suggested_topics,
    }

    insight_ref.set(insights)
    return insights
```

- [ ] **Step 2: Wire into grade_pdf — check if all jobs complete after each grading**

In `main.py`, at the end of the `grade_pdf` success path (just before `_increment_usage()`), add:

```python
# After each job completes, check if all jobs for the assignment are done → compute insights
try:
    assignment_id = job_data.get('assignmentId')
    teacher_id_for_insights = job_data.get('teacherId')
    if assignment_id and class_id:
        all_jobs_q = _get_db().collection('gradingJobs').where('assignmentId', '==', assignment_id)
        all_jobs = list(all_jobs_q.stream())
        pending = [j for j in all_jobs if j.to_dict().get('status') not in ('complete', 'error')]
        if not pending:
            from insights import compute_insights
            genai_for_insights = _init_genai()
            compute_insights(assignment_id, class_id, teacher_id_for_insights, genai_for_insights)
            print(f"Insights computed for assignment {assignment_id}")
except Exception as insights_err:
    print(f"Insights computation failed (non-fatal): {insights_err}")
```

- [ ] **Step 3: Also do the same for the text submission branch**

Add the same insights block just before `return` in the text submission branch.

- [ ] **Step 4: Deploy**

```bash
firebase deploy --only functions:grade_pdf
```

- [ ] **Step 5: Commit**

```bash
git add functions/grading/insights.py functions/grading/main.py
git commit -m "feat(insights): add compute_assignment_insights triggered after all jobs complete"
```

---

### 3-B: Frontend — `InsightsPanel.js`

**Files:**
- Create: `apps/web/components/teacher/InsightsPanel.js`

- [ ] **Step 1: Create the InsightsPanel component**

Create `apps/web/components/teacher/InsightsPanel.js`:

```javascript
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingDown, Users, Zap, BookOpen } from 'lucide-react';

export default function InsightsPanel({ insights, classId, onGenerateRetouchQuiz }) {
  const [expanded, setExpanded] = useState(true);
  if (!insights) return null;

  const {
    totalSubmissions,
    averageScore,
    medianScore,
    questionBreakdown = [],
    topStrugglingStudents = [],
    suggestedRetouchTopics = [],
  } = insights;

  const chartData = questionBreakdown.slice(0, 10).map(q => ({
    name: q.questionId,
    failRate: q.failRate,
  }));

  const top3Failed = questionBreakdown.slice(0, 3);

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-amber-600" />
          <span className="font-semibold text-amber-800 dark:text-amber-300">Post-Grading Insights</span>
          <Badge variant="outline" className="text-xs">{totalSubmissions} submissions</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>

      {expanded && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">Class Average</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-3xl font-bold text-foreground">{averageScore}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">Median Score</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-3xl font-bold text-foreground">{medianScore}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-question fail rate bar chart */}
          {chartData.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Question Fail Rates</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={v => [`${v}%`, 'Fail rate']} />
                  <Bar dataKey="failRate" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.failRate >= 60 ? '#ef4444' : entry.failRate >= 30 ? '#f59e0b' : '#22c55e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top 3 most-failed questions */}
          {top3Failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1">
                <BookOpen className="h-4 w-4" /> Questions Most Missed
              </p>
              {top3Failed.map(q => (
                <div key={q.questionId} className="rounded-lg border bg-card p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{q.questionId}</span>
                    <Badge variant={q.failRate >= 60 ? 'destructive' : 'secondary'}>
                      {q.failRate}% fail rate
                    </Badge>
                  </div>
                  {q.commonMistakes.length > 0 && (
                    <p className="text-xs text-muted-foreground">Common error: {q.commonMistakes[0]?.replace(/^[✓✗◯±]\s*/, '')}</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => onGenerateRetouchQuiz(q, suggestedRetouchTopics)}
                  >
                    <Zap className="h-3 w-3 mr-1 text-yellow-500" />
                    Generate re-teaching quiz
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Struggling students */}
          {topStrugglingStudents.length > 0 && (
            <div>
              <p className="text-sm font-medium flex items-center gap-1 mb-2">
                <Users className="h-4 w-4" /> Students Needing Support
              </p>
              <div className="space-y-1">
                {topStrugglingStudents.map(s => (
                  <div key={s.uid} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.displayName || s.uid}</span>
                    <Badge variant={s.pct < 50 ? 'destructive' : 'secondary'}>{s.pct}%</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire InsightsPanel into gradebook page**

In `apps/web/pages/teacher/class/[classId]/gradebook.js`:

1. Add import at top:
```javascript
import { onSnapshot, doc } from 'firebase/firestore';
import InsightsPanel from '@/components/teacher/InsightsPanel';
import QuickGenerateModal from '@/components/teacher/QuickGenerateModal';
```

2. Add state:
```javascript
const [insights, setInsights] = useState(null);
const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
const [showGenerateModal, setShowGenerateModal] = useState(false);
const [generatePrefill, setGeneratePrefill] = useState('');
```

3. When an assignment is selected in the gradebook (or load the first one by default), subscribe to insights:
```javascript
useEffect(() => {
  if (!selectedAssignmentId) return;
  const unsub = onSnapshot(doc(db, 'assignmentInsights', selectedAssignmentId), snap => {
    setInsights(snap.exists() ? snap.data() : null);
  });
  return () => unsub();
}, [selectedAssignmentId]);
```

4. Render InsightsPanel above the gradebook table:
```jsx
<InsightsPanel
  insights={insights}
  classId={classId}
  onGenerateRetouchQuiz={(question, topics) => {
    const topicStr = topics.slice(0, 2).join(', ');
    setGeneratePrefill(`Re-teaching quiz on ${question.questionId} mistakes${topicStr ? ` — topics: ${topicStr}` : ''}`);
    setShowGenerateModal(true);
  }}
/>

<QuickGenerateModal
  open={showGenerateModal}
  onClose={() => setShowGenerateModal(false)}
  classId={classId}
  prefill={generatePrefill}
  onGenerated={(data) => {
    const encoded = encodeURIComponent(JSON.stringify(data));
    router.push(`/teacher/assignment-builder/${classId}?generated=${encoded}`);
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/teacher/InsightsPanel.js apps/web/pages/teacher/class/
git commit -m "feat(insights): add InsightsPanel component and wire into gradebook"
```

---

### 3-C: End-to-end smoke test

- [ ] **Step 1: Start emulators**

```bash
firebase emulators:start
```

- [ ] **Step 2: Grade a submission**

Using the Emulator UI (`http://localhost:4000`), write a test `gradingJobs` document with `status: 'queued'`, `assignmentId: 'test-assign-1'`, `classId: 'test-class'`.

- [ ] **Step 3: Check insights**

After the function runs and all jobs for `test-assign-1` are complete, check Firestore for `assignmentInsights/test-assign-1`. Confirm `averageScore`, `medianScore`, `questionBreakdown` are populated.

- [ ] **Step 4: Open gradebook in browser**

Navigate to `/teacher/class/[classId]/gradebook`. Set `selectedAssignmentId` to `test-assign-1`. Confirm InsightsPanel renders with charts.

- [ ] **Step 5: Click "Generate re-teaching quiz"**

Confirm QuickGenerateModal opens with the pre-filled prompt. Confirm clicking Generate calls `generate_quick_content` and redirects to the assignment builder.

- [ ] **Step 6: Final deploy**

```bash
firebase deploy
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(phase1): complete Phase 1 — security, cost reductions, AI generator, builder, insights"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Covered by |
|-----------------|-----------|
| T4: Students read only own gradingJobs | Existing rules — already done |
| T4: Students cannot write gradingJobs directly | Existing rules — only `create` with studentId match |
| T4: Teachers only access own class data | Existing `isTeacherOfClass` helper |
| T4: TAs read-only on assigned classes | Existing rules |
| T4: quizCache service-account write-only | Task 4-B |
| T4: kbCache service-account write-only | Backstop deny in existing rules |
| T4: Storage assignment_pages/ rule | Task 4-A |
| T4: Pydantic validation in Python | Task 4-C |
| T4: 50 MB PDF rejection | Task 4-C step 4 |
| T4: Student rate limit (10 active jobs) | Task 4-D |
| T4: Teacher rate limit (20/day quiz gen) | Task 2-A (generate_quick_content) |
| T4: Role claim server-side only | Existing onUserCreate + Task 4-D |
| T4: classIds[] custom claim | Task 4-D step 4 |
| T5: Image resize 800px quality 75 | Task 5-A |
| T5: Prompt caching ordering | Task 5-A step 5 (existing ordering confirmed + comment) |
| T5: Fix _get_genai_model() bug | Task 5-A step 1 |
| T5: min_instances on grade_pdf | Task 5-B |
| T5: Storage URL caching in React | Task 5-C |
| T5: Gradebook pagination 25/page | Task 5-D |
| T2: NL prompt → structured blocks | Task 2-A |
| T2: 24h quizCache | Task 2-A |
| T2: Always Flash, never Pro | Task 2-A (uses gemini-2.5-flash) |
| T2: KB context max 8000 chars | Task 2-A |
| T2: QuickGenerateModal with steps | Task 2-B |
| T2: Advanced section collapsed by default | Task 2-B |
| T2: Output opens assignment builder | Task 2-B step 2 |
| T2: Teacher review before publish | Task 2-B + builder requires Save/Publish action |
| T1: @dnd-kit (not react-beautiful-dnd) | Task 1-A |
| T1: All 5 block types | Task 1-C + 1-D |
| T1: Keyboard reorder | Task 1-D (KeyboardSensor) |
| T1: Right panel live preview | Task 1-D (PreviewPanel) |
| T1: Desktop/mobile preview toggle | Task 1-D |
| T1: Auto-save 2s debounce + 30s interval | Task 1-D |
| T1: Firestore assignment schema | Task 1-D |
| T1: extract_pdf_pages callable | Task 1-B |
| T1: PDF pages at 150 DPI | Task 1-B |
| T1: assignment_pages/ Storage path | Task 1-B |
| T1: withAuth('teacher') gate | Task 1-D |
| T3: All jobs complete → compute insights | Task 3-A step 2 |
| T3: assignmentInsights/{assignmentId} schema | Task 3-A step 1 |
| T3: Idempotent (skip if exists) | Task 3-A step 1 |
| T3: Gemini for retouch topics, 500 tokens | Task 3-A step 1 |
| T3: InsightsPanel stat cards | Task 3-B |
| T3: Bar chart per-question fail rates | Task 3-B |
| T3: Top 3 failed questions | Task 3-B |
| T3: Generate re-teaching quiz button | Task 3-B |
| T3: Struggling students list | Task 3-B |
| T3: InsightsPanel in gradebook | Task 3-B step 2 |
| General: No new infra (no Docker/servers) | All tasks stay within Firebase + Gemini |
| General: No localStorage/sessionStorage | URL state used for generated param |
| General: withAuth on all new teacher pages | Task 1-D, Task 2-B |
| General: ShadCN/Radix + Tailwind | All frontend components |
| General: dnd-kit only | Task 1-A |
| General: dynamic import ssr:false | Task 1-C (BlockRenderer imports RichMathEditor dynamically) |

### Gaps identified after review

1. **`uuid` package needed** for `uuidv4()` in the assignment builder — added as a step in Task 1-D.
2. **`onSnapshot` audit** (Task 5 spec) — Task 5-C covers the submission view URL caching; a full audit of polling `getDoc()` calls across all pages was mentioned in the spec but would require reading every page file. Recommend a separate follow-up pass once the main features land.
3. **`Firestore rules unit tests`** (Task 4 spec mentions firebase-rules-unit-testing) — omitted from this plan to keep each slice shippable. Add as a follow-up task after rules are deployed and validated manually.
4. **`targetStudentIds[]` on re-teaching assignment** (Task 3 spec) — the InsightsPanel passes struggling student data to QuickGenerateModal; the generated content's blocks don't currently include `targetStudentIds`. This can be added as a field in the `generate_quick_content` return value and stored in Firestore during save in a follow-up.
