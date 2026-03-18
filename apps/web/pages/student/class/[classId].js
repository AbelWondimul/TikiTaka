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

import { db } from '@/firebase';
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

    fetchClassDetails();
    fetchSubmissions();
  }, [classId, user, router]);

  // Listen to active job status
  useEffect(() => {
    if (!activeJobId) return;

    const jobRef = doc(db, 'gradingJobs', activeJobId);
    const unsubscribe = onSnapshot(jobRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setJobStatus(data.status);
        if (data.status === 'complete') {
          setJobResultUrl(data.resultPdfUrl);
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
    
    const finalRubric = rubricType === 'structured' 
      ? JSON.stringify(rubricItems.filter(item => item.criteria.trim() !== '')) 
      : rubricText.trim();

    if (!finalRubric) {
      setSubmitError("Please provide a grading rubric.");
      return;
    }
    
    if (rubricType === 'structured' && rubricItems.some(item => item.criteria.trim() && !item.maxPoints)) {
       setSubmitError("Please provide max points for all criteria.");
       return;
    }

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

      await setDoc(jobRef, {
        status: 'queued',
        studentId: user.uid,
        classId: classId,
        teacherId: currentClass.teacherId,
        rubric: finalRubric,
        rubricType: rubricType, // Save type for UI rendering later if needed
        rawPdfUrl: `raw/${jobId}.pdf`,
        resultPdfUrl: null,
        score: null,
        createdAt: serverTimestamp()
      });

      setActiveJobId(jobId);
      setJobStatus('queued');

      const storagePath = `raw/${jobId}.pdf`;
      await uploadWithProgress(storagePath, uploadFile, (progress) => {
        setUploadProgress(progress);
      });

      setRubricText('');
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

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
              Grading complete! Score: {jobScore}/100
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Upload className="w-5 h-5 mr-2 text-primary" />
                  Submit Assignment
                </CardTitle>
                <CardDescription>
                  Upload your PDF submission and provide a grading rubric.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Grading Rubric</Label>
                    <div className="flex items-center gap-1 bg-muted/80 p-1 rounded-lg">
                      <Button 
                        variant={rubricType === 'text' ? 'secondary' : 'ghost'} 
                        size="sm" 
                        onClick={() => setRubricType('text')}
                        className="text-xs h-7 px-2 py-0 shadow-none border-none"
                      >
                        Plain Text
                      </Button>
                      <Button 
                        variant={rubricType === 'structured' ? 'secondary' : 'ghost'} 
                        size="sm" 
                        onClick={() => setRubricType('structured')}
                        className="text-xs h-7 px-2 py-0 shadow-none border-none"
                      >
                        Structured (V2)
                      </Button>
                    </div>
                  </div>

                  {rubricType === 'text' ? (
                    <Textarea 
                      id="rubric"
                      placeholder="Explain exactly how this assignment should be graded. Be specific about points, penalties, and what to look for."
                      className="min-h-[100px] resize-y"
                      value={rubricText}
                      onChange={(e) => setRubricText(e.target.value)}
                      disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                    />
                  ) : (
                    <div className="space-y-2">
                      {rubricItems.map((item, index) => (
                        <div key={index} className="flex gap-2 items-center">
                          <Input 
                            placeholder="Criteria (e.g., Code Cleanness)" 
                            value={item.criteria}
                            onChange={(e) => {
                              const newItems = [...rubricItems];
                              newItems[index].criteria = e.target.value;
                              setRubricItems(newItems);
                            }}
                            className="flex-1"
                            disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                          />
                          <Input 
                            type="number" 
                            placeholder="Max Pts" 
                            value={item.maxPoints}
                            onChange={(e) => {
                              const newItems = [...rubricItems];
                              newItems[index].maxPoints = e.target.value;
                              setRubricItems(newItems);
                            }}
                            className="w-20"
                            disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                          />
                          {rubricItems.length > 1 && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setRubricItems(rubricItems.filter((_, i) => i !== index))}
                              className="text-destructive h-9 w-9 p-0"
                              disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                            >
                              &times;
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setRubricItems([...rubricItems, { criteria: '', maxPoints: '' }])}
                        className="text-xs mt-1"
                        disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                      >
                        + Add Criteria
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pdfFile">Submission PDF (Max 20MB)</Label>
                  <Input 
                    id="pdfFile" type="file" accept=".pdf" ref={fileInputRef} onChange={handleFileChange}
                    disabled={activeJobId && jobStatus !== 'complete' && jobStatus !== 'error'}
                    className="cursor-pointer file:cursor-pointer"
                  />
                </div>

                {submitError && <Alert variant="destructive" className="py-2 px-3"><AlertDescription className="text-xs">{submitError}</AlertDescription></Alert>}

                {isSubmittingJob && (
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-xs text-muted-foreground"><span>Uploading File...</span><span>{Math.round(uploadProgress)}%</span></div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}

                <Button onClick={handleJobSubmit} disabled={isSubmittingJob || (activeJobId && jobStatus !== 'complete' && jobStatus !== 'error')} className="w-full sm:w-auto mt-2">
                   {isSubmittingJob ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting</> : "Submit for Grading"}
                </Button>
              </CardContent>
            </Card>

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
                  {submissions.map((sub) => (
                      <Card key={sub.id} className="p-3 border-muted/60">
                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                               <p className="text-sm font-medium truncate max-w-[150px]">
                                  {sub.rubric.slice(0, 30)}...
                               </p>
                               <p className="text-xs text-muted-foreground">
                                  {sub.createdAt?.toDate ? sub.createdAt.toDate().toLocaleDateString() : 'N/A'}
                               </p>
                            </div>
                            <div className="text-right">
                               {sub.status === 'complete' ? (
                                   <div className="flex flex-col items-end">
                                      <span className="text-sm font-bold text-green-600">{sub.score}/100</span>
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
                  ))}
               </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentClassDetail, 'student');
