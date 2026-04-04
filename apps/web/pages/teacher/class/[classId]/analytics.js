import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Download,
  Loader2,
  ArrowLeft,
  Users,
  CheckCircle2,
  BarChart3,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

const TIME_FILTERS = [
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
  { label: 'All Time', value: null },
];

function ClassAnalytics() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  if (!router.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [classData, setClassData] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [gradingJobs, setGradingJobs] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState(null); // null = all time

  useEffect(() => {
    if (!classId || !user) return;
    fetchData();
  }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch class
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (!classDoc.exists()) {
        setIsLoading(false);
        return;
      }
      const cls = { id: classDoc.id, ...classDoc.data() };
      setClassData(cls);

      // 2. Fetch assignments for this class
      const assignQ = query(collection(db, 'assignments'), where('classId', '==', classId));
      const assignSnap = await getDocs(assignQ);
      const assignList = [];
      assignSnap.forEach(d => assignList.push({ id: d.id, ...d.data() }));
      setAssignments(assignList);

      // 3. Fetch all grading jobs for this class
      const jobsQ = query(
        collection(db, 'gradingJobs'),
        where('classId', '==', classId),
        where('teacherId', '==', user.uid)
      );
      const jobsSnap = await getDocs(jobsQ);
      const jobList = [];
      jobsSnap.forEach(d => jobList.push({ id: d.id, ...d.data() }));
      setGradingJobs(jobList);

      // 4. Fetch student profiles
      const studentIds = cls.studentIds || [];
      const profiles = {};
      await Promise.all(
        studentIds.map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
              profiles[uid] = userDoc.data();
            }
          } catch (err) {
            console.error(`Error fetching user ${uid}:`, err);
          }
        })
      );
      setStudentProfiles(profiles);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter assignments by time window
  const getFilteredAssignments = () => {
    if (!timeFilter) return assignments;
    const cutoff = Date.now() - timeFilter * 24 * 60 * 60 * 1000;
    return assignments.filter(a => {
      const t = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      return t >= cutoff;
    });
  };

  const filteredAssignments = getFilteredAssignments();
  const filteredAssignmentIds = new Set(filteredAssignments.map(a => a.id));

  // Filter grading jobs to only those matching filtered assignments
  const filteredJobs = gradingJobs.filter(j => filteredAssignmentIds.has(j.assignmentId));

  const studentIds = classData?.studentIds || [];
  const totalAssignments = filteredAssignments.length;

  // ── Top-level stats ──
  const completedJobsByStudent = {};
  filteredJobs.forEach(j => {
    if (j.status === 'complete') {
      if (!completedJobsByStudent[j.studentId]) completedJobsByStudent[j.studentId] = new Set();
      completedJobsByStudent[j.studentId].add(j.assignmentId);
    }
  });

  // Overall completion %: (total completed assignment-student pairs) / (totalAssignments * totalStudents)
  const totalPossiblePairs = totalAssignments * studentIds.length;
  const totalCompletedPairs = Object.values(completedJobsByStudent).reduce((sum, s) => sum + s.size, 0);
  const overallCompletion = totalPossiblePairs > 0 ? Math.round((totalCompletedPairs / totalPossiblePairs) * 100) : 0;

  // Average grade across all completed jobs
  const gradedJobs = filteredJobs.filter(j => j.status === 'complete' && j.score != null && j.totalPoints);
  const avgGrade = gradedJobs.length > 0
    ? Math.round(gradedJobs.reduce((sum, j) => sum + (j.score / j.totalPoints) * 100, 0) / gradedJobs.length)
    : null;

  // Active students = currently enrolled, Inactive = archived (left class)
  const activeStudentCount = studentIds.length;
  const archivedStudentIds = classData?.archivedStudents || [];
  const inactiveStudentCount = archivedStudentIds.length;

  // ── Per-student table data ──
  const studentRows = studentIds.map(uid => {
    const profile = studentProfiles[uid] || {};
    const completedSet = completedJobsByStudent[uid] || new Set();
    const completedCount = completedSet.size;
    const completionPct = totalAssignments > 0 ? Math.round((completedCount / totalAssignments) * 100) : 0;

    // Missing assignments — only count as missing if past due date and not completed
    const now = new Date();
    const missingAssignments = filteredAssignments.filter(a => {
      if (completedSet.has(a.id)) return false;
      const dueDate = a.dueDate?.toDate ? a.dueDate.toDate() : (a.dueDate ? new Date(a.dueDate) : null);
      return dueDate && dueDate < now;
    });

    // Average grade for this student
    const studentGradedJobs = filteredJobs.filter(j => j.studentId === uid && j.status === 'complete' && j.score != null && j.totalPoints);
    let studentAvgGrade = null;
    if (studentGradedJobs.length > 0) {
      studentAvgGrade = Math.round(
        studentGradedJobs.reduce((sum, j) => sum + (j.score / j.totalPoints) * 100, 0) / studentGradedJobs.length
      );
    }

    return {
      uid,
      displayName: profile.displayName || profile.email || uid,
      email: profile.email || '',
      completedCount,
      completionPct,
      missingAssignments,
      avgGrade: studentAvgGrade,
    };
  });

  // Sort by name
  studentRows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const getGradeColor = (grade) => {
    if (grade == null) return 'text-muted-foreground';
    if (grade >= 90) return 'text-green-600';
    if (grade >= 80) return 'text-blue-600';
    if (grade >= 70) return 'text-amber-600';
    return 'text-red-600';
  };

  const getCompletionColor = (pct) => {
    if (pct >= 90) return 'text-green-600';
    if (pct >= 70) return 'text-blue-600';
    if (pct >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <>
      <Head>
        <title>{classData?.name || 'Class'} Analytics - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Back button + Title */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => router.push(`/teacher/class/${classId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {classData?.name || 'Class'} — Analytics
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeStudentCount} active student{activeStudentCount !== 1 ? 's' : ''}{inactiveStudentCount > 0 ? ` · ${inactiveStudentCount} inactive` : ''} · {totalAssignments} assignment{totalAssignments !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
            {!isLoading && studentRows.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs"
                onClick={() => {
                  const headers = ['Student', 'Email', 'Completion %', 'Completed', 'Missing', 'Avg Grade'];
                  const rows = studentRows.map(s => [
                    s.displayName,
                    s.email,
                    `${s.completionPct}%`,
                    `${s.completedCount}/${totalAssignments}`,
                    s.missingAssignments.length,
                    s.avgGrade != null ? `${s.avgGrade}%` : 'N/A',
                  ]);
                  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${classData?.name || 'class'}-gradebook.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
            )}
            <div className="flex gap-1.5 bg-muted/40 p-1 rounded-xl">
              {TIME_FILTERS.map(f => (
                <button
                  key={f.label}
                  onClick={() => setTimeFilter(f.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    timeFilter === f.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ── Stats Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <Card className="rounded-2xl shadow-sm border-border/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-teal-600" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Completion Rate</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold tracking-tight text-foreground">{overallCompletion}%</span>
                    <span className="text-xs text-muted-foreground">{totalCompletedPairs}/{totalPossiblePairs} pairs</span>
                  </div>
                  <div className="mt-3 w-full bg-muted/50 h-2 rounded-full overflow-hidden">
                    <div className="bg-teal-600 h-full rounded-full transition-all" style={{ width: `${overallCompletion}%` }} />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm border-border/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Avg Grade</span>
                  </div>
                  <span className={cn('text-3xl font-extrabold tracking-tight', avgGrade != null ? getGradeColor(avgGrade) : 'text-muted-foreground')}>
                    {avgGrade != null ? `${avgGrade}%` : '--'}
                  </span>
                  {avgGrade != null && (
                    <div className="mt-3 w-full bg-muted/50 h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${avgGrade}%` }} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm border-border/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center">
                      <Users className="h-5 w-5 text-violet-600" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Students</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold tracking-tight text-foreground">{activeStudentCount}</span>
                    <span className="text-xs text-muted-foreground">active</span>
                  </div>
                  {inactiveStudentCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">{inactiveStudentCount} inactive (left class)</p>
                  )}
                  <div className="mt-3 w-full bg-muted/50 h-2 rounded-full overflow-hidden">
                    <div className="bg-violet-600 h-full rounded-full transition-all" style={{ width: `${(activeStudentCount + inactiveStudentCount) > 0 ? (activeStudentCount / (activeStudentCount + inactiveStudentCount)) * 100 : 0}%` }} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Student Table ── */}
            <div className="space-y-4">
              <h2 className="text-lg font-bold tracking-tight text-foreground">Student Breakdown</h2>

              {studentRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
                  <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No students enrolled in this class.</p>
                </div>
              ) : (
                <Card className="rounded-2xl border-border/50 overflow-hidden shadow-sm">
                  <div className="max-h-[520px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-semibold min-w-[200px]">Student</TableHead>
                          <TableHead className="font-semibold text-center min-w-[130px]">Completion</TableHead>
                          <TableHead className="font-semibold text-center min-w-[120px]">Completed</TableHead>
                          <TableHead className="font-semibold text-center min-w-[140px]">Missing</TableHead>
                          <TableHead className="font-semibold text-center min-w-[100px]">Avg Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {studentRows.map((student) => (
                          <TableRow key={student.uid} className="hover:bg-muted/20 transition-colors">
                            {/* Student */}
                            <TableCell>
                              <Link
                                href={`/teacher/class/${classId}/student/${student.uid}`}
                                className="flex items-center gap-3 group"
                              >
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <span className="text-xs font-bold text-primary">
                                    {student.displayName.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                                    {student.displayName}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">{student.email}</p>
                                </div>
                              </Link>
                            </TableCell>

                            {/* Completion % */}
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={cn('text-sm font-bold tabular-nums', getCompletionColor(student.completionPct))}>
                                  {student.completionPct}%
                                </span>
                                <div className="w-16 bg-muted/50 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all',
                                      student.completionPct >= 70 ? 'bg-green-500' : student.completionPct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${student.completionPct}%` }}
                                  />
                                </div>
                              </div>
                            </TableCell>

                            {/* Completed count */}
                            <TableCell className="text-center">
                              <span className="text-sm font-semibold tabular-nums">
                                {student.completedCount}
                              </span>
                              <span className="text-xs text-muted-foreground"> / {totalAssignments}</span>
                            </TableCell>

                            {/* Missing assignments */}
                            <TableCell className="text-center">
                              {student.missingAssignments.length === 0 ? (
                                <Badge variant="secondary" className="bg-green-50 text-green-600 border-none text-[10px] font-bold">
                                  All done
                                </Badge>
                              ) : (
                                <Link
                                  href={`/teacher/class/${classId}/student/${student.uid}`}
                                  className="inline-flex items-center gap-1.5 group/missing"
                                >
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px] font-bold cursor-pointer group-hover/missing:bg-red-700 transition-colors"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    {student.missingAssignments.length} missing
                                  </Badge>
                                </Link>
                              )}
                            </TableCell>

                            {/* Avg Grade */}
                            <TableCell className="text-center">
                              {student.avgGrade != null ? (
                                <span className={cn('text-sm font-bold tabular-nums', getGradeColor(student.avgGrade))}>
                                  {student.avgGrade}%
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default withAuth(ClassAnalytics, 'teacher');
