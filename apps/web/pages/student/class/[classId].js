import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  doc, 
  setDoc,
  onSnapshot,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';

import { db, storage } from '@/firebase';
import { ref, getDownloadURL } from 'firebase/storage';

import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { getClassById } from '@/lib/classUtils';
import { uploadWithProgress } from '@/lib/storageUtils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Loader2, Upload, FileText, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';

function StudentClassDetail() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  
  const [currentClass, setCurrentClass] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null); // Added for debugging fallback

  // Submit Job State
  const [rubricText, setRubricText] = useState('');
  const [rubricType, setRubricType] = useState('text'); // 'text' | 'structured'
  const [rubricItems, setRubricItems] = useState([{ criteria: '', maxPoints: '' }]);
  const [uploadFile, setUploadFile] = useState(null);
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // Active Job State
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobResultUrl, setJobResultUrl] = useState(null);
  const [jobErrorMsg, setJobErrorMsg] = useState(null);
  const [jobScore, setJobScore] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobProgressText, setJobProgressText] = useState('');

  // Assignments State
  const [assignments, setAssignments] = useState([]);
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(true);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [assignmentPdfUrls, setAssignmentPdfUrls] = useState({});


  // Past Submissions State
  const [submissions, setSubmissions] = useState([]);
  const [isSubmissionsLoading, setIsSubmissionsLoading] = useState(true);

  useEffect(() => {
    if (!classId || !user) return;

    const fetchClassDetails = async () => {
      try {
        setIsLoading(true);
        const classData = await getClassById(classId);
        if (classData) {
          if (classData.teacherId) {
            const teacherDoc = await getDoc(doc(db, 'users', classData.teacherId));
            if (teacherDoc.exists()) {
              classData.teacherName = teacherDoc.data().displayName;
            }
          }
          setCurrentClass(classData);
        } else {
          setError("Class not found or you don't have permission to view it.");
        }
      } catch (error) {
        console.error("Error fetching class details:", error);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchSubmissions = async () => {
      try {
        setIsSubmissionsLoading(true);
        // Simple query without orderBy to avoid needing a composite index first
        const q = query(
          collection(db, 'gradingJobs'),
          where('studentId', '==', user.uid),
          where('classId', '==', classId)
        );
        const querySnapshot = await getDocs(q);
        const fetchedSubmissions = [];
        querySnapshot.forEach((doc) => {
          fetchedSubmissions.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort in memory instead
        fetchedSubmissions.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            return dateB - dateA; // descending
        });

        setSubmissions(fetchedSubmissions);
      } catch (error) {
        console.error("Error fetching submissions:", error);
      } finally {
        setIsSubmissionsLoading(false);
      }
    };

    const fetchAssignments = async () => {
      try {
        setIsAssignmentsLoading(true);
        const q = query(
          collection(db, 'assignments'),
          where('classId', '==', classId)
        );
        const querySnapshot = await getDocs(q);
        const fetchedAssignments = [];
        querySnapshot.forEach((doc) => {
          fetchedAssignments.push({ id: doc.id, ...doc.data() });
        });
        setAssignments(fetchedAssignments);
      } catch (error) {
        console.error("Error fetching assignments:", error);
      } finally {
        setIsAssignmentsLoading(false);
      }
    };

    fetchClassDetails();
    fetchSubmissions();
    fetchAssignments();
  }, [classId, user, router]);

  // Listen to active job status
  useEffect(() => {
    if (!activeJobId) return;

    const jobRef = doc(db, 'gradingJobs', activeJobId);
    const unsubscribe = onSnapshot(jobRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setJobStatus(data.status);
        if (data.status === 'complete' && data.resultPdfUrl) {
          getDownloadURL(ref(storage, data.resultPdfUrl))
            .then((url) => {
              setJobResultUrl(url);
            })
            .catch((err) => {
              console.error("Failed to get result PDF url:", err);
            });

          setJobScore(data.score);
          // Refresh submissions list when complete
          if (submissions.some(s => s.id === activeJobId)) {
             setSubmissions(prev => prev.map(s => s.id === activeJobId ? { ...s, ...data } : s));
          } else {
             setSubmissions(prev => [{ id: activeJobId, ...data }, ...prev]);
          }
        } else if (data.status === 'error') {
          setJobErrorMsg(data.feedback || "An unknown error occurred during grading.");
        }
        setJobProgress(data.progress || 0);
        setJobProgressText(data.progress_text || '');
      }
    });

    return () => unsubscribe();
  }, [activeJobId, submissions]);

  // Fetch assignment PDF URL when selected
  useEffect(() => {
    if (!selectedAssignmentId) return;
    
    const assignment = assignments.find(a => a.id === selectedAssignmentId);
    if (assignment && assignment.pdfUrl && !assignmentPdfUrls[selectedAssignmentId]) {
      getDownloadURL(ref(storage, assignment.pdfUrl))
        .then((url) => {
          setAssignmentPdfUrls(prev => ({ ...prev, [selectedAssignmentId]: url }));
        })
        .catch((err) => {
          console.error("Failed to get assignment PDF URL:", err);
        });
    }
  }, [selectedAssignmentId, assignments, assignmentPdfUrls]);


  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      if (file.size > 20 * 1024 * 1024) {
        setSubmitError("File size must be under 20MB.");
        setUploadFile(null);
      } else {
        setUploadFile(file);
        setSubmitError(null);
      }
    } else if (file) {
      setUploadFile(null);
      setSubmitError("Only PDF files are supported.");
    }
  };

  const handleJobSubmit = async () => {
    if (!currentClass) return;
    
    const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId);
    if (!selectedAssignment) {
      setSubmitError("Please select an assignment to submit.");
      return;
    }

    const finalRubric = selectedAssignment.rubric;
    if (!finalRubric) {
      setSubmitError("This assignment does not have a rubric set by the teacher.");
      return;
    }
    
    const derivedRubricType = selectedAssignment.rubricType || 'text';

    if (!uploadFile) {
      setSubmitError("Please select a PDF file to submit.");
      return;
    }

    setIsSubmittingJob(true);
    setSubmitError(null);
    setUploadProgress(0);
    
    // Reset active job
    setActiveJobId(null);
    setJobStatus(null);
    setJobResultUrl(null);
    setJobErrorMsg(null);
    setJobScore(null);

    try {
      const jobRef = doc(collection(db, 'gradingJobs'));
      const jobId = jobRef.id;

      setActiveJobId(jobId);
      setJobStatus('uploading');

      const storagePath = `raw/${jobId}.pdf`;
      await uploadWithProgress(storagePath, uploadFile, (progress) => {
        setUploadProgress(progress);
      });

      await setDoc(jobRef, {
        status: 'queued',
        studentId: user.uid,
        classId: classId,
        assignmentId: selectedAssignmentId,
        assignmentTitle: selectedAssignment.title,
        teacherId: currentClass.teacherId,
        rubric: finalRubric,
        rubricType: derivedRubricType,
        rawPdfUrl: storagePath,
        resultPdfUrl: null,
        score: null,
        createdAt: serverTimestamp()
      });

      setJobStatus('queued');


      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedAssignmentId(null); // Clear selection on success

    } catch (err) {
      console.error("Job submission failed:", err);
      setSubmitError("Failed to submit assignment. Please try again.");
      setActiveJobId(null);
    } finally {
      setIsSubmittingJob(false);
    }
  };

  const renderJobStatus = () => {
    if (!activeJobId) return null;

    const activeJob = submissions.find(s => s.id === activeJobId);
    const assignmentId = activeJob?.assignmentId || selectedAssignmentId;
    const assignment = assignments.find(a => a.id === assignmentId);
    const totalPoints = assignment?.totalPoints || 100;

    if (jobStatus === 'queued' || jobStatus === 'processing') {
      return (
        <div className="space-y-3 bg-muted/30 p-4 rounded-xl border border-muted/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium text-foreground">
                {jobStatus === 'queued' ? 'Queued' : 'Processing'}
              </span>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{jobProgress}%</span>
          </div>
          <Progress value={jobProgress} className="h-2" />
          <p className="text-xs text-muted-foreground">
             {jobProgressText || (jobStatus === 'queued' ? 'Waiting for AI Grader...' : 'AI Grading in progress...')}
          </p>
        </div>
      );
    }
    if (jobStatus === 'error') {
      return (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4 mr-2" />
          <AlertDescription>
            <span className="font-medium">Grading Failed:</span> {jobErrorMsg}
          </AlertDescription>
        </Alert>
      );
    }
    if (jobStatus === 'complete') {
      return (
        <div className="space-y-4">
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
            <CheckCircle className="w-4 h-4 mr-2" />
            <AlertDescription className="font-medium">
              Grading complete! Score: {jobScore}/{totalPoints}
            </AlertDescription>
          </Alert>
          
          <div className="border rounded-xl hidden md:block overflow-hidden h-[500px] w-full mt-4 bg-muted/20">
             <iframe src={`${jobResultUrl}#toolbar=0`} width="100%" height="100%" className="border-0" title="Graded PDF" />
          </div>
        </div>
      );
    }
    return null;
  };

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Button variant="ghost" className="pl-0 mb-4 text-muted-foreground hover:bg-transparent" onClick={() => router.push('/student/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4 mr-2" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentClass) return null;

  return (
    <>
      <Head>
        <title>{currentClass.name} - Class Details</title>
      </Head>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Button variant="ghost" className="pl-0 mb-4 text-muted-foreground hover:bg-transparent" onClick={() => router.push('/student/dashboard')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {currentClass.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Teacher: <span className="font-medium text-foreground">{currentClass.teacherName || 'Unknown'}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Submit Form */}
          <div className="lg:col-span-2 space-y-6">
            <div className="space-y-4">
              <h2 className="text-lg font-medium text-foreground">Assignments</h2>
              
              {isAssignmentsLoading ? (
                <div className="space-y-3">
                  {[1,2,3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
                </div>
              ) : assignments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 bg-muted/20 rounded-xl border border-dashed text-center">
                  <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">No assignments yet</p>
                  <p className="text-sm text-muted-foreground">Your teacher hasn't posted any assignments for this class.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assignments.map((assignment) => {
                    const hasSubmitted = submissions.some(s => s.assignmentId === assignment.id);
                    const isSelected = selectedAssignmentId === assignment.id;
                    
                    return (
                      <Card key={assignment.id} className={cn("transition-all cursor-pointer", isSelected && "border-primary shadow-sm")}>
                        <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0" onClick={() => setSelectedAssignmentId(isSelected ? null : assignment.id)}>
                          <div className="space-y-1">
                            <CardTitle className="text-base font-medium flex items-center">
                              {assignment.title}
                              {hasSubmitted && <CheckCircle className="w-4 h-4 ml-2 text-green-500" />}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Due: {assignment.dueDate || 'No due date'}
                            </CardDescription>
                          </div>
                          <Button variant={isSelected ? "secondary" : "outline"} size="sm">
                            {isSelected ? 'Cancel' : hasSubmitted ? 'Resubmit' : 'Submit'}
                          </Button>
                        </CardHeader>
                        
                        {isSelected && (
                          <CardContent className="p-4 pt-0 border-t space-y-4 mt-2">
                            {assignment.pdfUrl && (
                              <div className="pt-3 border-b pb-3">
                                <Label className="text-xs mb-1.5 block">Assignment Reference</Label>
                                {assignmentPdfUrls[assignment.id] ? (
                                  <Button variant="outline" size="sm" asChild className="w-full justify-start border-dashed hover:border-solid">
                                    <a href={assignmentPdfUrls[assignment.id]} target="_blank" rel="noopener noreferrer">
                                      <FileText className="mr-2 h-4 w-4 text-primary" /> 
                                      <span className="truncate">View Teacher's PDF</span>
                                    </a>
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" className="w-full justify-start border-dashed" disabled>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF Reference...
                                  </Button>
                                )}
                              </div>
                            )}

                            <div className="space-y-2">

                              <Label htmlFor="pdfFile" className="text-xs">Upload Submission PDF (Max 20MB)</Label>
                              <Input 
                                id="pdfFile" type="file" accept=".pdf" ref={fileInputRef} onChange={handleFileChange}
                                disabled={isSubmittingJob}
                                className="cursor-pointer file:cursor-pointer text-xs"
                              />
                            </div>

                            {submitError && <Alert variant="destructive" className="py-2 px-3"><AlertDescription className="text-xs">{submitError}</AlertDescription></Alert>}

                            {isSubmittingJob && (
                              <div className="space-y-2 pt-2">
                                <div className="flex justify-between text-xs text-muted-foreground"><span>Uploading File...</span><span>{Math.round(uploadProgress)}%</span></div>
                                <Progress value={uploadProgress} className="h-1" />
                              </div>
                            )}

                            <Button onClick={handleJobSubmit} disabled={isSubmittingJob} size="sm" className="w-full mt-2">
                               {isSubmittingJob ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Submitting</> : "Submit Assignment"}
                            </Button>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {activeJobId && (
              <div className="pt-2">
                <h3 className="text-sm font-medium mb-3">Active Job Status</h3>
                {renderJobStatus()}
              </div>
            )}
          </div>

          {/* Past Submissions list */}
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-sm font-medium text-foreground">Submissions History</h3>
            {isSubmissionsLoading ? (
               <div className="space-y-3">
                  {[1,2,3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
               </div>
            ) : submissions.length === 0 ? (
               <p className="text-xs text-muted-foreground">No submissions found for this class.</p>
            ) : (
               <div className="space-y-3">
                  {submissions.map((sub) => {
                      const assignment = assignments.find(a => a.id === sub.assignmentId);
                      const totalPoints = assignment?.totalPoints || 100;
                      
                      return (
                        <Card key={sub.id} className="p-3 border-muted/60">
                           <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                 <p className="text-sm font-medium truncate max-w-[150px]">
                                    {sub.assignmentTitle || 'Assignment'}
                                 </p>

                                 <p className="text-xs text-muted-foreground">
                                    {sub.createdAt?.toDate ? sub.createdAt.toDate().toLocaleDateString() : 'N/A'}
                                 </p>
                              </div>
                              <div className="text-right">
                                 {sub.status === 'complete' ? (
                                     <div className="flex flex-col items-end">
                                        <span className="text-sm font-bold text-green-600">{sub.score}/{totalPoints}</span>
                                        <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                                           <Link href={`/student/submission/${sub.id}`}>View</Link>
                                        </Button>
                                     </div>
                                 ) : sub.status === 'error' ? (
                                     <span className="text-xs text-destructive">Failed</span>
                                 ) : (
                                     <span className="text-xs text-primary animate-pulse flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" /> {sub.status}
                                     </span>
                                 )}
                              </div>
                           </div>
                        </Card>
                     );
                  })}
               </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentClassDetail, 'student');
