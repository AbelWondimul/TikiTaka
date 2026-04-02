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
  Menu,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet';

function StudentQuiz() {
  const router = useRouter();
  const { classId, quizId } = router.query;
  const { user } = useAuth();

  // Don't render until router params are available (required for static export)
  if (!router.isReady) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
  
  // Calculate stroke dasharray/offset for circular progress
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  return (
    <div className="font-['Inter'] text-slate-900 bg-[#F9FAFB] min-h-[max(884px,100dvh)]">
      <Head>
        <title>Quiz Interface - TikiTaka</title>
      </Head>

      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-md shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 w-full max-w-none">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <button className="text-teal-800 hover:opacity-80 transition-opacity">
                  <Menu className="w-6 h-6" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] p-0 border-r-0">
                <div className="flex flex-col h-full bg-surface">
                  <div className="px-6 py-8 border-b border-slate-100">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="h-10 w-10 bg-[#0f766e] rounded-lg flex items-center justify-center text-white font-bold text-xl">
                        T
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-teal-800 leading-none">Main Menu</h2>
                        <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mt-1">Navigation</p>
                      </div>
                    </div>
                  </div>
                  <nav className="flex-1 py-6 px-4 space-y-2 overflow-y-auto">
                    {[
                      { name: 'Overview', icon: 'dashboard' },
                      { name: 'Classes', icon: 'school' },
                      { name: 'Quizzes', icon: 'quiz' },
                      { name: 'Submissions', icon: 'assignment' },
                      { name: 'Students', icon: 'group' },
                    ].map((item, idx) => (
                      <a key={idx} href="#" className="flex items-center space-x-4 px-4 py-3 text-slate-600 font-medium hover:bg-slate-100 hover:text-teal-700 rounded-xl transition-all duration-200">
                        <span className="material-symbols-outlined">{item.icon}</span>
                        <span className="text-sm tracking-normal">{item.name}</span>
                      </a>
                    ))}
                    
                    <div className="my-4 border-t border-slate-100"></div>

                    <a href="#" className="flex items-center space-x-4 px-4 py-3 text-slate-600 font-medium hover:bg-slate-100 hover:text-teal-700 rounded-xl transition-all duration-200">
                      <span className="material-symbols-outlined">settings</span>
                      <span className="text-sm tracking-normal">Settings</span>
                    </a>
                  </nav>
                </div>
              </SheetContent>
            </Sheet>

            <h1 className="font-['Inter'] font-bold tracking-tight text-2xl font-extrabold tracking-[-1.5px] select-none cursor-pointer" onClick={() => router.push('/student/dashboard')}>
              <span className="text-slate-900">Tiki</span><span className="text-[#0F766E]">Taka</span>
            </h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 overflow-hidden">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-slate-500">person</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="pt-24 pb-32 px-4 max-w-[640px] mx-auto min-h-screen flex flex-col gap-6">
        
        {/* QUIZ CONTEXT CARD */}
        <section className="bg-white p-5 rounded-xl flex items-center justify-between shadow-[0_4px_16px_rgba(17,24,39,0.04)]">
          <div className="flex flex-col">
            <span className="font-label text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mb-1">Current Course</span>
            <h2 className="text-slate-900 font-headline font-bold text-[16px]">{className || 'Practice Quiz'}</h2>
          </div>
          <div className="relative flex items-center justify-center">
            {/* Circular Progress Indicator */}
            <svg className="w-12 h-12 transform -rotate-90">
              <circle className="text-slate-100" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" strokeWidth="4"></circle>
              <circle className="text-[#0f766e] transition-all duration-500 ease-out" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeWidth="4"></circle>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-slate-900">{currentIndex + 1}/{questions.length}</span>
            </div>
          </div>
        </section>

        {/* QUESTION CARD */}
        {currentQuestion && (
          <section className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)]">
            <div className="mb-8">
              <span className="font-label text-[11px] font-bold uppercase tracking-[0.8px] text-[#005c55] mb-2 block">
                Question {String(currentIndex + 1).padStart(2, '0')}
              </span>
              <h3 className="text-slate-900 font-headline font-bold text-[20px] leading-tight tracking-[-0.5px]">
                {currentQuestion.question}
              </h3>
            </div>
            
            {/* Options (8px radius, 44px height rows) */}
            <div className="flex flex-col gap-3">
              {currentQuestion.options.map((option, optIdx) => {
                const letter = ['A', 'B', 'C', 'D'][optIdx];
                const isSelected = currentAnswer === letter;

                if (isSelected) {
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className="flex items-center gap-4 min-h-[44px] py-2 px-4 rounded-lg bg-teal-50 border border-[#0f766e]/20 text-slate-900 w-full text-left transition-all active:scale-[0.98]"
                    >
                      <div className="w-6 h-6 rounded-full bg-[#0f766e] shrink-0 flex items-center justify-center text-white text-[12px] font-bold">{letter}</div>
                      <span className="text-[14px] font-semibold leading-snug">{option}</span>
                      <span className="material-symbols-outlined ml-auto text-[#0f766e] text-[20px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    </button>
                  );
                }

                return (
                  <button
                    key={optIdx}
                    type="button"
                    onClick={() => handleSelectAnswer(letter)}
                    className="flex items-center gap-4 min-h-[44px] py-2 px-4 rounded-lg bg-slate-50 border border-transparent text-slate-900 w-full text-left transition-all hover:bg-slate-100 active:scale-[0.98]"
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-200 shrink-0 flex items-center justify-center text-slate-600 text-[12px] font-bold">{letter}</div>
                    <span className="text-[14px] font-medium leading-snug">{option}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Contextual Hint / Info */}
        {currentQuestion && currentQuestion.hint && (
          <div className="bg-[#f3f4f5] p-4 rounded-xl flex items-start gap-3">
            <span className="material-symbols-outlined text-slate-400 text-[20px] shrink-0">lightbulb</span>
            <p className="text-[13px] text-[#3e4947] italic">
              {currentQuestion.hint}
            </p>
          </div>
        )}
      </main>

      {/* BottomNavBar */}
      <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-white shadow-[0_-4px_16px_rgba(17,24,39,0.04)] z-50">
        
        {/* Previous Button */}
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className={cn(
            "flex flex-col items-center justify-center px-8 py-2 active:scale-98 transition-all font-['Inter'] text-[11px] font-bold uppercase tracking-[0.8px]",
            currentIndex === 0 ? "text-slate-300 cursor-not-allowed opacity-50" : "text-slate-400 hover:text-slate-600"
          )}
        >
          <span className="material-symbols-outlined mb-1">arrow_back</span>
          Previous
        </button>
        
        {/* Next/Submit Button */}
        {isLastQuestion ? (
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className={cn(
              "flex flex-col items-center justify-center bg-[#0f766e] text-white rounded-xl px-12 py-2 active:scale-98 transition-all font-['Inter'] text-[11px] font-bold uppercase tracking-[0.8px] shadow-lg shadow-teal-900/10",
              !allAnswered && "opacity-50 cursor-not-allowed"
            )}
          >
            <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            Submit
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={!currentAnswer}
            className={cn(
               "flex flex-col items-center justify-center bg-[#0f766e] text-white rounded-xl px-12 py-2 active:scale-98 transition-all font-['Inter'] text-[11px] font-bold uppercase tracking-[0.8px] shadow-lg shadow-teal-900/10",
               !currentAnswer && "opacity-50 cursor-not-allowed"
            )}
          >
            <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_forward</span>
            Next
          </button>
        )}
      </nav>
    </div>
  );
}

export default withAuth(StudentQuiz, 'student');
