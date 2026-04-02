import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, ArrowLeft, Clock } from 'lucide-react';

function StudentQuizList() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  
  const [classData, setClassData] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolled, setIsEnrolled] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!classId || !user) return;
      try {
        setIsLoading(true);
        // 1. Enrollment check
        const classDocRef = doc(db, 'classes', classId);
        const classSnap = await getDoc(classDocRef);
        
        if (!classSnap.exists()) {
          setIsEnrolled(false);
          setIsLoading(false);
          return;
        }
        
        const cData = classSnap.data();
        if (!cData.studentIds || !cData.studentIds.includes(user.uid)) {
          setIsEnrolled(false);
          setIsLoading(false);
          return;
        }
        setClassData(cData);

        // 2. Query active quizzes
        const q = query(
          collection(db, 'quizzes'),
          where('classId', '==', classId),
          where('isActive', '==', true),
          orderBy('createdAt', 'desc')
        );
        const quizzesSnap = await getDocs(q);
        const quizList = quizzesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setQuizzes(quizList);

      } catch (err) {
        console.error("Error loading quizzes:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [classId, user]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isEnrolled) {
    return <div className="p-8 text-center text-muted-foreground">Not enrolled in this class</div>;
  }

  return (
    <>
      <Head>
        <title>{classData?.name ? `${classData.name} - Quizzes` : 'Quizzes'}</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8 min-h-screen">
        <header className="space-y-4">
          <Button 
            variant="ghost" 
            size="sm"
            className="-ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors" 
            onClick={() => router.push(`/student/class/${classId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Class Quizzes
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Select an active quiz to start your assessment.
              </p>
            </div>
            <Button 
              variant="outline" 
              className="rounded-xl gap-2 h-11 px-5 border-muted/60 hover:bg-muted/30 transition-all font-medium" 
              onClick={() => router.push(`/student/quizzes/${classId}/history`)}
            >
              <Clock className="h-4 w-4 text-primary" /> Past Attempts
            </Button>
          </div>
        </header>

        {quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 bg-muted/10 rounded-3xl border border-dashed border-muted/60 text-center animate-in fade-in duration-700">
            <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-6">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No active quizzes</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Your instructor hasn't scheduled any quizzes for this class yet. Check back later!
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((quiz, idx) => (
              <Card 
                key={quiz.id} 
                className="group relative overflow-hidden rounded-2xl border-muted/60 hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4 duration-500"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-primary/10 group-hover:bg-primary transition-colors" />
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px] uppercase tracking-wider font-bold">
                      Active
                    </Badge>
                  </div>
                  <CardTitle className="text-xl font-bold group-hover:text-primary transition-colors line-clamp-1">{quiz.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                    {quiz.description || "No description provided for this quiz."}
                  </p>
                  
                  <div className="pt-4 border-t border-muted/40 grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Time Limit</p>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-primary/70" />
                        {quiz.timeLimit ? `${quiz.timeLimit} mins` : "Unlimited"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Points</p>
                      <p className="text-sm font-medium">100 Max</p>
                    </div>
                  </div>

                  <Button 
                    className="w-full rounded-xl py-6 font-semibold shadow-md active:scale-95 transition-all"
                    onClick={() => router.push(`/student/quiz/${classId}?quizId=${quiz.id}`)}
                  >
                    Start Assessment
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentQuizList, 'student');
