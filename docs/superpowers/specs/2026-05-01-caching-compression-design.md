# Caching & Image Compression — Cost Reduction Design

**Date:** 2026-05-01
**Goal:** Reduce Firebase billing (Storage bandwidth, Cloud Function compute, Gemini token costs) while preserving grading accuracy.

---

## 1. Image Compression

**Files changed:** `functions/grading/main.py`

Every place a PDF page is rendered to an image and saved as JPEG:
- `dpi=150` → `dpi=120` on all `page.get_pixmap()` calls
- `quality=85` → `quality=70` on all `img.save(b, format="JPEG", ...)` calls

This applies to three sites in `main.py`:
- `grade_pdf` — student submission rendering (~line 256) and annotation recompile (~line 465)
- `generate_rubric` — homework PDF rendering (~line 829)

**Why 120/70:** Below ~96 DPI, Gemini misreads dense handwritten math (superscripts, fractions). 120 DPI is safe for all expected content. Quality 70 reduces JPEG size ~40% vs quality 85 with imperceptible visual difference at screen resolution.

**Expected savings:** ~35% reduction in Gemini image token costs per grading job; smaller Storage uploads for graded PDFs.

---

## 2. Knowledge Base Text Cache

**Files changed:** `functions/grading/main.py`

### Problem
`grade_pdf`, `generate_quiz`, `tika_chat`, and `confusion_heatmap` all independently download every KB PDF from Firebase Storage and parse it with PyMuPDF on every invocation. A class with 3 KB documents incurs 3 Storage downloads + 3 PDF parses on every grading job, quiz, and chat message.

### Solution
A `kbCache/{classId}` Firestore document that stores pre-extracted KB text and a content hash. All four functions check the cache before touching Storage.

**Cache document structure:**
```json
{
  "hash": "<deterministic string>",
  "text": "<extracted text, capped at 30000 chars>",
  "updatedAt": "<server timestamp>"
}
```

**Hash computation:** Sort KB Firestore documents by ID, concatenate `docId:update_time.isoformat()` for each (using Firestore's built-in `doc.update_time` metadata, always available), and hash the result with `hashlib.md5`. If any KB doc is added, removed, or replaced, the hash changes and the cache is refreshed automatically.

**Cache refresh flow:**
1. Query `knowledgeBase` collection for the class — collect doc IDs and Firestore `update_time` values
2. Compute hash from sorted `docId:update_time.isoformat()` pairs
3. Read `kbCache/{classId}` — if `hash` matches, return `text` immediately (no Storage access)
4. Otherwise: download + parse all KB PDFs, write new cache doc, return text

**Helper function:** Extract into a `_get_kb_text(class_id)` function called by `grade_pdf`, `generate_quiz`, and `tika_chat`, replacing their inline KB-loading blocks. (`confusion_heatmap` does not use KB text and is unaffected.)

**Expected savings:** Eliminates repeated Storage downloads for classes whose KB doesn't change between submissions. In a typical class with stable KB materials, this reduces Storage egress to near zero for the KB fetch path.

---

## 3. Compute & Token Right-Sizing

### 3a. `generate_rubric` memory: 2GB → 1GB

**File:** `functions/grading/main.py` — `@https_fn.on_call` decorator for `generate_rubric`

`generate_rubric` does the same workload as `grade_pdf` (PDF render + Gemini call) but is allocated 2GB vs 1GB. Reducing to 1GB halves compute billing for every rubric generation without any functional change.

### 3b. Edge-case re-evaluation threshold: 1 → 3 questions

**File:** `functions/grading/main.py` — `grade_pdf` edge case block (~line 386)

Currently any single low-confidence answer triggers a full `gemini-2.5-pro` call with all page images. Change: only invoke Pro when **3 or more** questions are flagged low-confidence. Saves one Pro API call per submission that has isolated ambiguous answers.

### 3c. `tika_chat` KB text cap: per-class 8k, global 30k

**File:** `functions/grading/main.py` — `tika_chat` function (~line 974)

Cap KB text extraction at **8000 chars per class** before the existing 30k global cap. Prevents a single large KB from dominating context and keeps per-message token cost predictable for multi-class students.

### 3d. Firebase Hosting static asset cache headers

**File:** `firebase.json`

Add a `headers` block for static JS, CSS, and font assets with `Cache-Control: public, max-age=31536000, immutable`. Next.js content-hashes all static asset filenames at build time, so year-long caching is safe. This reduces Firebase Hosting bandwidth on repeat visits.

```json
{
  "source": "**/*.@(js|css|woff2|woff|ttf)",
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
}
```

---

## Out of Scope

- Gemini native context caching (requires SDK migration from `google-generativeai` to `google-genai` — deferred per existing code comment)
- Frontend image optimization (Next.js `images.unoptimized: true` is required for static export mode)
- Firestore read optimization (already efficient; compound queries are indexed)
