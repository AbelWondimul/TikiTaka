import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

function StudentQuizReview() {
  const router = useRouter();
  const { classId, attemptId } = router.query;
  const { user } = useAuth();

  const [attempt, setAttempt] = useState(null);
  const [quizTitle, setQuizTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadAttempt() {
      if (!attemptId || !user) return;
      try {
        setIsLoading(true);
        const attemptRef = doc(db, 'quizAttempts', attemptId);
        const attemptSnap = await getDoc(attemptRef);

        if (!attemptSnap.exists()) {
          setErrorMessage('Quiz attempt not found.');
          setIsLoading(false);
          return;
        }

        const data = attemptSnap.data();
        if (data.studentId !== user.uid) {
          setErrorMessage('You do not have permission to view this attempt.');
          setIsLoading(false);
          return;
        }

        setAttempt({ id: attemptSnap.id, ...data });

        // Fetch quiz title
        if (data.quizId) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', data.quizId));
            if (quizDoc.exists()) {
              setQuizTitle(quizDoc.data().title);
            }
          } catch (err) {
            console.error('Error fetching quiz title:', err);
          }
        }
      } catch (err) {
        console.error("Error loading attempt:", err);
        setErrorMessage('Failed to load quiz attempt.');
      } finally {
        setIsLoading(false);
      }
    }
    loadAttempt();
  }, [attemptId, user]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push(`/student/quizzes/${classId}/history`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to History
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{quizTitle ? `${quizTitle} Review` : 'Quiz Review'}</title>
      </Head>
      <Header />
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push(`/student/quizzes/${classId}/history`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to History
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {quizTitle ? `${quizTitle} Review` : 'Quiz Review'}
          </h1>
          <p className="text-sm text-muted-foreground">Detailed breakdown of your answers</p>
        </div>

        {/* Score Header */}
        <Card className="border-primary/20">
          <CardContent className="py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-5xl font-bold tracking-tight text-foreground">
                {attempt.score}%
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {attempt.questions?.length || 0} questions
              </p>
            </div>
            <Badge variant={attempt.score >= 80 ? 'default' : 'secondary'} className="text-sm px-3 py-1">
               {formatDate(attempt.createdAt)}
            </Badge>
          </CardContent>
        </Card>

        {/* Question Review List */}
        <div className="space-y-4">
          {attempt.questions?.map((q, i) => {
            const isCorrect = q.studentAnswer === q.answer;

            return (
              <Card 
                key={i} 
                className={cn(
                  'border-l-4',
                  isCorrect ? 'border-l-green-500' : 'border-l-destructive'
                )}
              >
                <CardContent className="py-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground flex-1 leading-relaxed">
                      <span className="text-muted-foreground mr-1.5 font-normal">Q{i + 1}.</span>
                      {q.question}
                    </p>
                    {isCorrect ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    {q.options?.map((opt, j) => {
                      const letter = String.fromCharCode(65 + j); // 'A', 'B', etc.
                      const isStudent = q.studentAnswer === letter;
                      const isCorrectOption = q.answer === letter;

                      let variant = 'outline';
                      if (isStudent && isCorrectOption) variant = 'default';
                      else if (isStudent && !isCorrectOption) variant = 'destructive';
                      else if (isCorrectOption) variant = 'secondary';

                      return (
                        <Badge 
                          key={j}
                          variant={variant}
                          className="justify-start py-2 px-3 text-xs font-normal h-auto text-left"
                        >
                          <span className="font-semibold mr-1.5">{letter}.</span>
                          {opt}
                        </Badge>
                      );
                    })}
                  </div>

                  {!isCorrect && (
                    <Alert variant="destructive" className="py-2 px-3">
                      <AlertTitle className="text-xs font-medium">Incorrect</AlertTitle>
                      <AlertDescription className="text-xs mt-1">
                        Correct: <span className="font-semibold">{q.answer})</span> {q.options && q.options[q.answer.charCodeAt(0) - 65]}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="text-xs text-muted-foreground pt-1 border-t border-dashed">
                    Hint: {q.hint} | Topic: {q.topic}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentQuizReview, 'student');
