import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, ArrowLeft, FileText, CheckCircle, HelpCircle, ArrowUpDown, Download } from 'lucide-react';

function AssignmentSubmissionsPage() {
  const router = useRouter();
  const { homeworkId } = router.query;
  const { user } = useAuth();

  // Don't render until router params are available (required for static export)
  if (!router.isReady) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [assignment, setAssignment] = useState(null);
  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sort state
  const [sortOrder, setSortOrder] = useState('asc');

  // Inline grade editing state
  const [editingGradeId, setEditingGradeId] = useState(null);
  const [editGradeValue, setEditGradeValue] = useState('');

  // Fill grades dialog state
  const [isFillGradesOpen, setIsFillGradesOpen] = useState(false);
  const [fillGradeValue, setFillGradeValue] = useState('');
  const [fillOverwrite, setFillOverwrite] = useState(false);
  const [isFilling, setIsFilling] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!homeworkId || !user) return;

      try {
        setIsLoading(true);
        setError(null);

        // 1. Fetch Assignment
        const assignmentSnap = await getDoc(doc(db, 'assignments', homeworkId));
        if (!assignmentSnap.exists()) {
          setError("Assignment not found.");
          setIsLoading(false);
          return;
        }
        const assignmentData = { id: assignmentSnap.id, ...assignmentSnap.data() };
        setAssignment(assignmentData);

        const classId = assignmentData.classId;
        if (!classId) {
             setError("Invalid assignment data (missing classId).");
             setIsLoading(false);
             return;
        }

        // 2. Fetch Class for Roster
        const classSnap = await getDoc(doc(db, 'classes', classId));
        let cData = null;
        if (classSnap.exists()) {
          cData = classSnap.data();
          setClassData(cData);

          // 3. Fetch Students
          if (cData.studentIds && cData.studentIds.length > 0) {
            const studentsPromises = cData.studentIds.map(async (uid) => {
              const userDoc = await getDoc(doc(db, 'users', uid));
              if (userDoc.exists()) {
                return { uid: userDoc.id, ...userDoc.data() };
              }
              return { uid, displayName: 'Unknown Student', email: 'N/A' };
            });
            const studentsList = await Promise.all(studentsPromises);
            setStudents(studentsList);
          }
        }

        // 4. Fetch Submissions (Grading Jobs)
        const isTA = cData && (cData.taIds || []).includes(user.uid);
        const jobsQuery = isTA
          ? query(collection(db, 'gradingJobs'), where('assignmentId', '==', homeworkId), where('classId', '==', classId))
          : query(collection(db, 'gradingJobs'), where('assignmentId', '==', homeworkId), where('classId', '==', classId), where('teacherId', '==', user.uid));
        const jobsSnap = await getDocs(jobsQuery);
        const jobsList = jobsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSubmissions(jobsList);

      } catch (err) {
        console.error("Error loading submissions:", err);
        setError("Failed to load submission data.");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [homeworkId, user]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || "Failed to load assignment details."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sort students by last name
  const sortedStudents = [...students].sort((a, b) => {
    const lastA = (a.displayName || '').trim().split(' ').pop().toLowerCase();
    const lastB = (b.displayName || '').trim().split(' ').pop().toLowerCase();
    return sortOrder === 'asc' ? lastA.localeCompare(lastB) : lastB.localeCompare(lastA);
  });

  const getSubmissionForStudent = (studentId) => {
    return submissions.find(s => s.studentId === studentId);
  };

  // Inline grade edit handler
  const handleGradeEdit = async (submissionId, newScore) => {
    const parsed = Number(newScore);
    if (isNaN(parsed)) { setEditingGradeId(null); return; }
    try {
      await updateDoc(doc(db, 'gradingJobs', submissionId), { score: parsed });
      setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, score: parsed } : s));
    } catch (err) {
      console.error('Error updating grade:', err);
    }
    setEditingGradeId(null);
  };

  // Fill grades handler
  const handleFillGrades = async () => {
    const score = Number(fillGradeValue);
    if (isNaN(score)) return;
    setIsFilling(true);
    try {
      for (const student of students) {
        const submission = getSubmissionForStudent(student.uid);
        if (submission) {
          // Has submission — update score if overwrite enabled or no existing score
          if (fillOverwrite || submission.score === null || submission.score === undefined) {
            await updateDoc(doc(db, 'gradingJobs', submission.id), { score });
            setSubmissions(prev => prev.map(s => s.id === submission.id ? { ...s, score } : s));
          }
        } else {
          // No submission — create a grading job stub
          const newJob = await addDoc(collection(db, 'gradingJobs'), {
            assignmentId: homeworkId,
            classId: assignment.classId,
            studentId: student.uid,
            teacherId: user.uid,
            status: 'complete',
            score,
            createdAt: serverTimestamp(),
          });
          setSubmissions(prev => [...prev, { id: newJob.id, assignmentId: homeworkId, classId: assignment.classId, studentId: student.uid, teacherId: user.uid, status: 'complete', score }]);
        }
      }
      setIsFillGradesOpen(false);
      setFillGradeValue('');
      setFillOverwrite(false);
    } catch (err) {
      console.error('Error filling grades:', err);
    } finally {
      setIsFilling(false);
    }
  };

  // Per-assignment CSV export
  const handleDownloadCSV = () => {
    const rows = [['Student Name', 'Email', 'Status', 'Score']];
    for (const student of sortedStudents) {
      const submission = getSubmissionForStudent(student.uid);
      rows.push([
        student.displayName || '',
        student.email || '',
        submission ? submission.status : 'Not Submitted',
        submission && submission.score !== null && submission.score !== undefined ? String(submission.score) : '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(assignment?.title || 'assignment').replace(/[^a-z0-9]/gi, '_')}_grades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusLabel = (status) => {
    switch (status) {
      case 'complete': return <Badge variant="default" className="bg-green-600">Graded</Badge>;
      case 'queued': return <Badge variant="secondary">Queued</Badge>;
      case 'processing': return <Badge variant="secondary" className="animate-pulse">Processing</Badge>;
      case 'disputed': return <Badge variant="secondary" className="bg-amber-500">Disputed</Badge>;
      case 'error': return <Badge variant="destructive">Error</Badge>;
      default: return <Badge variant="outline">Not Submitted</Badge>;
    }
  };

  return (
    <>
      <Head>
        <title>{assignment.title} - Submissions</title>
      </Head>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push(`/teacher/class/${assignment.classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {assignment.title}
              </h1>
              <p className="text-muted-foreground mt-1 flex items-center text-sm">
                Topic: <span className="font-medium text-foreground ml-1">{assignment.topic || 'N/A'}</span>
                <span className="mx-2">|</span>
                Points: <span className="font-medium text-foreground ml-1">{assignment.totalPoints || 0}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setIsFillGradesOpen(true)}>
                Fill Grades
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleDownloadCSV}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </div>
        </div>

        <Card className="border-muted/60">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <FileText className="w-5 h-5 mr-2 text-primary" />
              Student Submissions
            </CardTitle>
            <CardDescription>
              {students.length} {students.length === 1 ? 'student' : 'students'} in class
            </CardDescription>
          </CardHeader>
          <CardContent>
            {students.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No students enrolled in this class.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                          <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>
                            Student
                            <ArrowUpDown className="h-3.5 w-3.5" />
                            <span className="text-[10px] text-muted-foreground font-normal">({sortOrder === 'asc' ? 'A-Z' : 'Z-A'})</span>
                          </button>
                        </TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStudents.map((student) => {
                    const submission = getSubmissionForStudent(student.uid);
                    const hasSubmitted = !!submission;
                    
                    return (
                      <TableRow key={student.uid} className={cn(hasSubmitted && "cursor-pointer hover:bg-muted/50 transition-colors")} onClick={() => {
                        if (hasSubmitted) {
                           // Route to teacher review view
                           router.push(`/teacher/homework/${assignment.id}/submissions/${submission.id}`);
                        }
                      }}>
                        <TableCell className="font-medium">
                          {student.displayName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {student.email}
                        </TableCell>
                        <TableCell>
                          {submission ? statusLabel(submission.status) : <Badge variant="outline">Not Submitted</Badge>}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {submission && submission.status === 'complete' && editingGradeId === submission.id ? (
                            <Input
                              type="number"
                              className="w-20 h-7 text-sm"
                              autoFocus
                              value={editGradeValue}
                              onChange={(e) => setEditGradeValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleGradeEdit(submission.id, editGradeValue);
                                if (e.key === 'Escape') setEditingGradeId(null);
                              }}
                              onBlur={() => handleGradeEdit(submission.id, editGradeValue)}
                            />
                          ) : submission && submission.score !== null && submission.score !== undefined ? (
                            <span
                              className="font-semibold cursor-pointer hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (submission.status === 'complete') {
                                  setEditingGradeId(submission.id);
                                  setEditGradeValue(String(submission.score));
                                }
                              }}
                              title={submission.status === 'complete' ? 'Click to edit' : ''}
                            >
                              {submission.score}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {hasSubmitted && (
                            <Button variant="ghost" size="sm" onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/teacher/homework/${assignment.id}/submissions/${submission.id}`);
                            }}>
                              View Details
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fill Grades Dialog */}
      <Dialog open={isFillGradesOpen} onOpenChange={setIsFillGradesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fill Grades</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="fill-grade-value">Default Grade</Label>
              <Input
                id="fill-grade-value"
                type="number"
                placeholder="e.g. 0"
                value={fillGradeValue}
                onChange={(e) => setFillGradeValue(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="fill-overwrite" className="text-sm">Overwrite existing grades</Label>
              <Switch
                id="fill-overwrite"
                checked={fillOverwrite}
                onCheckedChange={setFillOverwrite}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFillGradesOpen(false)}>Cancel</Button>
            <Button onClick={handleFillGrades} disabled={isFilling || fillGradeValue === ''}>
              {isFilling ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying...</> : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default withAuth(AssignmentSubmissionsPage, ['teacher', 'ta']);
