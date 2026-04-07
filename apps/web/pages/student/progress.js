import { useEffect, useState } from 'react';
import Head from 'next/head';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TrendingUp, CheckCircle2, BookOpen, Award, Flame, Target, ChevronDown } from 'lucide-react';
import StudentNavTabs from '@/components/layout/StudentNavTabs';

function StudentProgress() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [classGrades, setClassGrades] = useState({});
  const [totalStats, setTotalStats] = useState({ gpa: null, completed: 0, total: 0, quizAvg: null, streak: 0 });
  const [allJobs, setAllJobs] = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [expandedClassId, setExpandedClassId] = useState(null);

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Get enrolled classes
      const classesQ = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const classesSnap = await getDocs(classesQ);
      const cls = [];
      classesSnap.forEach(d => cls.push({ id: d.id, ...d.data() }));
      setClasses(cls);

      // Get all grading jobs
      const jobsQ = query(collection(db, 'gradingJobs'), where('studentId', '==', user.uid));
      const jobsSnap = await getDocs(jobsQ);
      const jobs = []; jobsSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));

      // Get all assignments
      const classIds = cls.map(c => c.id);
      let allAssignments = [];
      for (let i = 0; i < classIds.length; i += 10) {
        const batch = classIds.slice(i, i + 10);
        const assignQ = query(collection(db, 'assignments'), where('classId', 'in', batch));
        const snap = await getDocs(assignQ);
        snap.forEach(d => allAssignments.push({ id: d.id, ...d.data() }));
      }

      // Get quiz attempts
      const quizQ = query(collection(db, 'quizAttempts'), where('studentId', '==', user.uid));
      const quizSnap = await getDocs(quizQ);
      const quizzes = []; quizSnap.forEach(d => quizzes.push(d.data()));

      setAllJobs(jobs);
      setAllAssignments(allAssignments);

      // Per-class grades
      const grades = {};
      let totalEarned = 0, totalPossible = 0, totalCompleted = 0;
      cls.forEach(c => {
        const classJobs = jobs.filter(j => j.classId === c.id && j.status === 'complete' && j.score != null);
        const classAssignments = allAssignments.filter(a => a.classId === c.id);
        const earned = classJobs.reduce((s, j) => s + (j.score || 0), 0);
        const possible = classJobs.reduce((s, j) => s + (j.totalPoints || 100), 0);
        const pct = possible > 0 ? Math.round((earned / possible) * 100) : null;
        totalEarned += earned;
        totalPossible += possible;
        totalCompleted += classJobs.length;
        grades[c.id] = { earned, possible, pct, completed: classJobs.length, total: classAssignments.length };
      });
      setClassGrades(grades);

      // Quiz average
      const quizScores = quizzes.filter(q => q.score != null).map(q => q.score);
      const quizAvg = quizScores.length > 0 ? Math.round(quizScores.reduce((s, v) => s + v, 0) / quizScores.length) : null;

      // Activity streak (days with submissions)
      const dates = new Set();
      jobs.forEach(j => {
        const d = j.createdAt?.toDate ? j.createdAt.toDate() : null;
        if (d) dates.add(d.toISOString().split('T')[0]);
      });
      quizzes.forEach(q => {
        const d = q.createdAt?.toDate ? q.createdAt.toDate() : null;
        if (d) dates.add(d.toISOString().split('T')[0]);
      });
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        if (dates.has(d.toISOString().split('T')[0])) streak++;
        else if (i > 0) break;
      }

      const overallGpa = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : null;
      setTotalStats({ gpa: overallGpa, completed: totalCompleted, total: allAssignments.length, quizAvg, streak });
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const getGradeColor = (pct) => {
    if (pct == null) return 'text-muted-foreground';
    if (pct >= 90) return 'text-green-600';
    if (pct >= 80) return 'text-blue-600';
    if (pct >= 70) return 'text-amber-600';
    return 'text-red-600';
  };

  const getLetterGrade = (pct) => {
    if (pct == null) return '--';
    if (pct >= 93) return 'A';
    if (pct >= 90) return 'A-';
    if (pct >= 87) return 'B+';
    if (pct >= 83) return 'B';
    if (pct >= 80) return 'B-';
    if (pct >= 77) return 'C+';
    if (pct >= 73) return 'C';
    if (pct >= 70) return 'C-';
    if (pct >= 67) return 'D+';
    if (pct >= 60) return 'D';
    return 'F';
  };

  return (
    <>
      <Head><title>Progress - TikiTaka</title></Head>
      <Header />
      <StudentNavTabs active="progress" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Progress</h1>
          <p className="text-sm text-muted-foreground mt-1">Your performance across all classes.</p>
        </div>

        {isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <>
            {/* Top stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="p-4 text-center">
                  <Award className="h-5 w-5 mx-auto text-primary mb-1" />
                  <p className={cn('text-2xl font-extrabold', getGradeColor(totalStats.gpa))}>{totalStats.gpa != null ? `${totalStats.gpa}%` : '--'}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Overall GPA</p>
                  {totalStats.gpa != null && <Badge className="mt-1 text-[9px]">{getLetterGrade(totalStats.gpa)}</Badge>}
                </CardContent>
              </Card>
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="p-4 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto text-teal-600 mb-1" />
                  <p className="text-2xl font-extrabold">{totalStats.completed}<span className="text-sm font-normal text-muted-foreground">/{totalStats.total}</span></p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Completed</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="p-4 text-center">
                  <Target className="h-5 w-5 mx-auto text-blue-600 mb-1" />
                  <p className={cn('text-2xl font-extrabold', getGradeColor(totalStats.quizAvg))}>{totalStats.quizAvg != null ? `${totalStats.quizAvg}%` : '--'}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quiz Avg</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="p-4 text-center">
                  <Flame className="h-5 w-5 mx-auto text-orange-500 mb-1" />
                  <p className="text-2xl font-extrabold">{totalStats.streak}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Day Streak</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-class breakdown */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold tracking-tight">Class Breakdown</h2>
              {classes.length === 0 ? (
                <Card className="p-8 rounded-2xl text-center border-dashed"><p className="text-sm text-muted-foreground">No classes enrolled.</p></Card>
              ) : (
                classes.map(c => {
                  const g = classGrades[c.id] || {};
                  const completionPct = g.total > 0 ? Math.round((g.completed / g.total) * 100) : 0;
                  const isExpanded = expandedClassId === c.id;
                  const classAssigns = allAssignments.filter(a => a.classId === c.id);
                  const classJobs = allJobs.filter(j => j.classId === c.id);

                  return (
                    <Card key={c.id} className="rounded-2xl overflow-hidden">
                      <button
                        className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedClassId(isExpanded ? null : c.id)}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-sm font-bold">{c.name}</p>
                            <p className="text-[10px] text-muted-foreground">{g.completed}/{g.total} assignments completed</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className={cn('text-xl font-extrabold', getGradeColor(g.pct))}>{g.pct != null ? `${g.pct}%` : '--'}</p>
                              {g.pct != null && <Badge variant="outline" className="text-[9px]">{getLetterGrade(g.pct)}</Badge>}
                            </div>
                            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
                          </div>
                        </div>
                        <Progress value={completionPct} className="h-2" />
                      </button>

                      {isExpanded && classAssigns.length > 0 && (
                        <div className="border-t px-4 pb-4 pt-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Assignment</TableHead>
                                <TableHead className="text-xs text-right">Score</TableHead>
                                <TableHead className="text-xs text-right">Grade</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {classAssigns.map(a => {
                                const job = classJobs.find(j => j.assignmentId === a.id && j.status === 'complete' && j.score != null);
                                const pct = job ? Math.round((job.score / (job.totalPoints || a.totalPoints || 100)) * 100) : null;
                                return (
                                  <TableRow key={a.id}>
                                    <TableCell className="text-sm font-medium">{a.title}</TableCell>
                                    <TableCell className="text-sm text-right">
                                      {job ? <span className="font-semibold">{job.score}/{job.totalPoints || a.totalPoints || 100}</span> : <span className="text-muted-foreground">--</span>}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {pct != null ? (
                                        <span className={cn('text-sm font-bold', getGradeColor(pct))}>{pct}% <span className="text-xs font-normal text-muted-foreground">({getLetterGrade(pct)})</span></span>
                                      ) : (
                                        <span className="text-sm text-muted-foreground">Not graded</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
export default withAuth(StudentProgress, 'student');
