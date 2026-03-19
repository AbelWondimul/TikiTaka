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
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push(`/student/class/${classId}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Quizzes</h1>
            <p className="text-sm text-muted-foreground">Select a quiz to start</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => router.push(`/student/quizzes/${classId}/history`)}>
            <Clock className="h-4 w-4" /> Past Attempts
          </Button>
        </div>

        {quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-muted/10">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-1">No quizzes available</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Your teacher will create quizzes for this class soon.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((quiz) => (
              <Card key={quiz.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle>{quiz.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {quiz.description}
                  </p>
                  <Button 
                    className="w-full mt-2"
                    onClick={() => router.push(`/student/quiz/${classId}?quizId=${quiz.id}`)}
                  >
                    Start Quiz
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
