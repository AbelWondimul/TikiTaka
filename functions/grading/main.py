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
import datetime
import hashlib
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

def _get_bucket():
    global _bucket
    if _bucket is None:
        _bucket = storage.bucket()
    return _bucket


def _get_kb_text(class_id, max_chars=30000):
    """Return extracted text from all KB PDFs for class_id.

    Uses a kbCache/{class_id} Firestore document to avoid re-downloading
    unchanged KB PDFs on every function invocation. Cache is invalidated
    automatically when any KB doc is added, removed, or updated.
    """
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
            import fitz
            kb_bytes = kb_blob.download_as_bytes()
            kb_pdf = fitz.open(stream=kb_bytes, filetype="pdf")
            for page in kb_pdf:
                full_text += page.get_text() + "\n"
            kb_pdf.close()
        except Exception as e:
            print(f"Failed to parse KB doc {kb_data.get('title')}: {e}")

    full_text = full_text[:30000]  # internal cache cap stays at 30000
    cache_ref.set({
        'hash': current_hash,
        'text': full_text,
        'updatedAt': firestore.SERVER_TIMESTAMP
    })
    return full_text[:max_chars]  # return respects caller's max_chars parameter


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

def _resize_for_gemini(img, max_side: int = 800, quality: int = 75) -> bytes:
    """Resize PIL Image so its longest side <= max_side, return JPEG bytes."""
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

# Heavy imports (fitz, PIL, genai) are done lazily inside functions
# to avoid the 10-second deployment timeout.

def _init_genai():
    """Lazy-init Gemini. Called inside handler functions only."""
    import google.generativeai as genai
    # Check both common names for the API key
    api_key = os.environ.get('GOOGLEAI_KEY') or os.environ.get('GEMINI_API_KEY')
    if api_key:
        genai.configure(api_key=api_key)
    return genai

# Adjust function configuration
# timeoutSeconds: 540
# memory: 1GiB (reduced from 2GiB to lower Cloud Run costs)
@firestore_fn.on_document_written(
    document="gradingJobs/{jobId}",
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
    min_instances=1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
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

    _db = _get_db()
    job_ref = _db.collection('gradingJobs').document(job_id)

    # Pydantic validation
    try:
        from validators import GradingJobData
        from pydantic import ValidationError as PydanticValidationError
        GradingJobData(**{k: job_data.get(k) for k in GradingJobData.model_fields})
    except Exception as ve:
        job_ref.update({'status': 'error', 'feedback': f'Invalid job data: {ve}'})
        print(f"Validation error for job {job_id}: {ve}")
        return

    # Rate limit check
    from rate_limiter import check_student_grading_limit
    _student_id_rl = job_data.get('studentId', '')
    _class_id_rl = job_data.get('classId', '')
    if not check_student_grading_limit(_student_id_rl, _class_id_rl, max_active=10):
        job_ref.update({
            'status': 'error',
            'feedback': 'Rate limit: too many active grading jobs. Wait for current submissions to finish.'
        })
        return

    # Immediately update status to 'processing'
    job_ref.update({
        'status': 'processing',
        'progress': 0,
        'progress_text': 'Starting grading process...'
    })
    
    try:
        class_id = job_data.get('classId')
        rubric = job_data.get('rubric')
        raw_pdf_path = job_data.get('rawPdfUrl')
        submission_type = job_data.get('submissionType', 'pdf')
        submission_text = job_data.get('submissionText', '')

        # ── TEXT SUBMISSION BRANCH ──
        if submission_type == 'text' and submission_text:
            job_ref.update({'progress': 10, 'progress_text': 'Processing text submission...'})

            # Fetch Knowledge Base Text (cached)
            kb_text = _get_kb_text(class_id)

            job_ref.update({'progress': 30, 'progress_text': 'Grading text response...'})

            # Build prompt for text submission
            rubric_json = json.dumps(rubric, indent=2) if isinstance(rubric, dict) else str(rubric)
            prompt = f"""You are an expert academic grader. Grade the following student text submission against the rubric.

RUBRIC:
{rubric_json}

{"KNOWLEDGE BASE CONTEXT:" + chr(10) + kb_text[:8000] if kb_text else ""}

STUDENT SUBMISSION (text):
{submission_text[:15000]}

IMPORTANT MATH GRADING RULES:
- When grading mathematical expressions, check for SYMBOLIC EQUIVALENCE, not just string matching.
- x^2+2x+1 and (x+1)^2 are equivalent and both correct.
- 2/4 and 1/2 are equivalent.
- sin^2(x) + cos^2(x) and 1 are equivalent.
- Accept any valid algebraic simplification or rearrangement as correct.
- For LaTeX expressions, interpret the math content, not the markup syntax.
- If the student's answer is mathematically equivalent to the expected answer, mark it as correct regardless of form.

Return your response as a JSON object with:
- "score": "X/Y" where X is earned points and Y is total
- "earnedPoints": number
- "totalPoints": number
- "overallFeedback": string (2-3 sentences)
- "questions": array of objects, each with:
  - "questionNumber": string
  - "status": "correct" | "partial" | "wrong"
  - "pointsEarned": number
  - "pointsPossible": number
  - "feedback": string (1-2 sentences)
  - "confidence": "high" | "medium" | "low"

Respond ONLY with the JSON, no markdown."""

            genai = _init_genai()
            model = genai.GenerativeModel('gemini-2.5-flash')
            response = model.generate_content(prompt)
            response_text = response.text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            grading_result = json.loads(response_text)

            job_ref.update({'progress': 80, 'progress_text': 'Processing results...'})

            graded_questions = grading_result.get('questions', [])
            final_score = grading_result.get('earnedPoints', 0)
            total_points = grading_result.get('totalPoints', 0)
            overall_feedback = grading_result.get('overallFeedback', '')

            job_ref.update({
                'status': 'complete',
                'resultPdfUrl': None,
                'score': final_score,
                'totalPoints': total_points,
                'feedback': overall_feedback,
                'gradedQuestions': graded_questions,
                'hasEdgeCases': False,
                'progress': 100,
                'progress_text': 'Grading complete.',
                'completedAt': firestore.SERVER_TIMESTAMP
            })
            return

        # ── PDF SUBMISSION BRANCH ──
        if not raw_pdf_path:
            raise Exception("No PDF path provided and not a text submission.")

        # 1. Wait for raw PDF to appear in Storage (Retry loop — up to 60s)
        blob = _get_bucket().blob(raw_pdf_path)
        retries = 0
        max_retries = 12
        while not blob.exists() and retries < max_retries:
            time.sleep(5)
            retries += 1
            job_ref.update({'progress_text': f'Waiting for upload to complete... ({retries * 5}s)'})

        if not blob.exists():
            raise Exception(f"Raw PDF not found in Storage after {max_retries * 5}s. Path: {raw_pdf_path}")
            
        import fitz  # PyMuPDF — lazy import
        from PIL import Image, ImageDraw  # lazy import

        pdf_bytes = blob.download_as_bytes()
        MAX_PDF_BYTES = 50 * 1024 * 1024
        if len(pdf_bytes) > MAX_PDF_BYTES:
            raise Exception(f"PDF exceeds 50 MB limit ({len(pdf_bytes) / 1024 / 1024:.1f} MB). Submission rejected.")
        job_ref.update({'progress': 10, 'progress_text': 'Downloaded submission PDF.'})
        
        # 2. Fetch Knowledge Base Text (cached)
        kb_text = _get_kb_text(class_id)
                    
        job_ref.update({'progress': 20, 'progress_text': 'Retrieved knowledge base materials.'})
        # 3. Render PDF to Images (120 DPI)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_images = []
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=120)
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
The FIRST document provided below is the teacher’s homework rubric (questions, points, and internally generated correct answers). The SECOND document is the student’s handwritten or typed answers (provided as images following this text). Your task is to grade every question in the student’s document by comparing it to the generated model answer.

Apply these rules when evaluating each question:

**1. Scoring Guidelines:**
- If the student’s answer matches the core idea and final result of the generated model answer but is missing key details, steps, or a required formula, mark it as 'partial' and award roughly half the points (or a justified fraction).
- If the student’s answer is mostly correct but only missing a small label or explanation, you may still mark it as 'correct' if the generated answer’s main idea is clearly present.
- Only mark a question as 'correct' if the student’s answer fully satisfies the generated model answer, including all required elements such as formulas, explanations, diagrams, or units.
- Only mark a question as 'wrong' if the student’s answer is completely incorrect, contradicts the model answer, or is missing.

**2. Style Feedback Rules for Red Ink (Annotations):**
- Each per‑question feedback comment must be at most 15 words.
- Start correct feedback with the symbol '✓' followed by a brief positive remark.
- Start incorrect feedback with the symbol '✗' followed by a short, clear reason.
- For partial‑credit cases, you may use '◯' or '±' if needed, but keep the tone factual and constructive.
- Do not mention point values, grading policies, or system details in the feedback text.
Match Teacher-style example transformations (e.g., '✓ Correct explanation with F=ma included.', '✗ Missing formula F=ma here.').

**3. Spatial Location Estimates (CRITICAL — read carefully):**
- **pageEstimatePercent_Y**: A number (0 to 100) representing the vertical center of the student’s answer on the page. Be PRECISE:
  - Look at where the student actually wrote their answer
  - Estimate as a percentage from the top of the page to the center of their handwriting
  - For multi-column worksheets, each question has its own Y position
- **pageEstimatePercent_X**: A number (0 to 100) representing where the student’s written answer ENDS horizontally. This tells us where to place the annotation mark:
  - For answers on the LEFT side of a two-column layout: typically 25-40
  - For answers on the RIGHT side of a two-column layout: typically 65-80
  - For full-width answers: typically 40-60
  - The annotation will be placed JUST TO THE RIGHT of this position
- **pageNumber**: A 1-based index. Examine each page image carefully and assign the correct page.

**4. Feedback length rules:**
- For CORRECT answers: feedback should be EMPTY or at most 3 words (e.g., "✓ Correct")
- For WRONG/PARTIAL answers: feedback must be at most 8 words. Be extremely brief. Examples:
  - "✗ Should be 18, not 9"
  - "✗ Wrong product"
  - "± Missing units"
- NEVER write full sentences. NEVER repeat the question. NEVER say "Incorrect product; X multiplied by Y is Z" — just say "✗ Should be Z"

**5. IMPORTANT — Do not skip questions:**
- You MUST grade EVERY question listed in the rubric, even if the student left it blank (mark as ‘wrong’ with 0 points and feedback ‘✗ No answer’).
- Scan ALL pages carefully. Student answers may not be in order.
- If you cannot find an answer for a question on any page, still include it with status ‘wrong’ and pageNumber 1.


Return ONLY a JSON block with this exact structure (no markdown fences/blocks, just start with {{ and end with }}):
{{
  "score": "7/10",
  "earnedPoints": 7,
  "totalPoints": 10,
  "overallFeedback": "Overall good effort...",
  "questions": [
    {{
      "questionNumber": "Q1",
      "status": "correct",
      "pointsEarned": 2,
      "pointsPossible": 2,
      "feedback": "✓ Correct! ...",
      "pageEstimatePercent_Y": 30,
      "pageEstimatePercent_X": 25,
      "pageNumber": 1,
      "confidence": "high"
    }}
  ]
}}





Teacher’s Rubric:
{rubric}

Knowledge Base Context (Optional reference):
{kb_text[:20000]}
"""
        
        # Combine prompt and images into a single payload request
        # Prompt caching: static content (rubric, KB, instructions) FIRST — images LAST.
        # Gemini's implicit cache benefits from consistent leading content across requests.
        contents = [prompt]
        for p in page_images:
            img_data = _resize_for_gemini(p['img'], max_side=800, quality=75)
            contents.append({
                "mime_type": "image/jpeg",
                "data": img_data
            })

        job_ref.update({'progress': 50, 'progress_text': 'Evaluating student submission against rubric...'})
        
        response = model.generate_content(contents)
        json_str = response.text.strip()
        
        if "```json" in json_str:
            json_str = json_str.split("```json")[-1].split("```")[0].strip()
        elif "```" in json_str:
            json_str = json_str.split("```")[1].strip()
            
        parsed_result = json.loads(json_str)
        
        # Iteration 7: Conditionally handle edge cases (low confidence / unclear)
        graded_questions = parsed_result.get('questions', [])
        low_confidence_questions = []
        for q in graded_questions:
            conf = str(q.get('confidence', 'high')).lower()
            stat = str(q.get('status', '')).lower()
            if conf == 'low' or stat == 'unclear' or q.get('pointsEarned') is None:
                low_confidence_questions.append(q.get('questionNumber'))
                
        if len(low_confidence_questions) >= 3:
            job_ref.update({'progress_text': f'Handling edge cases for {len(low_confidence_questions)} question(s)...'})
            try:
                model_pro = genai.GenerativeModel('gemini-2.5-pro')
            except Exception:
                model_pro = model # Fallback to Flash if unavailable
        elif low_confidence_questions:
            print(f"edge_case_skip: {len(low_confidence_questions)} low-confidence question(s) below threshold, skipping Pro re-eval")
                
            edge_case_prompt = f"""
In this iteration, you are handling difficult edge cases in a student's submitted homework PDF.
Certain questions were flagged as low confidence because they may be illegible, messy, drawn, blank, or misplaced.

Student answer images follow this text prompt material.
Flagged questionNumber items: {", ".join(low_confidence_questions)}

Apply the following rules in order for each question item:
Rule 1 — Messy or partially illegible handwriting: Try best reading >=60%, <40% illegible = 0 pts with feedback '✗ Answer largely illegible — could not be graded.'
Rule 2 — Drawing‑based or diagram questions: evaluate core structure, labels presence, correctness. Full point if matches, partial if missing, 0 if absent.
Rule 3 — Mixed text and diagram answers: combine both components evaluates complement. Award proportionally.
Rule 4 — Completely blank answer: 0 points, feedback '✗ No answer provided.'
Rule 5 — Answer written in the wrong place: grade answer against question content appearing to answer, note mismatch.

Return ONLY a JSON array of updated question objects with:
- questionNumber
- status ('correct', 'partial', 'wrong')
- pointsEarned
- feedback (Max 15 words)
- confidence ('medium' or 'high')
- edgeCaseNote (one sentence)

Example structure (NO other text/markdown outside this array):
[
  {{
    "questionNumber": "Q3",
    "status": "partial",
    "pointsEarned": 1,
    "pointsPossible": 2,
    "feedback": "◯ Diagram mostly correct but missing axis labels.",
    "confidence": "medium",
    "edgeCaseNote": "Student drew correct graph but did not label X/Y axes."
  }}
]
"""
            pro_contents = [edge_case_prompt] + contents[1:] # images from main contents
            try:
                pro_response = model_pro.generate_content(pro_contents)
                pro_str = pro_response.text.strip()
                if "```json" in pro_str:
                    pro_str = pro_str.split("```json")[-1].split("```")[0].strip()
                elif "```" in pro_str:
                    pro_str = pro_str.split("```")[1].strip()
                pro_parsed = json.loads(pro_str)
                
                # Merge back
                pro_updates = {q['questionNumber']: q for q in pro_parsed}
                for i, q in enumerate(graded_questions):
                    num = q.get('questionNumber')
                    if num in pro_updates:
                        graded_questions[i] = pro_updates[num]
                        
                # Update submission doc flag
                sub_id = job_data.get('submissionId')
                if sub_id:
                     _db.collection('submissions').document(sub_id).update({'hasEdgeCases': True})
                else:
                     job_ref.update({'hasEdgeCases': True})
            except Exception as e:
                print(f"Edge case re-evaluation failed: {e}")

        final_score = parsed_result.get('earnedPoints', 0)
        overall_feedback = parsed_result.get('overallFeedback', 'Graded successfully.')

        
        # 7. Recompile annotated PDF
        # We can create a new PDF by inserting the PIL images back into fitz
        out_pdf = fitz.open()
        draw_errors = []
        for p in page_images:
            img = p['img']
            b = BytesIO()
            img.save(b, format="JPEG", quality=70)
            img_bytes = b.getvalue()
            
            pdf_page = out_pdf.new_page(width=p['width'], height=p['height'])
            pdf_page.insert_image(pdf_page.rect, stream=img_bytes)
            
            # --- START RED INK ANNOTATE ---
            for q in graded_questions:

                try:
                    p_num = int(q.get('pageNumber', 1)) - 1
                    if p_num == p['num'] - 1: # Match current page
                        x_pct = float(q.get('pageEstimatePercent_X', 50)) / 100.0
                        y_pct = float(q.get('pageEstimatePercent_Y', 0)) / 100.0
                        status = str(q.get('status', 'wrong')).lower()
                        num = q.get('questionNumber', '')
                        pts = q.get('pointsEarned', 0)
                        pos_pts = q.get('pointsPossible', 1)
                        
                        # Position: place mark just to the right of the answer
                        y_c = y_pct * p['height']
                        answer_end_x = x_pct * p['width']
                        mark_x = min(answer_end_x + 10, p['width'] * 0.88)

                        is_full = (pts == pos_pts)
                        color_red = (0.85, 0, 0)
                        color_green = (0, 0.6, 0)
                        s = 8  # mark size

                        import os
                        font_path = os.path.join(os.path.dirname(__file__), "fonts", "Caveat-Regular.ttf")
                        feedback = q.get('feedback', '')

                        if is_full:
                            # Green checkmark — drawn on page (prints)
                            pdf_page.draw_line(fitz.Point(mark_x, y_c + 2), fitz.Point(mark_x + s * 0.4, y_c + s), color=color_green, width=2)
                            pdf_page.draw_line(fitz.Point(mark_x + s * 0.4, y_c + s), fitz.Point(mark_x + s, y_c - 3), color=color_green, width=2)
                        else:
                            # Red cross — drawn on page (prints)
                            pdf_page.draw_line(fitz.Point(mark_x, y_c), fitz.Point(mark_x + s, y_c + s), color=color_red, width=2)
                            pdf_page.draw_line(fitz.Point(mark_x, y_c + s), fitz.Point(mark_x + s, y_c), color=color_red, width=2)

                            # Point deduction label — drawn on page (prints)
                            lost_pts = pos_pts - pts
                            if lost_pts > 0:
                                label = f"-{lost_pts}"
                                rect_box = fitz.Rect(mark_x + s + 3, y_c - 4, mark_x + s + 35, y_c + s + 8)
                                pdf_page.insert_textbox(
                                    rect_box, label, fontsize=10, color=color_red,
                                    fontfile=font_path if os.path.exists(font_path) else None,
                                    fontname="f0"
                                )

                        # Feedback comment — added as screen-only annotation (does NOT print)
                        if feedback and not is_full:
                            clean_fb = feedback.strip().lstrip('✓✗◯±').strip()
                            if clean_fb:
                                fb_x = mark_x + s + 38 if not is_full else mark_x + s + 5
                                fb_rect = fitz.Rect(fb_x, y_c - 6, min(fb_x + 200, p['width'] - 10), y_c + 30)
                                annot = pdf_page.add_freetext_annot(
                                    fb_rect,
                                    clean_fb[:50],
                                    fontsize=9,
                                    fontname="helv",
                                    text_color=(0.7, 0, 0),
                                    fill_color=(1, 1, 1),
                                    border_color=(0.9, 0.8, 0.8),
                                )
                                # Remove PRINT flag (bit 3 = value 4) so it shows on screen but not when printed
                                annot.set_flags(annot.flags & ~4)
                                annot.update()



                except Exception as draw_err:
                    print(f"Drawing Error for question {q.get('questionNumber')}: {draw_err}")
                    draw_errors.append(f"{q.get('questionNumber')}: {str(draw_err)}")
            # --- END RED INK ANNOTATE ---
            
        out_bytes = out_pdf.write()
        out_pdf.close()
        doc.close()


        
        job_ref.update({'progress': 90, 'progress_text': 'Recompiled annotated PDF.'})
        # 8. Upload Result and Update Job
        student_id = job_data.get('studentId', 'unknown')
        result_path = f"results/{student_id}/{job_id}.pdf"
        res_blob = _get_bucket().blob(result_path)
        res_blob.upload_from_string(out_bytes, content_type="application/pdf")
        
        job_ref.update({
            'status': 'complete',
            'resultPdfUrl': result_path,
            'score': final_score,
            'feedback': overall_feedback,
            'gradedQuestions': graded_questions,
            'draw_errors': draw_errors,

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
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
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
                if not kb_path:
                    continue
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
    if not (os.environ.get('GOOGLEAI_KEY') or os.environ.get('GEMINI_API_KEY')):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="AI service is not configured. Set GOOGLEAI_KEY in Firebase Function secrets."
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


# ---------------------------------------------------------------------------
# generateRubric — HTTPS Callable
# ---------------------------------------------------------------------------

@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def generate_rubric(req: https_fn.CallableRequest):
    """
    Analyzes a homework PDF and generates a grading rubric (questions + answers).
    Input (req.data):  { classId: string, rawPdfPath: string }
    Returns:           { questions: Array, totalPoints: Number, topic: String }
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    class_id = req.data.get("classId") if req.data else None
    raw_pdf_path = req.data.get("rawPdfPath") if req.data else None

    if not class_id or not raw_pdf_path:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="classId and rawPdfPath are required."
        )

    # 1. Download and Render PDF to Images
    page_images = []
    try:
        import fitz  # PyMuPDF
        from PIL import Image
        
        blob = _get_bucket().blob(raw_pdf_path)
        if blob.exists():
            pdf_bytes = blob.download_as_bytes()
            pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            for page_num in range(len(pdf_doc)):
                page = pdf_doc.load_page(page_num)
                pix = page.get_pixmap(dpi=120)
                # Convert Pixmap to PIL Image
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                page_images.append(img)
            pdf_doc.close()
        else:
            raise ValueError(f"PDF not found at {raw_pdf_path}")
    except Exception as e:
        print(f"Error reading/rendering PDF: {e}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message=f"Failed to read PDF: {e}"
        )

    if not page_images:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="No pages could be rendered from the PDF. Ensure it is not empty or corrupted."
        )

    # 2. Call Gemini
    if not (os.environ.get('GOOGLEAI_KEY') or os.environ.get('GEMINI_API_KEY')):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="AI service is not configured. Set GOOGLEAI_KEY in Firebase Function secrets."
        )

    genai = _init_genai()
    model = genai.GenerativeModel("gemini-2.5-flash")

    prompt = f"""
Analyze the following homework document images and identify every question (or sub‑question). For each, record:
- the question number or label (e.g., 'Q1', '1a', 'Problem 2')
- a short description of what the question is asking
- the point value if it is shown on the document; if no point value is given, assume this question is worth 1 point

Based solely on the question text in the images, infer and generate a correct, model answer for each question.
Reason from the question content and produce a concise, correct answer that a strong student would write.

Then compute the total possible points for the homework by summing the points (or 1 point per question if no points are given). Also infer the main overall topic.

Return ONLY a JSON block with this exact structure (no markdown fences, just start with {{ and end with }}):
{{
  "questions": [
    {{
      "number": "Q1",
      "description": "Describe Newton’s second law and state its formula.",
      "points": 2,
      "generatedAnswer": "Newton’s second law states that the acceleration of an object is directly proportional to the net force acting on it and inversely proportional to its mass. The formula is F = ma."
    }}
  ],
  "totalPoints": 2,
  "topic": "Newton’s laws of motion"
}}
"""

    contents = [prompt]
    from io import BytesIO
    for img in page_images:
        contents.append({
            "mime_type": "image/jpeg",
            "data": _resize_for_gemini(img, max_side=800, quality=75)
        })

    rubric = None
    last_error = None

    for attempt in range(2):
        try:
            if attempt == 1:
                 # Append critical instruction with correct escaped brackets
                 contents[0] = prompt + '\nCRITICAL: Return RAW JSON ONLY. No markdown fences. Example: {{"questions": [...], "totalPoints": 10, "topic": "..."}}'

            response = model.generate_content(contents)
            json_str = response.text.strip()

            if "```json" in json_str:
                json_str = json_str.split("```json")[-1].split("```")[0].strip()
            elif "```" in json_str:
                json_str = json_str.split("```")[1].strip()

            parsed = json.loads(json_str)

            # Validate structure
            if "questions" not in parsed or "totalPoints" not in parsed or "topic" not in parsed:
                raise ValueError("Missing required top-level keys: questions, totalPoints, topic")
            if not isinstance(parsed["questions"], list):
                raise ValueError("questions must be an array")

            rubric = parsed
            break

        except Exception as e:
            last_error = e
            print(f"Rubric generation attempt {attempt+1} failed: {e}")

    if rubric is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"Failed to generate valid rubric: {last_error}"
        )

    _increment_usage()
    return rubric


@https_fn.on_call(
    timeout_sec=60,
    memory=options.MemoryOption.MB_512,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def tika_chat(req: https_fn.CallableRequest):
    """
    Tika chatbot — answers student questions grounded ONLY in their assignments,
    due dates, grades, and teacher-uploaded knowledge base materials.
    Input (req.data): { question: str, context: str }
    Returns: { answer: str }
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    question = (req.data or {}).get("question", "").strip()[:1000]
    context = (req.data or {}).get("context", "").strip()[:15000]

    if not question:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Question is required."
        )

    # Fetch knowledge base text for student's enrolled classes
    student_uid = req.auth.uid
    db = _get_db()

    # Get classes the student is enrolled in
    classes_query = db.collection('classes').where('studentIds', 'array_contains', student_uid).stream()
    class_ids = []
    for c in classes_query:
        class_ids.append(c.id)

    kb_text = ""
    if class_ids:
        for cid in class_ids[:10]:  # cap at 10 classes
            class_kb = _get_kb_text(cid, max_chars=8000)
            if class_kb:
                kb_text += class_kb + "\n"
            if len(kb_text) >= 30000:
                break
    kb_text = kb_text[:30000]

    genai = _init_genai()
    model = genai.GenerativeModel("gemini-2.5-flash")

    system_prompt = f"""You are Tika, a helpful and friendly student assistant for the TikiTaka learning platform.

STRICT RULES:
1. You may ONLY answer questions using the CONTEXT provided below. This includes the student's enrolled classes, assignments, due dates, grades, and teacher-uploaded knowledge base materials.
2. If the answer is NOT in the context, say: "I don't have enough information to answer that. Please ask your teacher for help!"
3. NEVER make up facts, grades, due dates, or assignment details.
4. NEVER generate study content or answers to homework questions — only help the student understand what they need to do and when.
5. Be concise, encouraging, and helpful. Use a warm, supportive tone.
6. When listing assignments or due dates, be specific and organized.
7. If asked about grading, only reference actual scores and feedback from the context.
8. WHAT-IF GRADE QUESTIONS: When the student asks "What if I get X on [assignment]?" or similar hypothetical grade questions:
   - Use the GRADE CALCULATION DATA and WHAT-IF FORMULA from the context
   - Calculate: New % = (current earned + hypothetical score) / (current possible + assignment total points) * 100
   - Show their current grade %, the projected grade %, and the difference
   - Be encouraging regardless of the result
   - You can handle multiple what-if scenarios in one question
   - If the student asks what grade they NEED to reach a target %, work backwards: needed score = (target% * new total possible / 100) - current earned

STUDENT CONTEXT (assignments, classes, grades, due dates):
{context}

TEACHER KNOWLEDGE BASE MATERIALS:
{kb_text if kb_text else "No knowledge base materials uploaded by teachers yet."}
"""

    try:
        response = model.generate_content([
            {"role": "user", "parts": [system_prompt]},
            {"role": "model", "parts": ["Hi! I'm Tika, your learning assistant. I can help you with your assignments, due dates, and class info. What would you like to know?"]},
            {"role": "user", "parts": [question]},
        ])
        answer = response.text.strip()
    except Exception as e:
        print(f"Tika chat error: {e}")
        answer = "Sorry, I'm having trouble right now. Please try again in a moment!"

    return {"answer": answer}


@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def confusion_heatmap(req: https_fn.CallableRequest):
    """
    Generates a confusion heatmap analysis for a class.
    Analyzes quiz topic gaps and assignment grading feedback to identify
    concepts the class is struggling with.
    Input (req.data): { classId: str }
    Returns: { analysis: str, topics: [{ topic, severity, count, description }] }
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    class_id = (req.data or {}).get("classId", "").strip()
    if not class_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="classId is required."
        )

    db = _get_db()

    # Verify teacher owns the class or is a TA
    class_doc = db.collection('classes').document(class_id).get()
    class_data = class_doc.to_dict() if class_doc.exists else None
    is_owner = class_data and class_data.get('teacherId') == req.auth.uid
    is_ta = class_data and req.auth.uid in class_data.get('taIds', [])
    if not class_doc.exists or (not is_owner and not is_ta):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message="You do not have access to this class."
        )
    student_count = len(class_data.get('studentIds', []))

    # 1. Gather quiz topic gaps
    quiz_data = []
    quiz_query = db.collection('quizAttempts').where('classId', '==', class_id).stream()
    for attempt_doc in quiz_query:
        attempt = attempt_doc.to_dict()
        quiz_data.append({
            'score': attempt.get('score'),
            'topicGaps': attempt.get('topicGaps', []),
            'questions': [
                {'topic': q.get('topic', ''), 'correct': q.get('correct', True)}
                for q in attempt.get('questions', [])
            ]
        })

    # 2. Gather assignment grading feedback
    assignment_data = []
    jobs_ref = db.collection('gradingJobs').where('classId', '==', class_id)
    if not is_ta:
        jobs_ref = jobs_ref.where('teacherId', '==', req.auth.uid)
    jobs_query = jobs_ref.stream()
    for job_doc in jobs_query:
        job = job_doc.to_dict()
        if job.get('status') == 'complete' and job.get('gradedQuestions'):
            assignment_data.append({
                'title': job.get('assignmentTitle', 'Assignment'),
                'score': job.get('score'),
                'totalPoints': job.get('totalPoints'),
                'questions': [
                    {
                        'number': q.get('questionNumber', ''),
                        'status': q.get('status', ''),
                        'pointsEarned': q.get('pointsEarned', 0),
                        'pointsPossible': q.get('pointsPossible', 0),
                        'feedback': q.get('feedback', '')
                    }
                    for q in job.get('gradedQuestions', [])
                ]
            })

    # 3. Get assignment rubric info
    rubric_data = []
    assign_query = db.collection('assignments').where('classId', '==', class_id).stream()
    for assign_doc in assign_query:
        assign = assign_doc.to_dict()
        if assign.get('rubric') and assign['rubric'].get('questions'):
            rubric_data.append({
                'title': assign.get('title', ''),
                'topic': assign.get('topic', assign['rubric'].get('topic', '')),
                'questions': [
                    {'number': q.get('number', ''), 'description': q.get('description', '')}
                    for q in assign['rubric']['questions']
                ]
            })

    if not quiz_data and not assignment_data:
        return {
            "analysis": "Not enough data yet. Students need to complete quizzes or assignments before a confusion analysis can be generated.",
            "topics": []
        }

    # 4. Call Gemini for analysis
    genai = _init_genai()
    model = genai.GenerativeModel("gemini-2.5-flash")

    prompt = f"""You are an expert educational analyst. A teacher wants to understand what concepts their class of {student_count} students is struggling with BEFORE an upcoming test or midterm.

Analyze the following data and produce a structured confusion report.

QUIZ ATTEMPT DATA ({len(quiz_data)} attempts):
{json.dumps(quiz_data[:50], default=str)}

ASSIGNMENT GRADING DATA ({len(assignment_data)} graded submissions):
{json.dumps(assignment_data[:50], default=str)}

ASSIGNMENT RUBRIC CONTEXT:
{json.dumps(rubric_data[:20], default=str)}

Based on the data above, produce a JSON response with this exact structure (no markdown fences):
{{
  "analysis": "A 2-3 paragraph executive summary written directly to the teacher. Start with the most critical areas of confusion. Be specific about which concepts students are getting wrong and why. Give actionable reteaching suggestions. Use a professional but supportive tone.",
  "topics": [
    {{
      "topic": "Name of the concept/topic",
      "severity": "high" | "medium" | "low",
      "count": <number of students/attempts affected>,
      "description": "1-2 sentence explanation of what students are getting wrong and a suggestion for how to reteach it"
    }}
  ]
}}

Sort topics by severity (high first), then by count descending. Include up to 10 topics maximum.
Return ONLY the JSON object, no other text.
"""

    try:
        response = model.generate_content(prompt)
        raw = response.text.strip()
        if "```json" in raw:
            raw = raw.split("```json")[-1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].strip()
        parsed = json.loads(raw)
        return parsed
    except Exception as e:
        print(f"Confusion heatmap generation error: {e}")
        return {
            "analysis": "Unable to generate analysis at this time. Please try again later.",
            "topics": []
        }


# ---------------------------------------------------------------------------
# generate_quick_content — HTTPS Callable
# Natural-language prompt → assignment builder blocks
# ---------------------------------------------------------------------------

@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    secrets=["GOOGLEAI_KEY", "GEMINI_API_KEY"]
)
def generate_quick_content(req: https_fn.CallableRequest):
    """
    Accept a single natural-language prompt and return assignment builder blocks.
    Input:  { classId, prompt, useKnowledgeBase, questionCount, difficulty, questionTypes }
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
            age = datetime.datetime.now(datetime.timezone.utc) - cached_at
            if age.total_seconds() < 86400:
                return cached.get('result')

    # Fetch KB context (cap at 8000 chars to stay under token budget)
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
      "content": "<question text>",
      "points": 1,
      "questionType": "mcq",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answer": "A",
      "hint": "one concise sentence",
      "topic": "topic name"
    }}
  ]
}}

For short/long answer blocks, omit "options" and "answer" fields.
Start with one divider block if there are multiple parts: {{"id": "div_1", "type": "divider", "order": 0, "content": "Part A"}}.
Keep all block IDs unique. Use sequential order values starting from 1 (dividers can use 0).
"""

    result = None
    last_error = None
    for attempt in range(2):
        try:
            extra = '' if attempt == 0 else '\nCRITICAL: Return RAW JSON ONLY. No markdown fences.'
            response = model.generate_content(prompt_text + extra)
            json_str = response.text.strip()
            if '```json' in json_str:
                json_str = json_str.split('```json')[-1].split('```')[0].strip()
            elif '```' in json_str:
                json_str = json_str.split('```')[1].strip()
            parsed = json.loads(json_str)
            if 'blocks' not in parsed or 'title' not in parsed:
                raise ValueError("Missing required fields: blocks, title")
            result = parsed
            break
        except Exception as e:
            last_error = e
            print(f"generate_quick_content attempt {attempt + 1} failed: {e}")

    if result is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"Content generation failed after 2 attempts: {last_error}"
        )

    # Store in 24-hour cache (admin SDK bypasses Firestore rules)
    try:
        cache_ref.set({
            'result': result,
            'prompt': inp.prompt,
            'classId': inp.classId,
            'teacherId': teacher_id,
            'createdAt': firestore.SERVER_TIMESTAMP
        })
    except Exception as e:
        print(f"Cache write failed (non-fatal): {e}")

    increment_teacher_quiz_gen(teacher_id)
    _increment_usage()
    return result
