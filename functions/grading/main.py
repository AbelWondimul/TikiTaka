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

def _check_and_increment_rate_limit(uid: str, action: str, limit: int, is_trigger: bool = False):
    """Checks daily rates for users/{uid}/dailyUsage/{YYYY-MM-DD}"""
    try:
        from firebase_functions import https_fn
        db = _get_db()
        today_str = datetime.date.today().strftime('%Y-%m-%d')
        usage_ref = db.collection('users').document(uid).collection('dailyUsage').document(today_str)
        snap = usage_ref.get()
        current_count = 0
        if snap.exists:
            current_count = snap.to_dict().get(action, 0)
        if current_count >= limit:
            if is_trigger:
                return False
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                message=f"Daily limit of {limit} for {action} exceeded."
            )
        usage_ref.set({action: firestore.Increment(1)}, merge=True)
        return True
    except Exception as e:
        if hasattr(https_fn, 'HttpsError') and isinstance(e, https_fn.HttpsError):
            raise e
        print(f"Stats Limit Error for {uid}: {e}")
        return True # fail open

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
    uid = job_data.get('studentId')
    if uid and not _check_and_increment_rate_limit(uid, 'grade_pdf', 5, is_trigger=True):
        job_ref = _db.collection('gradingJobs').document(job_id)
        job_ref.update({
            'status': 'error',
            'feedback': 'Daily grading limit exceeded (Max 5). Please contact your teacher.'
        })
        return

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

**3. Spatial Location Estimates (Conceptual):**
- **pageEstimatePercent_Y**: A number (0 to 100) estimated from the top of the page indicating where the student’s answer appears (e.g., 10-20 near top, 50 halfway, 80-90 bottom).
- **pageEstimatePercent_X**: A number (0 to 100) estimated from the left edges indicating X‑offset approximations (e.g., 10-20 left, 50 center, 80-90 right).
- **pageNumber**: A 1-based index (optional, useful if question spans multiple pages).


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
        contents = [prompt]
        for p in page_images:
            b = BytesIO()
            p['img'].save(b, format="JPEG", quality=85)
            img_data = b.getvalue()
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
                
        if low_confidence_questions:
            job_ref.update({'progress_text': f'Handling edge cases for {len(low_confidence_questions)} question(s)...'})
            try:
                model_pro = genai.GenerativeModel('gemini-2.5-pro')
            except Exception:
                model_pro = model # Fallback to Flash if unavailable
                
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
            img.save(b, format="JPEG", quality=85)
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
                        
                        fitz_pt = fitz.Point(x_pct * p['width'], y_pct * p['height'])
                        
                        # Set mark text and draw vectors (✓, ✗) to avoid font glyph issues
                        is_full = (pts == pos_pts)
                        feedback = q.get('feedback', '')
                        color_red = (0.8, 0, 0)
                        width_th = 4
                        
                        x_c = fitz_pt.x
                        y_c = fitz_pt.y
                        
                        if is_full:
                            # Draw Checkmark vector
                            pdf_page.draw_line(fitz.Point(x_c, y_c), fitz.Point(x_c + 15, y_c + 15), color=color_red, width=width_th)
                            pdf_page.draw_line(fitz.Point(x_c + 15, y_c + 15), fitz.Point(x_c + 40, y_c - 15), color=color_red, width=width_th)
                            text_to_draw = "" # Full marks get only graphics
                        else:
                            lost_pts = pos_pts - pts
                            text_to_draw = f"{num} (-{lost_pts} pts)"
                            if status == 'wrong':
                                # Draw Cross vector
                                pdf_page.draw_line(fitz.Point(x_c, y_c), fitz.Point(x_c + 30, y_c + 30), color=color_red, width=width_th)
                                pdf_page.draw_line(fitz.Point(x_c, y_c + 30), fitz.Point(x_c + 30, y_c), color=color_red, width=width_th)
                            else: # partial credit
                                text_to_draw = f"± {text_to_draw}"
                                
                            if feedback:
                                clean_fb = feedback.strip().lstrip('✓✗◯±').strip()
                                text_to_draw += f": {clean_fb}"
                                
                        if text_to_draw:
                            import os
                            font_path = os.path.join(os.path.dirname(__file__), "fonts", "Caveat-Regular.ttf")
                            
                            rect_box = fitz.Rect(
                                x_c + 50,             # x0
                                y_c - 15,             # y0
                                p['width'] - 30,      # x1
                                y_c + 150             # y1
                            )
                            
                            pdf_page.insert_textbox(
                                rect_box, 
                                text_to_draw, 
                                fontsize=28, 
                                color=color_red,
                                fontfile=font_path if os.path.exists(font_path) else None,
                                fontname="f0"
                            )



                except Exception as draw_err:
                    print(f"Drawing Error for question {q.get('questionNumber')}: {draw_err}")
                    draw_errors.append(f"{q.get('questionNumber')}: {str(draw_err)}")
            # --- END RED INK ANNOTATE ---
            
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
    _check_and_increment_rate_limit(student_id, 'generate_quiz', 10)
    
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


# ---------------------------------------------------------------------------
# generateRubric — HTTPS Callable
# ---------------------------------------------------------------------------

@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_2,
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

    teacher_id = req.auth.uid
    _check_and_increment_rate_limit(teacher_id, 'generate_rubric', 15)

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
                pix = page.get_pixmap(dpi=150)
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
    if not os.environ.get('GOOGLEAI_KEY'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="AI service is not configured."
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
        b = BytesIO()
        img.save(b, format="JPEG", quality=85)
        contents.append({
            "mime_type": "image/jpeg",
            "data": b.getvalue()
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

