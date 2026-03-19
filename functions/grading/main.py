"""
Core PDF Grading Pipeline

Listens for new documents in `/gradingJobs/{jobId}`.
Downloads the raw PDF.
Renders pages as PNGs using PyMuPDF.
Fetches Knowledge Base documents for the class.
Calls Gemini 2.5 Pro to grade against the rubric.
Draws feedback on PNGs using Pillow.
Recompiles the PDF and uploads to Storage.
"""
import os
import json
import time
import base64
from io import BytesIO

from firebase_admin import initialize_app, firestore, storage
from firebase_functions import firestore_fn, options

# Initialize Firebase Admin at top level to ensure authenticated contexts are fully loaded
import firebase_admin
if not firebase_admin._apps:
    initialize_app()

_db = None
_bucket = None

def _get_db():
    global _db
    if _db is None:
        _db = firestore.client()
    return _db

_lifecycle_set = False

def _get_bucket():
    global _bucket, _lifecycle_set
    if _bucket is None:
        _bucket = storage.bucket()
        if not _lifecycle_set:
            try:
                _bucket.lifecycle_rules = [
                    {
                        "action": {"type": "Delete"},
                        "condition": {"age": 90, "matchesPrefix": ["results/"]}
                    }
                ]
                _bucket.patch()
                _lifecycle_set = True
                print("Applied Storage Lifecycle Rule for results/")
            except Exception as e:
                print(f"Failed to set lifecycle: {e}")
    return _bucket


import datetime

def _increment_usage():
    try:
        db = _get_db()
        today_str = datetime.date.today().strftime('%Y-%m-%d')
        stats_ref = db.collection('usage').document('stats')
        stats_ref.set({
            'totalCalls': firestore.Increment(1),
            'dailyStats': {
                today_str: firestore.Increment(1)
            }
        }, merge=True)
    except Exception as e:
        print(f"Failed to increment usage stats: {e}")

# Heavy imports (fitz, PIL, genai) are done lazily inside functions
# to avoid the 10-second deployment timeout.

def _init_genai():
    """Lazy-init Gemini. Called inside handler functions only."""
    import google.generativeai as genai
    api_key = os.environ.get('GOOGLEAI_KEY')
    if api_key:
        genai.configure(api_key=api_key)
    return genai

# Adjust function configuration
# timeoutSeconds: 540
# memory: 2GiB
@firestore_fn.on_document_written(
    document="gradingJobs/{jobId}",
    timeout_sec=540,
    memory=options.MemoryOption.GB_2
)
def grade_pdf(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot | None]]) -> None:
    """Triggered when a grading job is created or updated."""
    change = event.data
    before = change.before
    after = change.after
    
    if not after or not after.exists:
        return
        
    before_data = before.to_dict() if before and before.exists else {}
    after_data = after.to_dict()
    
    before_status = before_data.get('status')
    after_status = after_data.get('status')
    
    # Run condition:
    # 1. New document (before doesn't exist)
    # 2. Status updated TO 'queued' from anything else
    is_new = not before or not before.exists
    is_re_grade = before_status != 'queued' and after_status == 'queued'
    
    if not (is_new or is_re_grade):
        return
        
    job_id = event.params["jobId"]
    job_data = after_data
    
    # Immediately update status to 'processing'
    _db = _get_db()
    job_ref = _db.collection('gradingJobs').document(job_id)
    job_ref.update({
        'status': 'processing',
        'progress': 0,
        'progress_text': 'Starting grading process...'
    })
    
    try:
        class_id = job_data.get('classId')
        rubric = job_data.get('rubric')
        raw_pdf_path = job_data.get('rawPdfUrl')
        
        # 1. Wait for raw PDF to appear in Storage (Retry loop)
        blob = _get_bucket().blob(raw_pdf_path)
        retries = 0
        while not blob.exists() and retries < 3:
            time.sleep(5)
            retries += 1
            
        if not blob.exists():
            raise Exception("Raw PDF not found in Storage after retries.")
            
        import fitz  # PyMuPDF — lazy import
        from PIL import Image, ImageDraw  # lazy import

        pdf_bytes = blob.download_as_bytes()
        job_ref.update({'progress': 10, 'progress_text': 'Downloaded submission PDF.'})
        
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
                    
        job_ref.update({'progress': 20, 'progress_text': 'Retrieved knowledge base materials.'})
        # 3. Render PDF to Images (150 DPI)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_images = []
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=150)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            # Add light invisible coordinate grid overlay (optional)
            # draw = ImageDraw.Draw(img)
            # for x in range(0, img.width, 100):
            #     draw.line([(x, 0), (x, img.height)], fill=(200, 200, 200, 50))
            # for y in range(0, img.height, 100):
            #     draw.line([(0, y), (img.width, y)], fill=(200, 200, 200, 50))
                
            page_images.append({
                'num': page_num + 1,
                'img': img,
                'width': pix.width,
                'height': pix.height
            })
        job_ref.update({'progress': 35, 'progress_text': 'Rendered document pages.'})
            
        # 4. Process with Gemini
        genai = _init_genai()
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        prompt = f"""
You are a strict academic grader. Grade the following student submission
against the rubric. Use the provided Knowledge Base reference material if needed.

If the Rubric is a JSON array of criteria (V2 Rubric), evaluate the submission STRICTLY against each criteria item and allocate scores proportionally to `maxPoints` or weight list items.

Return ONLY a JSON array with no markdown blocks (no ```json). 
Each object in the array must represent a specific piece of feedback anchored to a visual location on the page.
The properties must be exactly:
  page (int, 1-indexed),
  x_coord (int, pixels from left. MUST be within the page boundaries.),
  y_coord (int, pixels from top. MUST be within the page boundaries.),
  text (str, your feedback comment, max 20 words),
  color ('red' | 'green' | 'orange'),
  score (int 0-100, ONLY on the very last object in the array, all others omit this field)

Rubric:
{rubric}

Knowledge Base Context:
{kb_text[:20000]}
"""
        
        all_feedback = []
        # Process in batches of 5 pages
        batch_size = 5
        for i in range(0, len(page_images), batch_size):
            progress_val = 35 + int((i / len(page_images)) * 50)
            job_ref.update({
                'progress': min(85, progress_val),
                'progress_text': f"Analyzing pages {i+1} to {min(i+batch_size, len(page_images))}..."
            })
            batch = page_images[i:i+batch_size]
            contents = [prompt]
            for p in batch:
                # Convert PIL to bytes
                b = BytesIO()
                p['img'].save(b, format="PNG")
                img_data = b.getvalue()
                
                contents.append({
                    "mime_type": "image/png",
                    "data": img_data
                })
                
            try:
                response = model.generate_content(contents)
                json_str = response.text.strip()
                # Clean markdown blocks
                if "```json" in json_str:
                    json_str = json_str.split("```json")[-1]
                    json_str = json_str.split("```")[0].strip()
                elif "```" in json_str:
                    json_str = json_str.split("```")[1].strip()
                    
                batch_feedback = json.loads(json_str)
                all_feedback.extend(batch_feedback)
            except Exception as e:
                # Retry once logic
                print(f"Validation failed on batch, retrying. {e}")
                revised_prompt = prompt + "\nCRITICAL: YOU MUST RETURN RAW JSON ONLY. NO MARKDOWN. EXAMPLE: [{\"page\": 1, \"x_coord\": 150, \"y_coord\": 200, \"text\": \"Good point\", \"color\": \"green\"}]"
                contents[0] = revised_prompt
                try:
                    retry_response = model.generate_content(contents)
                    r_str = retry_response.text.strip()
                    if "```json" in r_str:
                        r_str = r_str.split("```json")[-1]
                        r_str = r_str.split("```")[0].strip()
                    elif "```" in r_str:
                        r_str = r_str.split("```")[1].strip()
                    all_feedback.extend(json.loads(r_str))
                except Exception as retry_e:
                    print(f"Second failure on batch: {retry_e}")
                    # We continue to the next batch rather than fail the entire document
                    pass

        # 5. Extract Final Score and format feedback coordinates
        final_score = 0
        for fb in all_feedback:
            if 'score' in fb and isinstance(fb['score'], (int, float)):
                final_score = fb['score']
                
            # Restrict coords to image boundaries
            page_idx = fb.get('page', 1) - 1
            if 0 <= page_idx < len(page_images):
                p_width = page_images[page_idx]['width']
                p_height = page_images[page_idx]['height']
                
                fb['x_coord'] = max(0, min(fb.get('x_coord', 10), p_width - 150))
                fb['y_coord'] = max(0, min(fb.get('y_coord', 10), p_height - 30))

        # 6. Draw annotations on the extracted images with Pillow
        for fb in all_feedback:
            page_idx = fb.get('page', 1) - 1
            if 0 <= page_idx < len(page_images):
                img = page_images[page_idx]['img']
                draw = ImageDraw.Draw(img, 'RGBA')
                
                x = fb['x_coord']
                y = fb['y_coord']
                text = str(fb.get('text', ''))
                
                color_map = {
                    'red': (255, 0, 0, 255),
                    'green': (0, 128, 0, 255),
                    'orange': (255, 165, 0, 255)
                }
                c_name = str(fb.get('color', 'red')).lower()
                text_color = color_map.get(c_name, (255, 0, 0, 255))
                
                # Approximate bounding box for the text overlay
                # Assumes default font size of ~10-12 points = ~6-8 pixels per char wide
                chars_len = len(text)
                box_x2 = x + (chars_len * 6) + 15
                box_y2 = y + 25
                
                draw.rectangle([x-5, y-5, box_x2, box_y2], fill=(255, 255, 255, 220), outline=text_color, width=2)
                draw.text((x, y), text, fill=text_color)
                
                # Update image reference in array
                page_images[page_idx]['img'] = img
                
        job_ref.update({'progress': 85, 'progress_text': 'Applying feedback to document.'})
        # 7. Recompile annotated PDF
        # We can create a new PDF by inserting the PIL images back into fitz
        out_pdf = fitz.open()
        for p in page_images:
            img = p['img']
            b = BytesIO()
            img.save(b, format="JPEG", quality=85) # Save sizing
            img_bytes = b.getvalue()
            
            # Create a new PDF page matching image size
            pdf_page = out_pdf.new_page(width=p['width'], height=p['height'])
            pdf_page.insert_image(pdf_page.rect, stream=img_bytes)
            
        out_bytes = out_pdf.write()
        out_pdf.close()
        doc.close()
        
        job_ref.update({'progress': 90, 'progress_text': 'Recompiled annotated PDF.'})
        # 8. Upload Result and Update Job
        result_path = f"results/{job_id}.pdf"
        res_blob = _get_bucket().blob(result_path)
        res_blob.upload_from_string(out_bytes, content_type="application/pdf")
        
        job_ref.update({
            'status': 'complete',
            'resultPdfUrl': result_path, # Path relative to bucket
            'score': final_score,
            'progress': 100,
            'progress_text': 'Grading complete.',
            'completedAt': firestore.SERVER_TIMESTAMP
        })
        _increment_usage()

        # Cleanup: Delete raw PDF after success
        try:
            if raw_pdf_path:
                raw_blob = _get_bucket().blob(raw_pdf_path)
                if raw_blob.exists():
                    raw_blob.delete()
                    print(f"Deleted raw PDF: {raw_pdf_path}")
        except Exception as e:
            print(f"Failed to delete raw PDF: {e}")
        
    except Exception as e:
        print(f"Grading Error: {e}")
        job_ref.update({
            'status': 'error',
            'feedback': str(e)
        })


# ---------------------------------------------------------------------------
# generateQuiz — HTTPS Callable
# ---------------------------------------------------------------------------
from firebase_functions import https_fn


@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
)
def generate_quiz(req: https_fn.CallableRequest):
    """
    Generates 10 MCQ questions targeting the student's weak topics.
    Input (req.data):  { classId: string }
    Returns:           Array of 10 question objects
    """
    # Auth check — on_call provides req.auth automatically
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    student_id = req.auth.uid
    class_id = req.data.get("classId") if req.data else None
    excluded_doc_ids = req.data.get("excludedDocIds", []) if req.data else []

    if not class_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="classId is required."
        )

    # ------------------------------------------------------------------
    # 1. Read last 5 quizAttempts → extract & deduplicate topicGaps
    # ------------------------------------------------------------------
    topic_gaps = []
    try:
        attempts_query = (
            _get_db().collection("quizAttempts")
            .where("studentId", "==", student_id)
            .where("classId", "==", class_id)
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .limit(5)
        )
        for attempt_doc in attempts_query.stream():
            attempt_data = attempt_doc.to_dict()
            gaps = attempt_data.get("topicGaps", [])
            if isinstance(gaps, list):
                topic_gaps.extend(gaps)
    except Exception as e:
        print(f"Warning: Could not read quizAttempts: {e}")
        # Continue with empty topic_gaps — first-time quiz

    # Deduplicate while preserving frequency-based ranking
    seen = {}
    for t in topic_gaps:
        seen[t] = seen.get(t, 0) + 1
    ranked_topics = sorted(seen.keys(), key=lambda x: seen[x], reverse=True)

    # ------------------------------------------------------------------
    # 2. Read Knowledge Base documents for this class
    # ------------------------------------------------------------------
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

    if not kb_text.strip():
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="No knowledge base materials found for this class. Ask your teacher to upload reference PDFs."
        )

    # ------------------------------------------------------------------
    # 3. Call Gemini to generate 10 MCQ questions
    # ------------------------------------------------------------------
    if not os.environ.get('GOOGLEAI_KEY'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="AI service is not configured."
        )

    genai = _init_genai()
    model = genai.GenerativeModel("gemini-2.5-flash")

    topic_gaps_str = ", ".join(ranked_topics) if ranked_topics else "none identified yet"

    prompt = f"""
Generate exactly 10 multiple-choice questions for a student.
Focus on these weak topics (if any): {topic_gaps_str}
Base questions on this course content: {kb_text[:20000]}

Return ONLY a valid JSON array (no markdown). Each item must have:
  question: string
  options: array of exactly 4 strings labeled "A) ...", "B) ...", "C) ...", "D) ..."
  answer: "A" | "B" | "C" | "D"
  hint: one concise sentence that guides without giving away the answer
  topic: which topic from the course content this question covers
"""

    questions = None
    last_error = None

    for attempt in range(2):
        try:
            actual_prompt = prompt
            if attempt == 1:
                actual_prompt += '\nCRITICAL: Return RAW JSON ONLY. No markdown fences. Example: [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "hint": "...", "topic": "..."}]'

            response = model.generate_content(actual_prompt)
            json_str = response.text.strip()

            # Clean markdown fences
            if "```json" in json_str:
                json_str = json_str.split("```json")[-1]
                json_str = json_str.split("```")[0].strip()
            elif "```" in json_str:
                json_str = json_str.split("```")[1].strip()

            parsed = json.loads(json_str)

            # Validate structure
            if not isinstance(parsed, list) or len(parsed) != 10:
                raise ValueError(f"Expected array of 10 items, got {type(parsed).__name__} with {len(parsed) if isinstance(parsed, list) else 'N/A'} items")

            required_keys = {"question", "options", "answer", "hint", "topic"}
            valid_answers = {"A", "B", "C", "D"}
            for i, q in enumerate(parsed):
                missing = required_keys - set(q.keys())
                if missing:
                    raise ValueError(f"Question {i+1} missing keys: {missing}")
                if not isinstance(q["options"], list) or len(q["options"]) != 4:
                    raise ValueError(f"Question {i+1} must have exactly 4 options")
                if q["answer"] not in valid_answers:
                    raise ValueError(f"Question {i+1} answer must be A/B/C/D, got '{q['answer']}'")

            questions = parsed
            break

        except Exception as e:
            last_error = e
            print(f"Quiz generation attempt {attempt+1} failed: {e}")

    if questions is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"Failed to generate valid quiz questions: {last_error}"
        )

    _increment_usage()
    return questions
