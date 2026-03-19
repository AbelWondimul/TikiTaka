import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, ArrowLeft, Clock } from 'lucide-react';

function StudentQuizHistory() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  const [classData, setClassData] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [quizTitles, setQuizTitles] = useState({});
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

        // 2. Query attempts
        const q = query(
          collection(db, 'quizAttempts'),
          where('studentId', '==', user.uid),
          where('classId', '==', classId),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const attemptsSnap = await getDocs(q);
        const attemptList = attemptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAttempts(attemptList);

        // Fetch quiz titles
        const quizIds = [...new Set(attemptList.map(a => a.quizId).filter(Boolean))];
        const titleMap = {};
        await Promise.all(quizIds.map(async (id) => {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', id));
            if (quizDoc.exists()) {
              titleMap[id] = quizDoc.data().title;
            }
          } catch (err) {
            console.error(`Error fetching quiz ${id}:`, err);
          }
        }));
        setQuizTitles(titleMap);

      } catch (err) {
        console.error("Error loading attempts:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [classId, user]);

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

  if (!isEnrolled) {
    return <div className="p-8 text-center text-muted-foreground">Not enrolled in this class</div>;
  }

  return (
    <>
      <Head>
        <title>{classData?.name ? `${classData.name} - Quiz History` : 'Quiz History'}</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push(`/student/quizzes/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Quizzes
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Quiz History</h1>
          <p className="text-sm text-muted-foreground">Review your past performance</p>
        </div>

        {attempts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-muted/10">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm font-medium">No past attempts</p>
            <p className="text-sm text-muted-foreground max-w-md">
              You haven't taken any quizzes for this class yet.
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quiz</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((attempt) => (
                    <TableRow key={attempt.id}>
                      <TableCell className="font-medium">
                        {attempt.quizId ? (quizTitles[attempt.quizId] || 'Quiz') : 'Practice Quiz'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={attempt.score >= 80 ? 'default' : 'secondary'}>
                          {attempt.score}%
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(attempt.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/student/quizzes/${classId}/${attempt.id}`}>
                            Review
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentQuizHistory, 'student');
