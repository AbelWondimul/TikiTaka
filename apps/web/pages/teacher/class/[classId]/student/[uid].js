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
  updateDoc
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, FileText, CheckCircle, HelpCircle, Calendar, ClipboardList, Brain, ExternalLink, RotateCcw, AlertTriangle, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function StudentPerformancePage() {
  const router = useRouter();
  const { classId, uid } = router.query;
  const { user } = useAuth();

  if (!router.isReady) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [studentData, setStudentData] = useState(null);
  const [classData, setClassData] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [gradingJobs, setGradingJobs] = useState([]);
  const [quizAttempts, setQuizAttempts] = useState([]);
  const [quizTitles, setQuizTitles] = useState({});
  const [topicGapsData, setTopicGapsData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Expanded assignment view
  const [expandedAssignmentId, setExpandedAssignmentId] = useState(null);
  const [pdfUrls, setPdfUrls] = useState({}); // { jobId: { student: url, graded: url } }

  const handleRegrade = async (jobId, e) => {
    e.stopPropagation();
    try {
      const jobRef = doc(db, 'gradingJobs', jobId);
      await updateDoc(jobRef, {
        status: 'queued',
        score: null,
        feedback: null,
        resultPdfUrl: null,
        progress: 0,
        progress_text: 'Re-grading triggered...'
      });
      setGradingJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'queued', score: null } : j));
    } catch (err) {
      console.error("Failed to re-grade:", err);
    }
  };

  const loadPdfUrls = async (job) => {
    if (pdfUrls[job.id]) return;
    const urls = {};
    try {
      if (job.rawPdfUrl) {
        urls.student = await getDownloadURL(ref(storage, job.rawPdfUrl));
      }
      if (job.resultPdfUrl) {
        urls.graded = await getDownloadURL(ref(storage, job.resultPdfUrl));
      }
    } catch (err) {
      console.error('Error loading PDF URLs:', err);
    }
    setPdfUrls(prev => ({ ...prev, [job.id]: urls }));
  };

  useEffect(() => {
    async function loadData() {
      if (!classId || !uid || !user) return;

      try {
        setIsLoading(true);
        setError(null);

        // 1. Fetch Student & Class
        const [studentSnap, classSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          getDoc(doc(db, 'classes', classId))
        ]);

        if (!studentSnap.exists()) {
          setError("Student not found.");
          setIsLoading(false);
          return;
        }
        setStudentData(studentSnap.data());

        if (classSnap.exists()) {
          setClassData(classSnap.data());
        }

        // 2. Fetch assignments for this class
        const assignQ = query(collection(db, 'assignments'), where('classId', '==', classId));
        const assignSnap = await getDocs(assignQ);
        const assignList = [];
        assignSnap.forEach(d => assignList.push({ id: d.id, ...d.data() }));
        assignList.sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return tB - tA;
        });
        setAssignments(assignList);

        // 3. Fetch grading jobs for this student in this class
        const jobsQuery = query(
          collection(db, 'gradingJobs'),
          where('classId', '==', classId),
          where('studentId', '==', uid),
          where('teacherId', '==', user.uid)
        );
        const jobsSnap = await getDocs(jobsQuery);
        const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        jobs.sort((a, b) => (b.completedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));
        setGradingJobs(jobs);

        // 4. Fetch quiz attempts
        const quizQuery = query(
          collection(db, 'quizAttempts'),
          where('classId', '==', classId),
          where('studentId', '==', uid)
        );
        const quizSnap = await getDocs(quizQuery);
        const quizzes = quizSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        quizzes.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setQuizAttempts(quizzes);

        // 5. Fetch quiz titles
        const quizIds = [...new Set(quizzes.map(q => q.quizId).filter(Boolean))];
        const titles = {};
        await Promise.all(quizIds.map(async (qid) => {
          try {
            const qDoc = await getDoc(doc(db, 'quizzes', qid));
            if (qDoc.exists()) titles[qid] = qDoc.data().title;
          } catch (_) {}
        }));
        setQuizTitles(titles);

        // 6. Aggregate Topic Gaps
        const gapCounts = {};
        quizzes.forEach(q => {
          if (q.topicGaps) {
            q.topicGaps.forEach(topic => {
              gapCounts[topic] = (gapCounts[topic] || 0) + 1;
            });
          }
        });
        setTopicGapsData(
          Object.entries(gapCounts).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count)
        );

      } catch (err) {
        console.error("Error loading student data:", err);
        setError("Failed to load details.");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [classId, uid, user]);

  // Compute stats
  const completedJobs = gradingJobs.filter(j => j.status === 'complete' && j.score != null);
  const avgGrade = completedJobs.length > 0
    ? Math.round(completedJobs.reduce((s, j) => s + ((j.score / (j.totalPoints || 100)) * 100), 0) / completedJobs.length)
    : null;
  const avgQuiz = quizAttempts.length > 0
    ? Math.round(quizAttempts.reduce((s, q) => s + (q.score || 0), 0) / quizAttempts.length)
    : null;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !studentData) {
    return (
      <>
        <Header />
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Button variant="ghost" className="mb-6 -ml-4" onClick={() => router.push(`/teacher/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          <Card className="border-destructive">
            <CardHeader><CardTitle className="text-destructive">Error</CardTitle></CardHeader>
            <CardContent><p>{error || "Failed to load student details."}</p></CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{studentData.displayName} - TikiTaka</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Navigation */}
        <div className="flex items-center gap-3 -ml-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {classData?.name || 'Class'}
          </Button>
        </div>

        {/* Student Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="text-xl font-bold text-primary">{studentData.displayName?.charAt(0)?.toUpperCase() || '?'}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{studentData.displayName}</h1>
              <p className="text-sm text-muted-foreground">{studentData.email}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="text-center px-4 py-2 bg-muted/30 rounded-xl border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg Grade</p>
              <p className={cn('text-lg font-bold', avgGrade != null ? (avgGrade >= 80 ? 'text-green-600' : avgGrade >= 60 ? 'text-amber-600' : 'text-red-600') : 'text-muted-foreground')}>
                {avgGrade != null ? `${avgGrade}%` : '--'}
              </p>
            </div>
            <div className="text-center px-4 py-2 bg-muted/30 rounded-xl border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg Quiz</p>
              <p className={cn('text-lg font-bold', avgQuiz != null ? (avgQuiz >= 80 ? 'text-green-600' : avgQuiz >= 60 ? 'text-amber-600' : 'text-red-600') : 'text-muted-foreground')}>
                {avgQuiz != null ? `${avgQuiz}%` : '--'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ── Assignments (3/5) ── */}
          <div className="lg:col-span-3 space-y-5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold tracking-tight">Assignments</h2>
              <Badge variant="outline" className="ml-auto font-normal text-muted-foreground">
                {completedJobs.length}/{assignments.length} completed
              </Badge>
            </div>

            {assignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed rounded-2xl bg-muted/5 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No assignments for this class</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignments.map((assignment) => {
                  const job = gradingJobs.find(j => j.assignmentId === assignment.id);
                  const isGraded = job?.status === 'complete' && job?.score != null;
                  const isPending = job && !isGraded;
                  const isMissing = !job;
                  const isExpanded = expandedAssignmentId === assignment.id;
                  const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : (assignment.dueDate ? new Date(assignment.dueDate) : null);
                  const isOverdue = dueDate && dueDate < new Date() && isMissing;

                  return (
                    <Card
                      key={assignment.id}
                      className={cn(
                        'rounded-2xl transition-all overflow-hidden',
                        isGraded ? 'border-green-200/60 bg-green-50/30 dark:border-green-800/30 dark:bg-green-950/10' :
                        isOverdue ? 'border-red-200/50 bg-red-50/20 dark:border-red-800/30 dark:bg-red-950/10' :
                        'border-border/50'
                      )}
                    >
                      <div
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/20 transition-colors"
                        onClick={() => {
                          const next = isExpanded ? null : assignment.id;
                          setExpandedAssignmentId(next);
                          if (next && job) loadPdfUrls(job);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold truncate">{assignment.title}</p>
                            {isGraded && (
                              <Badge className="bg-green-500/10 text-green-600 border-none text-[10px] font-bold h-5">
                                <CheckCircle className="h-3 w-3 mr-1" /> Graded
                              </Badge>
                            )}
                            {isPending && (
                              <Badge className="bg-amber-500/10 text-amber-600 border-none text-[10px] font-bold h-5">
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> {job.status}
                              </Badge>
                            )}
                            {isMissing && (
                              <Badge variant={isOverdue ? 'destructive' : 'secondary'} className="text-[10px] font-bold h-5">
                                {isOverdue ? <><AlertTriangle className="h-3 w-3 mr-1" /> Missing</> : 'Not submitted'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {dueDate && (
                              <span>Due: {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            )}
                            <span>{assignment.totalPoints || 100} pts</span>
                            {isGraded && (
                              <span className="font-bold text-green-600 dark:text-green-400">
                                Score: {job.score}/{job.totalPoints || assignment.totalPoints || 100}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          {isGraded && job.status === 'disputed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs rounded-lg border-amber-300 text-amber-700 hover:bg-amber-50"
                              onClick={(e) => handleRegrade(job.id, e)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" /> Re-grade
                            </Button>
                          )}
                          {isGraded && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs rounded-lg"
                              onClick={(e) => { e.stopPropagation(); router.push(`/teacher/homework/${assignment.id}/submissions/${job.id}`); }}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Review
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expanded: Show student PDF + graded PDF side by side */}
                      {isExpanded && job && (
                        <div className="border-t bg-muted/5 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                          {isGraded && job.gradedQuestions && (
                            <div className="space-y-2">
                              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Question Breakdown</p>
                              <div className="grid gap-1.5">
                                {job.gradedQuestions.map((q, idx) => (
                                  <div key={idx} className={cn(
                                    'flex items-center justify-between px-3 py-2 rounded-lg text-sm',
                                    q.pointsEarned === q.pointsPossible ? 'bg-green-50/50 dark:bg-green-950/20' : 'bg-amber-50/50 dark:bg-amber-950/20'
                                  )}>
                                    <span className="font-medium">{q.questionNumber}</span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">{q.feedback}</span>
                                      <span className={cn('font-bold text-xs', q.pointsEarned === q.pointsPossible ? 'text-green-600' : 'text-amber-600')}>
                                        {q.pointsEarned}/{q.pointsPossible}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Student's original submission */}
                            <div className="space-y-2">
                              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Student Submission</p>
                              {pdfUrls[job.id]?.student ? (
                                <div className="border rounded-xl overflow-hidden h-[350px] bg-muted/20">
                                  <iframe src={`${pdfUrls[job.id].student}#toolbar=0`} width="100%" height="100%" className="border-0" title="Student PDF" />
                                </div>
                              ) : (
                                <div className="border rounded-xl h-[100px] flex items-center justify-center bg-muted/10">
                                  <p className="text-xs text-muted-foreground">No student PDF available</p>
                                </div>
                              )}
                            </div>

                            {/* AI graded result */}
                            <div className="space-y-2">
                              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">AI Graded Result</p>
                              {pdfUrls[job.id]?.graded ? (
                                <div className="border rounded-xl overflow-hidden h-[350px] bg-muted/20">
                                  <iframe src={`${pdfUrls[job.id].graded}#toolbar=0`} width="100%" height="100%" className="border-0" title="Graded PDF" />
                                </div>
                              ) : (
                                <div className="border rounded-xl h-[100px] flex items-center justify-center bg-muted/10">
                                  <p className="text-xs text-muted-foreground">No graded PDF available</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-xs"
                              onClick={(e) => handleRegrade(job.id, e)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Re-grade
                            </Button>
                            <Button
                              size="sm"
                              className="rounded-lg text-xs"
                              onClick={() => router.push(`/teacher/homework/${assignment.id}/submissions/${job.id}`)}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Full Review
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Quiz Attempts (2/5) ── */}
          <div className="lg:col-span-2 space-y-5">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold tracking-tight">Quiz Attempts</h2>
              <Badge variant="outline" className="ml-auto font-normal text-muted-foreground">
                {quizAttempts.length} total
              </Badge>
            </div>

            {quizAttempts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed rounded-2xl bg-muted/5 text-center">
                <Brain className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No quizzes taken</p>
              </div>
            ) : (
              <div className="space-y-3">
                {quizAttempts.map((attempt, idx) => {
                  const title = attempt.quizId ? (quizTitles[attempt.quizId] || 'Quiz') : 'Practice Quiz';
                  const attemptCode = attempt.id.slice(-6).toUpperCase();
                  const scoreColor = attempt.score >= 80 ? 'text-green-600' : attempt.score >= 60 ? 'text-amber-600' : 'text-red-600';

                  return (
                    <Card
                      key={attempt.id}
                      className="rounded-2xl border-border/50 hover:border-primary/30 transition-colors cursor-pointer group"
                      onClick={() => {
                        if (attempt.quizId) {
                          router.push(`/teacher/class/${classId}/quiz/${attempt.quizId}`);
                        }
                      }}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold group-hover:text-primary transition-colors truncate">{title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 text-muted-foreground">
                                #{attemptCode}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground">
                                {attempt.createdAt?.toDate ? attempt.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                              </span>
                            </div>
                          </div>
                          <span className={cn('text-lg font-bold tabular-nums', scoreColor)}>
                            {attempt.score != null ? `${attempt.score}%` : '--'}
                          </span>
                        </div>

                        {attempt.topicGaps && attempt.topicGaps.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {attempt.topicGaps.map((gap, gIdx) => (
                              <Badge key={gIdx} variant="outline" className="text-[9px] px-1.5 py-0 bg-muted/30 text-muted-foreground">
                                {gap}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {attempt.quizId && (
                          <p className="text-[10px] text-primary/60 mt-2 group-hover:text-primary transition-colors">
                            Click to view full quiz analytics →
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Topic Gap Map */}
            {topicGapsData.length > 0 && (
              <Card className="rounded-2xl border-border/50 mt-6">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center text-sm font-bold">
                    <HelpCircle className="w-4 h-4 mr-2 text-primary" />
                    Topic Gaps
                  </CardTitle>
                  <CardDescription className="text-xs">Areas flagged for improvement</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topicGapsData} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="topic" tick={{ fontSize: 11 }} width={75} />
                        <Tooltip contentStyle={{ fontSize: '11px' }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentPerformancePage, 'teacher');
