# Caching & Image Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Firebase billing (Gemini token costs, Storage bandwidth, Cloud Function compute) by compressing images sent to Gemini, caching Knowledge Base text in Firestore, right-sizing function memory, and adding CDN cache headers.

**Architecture:** All changes are confined to `functions/grading/main.py` and `firebase.json`. The KB cache is a `kbCache/{classId}` Firestore document keyed by an MD5 hash of KB doc IDs and update timestamps; a new `_get_kb_text(class_id, max_chars)` helper replaces the three inline KB-loading blocks. Image compression is a pure find-and-replace of DPI and JPEG quality constants.

**Tech Stack:** Python 3.12, `firebase-admin` (Firestore + Storage), `PyMuPDF` (`fitz`), `hashlib` (stdlib), `pytest` + `unittest.mock` for tests.

---

## File Map

| File | Change |
|------|--------|
| `functions/grading/main.py` | Add `_get_kb_text` helper; replace 3 inline KB blocks; change DPI 150→120, quality 85→70 (5 sites); lower `generate_rubric` memory 2GB→1GB; raise edge-case threshold 1→3 |
| `firebase.json` | Add `headers` block for static asset CDN caching |
| `functions/grading/tests/__init__.py` | Create (empty) |
| `functions/grading/tests/conftest.py` | Create — mocks Firebase modules before import |
| `functions/grading/tests/test_kb_cache.py` | Create — unit tests for KB cache hash logic |

---

## Task 1: Image Compression — DPI and JPEG Quality

**Files:**
- Modify: `functions/grading/main.py`

There are **5 sites** to change. Each is a unique string so use exact-match edits.

- [ ] **Step 1: Lower DPI in `grade_pdf` student rendering**

Find this exact string in `main.py` (inside the `for page_num in range(len(doc)):` loop in `grade_pdf`):
```python
            pix = page.get_pixmap(dpi=150)
```
Replace with:
```python
            pix = page.get_pixmap(dpi=120)
```

- [ ] **Step 2: Lower JPEG quality in `grade_pdf` Gemini contents prep**

Find (inside the `for p in page_images:` loop that builds `contents`):
```python
            p['img'].save(b, format="JPEG", quality=85)
```
Replace with:
```python
            p['img'].save(b, format="JPEG", quality=70)
```

- [ ] **Step 3: Lower JPEG quality in `grade_pdf` annotation recompile**

Find (inside the `for p in page_images:` loop that builds `out_pdf`):
```python
            img.save(b, format="JPEG", quality=85)
            img_bytes = b.getvalue()
```
Replace with:
```python
            img.save(b, format="JPEG", quality=70)
            img_bytes = b.getvalue()
```

- [ ] **Step 4: Lower DPI in `generate_rubric` rendering**

Find (inside the `for page_num in range(len(pdf_doc)):` loop in `generate_rubric`):
```python
                pix = page.get_pixmap(dpi=150)
```
Replace with:
```python
                pix = page.get_pixmap(dpi=120)
```

- [ ] **Step 5: Lower JPEG quality in `generate_rubric` Gemini contents**

Find (inside the `for img in page_images:` loop in `generate_rubric`):
```python
        img.save(b, format="JPEG", quality=85)
```
Replace with:
```python
        img.save(b, format="JPEG", quality=70)
```

- [ ] **Step 6: Verify all five sites changed and no `dpi=150` or `quality=85` remain**

Run:
```bash
cd functions/grading && grep -n "dpi=150\|quality=85" main.py
```
Expected: no output (zero matches).

- [ ] **Step 7: Commit**

```bash
git add functions/grading/main.py
git commit -m "perf: lower PDF render DPI 150->120 and JPEG quality 85->70"
```

---

## Task 2: KB Cache Tests

**Files:**
- Create: `functions/grading/tests/__init__.py`
- Create: `functions/grading/tests/conftest.py`
- Create: `functions/grading/tests/test_kb_cache.py`

- [ ] **Step 1: Create the tests package**

Create `functions/grading/tests/__init__.py` as an empty file.

- [ ] **Step 2: Create `conftest.py` to mock Firebase before import**

Create `functions/grading/tests/conftest.py`:
```python
import sys
from unittest.mock import MagicMock

# Must run before main.py is imported anywhere in the test session.
_fb_admin = MagicMock()
_fb_admin._apps = {}
sys.modules.setdefault('firebase_admin', _fb_admin)
sys.modules.setdefault('firebase_admin.firestore', MagicMock())
sys.modules.setdefault('firebase_admin.storage', MagicMock())

_fb_fns = MagicMock()
sys.modules.setdefault('firebase_functions', _fb_fns)
sys.modules.setdefault('firebase_functions.firestore_fn', MagicMock())
sys.modules.setdefault('firebase_functions.https_fn', MagicMock())
sys.modules.setdefault('firebase_functions.options', MagicMock())
sys.modules.setdefault('google.generativeai', MagicMock())
sys.modules.setdefault('fitz', MagicMock())
sys.modules.setdefault('PIL', MagicMock())
sys.modules.setdefault('PIL.Image', MagicMock())
sys.modules.setdefault('PIL.ImageDraw', MagicMock())
```

- [ ] **Step 3: Write the failing tests**

Create `functions/grading/tests/test_kb_cache.py`:
```python
import hashlib
import sys
import os
import pytest
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import main


# ---------------------------------------------------------------------------
# Hash logic tests (pure, no mocks needed)
# ---------------------------------------------------------------------------

def _compute_hash(pairs):
    """Replicate the hash computation from _get_kb_text."""
    sorted_pairs = sorted(pairs, key=lambda x: x[0])
    hash_input = "|".join(f"{doc_id}:{ts}" for doc_id, ts in sorted_pairs)
    return hashlib.md5(hash_input.encode()).hexdigest()


def test_hash_is_deterministic():
    pairs = [("doc_b", "2026-01-01"), ("doc_a", "2026-01-02")]
    assert _compute_hash(pairs) == _compute_hash(pairs)


def test_hash_changes_when_doc_added():
    before = [("doc_a", "2026-01-01")]
    after = [("doc_a", "2026-01-01"), ("doc_b", "2026-01-02")]
    assert _compute_hash(before) != _compute_hash(after)


def test_hash_changes_when_timestamp_changes():
    before = [("doc_a", "2026-01-01T00:00:00")]
    after = [("doc_a", "2026-01-02T00:00:00")]
    assert _compute_hash(before) != _compute_hash(after)


def test_hash_is_order_independent():
    pairs_1 = [("doc_b", "2026-01-02"), ("doc_a", "2026-01-01")]
    pairs_2 = [("doc_a", "2026-01-01"), ("doc_b", "2026-01-02")]
    assert _compute_hash(pairs_1) == _compute_hash(pairs_2)


# ---------------------------------------------------------------------------
# _get_kb_text integration tests (with mocked Firebase + fitz)
# ---------------------------------------------------------------------------

def _make_kb_doc(doc_id, storage_url, update_time_str="2026-01-01T00:00:00"):
    """Build a mock Firestore document snapshot for a KB doc."""
    from datetime import datetime, timezone
    doc = MagicMock()
    doc.id = doc_id
    doc.update_time = datetime.fromisoformat(update_time_str).replace(tzinfo=timezone.utc)
    doc.to_dict.return_value = {"storageUrl": storage_url, "title": doc_id}
    return doc


def _make_cache_doc(hash_val, text):
    """Build a mock Firestore document snapshot for kbCache."""
    doc = MagicMock()
    doc.exists = True
    doc.to_dict.return_value = {"hash": hash_val, "text": text}
    return doc


@patch('main._get_bucket')
@patch('main._get_db')
def test_cache_hit_skips_storage(mock_get_db, mock_get_bucket):
    """When cache hash matches, Storage is never touched."""
    kb_doc = _make_kb_doc("doc1", "knowledgeBase/cls1/doc1")
    expected_hash = _compute_hash([("doc1", kb_doc.update_time.isoformat())])
    cached_text = "cached knowledge base text"

    db = MagicMock()
    mock_get_db.return_value = db
    db.collection.return_value.where.return_value.stream.return_value = [kb_doc]
    db.collection.return_value.document.return_value.get.return_value = _make_cache_doc(
        expected_hash, cached_text
    )

    result = main._get_kb_text("cls1")

    assert result == cached_text
    mock_get_bucket.assert_not_called()


@patch('main._get_bucket')
@patch('main._get_db')
def test_cache_miss_downloads_and_writes_cache(mock_get_db, mock_get_bucket):
    """On cache miss, Storage is downloaded and cache is written."""
    import fitz as mock_fitz

    kb_doc = _make_kb_doc("doc1", "knowledgeBase/cls1/doc1")

    # Stale cache with wrong hash
    stale_cache = MagicMock()
    stale_cache.exists = True
    stale_cache.to_dict.return_value = {"hash": "wrong_hash", "text": "old text"}

    db = MagicMock()
    mock_get_db.return_value = db
    db.collection.return_value.where.return_value.stream.return_value = [kb_doc]
    cache_ref = MagicMock()
    db.collection.return_value.document.return_value = cache_ref
    cache_ref.get.return_value = stale_cache

    # Mock Storage blob
    blob = MagicMock()
    blob.exists.return_value = True
    blob.download_as_bytes.return_value = b"fakepdfbytes"
    mock_get_bucket.return_value.blob.return_value = blob

    # Mock fitz PDF parsing
    page = MagicMock()
    page.get_text.return_value = "extracted text"
    pdf_mock = MagicMock()
    pdf_mock.__iter__ = MagicMock(return_value=iter([page]))
    mock_fitz.open.return_value = pdf_mock

    result = main._get_kb_text("cls1")

    assert "extracted text" in result
    cache_ref.set.assert_called_once()
    written = cache_ref.set.call_args[0][0]
    assert "hash" in written
    assert "text" in written
    assert written["text"] == "extracted text\n"


@patch('main._get_bucket')
@patch('main._get_db')
def test_no_kb_docs_returns_empty_string(mock_get_db, mock_get_bucket):
    db = MagicMock()
    mock_get_db.return_value = db
    db.collection.return_value.where.return_value.stream.return_value = []

    result = main._get_kb_text("cls_empty")

    assert result == ""
    mock_get_bucket.assert_not_called()


@patch('main._get_bucket')
@patch('main._get_db')
def test_max_chars_respected(mock_get_db, mock_get_bucket):
    """max_chars slices the returned text."""
    kb_doc = _make_kb_doc("doc1", "knowledgeBase/cls1/doc1")
    long_text = "x" * 50000

    db = MagicMock()
    mock_get_db.return_value = db
    db.collection.return_value.where.return_value.stream.return_value = [kb_doc]
    cache_ref = MagicMock()
    db.collection.return_value.document.return_value = cache_ref

    expected_hash = _compute_hash([("doc1", kb_doc.update_time.isoformat())])
    cache_ref.get.return_value = _make_cache_doc(expected_hash, long_text)

    result = main._get_kb_text("cls1", max_chars=8000)

    assert len(result) == 8000
```

- [ ] **Step 4: Run tests and confirm they all fail (function not yet implemented)**

```bash
cd functions/grading && python -m pytest tests/test_kb_cache.py -v 2>&1 | head -40
```
Expected: errors like `AttributeError: module 'main' has no attribute '_get_kb_text'`

---

## Task 3: Implement `_get_kb_text` Helper

**Files:**
- Modify: `functions/grading/main.py`

Add the `_get_kb_text` function after the `_get_bucket` function (around line 40), before the `_increment_usage` function.

- [ ] **Step 1: Add the `_get_kb_text` function**

Find this exact block in `main.py`:
```python
import datetime

def _increment_usage():
```

Replace with:
```python
import datetime
import hashlib

def _get_kb_text(class_id, max_chars=30000):
    """Return extracted text from all KB PDFs for class_id.

    Uses a kbCache/{class_id} Firestore document to avoid re-downloading
    unchanged KB PDFs on every function invocation. Cache is invalidated
    automatically when any KB doc is added, removed, or updated.
    """
    import fitz

    db = _get_db()

    kb_docs = list(
        db.collection('knowledgeBase').where('classId', '==', class_id).stream()
    )
    if not kb_docs:
        return ""

    sorted_pairs = sorted(
        (doc.id, doc.update_time.isoformat()) for doc in kb_docs
    )
    hash_input = "|".join(f"{doc_id}:{ts}" for doc_id, ts in sorted_pairs)
    current_hash = hashlib.md5(hash_input.encode()).hexdigest()

    cache_ref = db.collection('kbCache').document(class_id)
    cache_snap = cache_ref.get()
    if cache_snap.exists:
        cached = cache_snap.to_dict()
        if cached.get('hash') == current_hash:
            return cached.get('text', '')[:max_chars]

    full_text = ""
    for kb_doc in kb_docs:
        kb_data = kb_doc.to_dict()
        kb_path = kb_data.get('storageUrl')
        if not kb_path:
            continue
        kb_blob = _get_bucket().blob(kb_path)
        if not kb_blob.exists():
            continue
        try:
            kb_bytes = kb_blob.download_as_bytes()
            kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
            for page in kb_pdf:
                full_text += page.get_text() + "\n"
            kb_pdf.close()
        except Exception as e:
            print(f"Failed to parse KB doc {kb_data.get('title')}: {e}")

    full_text = full_text[:30000]
    cache_ref.set({
        'hash': current_hash,
        'text': full_text,
        'updatedAt': firestore.SERVER_TIMESTAMP
    })
    return full_text[:max_chars]


def _increment_usage():
```

- [ ] **Step 2: Run the tests and confirm they pass**

```bash
cd functions/grading && python -m pytest tests/test_kb_cache.py -v
```
Expected output:
```
tests/test_kb_cache.py::test_hash_is_deterministic PASSED
tests/test_kb_cache.py::test_hash_changes_when_doc_added PASSED
tests/test_kb_cache.py::test_hash_changes_when_timestamp_changes PASSED
tests/test_kb_cache.py::test_hash_is_order_independent PASSED
tests/test_kb_cache.py::test_cache_hit_skips_storage PASSED
tests/test_kb_cache.py::test_cache_miss_downloads_and_writes_cache PASSED
tests/test_kb_cache.py::test_no_kb_docs_returns_empty_string PASSED
tests/test_kb_cache.py::test_max_chars_respected PASSED

8 passed
```

- [ ] **Step 3: Commit**

```bash
git add functions/grading/main.py functions/grading/tests/
git commit -m "feat: add _get_kb_text helper with Firestore cache"
```

---

## Task 4: Wire `_get_kb_text` into `grade_pdf`

**Files:**
- Modify: `functions/grading/main.py`

- [ ] **Step 1: Replace the inline KB loading block in `grade_pdf`**

Find this block (the "2. Fetch Knowledge Base Text" section inside the PDF branch of `grade_pdf`):
```python
        # 2. Fetch Knowledge Base Text
        kb_text = ""
        kb_query = _get_db().collection('knowledgeBase').where('classId', '==', class_id).stream()
        for kb_doc in kb_query:
            kb_data = kb_doc.to_dict()
            kb_path = kb_data.get('storageUrl')
            kb_blob = _get_bucket().blob(kb_path)
            if kb_blob.exists():
                kb_bytes = kb_blob.download_as_bytes()
                try:
                    kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
                    for page in kb_pdf:
                        kb_text += page.get_text() + "\n"
                    kb_pdf.close()
                except Exception as e:
                    print(f"Failed to parse KB doc {kb_data.get('title')}: {e}")
```

Replace with:
```python
        # 2. Fetch Knowledge Base Text (cached)
        kb_text = _get_kb_text(class_id)
```

- [ ] **Step 2: Also replace the KB loading block in the TEXT SUBMISSION branch**

Find this block (inside the `if submission_type == 'text' and submission_text:` branch):
```python
            # Fetch Knowledge Base Text
            kb_text = ""
            kb_query = _get_db().collection('knowledgeBase').where('classId', '==', class_id).stream()
            for kb_doc in kb_query:
                kb_data_doc = kb_doc.to_dict()
                kb_path = kb_data_doc.get('storageUrl')
                kb_blob = _get_bucket().blob(kb_path)
                if kb_blob.exists():
                    kb_bytes = kb_blob.download_as_bytes()
                    try:
                        import fitz
                        kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
                        for page in kb_pdf:
                            kb_text += page.get_text() + "\n"
                        kb_pdf.close()
                    except Exception as e:
                        print(f"Failed to parse KB doc: {e}")
```

Replace with:
```python
            # Fetch Knowledge Base Text (cached)
            kb_text = _get_kb_text(class_id)
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
cd functions/grading && python -m pytest tests/ -v
```
Expected: 8 passed, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add functions/grading/main.py
git commit -m "refactor: use _get_kb_text cache in grade_pdf"
```

---

## Task 5: Wire `_get_kb_text` into `generate_quiz`

**Files:**
- Modify: `functions/grading/main.py`

Note: `generate_quiz` has an `excluded_doc_ids` parameter. The cache cannot account for doc exclusions, so we use `_get_kb_text` only when `excluded_doc_ids` is empty, falling back to direct download otherwise.

- [ ] **Step 1: Replace the inline KB loading block in `generate_quiz`**

Find this entire block (the "2. Read Knowledge Base documents" section in `generate_quiz`):
```python
    kb_text = ""
    try:
        import fitz  # PyMuPDF — lazy import
        kb_query = _get_db().collection("knowledgeBase").where("classId", "==", class_id).stream()
        for kb_doc in kb_query:
            if kb_doc.id in excluded_doc_ids:
                continue
            kb_data = kb_doc.to_dict()
            kb_path = kb_data.get("storageUrl")
            kb_blob = _get_bucket().blob(kb_path)
            if kb_blob.exists():
                kb_bytes = kb_blob.download_as_bytes()
                try:
                    kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
                    for page in kb_pdf:
                        kb_text += page.get_text() + "\n"
                    kb_pdf.close()
                except Exception as parse_err:
                    print(f"Failed to parse KB doc {kb_data.get('title')}: {parse_err}")
    except Exception as e:
        print(f"Warning: Could not read knowledgeBase: {e}")
```

Replace with:
```python
    kb_text = ""
    try:
        if not excluded_doc_ids:
            kb_text = _get_kb_text(class_id)
        else:
            import fitz
            kb_query = _get_db().collection("knowledgeBase").where("classId", "==", class_id).stream()
            for kb_doc in kb_query:
                if kb_doc.id in excluded_doc_ids:
                    continue
                kb_data = kb_doc.to_dict()
                kb_path = kb_data.get("storageUrl")
                kb_blob = _get_bucket().blob(kb_path)
                if kb_blob.exists():
                    kb_bytes = kb_blob.download_as_bytes()
                    try:
                        kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
                        for page in kb_pdf:
                            kb_text += page.get_text() + "\n"
                        kb_pdf.close()
                    except Exception as parse_err:
                        print(f"Failed to parse KB doc {kb_data.get('title')}: {parse_err}")
    except Exception as e:
        print(f"Warning: Could not read knowledgeBase: {e}")
```

- [ ] **Step 2: Run tests**

```bash
cd functions/grading && python -m pytest tests/ -v
```
Expected: 8 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add functions/grading/main.py
git commit -m "refactor: use _get_kb_text cache in generate_quiz"
```

---

## Task 6: Wire `_get_kb_text` into `tika_chat`

**Files:**
- Modify: `functions/grading/main.py`

This also applies the per-class 8k cap specified in the design.

- [ ] **Step 1: Replace the inline KB loading block in `tika_chat`**

Find this block (the KB loading section inside `tika_chat`):
```python
    kb_text = ""
    if class_ids:
        import fitz
        for cid in class_ids[:10]:  # cap at 10 classes
            kb_query = db.collection('knowledgeBase').where('classId', '==', cid).stream()
            for kb_doc in kb_query:
                kb_data = kb_doc.to_dict()
                kb_path = kb_data.get('storageUrl')
                if not kb_path:
                    continue
                try:
                    kb_blob = _get_bucket().blob(kb_path)
                    if kb_blob.exists():
                        kb_bytes = kb_blob.download_as_bytes()
                        kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
                        for page in kb_pdf:
                            kb_text += page.get_text() + "\n"
                        kb_pdf.close()
                except Exception as e:
                    print(f"Failed to parse KB doc: {e}")

    # Cap KB text to avoid token overflows
    if len(kb_text) > 30000:
        kb_text = kb_text[:30000] + "\n[...truncated]"
```

Replace with:
```python
    kb_text = ""
    if class_ids:
        for cid in class_ids[:10]:  # cap at 10 classes
            class_kb = _get_kb_text(cid, max_chars=8000)
            if class_kb:
                kb_text += class_kb + "\n"
            if len(kb_text) >= 30000:
                break
    kb_text = kb_text[:30000]
```

- [ ] **Step 2: Run tests**

```bash
cd functions/grading && python -m pytest tests/ -v
```
Expected: 8 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add functions/grading/main.py
git commit -m "refactor: use _get_kb_text cache in tika_chat with 8k per-class cap"
```

---

## Task 7: Compute & Token Right-Sizing

**Files:**
- Modify: `functions/grading/main.py`

Three small changes in one task.

- [ ] **Step 1: Lower `generate_rubric` memory from 2GB to 1GB**

Find:
```python
@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_2,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def generate_rubric(req: https_fn.CallableRequest):
```

Replace with:
```python
@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def generate_rubric(req: https_fn.CallableRequest):
```

- [ ] **Step 2: Raise edge-case re-evaluation threshold from 1 to 3 questions**

Find:
```python
        if low_confidence_questions:
            job_ref.update({'progress_text': f'Handling edge cases for {len(low_confidence_questions)} question(s)...'})
```

Replace with:
```python
        if len(low_confidence_questions) >= 3:
            job_ref.update({'progress_text': f'Handling edge cases for {len(low_confidence_questions)} question(s)...'})
```

- [ ] **Step 3: Verify both changes are in place**

```bash
cd functions/grading && grep -n "GB_2\|low_confidence_questions\b" main.py
```
Expected: `GB_2` has zero matches; the `low_confidence_questions` line shows `>= 3`.

- [ ] **Step 4: Run tests**

```bash
cd functions/grading && python -m pytest tests/ -v
```
Expected: 8 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add functions/grading/main.py
git commit -m "perf: lower generate_rubric memory 2GB->1GB; raise edge-case threshold to 3"
```

---

## Task 8: Firebase Hosting Static Asset Cache Headers

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Add cache headers block to `firebase.json`**

Find the `"hosting"` object's `"rewrites"` array closing bracket and `"functions"` key. The `hosting` object currently looks like:
```json
  "hosting": {
    "public": "apps/web/out",
    "cleanUrls": true,
    "ignore": [...],
    "rewrites": [...]
  },
```

Add a `"headers"` key inside the `"hosting"` object, immediately after the `"rewrites"` array:
```json
    "headers": [
      {
        "source": "**/_next/static/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      },
      {
        "source": "**/*.@(js|css|woff2|woff|ttf|eot)",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      }
    ]
```

To apply the edit precisely, find the last rewrite entry in `firebase.json`, which ends with:
```json
      }
    ]
  },
  "functions": [
```

Replace the closing of the `hosting` object (the `]` after the last rewrite, followed by `},`) with:
```json
      }
    ],
    "headers": [
      {
        "source": "**/_next/static/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      },
      {
        "source": "**/*.@(js|css|woff2|woff|ttf|eot)",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      }
    ]
  },
  "functions": [
```

- [ ] **Step 2: Validate firebase.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('valid')"
```
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add firebase.json
git commit -m "perf: add CDN cache headers for static JS/CSS/font assets"
```

---

## Verification Checklist

After all tasks are complete, run the full test suite and do a final grep to confirm no regressions:

```bash
# All tests pass
cd functions/grading && python -m pytest tests/ -v

# No old DPI or quality values remain
grep -n "dpi=150\|quality=85\|GB_2" main.py

# KB cache helper is present
grep -n "_get_kb_text" main.py

# Edge case threshold is 3
grep -n "low_confidence_questions" main.py

# firebase.json is valid
cd ../.. && node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('valid')"
```
