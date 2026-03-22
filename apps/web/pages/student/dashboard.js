import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  doc, 
  updateDoc, 
  arrayUnion,
  orderBy,
  limit,
  serverTimestamp
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { getClassByCode } from '@/lib/classUtils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2, BookOpen, UserPlus, Brain, Clock, Trophy } from 'lucide-react';

const joinFormSchema = z.object({
  classCode: z.string().length(6, { message: "Class code must be exactly 6 characters." }).toUpperCase(),
});

function StudentDashboard() {
  const { user } = useAuth();
  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Join Class State
  const [joinError, setJoinError] = useState(null);
  const [joinSuccess, setJoinSuccess] = useState(null);

  // Quiz History State
  const [quizHistory, setQuizHistory] = useState([]);
  const [isQuizHistoryLoading, setIsQuizHistoryLoading] = useState(true);

  const joinForm = useForm({
    resolver: zodResolver(joinFormSchema),
    defaultValues: { classCode: "" },
  });

  const fetchEnrolledClasses = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const q = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const querySnapshot = await getDocs(q);
      
      const classPromises = querySnapshot.docs.map(async (classDoc) => {
        const classData = { id: classDoc.id, ...classDoc.data() };
        if (classData.teacherId) {
          try {
            const teacherDoc = await getDoc(doc(db, 'users', classData.teacherId));
            if (teacherDoc.exists()) {
              classData.teacherName = teacherDoc.data().displayName;
            }
          } catch (err) {
            console.error(`Error fetching teacher for class ${classDoc.id}:`, err);
          }
        }
        return classData;
      });

      const fetchedClasses = await Promise.all(classPromises);
      setEnrolledClasses(fetchedClasses);
    } catch (error) {
      console.error("Error fetching enrolled classes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchQuizHistory = async () => {
    if (!user) return;
    try {
      setIsQuizHistoryLoading(true);
      // Simple query: get student's quiz attempts, sort in memory to avoid composite index issues
      const q = query(
        collection(db, 'quizAttempts'),
        where('studentId', '==', user.uid),
      );
      const querySnapshot = await getDocs(q);
      const attempts = [];
      querySnapshot.forEach((docSnap) => {
        attempts.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Sort by createdAt descending in memory, take last 5
      attempts.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return dateB - dateA;
      });
      setQuizHistory(attempts.slice(0, 5));
    } catch (error) {
      console.error("Error fetching quiz history:", error);
    } finally {
      setIsQuizHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrolledClasses();
    fetchQuizHistory();
  }, [user]);

  async function onJoinSubmit(values) {
    if (!user) return;
    setJoinError(null);
    setJoinSuccess(null);

    try {
      const classData = await getClassByCode(values.classCode);
      if (!classData) {
        setJoinError("Class not found. Please check the code and try again.");
        return;
      }
      if (classData.studentIds && classData.studentIds.includes(user.uid)) {
        setJoinError("You are already enrolled in this class.");
        return;
      }

      await updateDoc(doc(db, 'classes', classData.id), {
        studentIds: arrayUnion(user.uid)
      });
      
      joinForm.reset();
      setJoinSuccess(`Successfully joined ${classData.name}!`);
      fetchEnrolledClasses();
      
      setTimeout(() => setJoinSuccess(null), 5000);
    } catch (error) {
      console.error("Error joining class:", error);
      setJoinError("An error occurred while joining the class. Please try again.");
    }
  }

  // Helper to find class name for a quiz attempt
  const getClassName = (classId) => {
    const found = enrolledClasses.find((c) => c.id === classId);
    return found ? found.name : 'Unknown Class';
  };

  return (
    <>
      <Head>
        <title>Student Dashboard - Automated PDF Grading Engine</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Student Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Join classes, submit assignments, and take adaptive quizzes.
          </p>
        </div>

        {/* My Classes Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">My Registered Classes</h2>
          
          {isLoading && enrolledClasses.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse bg-muted/50 h-32" />
              ))}
            </div>
          ) : enrolledClasses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-xl bg-muted/10">
              <BookOpen className="h-10 w-10 text-muted-foreground opacity-40 mb-3" />
              <p className="text-sm font-medium text-foreground">No classes yet</p>
              <p className="text-xs text-muted-foreground mt-1">Join a class using the form below to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {enrolledClasses.map((c) => (
                <Card key={c.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{c.name}</CardTitle>
                    <CardDescription>
                      {c.studentIds?.length || 0} students enrolled
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                      <Button asChild variant="outline" className="flex-1">
                        <Link href={`/student/quizzes/${c.id}`}>
                          View Quizzes
                        </Link>
                      </Button>
                      <Button asChild className="flex-1">
                        <Link href={`/student/class/${c.id}`}>
                          View Assignments
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Join Class Section */}
          <Card className="lg:col-span-1 border-primary/20 bg-primary/5 h-fit">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <UserPlus className="w-5 h-5 mr-2 text-primary" />
                Join a Class
              </CardTitle>
              <CardDescription>
                Enter the 6-character code from your teacher.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...joinForm}>
                <form onSubmit={joinForm.handleSubmit(onJoinSubmit)} className="space-y-4">
                  <FormField
                    control={joinForm.control}
                    name="classCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Class Code</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g. A1B2C3" 
                            className="font-mono uppercase"
                            maxLength={6}
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {joinError && <Alert variant="destructive" className="py-2 px-3"><AlertDescription className="text-xs">{joinError}</AlertDescription></Alert>}
                  {joinSuccess && <Alert className="py-2 px-3 bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"><AlertDescription className="text-xs">{joinSuccess}</AlertDescription></Alert>}

                  <Button type="submit" className="w-full" disabled={joinForm.formState.isSubmitting}>
                    {joinForm.formState.isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Joining...</> : "Join Class"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Quiz History Section */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <Trophy className="w-5 h-5 mr-2 text-primary" />
                Quiz History
              </CardTitle>
              <CardDescription>
                Your recent adaptive quiz attempts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isQuizHistoryLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : quizHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Brain className="h-10 w-10 text-muted-foreground opacity-40 mb-3" />
                  <p className="text-sm font-medium text-foreground">No quizzes taken yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Start a quiz from one of your enrolled classes above.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {quizHistory.map((attempt) => (
                    <Link
                      key={attempt.id}
                      href={`/student/quizzes/${attempt.classId}/${attempt.id}`}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-muted/60 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-foreground">
                          {getClassName(attempt.classId)}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {attempt.createdAt?.toDate
                            ? attempt.createdAt.toDate().toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : 'N/A'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {attempt.topicGaps && attempt.topicGaps.length > 0 && (
                          <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                            {attempt.topicGaps.length} topic{attempt.topicGaps.length !== 1 ? 's' : ''} to review
                          </Badge>
                        )}
                        <span
                          className={cn(
                            'text-sm font-bold tabular-nums',
                            attempt.score >= 70
                              ? 'text-green-600 dark:text-green-400'
                              : attempt.score >= 40
                                ? 'text-yellow-600 dark:text-yellow-400'
                                : 'text-destructive'
                          )}
                        >
                          {attempt.score}%
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentDashboard, 'student');
