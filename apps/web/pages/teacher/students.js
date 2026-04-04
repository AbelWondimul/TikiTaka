import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Search,
  MessageSquare,
  ArrowLeft,
  Users,
  GraduationCap,
} from 'lucide-react';

function TeacherStudents() {
  const { user } = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch all teacher's classes
      const classesQ = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const classesSnap = await getDocs(classesQ);
      const fetchedClasses = [];
      classesSnap.forEach(d => fetchedClasses.push({ id: d.id, ...d.data() }));
      setClasses(fetchedClasses);

      // 2. Collect all unique student UIDs across classes
      const studentClassMap = {}; // uid -> [{ classId, className }]
      fetchedClasses.forEach(c => {
        (c.studentIds || []).forEach(uid => {
          if (!studentClassMap[uid]) studentClassMap[uid] = [];
          studentClassMap[uid].push({ classId: c.id, className: c.name });
        });
      });

      const uids = Object.keys(studentClassMap);
      if (uids.length === 0) {
        setStudents([]);
        setIsLoading(false);
        return;
      }

      // 3. Fetch user profiles
      const userProfiles = {};
      await Promise.all(
        uids.map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
              userProfiles[uid] = userDoc.data();
            }
          } catch (err) {
            console.error(`Error fetching user ${uid}:`, err);
          }
        })
      );

      // 4. Fetch all grading jobs for this teacher
      const jobsQ = query(collection(db, 'gradingJobs'), where('teacherId', '==', user.uid));
      const jobsSnap = await getDocs(jobsQ);
      const allJobs = [];
      jobsSnap.forEach(d => allJobs.push({ id: d.id, ...d.data() }));

      // 5. Fetch all quiz attempts for this teacher's classes
      const classIds = fetchedClasses.map(c => c.id);
      let allQuizAttempts = [];
      // Firestore 'in' limited to 30, batch if needed
      for (let i = 0; i < classIds.length; i += 30) {
        const batch = classIds.slice(i, i + 30);
        const quizQ = query(collection(db, 'quizAttempts'), where('classId', 'in', batch));
        const quizSnap = await getDocs(quizQ);
        quizSnap.forEach(d => allQuizAttempts.push({ id: d.id, ...d.data() }));
      }

      // 6. Build student rows
      const studentRows = uids.map(uid => {
        const profile = userProfiles[uid] || {};
        const enrolledClasses = studentClassMap[uid];

        // Grade: completed grading jobs for this student
        const studentJobs = allJobs.filter(j => j.studentId === uid && j.status === 'complete' && j.score != null && j.totalPoints);
        let avgGrade = null;
        if (studentJobs.length > 0) {
          const totalPct = studentJobs.reduce((sum, j) => sum + (j.score / j.totalPoints) * 100, 0);
          avgGrade = Math.round(totalPct / studentJobs.length);
        }

        // Quiz: attempts for this student
        const studentQuizzes = allQuizAttempts.filter(q => q.studentId === uid && q.score != null);
        let avgQuiz = null;
        if (studentQuizzes.length > 0) {
          const totalScore = studentQuizzes.reduce((sum, q) => sum + (q.score || 0), 0);
          avgQuiz = Math.round(totalScore / studentQuizzes.length);
        }

        return {
          uid,
          displayName: profile.displayName || profile.email || uid,
          email: profile.email || '',
          enrolledClasses,
          avgGrade,
          avgQuiz,
          submissionCount: studentJobs.length,
          quizCount: studentQuizzes.length,
        };
      });

      // Sort alphabetically
      studentRows.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setStudents(studentRows);
    } catch (err) {
      console.error('Error fetching students data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMessageStudent = (student) => {
    // Find the first class this student belongs to, to construct the conversation route
    const firstClass = student.enrolledClasses[0];
    if (firstClass) {
      router.push(`/teacher/messages?studentId=${student.uid}&classId=${firstClass.classId}`);
    } else {
      router.push('/teacher/messages');
    }
  };

  const filteredStudents = students.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.displayName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      s.enrolledClasses.some(c => c.className.toLowerCase().includes(q))
    );
  });

  const getGradeColor = (grade) => {
    if (grade == null) return 'text-muted-foreground';
    if (grade >= 90) return 'text-green-600 dark:text-green-400';
    if (grade >= 80) return 'text-blue-600 dark:text-blue-400';
    if (grade >= 70) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <TeacherLayout activePage="students">
      <Head>
        <title>Students - TikiTaka</title>
      </Head>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Students</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {students.length} student{students.length !== 1 ? 's' : ''} across {classes.length} class{classes.length !== 1 ? 'es' : ''}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or class..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10 rounded-xl"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
            <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No students enrolled</p>
            <p className="text-sm text-muted-foreground mt-1">Students will appear here once they join your classes.</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
            <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No students match "{searchQuery}"</p>
          </div>
        ) : (
          <Card className="rounded-2xl border-border/50 overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Student</TableHead>
                  <TableHead className="font-semibold">Class(es)</TableHead>
                  <TableHead className="font-semibold text-center">Avg Grade</TableHead>
                  <TableHead className="font-semibold text-center">Avg Quiz</TableHead>
                  <TableHead className="font-semibold text-center w-[80px]">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.map((student) => (
                  <TableRow key={student.uid} className="hover:bg-muted/20 transition-colors">
                    {/* Student Name & Email */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-primary">
                            {student.displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{student.displayName}</p>
                          <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Classes */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {student.enrolledClasses.map((c) => (
                          <Link key={c.classId} href={`/teacher/class/${c.classId}`}>
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-semibold cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                            >
                              {c.className}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </TableCell>

                    {/* Avg Grade */}
                    <TableCell className="text-center">
                      {student.avgGrade != null ? (
                        <div className="flex flex-col items-center">
                          <span className={cn('text-base font-bold tabular-nums', getGradeColor(student.avgGrade))}>
                            {student.avgGrade}%
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {student.submissionCount} assignment{student.submissionCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>

                    {/* Avg Quiz */}
                    <TableCell className="text-center">
                      {student.avgQuiz != null ? (
                        <div className="flex flex-col items-center">
                          <span className={cn('text-base font-bold tabular-nums', getGradeColor(student.avgQuiz))}>
                            {student.avgQuiz}%
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {student.quizCount} quiz{student.quizCount !== 1 ? 'zes' : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>

                    {/* Message */}
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                        onClick={() => handleMessageStudent(student)}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </TeacherLayout>
  );
}

export default withAuth(TeacherStudents, 'teacher');
