import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';

import { db } from '@/firebase';
import { withAuth } from '@/components/layout/with-auth';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, FileText, CheckCircle, HelpCircle } from 'lucide-react';

function AssignmentSubmissionsPage() {
  const router = useRouter();
  const { homeworkId } = router.query;
  
  const [assignment, setAssignment] = useState(null);
  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      if (!homeworkId) return;

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
        if (classSnap.exists()) {
          const cData = classSnap.data();
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
        const jobsQuery = query(
          collection(db, 'gradingJobs'),
          where('assignmentId', '==', homeworkId),
          where('classId', '==', classId)
        );
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
  }, [homeworkId]);

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

  const getSubmissionForStudent = (studentId) => {
    return submissions.find(s => s.studentId === studentId);
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
                    <TableHead>Student</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((student) => {
                    const submission = getSubmissionForStudent(student.uid);
                    const hasSubmitted = !!submission;
                    
                    return (
                      <TableRow key={student.uid} className={cn(hasSubmitted && "cursor-pointer hover:bg-muted/50 transition-colors")} onClick={() => {
                        if (hasSubmitted) {
                           // Route to teacher review view
                           router.push(`/teacher/homework/${homeworkId}/submissions/${submission.id}`);
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
                        <TableCell>
                          {submission && submission.score !== null ? (
                            <span className="font-semibold">{submission.score}</span>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {hasSubmitted && (
                            <Button variant="ghost" size="sm" onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/teacher/homework/${homeworkId}/submissions/${submission.id}`);
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
    </>
  );
}

export default withAuth(AssignmentSubmissionsPage, 'teacher');
