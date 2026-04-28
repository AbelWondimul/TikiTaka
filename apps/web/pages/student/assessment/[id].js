import { useRouter } from 'next/router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { db } from '@/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { calculateTimeRemaining, formatTime, isTimerCritical } from '@/lib/assessments/timerLogic';
import { setupLockdown } from '@/lib/assessments/lockdownDetector';
import { autoGradeSubmission } from '@/lib/assessments/autoGrade';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import MathRenderer from '@/components/editor/MathRenderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  FileText,
  AlertTriangle,
  Flag,
  CheckCircle,
  ArrowLeft,
  Shield,
  Hash,
  Timer,
  RotateCcw,
} from 'lucide-react';

function TakeAssessmentPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  // Data states
  const [assessment, setAssessment] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answerChoices, setAnswerChoices] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);

  // Assessment-taking states
  const [responses, setResponses] = useState({});
  const [flaggedQuestions, setFlaggedQuestions] = useState(new Set());
  const [timeRemaining, setTimeRemaining] = useState(Infinity);
  const [violations, setViolations] = useState([]);
  const [showViolationDialog, setShowViolationDialog] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const autosaveRef = useRef(null);
  const lockdownCleanupRef = useRef(null);
  const startTimeRef = useRef(null);

  // Load assessment data
  useEffect(() => {
    if (!id || !user) return;

    async function loadData() {
      try {
        // Load assessment
        const assessmentDoc = await getDoc(doc(db, 'assessments', id));
        if (!assessmentDoc.exists()) {
          router.push('/student/dashboard');
          return;
        }
        const assessmentData = { id: assessmentDoc.id, ...assessmentDoc.data() };
        setAssessment(assessmentData);

        // Load questions
        const questionsQuery = query(
          collection(db, 'assessments', id, 'questions'),
          orderBy('orderIndex')
        );
        const questionsSnap = await getDocs(questionsQuery);
        const questionsData = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setQuestions(questionsData);

        // Load answer choices for all questions
        const allChoices = [];
        for (const q of questionsData) {
          const choicesSnap = await getDocs(
            collection(db, 'assessments', id, 'questions', q.id, 'answerChoices')
          );
          choicesSnap.docs.forEach((c) => {
            allChoices.push({ id: c.id, questionId: q.id, ...c.data() });
          });
        }
        setAnswerChoices(allChoices);

        // Check for existing submission
        const submissionsQuery = query(
          collection(db, 'assessments', id, 'submissions'),
          where('studentId', '==', user.uid)
        );
        const submissionsSnap = await getDocs(submissionsQuery);
        if (!submissionsSnap.empty) {
          // Get the most recent submission
          const subs = submissionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const latest = subs.sort((a, b) => (b.attemptNumber || 1) - (a.attemptNumber || 1))[0];
          setSubmission(latest);

          if (latest.status === 'in_progress') {
            startTimeRef.current = latest.startedAt;
            // Load saved responses from Firestore if any
            const responsesSnap = await getDocs(
              collection(db, 'assessments', id, 'submissions', latest.id, 'responses')
            );
            const savedResponses = {};
            responsesSnap.docs.forEach((r) => {
              const data = r.data();
              savedResponses[data.questionId] = data;
            });
            setResponses(savedResponses);
          }
        }
      } catch (err) {
        console.error('Error loading assessment:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [id, user, router]);

  // Restore from localStorage on mount
  useEffect(() => {
    if (!id || !user || !submission || submission.status !== 'in_progress') return;

    const storageKey = `assessment_${id}_${user.uid}_responses`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setResponses((prev) => {
          // Only restore if we don't already have Firestore responses
          if (Object.keys(prev).length === 0) {
            return parsed;
          }
          return prev;
        });
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [id, user, submission]);

  // Autosave to localStorage every 10 seconds
  useEffect(() => {
    if (!id || !user || !submission || submission.status !== 'in_progress') return;

    const storageKey = `assessment_${id}_${user.uid}_responses`;
    autosaveRef.current = setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify(responses));
    }, 10000);

    return () => {
      if (autosaveRef.current) clearInterval(autosaveRef.current);
    };
  }, [id, user, submission, responses]);

  // Timer
  useEffect(() => {
    if (!assessment?.timeLimit || !submission || submission.status !== 'in_progress') return;

    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining(submission.startedAt, assessment.timeLimit);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleAutoSubmit();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [assessment, submission]);

  // Browser lockdown
  useEffect(() => {
    if (!assessment?.browserLockdown || !submission || submission.status !== 'in_progress') return;

    lockdownCleanupRef.current = setupLockdown((violation) => {
      setViolations((prev) => {
        const updated = [...prev, violation];
        const maxViolations = assessment.maxViolations || 3;
        if (updated.length === 1) {
          setShowViolationDialog(true);
        }
        if (updated.length >= maxViolations) {
          handleAutoSubmit();
        }
        return updated;
      });
    });

    return () => {
      if (lockdownCleanupRef.current) lockdownCleanupRef.current();
    };
  }, [assessment, submission]);

  // Handlers
  const handleBeginAssessment = async () => {
    try {
      // Count existing submissions for attempt number
      const submissionsQuery = query(
        collection(db, 'assessments', id, 'submissions'),
        where('studentId', '==', user.uid)
      );
      const existingSnap = await getDocs(submissionsQuery);
      const attemptNumber = existingSnap.size + 1;

      const subRef = await addDoc(collection(db, 'assessments', id, 'submissions'), {
        studentId: user.uid,
        attemptNumber,
        startedAt: serverTimestamp(),
        status: 'in_progress',
        createdAt: serverTimestamp(),
      });

      const newSub = {
        id: subRef.id,
        studentId: user.uid,
        attemptNumber,
        startedAt: Timestamp.now(),
        status: 'in_progress',
      };
      setSubmission(newSub);
      startTimeRef.current = newSub.startedAt;
    } catch (err) {
      console.error('Error starting assessment:', err);
    }
  };

  const updateResponse = useCallback((questionId, data) => {
    setResponses((prev) => ({
      ...prev,
      [questionId]: { questionId, ...prev[questionId], ...data },
    }));
  }, []);

  const toggleFlag = useCallback((questionId) => {
    setFlaggedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }, []);

  const handleAutoSubmit = async () => {
    await submitAssessment();
  };

  const submitAssessment = async () => {
    if (submitting) return;
    setSubmitting(true);
    setShowSubmitDialog(false);

    try {
      // Calculate time spent
      const startedAt = submission.startedAt?.toDate
        ? submission.startedAt.toDate()
        : new Date(submission.startedAt?.seconds * 1000 || Date.now());
      const timeSpentSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

      // Save responses to subcollection
      const responsesCol = collection(db, 'assessments', id, 'submissions', submission.id, 'responses');
      const responseEntries = Object.values(responses);
      for (const resp of responseEntries) {
        await addDoc(responsesCol, {
          ...resp,
          submittedAt: serverTimestamp(),
        });
      }

      // Auto-grade
      const gradedResults = autoGradeSubmission(questions, responseEntries, answerChoices);
      const allAutoGraded = gradedResults.every((r) => r.autoGraded);
      const totalScore = gradedResults.reduce((sum, r) => sum + (r.pointsEarned || 0), 0);
      const maxScore = questions.reduce((sum, q) => sum + (q.points || 0), 0);

      // Update submission doc
      const updateData = {
        status: 'submitted',
        submittedAt: serverTimestamp(),
        timeSpentSeconds,
        gradedResults,
      };

      if (allAutoGraded) {
        updateData.score = totalScore;
        updateData.maxScore = maxScore;
        updateData.percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 10000) / 100 : 0;
        updateData.status = 'graded';
      }

      await updateDoc(doc(db, 'assessments', id, 'submissions', submission.id), updateData);

      // Clear localStorage
      const storageKey = `assessment_${id}_${user.uid}_responses`;
      localStorage.removeItem(storageKey);

      setSubmission((prev) => ({ ...prev, ...updateData, submittedAt: new Date() }));
      setSubmitted(true);
    } catch (err) {
      console.error('Error submitting assessment:', err);
      setSubmitting(false);
    }
  };

  // Derived values
  const answeredCount = Object.keys(responses).filter((qId) => {
    const r = responses[qId];
    return r && (r.answerChoiceIds?.length > 0 || r.textResponse?.trim());
  }).length;

  const progressPercent = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

  // LOADING STATE
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-2/3" />
          <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Assessment not found.</p>
      </div>
    );
  }

  // STATE 4: Already submitted
  if (submission && (submission.status === 'submitted' || submission.status === 'graded') && !submitted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">Assessment Submitted</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            {submission.submittedAt && (
              <p className="text-gray-500 dark:text-gray-400">
                Submitted:{' '}
                {(submission.submittedAt?.toDate
                  ? submission.submittedAt.toDate()
                  : new Date(submission.submittedAt?.seconds * 1000 || submission.submittedAt)
                ).toLocaleString()}
              </p>
            )}
            {submission.status === 'graded' && assessment.showCorrectAnswers && (
              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg">
                <p className="text-lg font-semibold">
                  Score: {submission.score} / {submission.maxScore}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{submission.percentage}%</p>
              </div>
            )}
            <Button onClick={() => router.push('/student/dashboard')} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // STATE 3 / Post-submit thank you
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">Assessment Submitted!</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-gray-500 dark:text-gray-400">
              Your assessment has been submitted successfully at{' '}
              {new Date().toLocaleString()}.
            </p>
            {submission?.score !== undefined && (
              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg">
                <p className="text-lg font-semibold">
                  Score: {submission.score} / {submission.maxScore}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{submission.percentage}%</p>
              </div>
            )}
            <Button onClick={() => router.push('/student/dashboard')} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // STATE 1: Pre-start screen
  if (!submission || submission.status !== 'in_progress') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">{assessment.title}</h1>
            {assessment.instructions && (
              <MathRenderer
                content={assessment.instructions}
                className="text-gray-600 dark:text-gray-400 mt-4 text-left"
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Hash className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Questions</p>
                  <p className="font-semibold">{questions.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Timer className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Time Limit</p>
                  <p className="font-semibold">
                    {assessment.timeLimit ? `${assessment.timeLimit} minutes` : 'No time limit'}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <RotateCcw className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Attempts</p>
                  <p className="font-semibold">{assessment.maxAttempts || 1}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {assessment.browserLockdown && (
            <Alert variant="destructive">
              <Shield className="w-4 h-4" />
              <AlertDescription>
                This assessment uses browser lockdown. You will not be able to switch tabs,
                open developer tools, or use keyboard shortcuts during the assessment.
                Violations may result in automatic submission.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-center">
            <Button size="lg" onClick={handleBeginAssessment} className="px-8 py-6 text-lg">
              Begin Assessment
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // STATE 2: Taking the assessment
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Top bar */}
      <div className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b dark:border-gray-700 shadow-sm dark:shadow-gray-900/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[200px]">
            {assessment.title}
          </p>

          {assessment.timeLimit && (
            <div
              className={`font-mono text-lg font-bold ${
                isTimerCritical(timeRemaining) ? 'text-red-600' : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              <Clock className="w-4 h-4 inline mr-1" />
              {formatTime(timeRemaining)}
            </div>
          )}

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Question {answeredCount} of {questions.length}
            </span>
            <Button onClick={() => setShowSubmitDialog(true)} size="sm">
              Submit
            </Button>
          </div>
        </div>

        <Progress value={progressPercent} className="h-1" />
      </div>

      {/* Questions area */}
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {questions.map((question, index) => (
          <Card
            key={question.id}
            className={`${flaggedQuestions.has(question.id) ? 'border-l-4 border-l-orange-400' : ''}`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Question {index + 1}</CardTitle>
                <Badge variant="secondary">{question.points} pts</Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFlag(question.id)}
                className={flaggedQuestions.has(question.id) ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}
              >
                <Flag className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Question content */}
              {question.content && (
                <MathRenderer content={question.content} />
              )}
              {question.text && !question.content && (
                <p className="text-gray-800 dark:text-gray-100">{question.text}</p>
              )}

              {/* Media */}
              {question.imageUrl && (
                <img
                  src={question.imageUrl}
                  alt="Question media"
                  className="max-w-full rounded-lg"
                />
              )}

              {/* Answer input */}
              <QuestionInput
                question={question}
                choices={answerChoices.filter((c) => c.questionId === question.id)}
                response={responses[question.id]}
                onUpdate={(data) => updateResponse(question.id, data)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Submit confirmation dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Assessment?</DialogTitle>
            <DialogDescription>
              Please review before submitting. You cannot change your answers after submission.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm">
              <span className="font-medium">Answered:</span> {answeredCount} of {questions.length} questions
            </p>
            {questions.length - answeredCount > 0 && (
              <p className="text-sm text-amber-600">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                {questions.length - answeredCount} question(s) unanswered
              </p>
            )}
            {flaggedQuestions.size > 0 && (
              <p className="text-sm text-orange-600">
                <Flag className="w-4 h-4 inline mr-1" />
                {flaggedQuestions.size} question(s) flagged for review
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Review Answers
            </Button>
            <Button
              variant="destructive"
              onClick={submitAssessment}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Submit Assessment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Violation warning dialog */}
      <Dialog open={showViolationDialog} onOpenChange={setShowViolationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">
              <AlertTriangle className="w-5 h-5 inline mr-2" />
              Browser Violation Detected
            </DialogTitle>
            <DialogDescription>
              A lockdown violation has been detected. Please stay on this page and do not
              attempt to switch tabs or open other tools. Further violations may result in
              automatic submission of your assessment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowViolationDialog(false)}>I Understand</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Answer input component based on question type
function QuestionInput({ question, choices, response, onUpdate }) {
  const selectedIds = response?.answerChoiceIds || [];
  const textValue = response?.textResponse || '';

  switch (question.type) {
    case 'multiple_choice':
      return (
        <div className="space-y-2">
          {choices
            .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
            .map((choice) => {
              const isSelected = selectedIds.includes(choice.id);
              const isMultiple = question.allowMultipleCorrect;

              return (
                <div
                  key={choice.id}
                  onClick={() => {
                    let newIds;
                    if (isMultiple) {
                      newIds = isSelected
                        ? selectedIds.filter((cid) => cid !== choice.id)
                        : [...selectedIds, choice.id];
                    } else {
                      newIds = [choice.id];
                    }
                    onUpdate({ answerChoiceIds: newIds });
                  }}
                  className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <div
                    className={`w-5 h-5 flex items-center justify-center rounded-${
                      isMultiple ? 'sm' : 'full'
                    } border-2 ${
                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {isSelected && (
                      <div className={`w-2 h-2 bg-white rounded-${isMultiple ? 'sm' : 'full'}`} />
                    )}
                  </div>
                  <span className="text-sm">{choice.text}</span>
                </div>
              );
            })}
        </div>
      );

    case 'true_false':
      return (
        <div className="flex gap-4">
          {['True', 'False'].map((option) => {
            const choice = choices.find(
              (c) => c.text?.toLowerCase() === option.toLowerCase()
            );
            const choiceId = choice?.id || option.toLowerCase();
            const isSelected = selectedIds.includes(choiceId);

            return (
              <Button
                key={option}
                variant={isSelected ? 'default' : 'outline'}
                className={`flex-1 h-14 text-lg ${isSelected ? '' : ''}`}
                onClick={() => onUpdate({ answerChoiceIds: [choiceId] })}
              >
                {option}
              </Button>
            );
          })}
        </div>
      );

    case 'short_answer':
      return (
        <Input
          placeholder="Type your answer..."
          value={textValue}
          onChange={(e) => onUpdate({ textResponse: e.target.value })}
        />
      );

    case 'essay':
      return (
        <div className="space-y-2">
          <Textarea
            placeholder="Write your essay response..."
            value={textValue}
            onChange={(e) => onUpdate({ textResponse: e.target.value })}
            rows={8}
          />
          {question.wordLimit && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
              {textValue.trim().split(/\s+/).filter(Boolean).length} / {question.wordLimit} words
            </p>
          )}
        </div>
      );

    case 'coding':
      return (
        <div className="space-y-2">
          {question.language && (
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase">{question.language}</p>
          )}
          <textarea
            className="w-full font-mono bg-slate-900 text-green-400 p-3 rounded min-h-[200px] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="// Write your code here..."
            value={textValue}
            onChange={(e) => onUpdate({ textResponse: e.target.value })}
          />
        </div>
      );

    default:
      return <p className="text-gray-500 dark:text-gray-400 text-sm">Unsupported question type: {question.type}</p>;
  }
}

export default withAuth(TakeAssessmentPage, ['student']);
