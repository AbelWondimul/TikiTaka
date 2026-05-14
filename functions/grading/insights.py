"""compute_assignment_insights — aggregates grading results for one assignment."""
import json
import statistics
from firebase_admin import firestore
from google.api_core.exceptions import AlreadyExists


def _get_db():
    return firestore.client()


def compute_insights(assignment_id: str, class_id: str, teacher_id: str, genai) -> dict:
    """
    Aggregates all complete gradingJobs for assignment_id and writes
    assignmentInsights/{assignment_id} to Firestore.

    Returns the insights dict.
    """
    db = _get_db()

    insight_ref = db.collection('assignmentInsights').document(assignment_id)

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
            qnum = str(q.get('questionNumber', '?'))
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
            raw = raw.split('```')[1]
            if raw.startswith('json'):
                raw = raw[4:]
            raw = raw.strip()
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

    try:
        insight_ref.create(insights)
    except AlreadyExists:
        return insight_ref.get().to_dict()
    return insights
