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
