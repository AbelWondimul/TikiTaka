import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';

import { db, functions } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { getClassById } from '@/lib/classUtils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Lightbulb,
  RotateCcw,
  BookOpen,
  PlayCircle,
} from 'lucide-react';

function StudentQuiz() {
  const router = useRouter();
  const { classId, quizId } = router.query;
  const { user } = useAuth();

  // Class info
  const [className, setClassName] = useState('');
  const [quiz, setQuiz] = useState(null);

  // Quiz lifecycle: 'preview' | 'loading' | 'quiz' | 'submitting' | 'results' | 'error'
  const [phase, setPhase] = useState('preview');
  const [errorMessage, setErrorMessage] = useState('');

  // Questions state
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});

  // Results state
  const [results, setResults] = useState(null);

  // ------------------------------------------------------------------
  // Fetch metadata on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!classId) return;

    const fetchMetadata = async () => {
      try {
        const classData = await getClassById(classId);
        if (classData) {
          setClassName(classData.name);
        }
      } catch (err) {
        console.error('Error fetching class:', err);
      }

      if (quizId) {
        try {
          const quizRef = doc(db, 'quizzes', quizId);
          const quizSnap = await getDoc(quizRef);
          if (quizSnap.exists()) {
            setQuiz({ id: quizSnap.id, ...quizSnap.data() });
          }
        } catch (err) {
          console.error('Error fetching quiz details:', err);
        }
      }
    };

    fetchMetadata();
  }, [classId, quizId]);

  // ------------------------------------------------------------------
  // Generate quiz
  // ------------------------------------------------------------------
  const loadQuiz = useCallback(async () => {
    if (!classId || !functions) return;

    setPhase('loading');
    setErrorMessage('');
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers({});
    setResults(null);

    // Generate quiz
    try {
      const generateQuizFn = httpsCallable(functions, 'generate_quiz');
      const result = await generateQuizFn({ 
        classId, 
        quizId, 
        excludedDocIds: quiz?.excludedDocIds || [] 
      });
      const questionData = result.data;

      if (!Array.isArray(questionData) || questionData.length === 0) {
        throw new Error('No questions received from the AI.');
      }

      setQuestions(questionData);
      setPhase('quiz');
    } catch (err) {
      console.error('Failed to generate quiz:', err);
      setErrorMessage(
        err.message || 'Failed to generate quiz. Please try again.'
      );
      setPhase('error');
    }
  }, [classId, quizId]);

  // loadQuiz called manually from start screen

  // ------------------------------------------------------------------
  // Quiz interactions
  // ------------------------------------------------------------------
  const handleSelectAnswer = (letter) => {
    setAnswers((prev) => ({ ...prev, [currentIndex]: letter }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!functions) return;
    setPhase('submitting');

    try {
      const submitQuiz = httpsCallable(functions, 'submitQuiz');
      const result = await submitQuiz({
        questions,
        answers,
        classId,
        quizId,
      });
      setResults(result.data);
      setPhase('results');
    } catch (err) {
      console.error('Failed to submit quiz:', err);
      setErrorMessage(
        err.message || 'Failed to submit quiz. Please try again.'
      );
      setPhase('error');
    }
  };

  // ------------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------------
  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
  const progressPercent = questions.length > 0
    ? ((currentIndex + 1) / questions.length) * 100
    : 0;

  // ------------------------------------------------------------------
  // Render: Preview / Start Screen
  // ------------------------------------------------------------------
  if (phase === 'preview') {
    return (
      <>
        <Head>
          <title>{quiz?.title || 'Practice Quiz'} - {className || 'Class'}</title>
        </Head>
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          <Button
            variant="ghost"
            className="pl-0 text-muted-foreground hover:bg-transparent"
            onClick={() => router.push('/student/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>

          {quiz ? (
            <div className="p-6 bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl border">
              <div className="flex items-start gap-4">
                <PlayCircle className="h-10 w-10 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">{quiz.title}</h1>
                  <p className="text-muted-foreground text-lg mt-1">{quiz.description}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-muted rounded-xl">
              <h1 className="text-2xl font-semibold tracking-tight">Practice Quiz</h1>
              <p className="text-muted-foreground text-lg mt-1">
                Generated from your recent performance and class materials
              </p>
            </div>
          )}

          <div className="flex justify-center pt-8">
            <Button size="lg" onClick={loadQuiz} className="gap-2">
              <PlayCircle className="h-5 w-5" />
              Start Quiz
            </Button>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Render: Loading
  // ------------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <>
        <Head>
          <title>Generating Quiz...</title>
        </Head>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              Generating your personalized quiz
            </p>
            <p className="text-xs text-muted-foreground">
              Analyzing weak topics and crafting questions from course materials...
            </p>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Render: Error
  // ------------------------------------------------------------------
  if (phase === 'error') {
    return (
      <>
        <Head>
          <title>Quiz Error</title>
        </Head>
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <Button
            variant="ghost"
            className="pl-0 text-muted-foreground hover:bg-transparent"
            onClick={() => router.push('/student/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <Button onClick={loadQuiz}>
            <RotateCcw className="mr-2 h-4 w-4" /> Try Again
          </Button>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Render: Submitting
  // ------------------------------------------------------------------
  if (phase === 'submitting') {
    return (
      <>
        <Head>
          <title>Submitting Quiz...</title>
        </Head>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">
            Scoring your answers...
          </p>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Render: Results
  // ------------------------------------------------------------------
  if (phase === 'results' && results) {
    const { score, topicGaps, questions: resultQuestions } = results;
    const correctCount = resultQuestions.filter((q) => q.correct).length;

    return (
      <>
        <Head>
          <title>Quiz Results — {className}</title>
        </Head>
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <Button
            variant="ghost"
            className="pl-0 text-muted-foreground hover:bg-transparent"
            onClick={() => router.push('/student/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Quiz Results
            </h1>
            {className && (
              <p className="text-sm text-muted-foreground mt-1">{className}</p>
            )}
          </div>

          {/* Score Summary */}
          <Card className="border-primary/20">
            <CardContent className="py-8 flex flex-col items-center gap-2 text-center">
              <p className="text-5xl font-bold tracking-tight text-foreground">
                {correctCount} / {resultQuestions.length}
              </p>
              <p className="text-sm text-muted-foreground">
                Score: {score}%
              </p>
            </CardContent>
          </Card>

          {/* Topic Gaps */}
          {topicGaps && topicGaps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Topics to Review
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {topicGaps.map((topic, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-Question Review */}
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-foreground">
              Question Breakdown
            </h2>
            {resultQuestions.map((q, i) => (
              <Card
                key={i}
                className={cn(
                  'border-l-4',
                  q.correct
                    ? 'border-l-green-500'
                    : 'border-l-destructive'
                )}
              >
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground flex-1">
                      <span className="text-muted-foreground mr-2">
                        Q{i + 1}.
                      </span>
                      {q.question}
                    </p>
                    {q.correct ? (
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    {q.options.map((opt, optIdx) => {
                      const letter = ['A', 'B', 'C', 'D'][optIdx];
                      const isCorrectAnswer = letter === q.answer;
                      const isStudentAnswer = letter === q.studentAnswer;
                      const isWrong = isStudentAnswer && !q.correct;

                      return (
                        <div
                          key={optIdx}
                          className={cn(
                            'text-xs px-3 py-2 rounded-lg border',
                            isCorrectAnswer &&
                              'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400',
                            isWrong &&
                              'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400',
                            !isCorrectAnswer &&
                              !isWrong &&
                              'bg-muted/30 border-muted/60 text-muted-foreground'
                          )}
                        >
                          {opt}
                          {isCorrectAnswer && (
                            <span className="ml-1 font-medium"> ✓</span>
                          )}
                          {isWrong && (
                            <span className="ml-1 font-medium">
                              {' '}(your answer)
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Topic:</span> {q.topic}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Take Another Quiz */}
          <div className="flex justify-center pt-4 pb-8">
            <Button onClick={loadQuiz} size="lg">
              <RotateCcw className="mr-2 h-4 w-4" /> Take Another Quiz
            </Button>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Render: Quiz (active question)
  // ------------------------------------------------------------------
  return (
    <>
      <Head>
        <title>
          Quiz — Question {currentIndex + 1} of {questions.length}
        </title>
      </Head>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            className="pl-0 text-muted-foreground hover:bg-transparent"
            onClick={() => router.push('/student/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Exit Quiz
          </Button>
          <span className="text-sm text-muted-foreground font-medium">
            Question {currentIndex + 1} of {questions.length}
          </span>
        </div>

        {/* Progress */}
        <Progress value={progressPercent} className="h-2" />

        {/* Question Card */}
        {currentQuestion && (
          <Card>
            <CardContent className="py-6 space-y-6">
              {/* Question text */}
              <p className="text-base font-medium text-foreground leading-relaxed">
                {currentQuestion.question}
              </p>

              {/* Options */}
              <div className="space-y-3">
                {currentQuestion.options.map((option, optIdx) => {
                  const letter = ['A', 'B', 'C', 'D'][optIdx];
                  const isSelected = currentAnswer === letter;

                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => handleSelectAnswer(letter)}
                      className={cn(
                        'w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors',
                        'hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        isSelected
                          ? 'border-primary bg-primary/5 text-foreground font-medium'
                          : 'border-muted/60 text-foreground'
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              {/* Hint */}
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Show hint
                </summary>
                <p className="mt-2 text-sm text-muted-foreground bg-muted/30 px-3 py-2 rounded-lg">
                  {currentQuestion.hint}
                </p>
              </details>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentIndex === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Previous
          </Button>

          {isLastQuestion ? (
            <Button
              onClick={handleSubmit}
              disabled={!allAnswered}
            >
              Submit Quiz
            </Button>
          ) : (
            <Button
              onClick={handleNext}
              disabled={!currentAnswer}
            >
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Answer count indicator */}
        <p className="text-center text-xs text-muted-foreground">
          {Object.keys(answers).length} of {questions.length} answered
        </p>
      </div>
    </>
  );
}

export default withAuth(StudentQuiz, 'student');
