"""Firestore-backed rate limiting for Cloud Functions."""
import datetime
from firebase_admin import firestore


def _get_db():
    return firestore.client()


def check_student_grading_limit(student_id: str, class_id: str, max_active: int = 10) -> bool:
    """Returns True if student is within limit, False if they have hit it."""
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
    """Returns True if teacher is within daily quiz generation limit."""
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
