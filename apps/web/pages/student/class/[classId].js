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
  updateDoc,
  onSnapshot,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';

import { db, storage } from '@/firebase';
import { ref, getDownloadURL } from 'firebase/storage';

import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { getClassById } from '@/lib/classUtils';
import { uploadWithProgress } from '@/lib/storageUtils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2, Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, Clock, BookOpen, ChevronDown, MessageCircleQuestion, CalendarPlus, Ticket, Calculator, TrendingUp } from 'lucide-react';

function StudentClassDetail() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  // Don't render until router params are available (required for static export)
  if (!router.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

  // Past Assignments Dropdown
  const [showPastAssignments, setShowPastAssignments] = useState(false);

  // What-If Grade Calculator
  const [showWhatIf, setShowWhatIf] = useState(false);
  const [whatIfGrades, setWhatIfGrades] = useState({}); // { assignmentId: hypothetical score }

  // Extension Passes
  const [extensionTotal, setExtensionTotal] = useState(0);
  const [extensionUsed, setExtensionUsed] = useState(0);
  const [extensionDueDates, setExtensionDueDates] = useState({}); // { assignmentId: Date }
  const [extensionLoading, setExtensionLoading] = useState(null); // assignmentId being extended

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

          // Load extension data
          setExtensionTotal(classData.extensionPassesTotal || 0);
          const usedMap = classData.extensionPassesUsed || {};
          setExtensionUsed(usedMap[user.uid] || 0);
          const dueDatesMap = classData.extensionDueDates || {};
          const parsedDueDates = {};
          Object.entries(dueDatesMap).forEach(([key, val]) => {
            if (key.startsWith(user.uid + '_')) {
              const assignId = key.slice(user.uid.length + 1);
              parsedDueDates[assignId] = val?.toDate ? val.toDate() : new Date(val);
            }
          });
          setExtensionDueDates(parsedDueDates);
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

  const handleRequestExtension = async (assignment) => {
    if (extensionLoading) return;
    const remaining = extensionTotal - extensionUsed;
    if (remaining <= 0) return;

    setExtensionLoading(assignment.id);
    try {
      // Get current due date (either extended or original)
      const currentDue = extensionDueDates[assignment.id]
        || (assignment.dueDate?.toDate ? assignment.dueDate.toDate() : (assignment.dueDate ? new Date(assignment.dueDate) : null));

      if (!currentDue) return;

      // New due date = current + 1 day
      const newDue = new Date(currentDue);
      newDue.setDate(newDue.getDate() + 1);

      const dueDateKey = `extensionDueDates.${user.uid}_${assignment.id}`;
      const usedKey = `extensionPassesUsed.${user.uid}`;

      await updateDoc(doc(db, 'classes', classId), {
        [dueDateKey]: newDue,
        [usedKey]: extensionUsed + 1,
      });

      setExtensionDueDates(prev => ({ ...prev, [assignment.id]: newDue }));
      setExtensionUsed(prev => prev + 1);
    } catch (err) {
      console.error('Error requesting extension:', err);
    } finally {
      setExtensionLoading(null);
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

      const storagePath = `raw/${user.uid}/${jobId}.pdf`;
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
        <title>{currentClass.name} - TikiTaka</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8 min-h-screen">
        <header className="space-y-4">
          <Button 
            variant="ghost" 
            size="sm"
            className="-ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors" 
            onClick={() => router.push('/student/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {currentClass.name}
              </h1>
              <div className="flex items-center gap-2 mt-2">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                  {currentClass.teacherName?.charAt(0) || 'T'}
                </div>
                <p className="text-sm text-muted-foreground">
                  Instructor: <span className="text-foreground font-medium">{currentClass.teacherName || 'Unknown'}</span>
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <section className="space-y-4">
              {(() => {
                const now = new Date();
                // Helper: get effective due date for assignment (respects per-student extensions)
                const getEffectiveDueDate = (a) => {
                  if (extensionDueDates[a.id]) return extensionDueDates[a.id];
                  return a.dueDate?.toDate ? a.dueDate.toDate() : (a.dueDate ? new Date(a.dueDate) : null);
                };

                // Categorize assignments
                const activeAssignments = assignments.filter((a) => {
                  const isGraded = submissions.some(s => s.assignmentId === a.id && s.status === 'complete');
                  if (isGraded) return false;
                  const dueDate = getEffectiveDueDate(a);
                  const isOverdue = dueDate && dueDate < now;
                  if (isOverdue) return false;
                  return true;
                });
                const pastAssignments = assignments.filter((a) => {
                  const isGraded = submissions.some(s => s.assignmentId === a.id && s.status === 'complete');
                  if (isGraded) return true;
                  const dueDate = getEffectiveDueDate(a);
                  const isOverdue = dueDate && dueDate < now;
                  if (isOverdue && !isGraded) return true;
                  return false;
                });

                const remainingPasses = extensionTotal - extensionUsed;

                const renderAssignmentCard = (assignment) => {
                  const hasSubmitted = submissions.some(s => s.assignmentId === assignment.id);
                  const gradedSub = submissions.find(s => s.assignmentId === assignment.id && s.status === 'complete');
                  const isGraded = !!gradedSub;
                  const originalDueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : (assignment.dueDate ? new Date(assignment.dueDate) : null);
                  const dueDate = extensionDueDates[assignment.id] || originalDueDate;
                  const hasExtension = !!extensionDueDates[assignment.id];
                  const isOverdue = dueDate && dueDate < now && !isGraded;
                  const isSelected = selectedAssignmentId === assignment.id;

                  const dueDateDisplay = dueDate
                    ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No due date';

                  return (
                    <Card
                      key={assignment.id}
                      className={cn(
                        "transition-all duration-200 overflow-hidden rounded-2xl group",
                        isSelected
                          ? "ring-2 ring-primary border-transparent shadow-lg"
                          : "hover:shadow-md",
                        isGraded
                          ? "bg-green-50/60 border-green-200/60 dark:bg-green-950/20 dark:border-green-800/40"
                          : isOverdue
                            ? "bg-red-50/50 border-red-200/50 dark:bg-red-950/20 dark:border-red-800/40"
                            : "border-muted/60 hover:border-muted-foreground/20"
                      )}
                    >
                      <CardHeader
                        className="p-5 flex flex-row items-center justify-between space-y-0 cursor-pointer"
                        onClick={() => setSelectedAssignmentId(isSelected ? null : assignment.id)}
                      >
                        <div className="space-y-1.5">
                          <CardTitle className="text-lg font-semibold flex items-center gap-2">
                            {assignment.title}
                            {isGraded && (
                              <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400 border-none px-1.5 h-5">
                                <CheckCircle className="w-3 h-3 mr-1" /> Graded
                              </Badge>
                            )}
                            {isOverdue && (
                              <Badge variant="destructive" className="px-1.5 h-5 text-[10px] font-bold uppercase tracking-wider">
                                <AlertCircle className="w-3 h-3 mr-1" /> Past Due
                              </Badge>
                            )}
                          </CardTitle>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              Due: {dueDateDisplay}
                            </span>
                            {hasExtension && (
                              <Badge className="bg-blue-50 text-blue-700 border-none text-[9px] px-1.5 py-0 h-4">
                                <CalendarPlus className="h-2.5 w-2.5 mr-0.5" /> Extended
                              </Badge>
                            )}
                            <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                            <span>{assignment.totalPoints || 100} pts</span>
                            {isGraded && gradedSub && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                                <span className="font-semibold text-green-600 dark:text-green-400">
                                  Score: {gradedSub.score}/{assignment.totalPoints || 100}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {isGraded ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full px-5 text-green-700 border-green-300 hover:bg-green-100 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-900/30"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (gradedSub) router.push(`/student/submission/${gradedSub.id}`);
                            }}
                          >
                            View Results
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2">
                            {dueDate && !hasSubmitted && remainingPasses > 0 && extensionTotal > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-full px-3 text-blue-600 hover:bg-blue-50 hover:text-blue-700 text-xs"
                                onClick={(e) => { e.stopPropagation(); handleRequestExtension(assignment); }}
                                disabled={extensionLoading === assignment.id}
                              >
                                {extensionLoading === assignment.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <><CalendarPlus className="h-3.5 w-3.5 mr-1" /> +1 Day</>
                                )}
                              </Button>
                            )}
                            <Button
                              variant={isSelected ? "secondary" : "outline"}
                              size="sm"
                              className={cn("rounded-full px-5 transition-all", !isSelected && "group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary")}
                            >
                              {isSelected ? 'Cancel' : hasSubmitted ? 'Resubmit' : 'Open'}
                            </Button>
                          </div>
                        )}
                      </CardHeader>

                      {isSelected && !isGraded && (
                        <CardContent className="p-5 pt-0 border-t bg-muted/5 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                          {assignment.pdfUrl && (
                            <div className="pt-4 space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resources</Label>
                              {assignmentPdfUrls[assignment.id] ? (
                                <a
                                  href={assignmentPdfUrls[assignment.id]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center p-3 rounded-xl border border-muted/60 bg-background hover:bg-muted/30 transition-colors group/file"
                                >
                                  <FileText className="mr-3 h-5 w-5 text-primary" />
                                  <span className="text-sm font-medium flex-1 truncate">{assignment.title} - Reference.pdf</span>
                                  <Upload className="h-4 w-4 text-muted-foreground opacity-0 group-hover/file:opacity-100 transition-opacity" />
                                </a>
                              ) : (
                                <div className="flex items-center p-3 rounded-xl border border-dashed bg-background/50">
                                  <Loader2 className="mr-3 h-4 w-4 animate-spin text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground italic">Loading reference...</span>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="space-y-3">
                            <Label htmlFor="pdfFile" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submission</Label>
                            <div className="relative group/upload">
                              <Input
                                id="pdfFile"
                                type="file"
                                accept=".pdf"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                disabled={isSubmittingJob}
                                className="cursor-pointer file:cursor-pointer h-24 border-dashed border-2 hover:border-primary/50 transition-colors flex items-center justify-center text-center py-8"
                              />
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-muted-foreground group-hover/upload:text-primary transition-colors">
                                {!uploadFile ? (
                                  <>
                                    <Upload className="h-6 w-6 mb-2" />
                                    <p className="text-xs font-medium">Click to select or drag & drop PDF</p>
                                    <p className="text-[10px] opacity-60">Maximum size 20MB</p>
                                  </>
                                ) : (
                                  <>
                                    <FileText className="h-6 w-6 mb-2 text-primary" />
                                    <p className="text-sm font-semibold text-foreground">{uploadFile.name}</p>
                                    <p className="text-[10px] opacity-60">Ready to submit • {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {submitError && (
                            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 rounded-xl">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription className="text-xs">{submitError}</AlertDescription>
                            </Alert>
                          )}

                          {isSubmittingJob && (
                            <div className="space-y-2 pt-2">
                              <div className="flex justify-between text-[10px] font-bold uppercase text-muted-foreground">
                                <span>Uploading Submission</span>
                                <span>{Math.round(uploadProgress)}%</span>
                              </div>
                              <Progress value={uploadProgress} className="h-1.5 bg-muted/50 rounded-full overflow-hidden" />
                            </div>
                          )}

                          <Button
                            onClick={handleJobSubmit}
                            disabled={isSubmittingJob || !uploadFile}
                            className="w-full rounded-xl py-6 text-base font-semibold shadow-md active:scale-[0.98] transition-all"
                          >
                            {isSubmittingJob ? (
                              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                            ) : "Submit for Grading"}
                          </Button>
                        </CardContent>
                      )}
                    </Card>
                  );
                };

                return (
                  <>
                    {/* Active Assignments */}
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-semibold tracking-tight">Active Assignments</h2>
                      <div className="flex items-center gap-2">
                        {extensionTotal > 0 && (
                          <Badge variant="outline" className="font-normal text-blue-600 border-blue-200 bg-blue-50/50">
                            <Ticket className="h-3 w-3 mr-1" /> {remainingPasses} extension{remainingPasses !== 1 ? 's' : ''} left
                          </Badge>
                        )}
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {activeAssignments.length} Active
                        </Badge>
                      </div>
                    </div>

                    {isAssignmentsLoading ? (
                      <div className="space-y-4">
                        {[1,2].map((i) => <div key={i} className="h-32 bg-muted/40 animate-pulse rounded-2xl border" />)}
                      </div>
                    ) : activeAssignments.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 bg-muted/10 rounded-2xl border border-dashed text-center">
                        <div className="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-base font-medium">No active assignments</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {pastAssignments.length > 0 ? "All assignments are completed or past due." : "Your instructor hasn't posted any assignments."}
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {activeAssignments.map(renderAssignmentCard)}
                      </div>
                    )}

                    {/* Past Assignments */}
                    {!isAssignmentsLoading && pastAssignments.length > 0 && (
                      <div className="pt-4 space-y-3">
                        <button
                          onClick={() => setShowPastAssignments(!showPastAssignments)}
                          className="flex items-center justify-between w-full group/past"
                        >
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold tracking-tight text-muted-foreground group-hover/past:text-foreground transition-colors">
                              Past Assignments
                            </h2>
                            <Badge variant="secondary" className="font-normal text-muted-foreground">
                              {pastAssignments.length}
                            </Badge>
                          </div>
                          <ChevronDown className={cn(
                            "h-5 w-5 text-muted-foreground transition-transform duration-200",
                            showPastAssignments && "rotate-180"
                          )} />
                        </button>

                        {showPastAssignments && (
                          <div className="grid gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            {pastAssignments.map(renderAssignmentCard)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </section>

            {activeJobId && (
              <section className="space-y-4 pt-4 border-t border-muted/40 animate-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-lg font-semibold tracking-tight">Active Grading Job</h3>
                {renderJobStatus()}
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <div className="p-6 rounded-3xl bg-primary/5 border border-primary/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-primary/70">Class Actions</h3>
              <div className="grid gap-2">
                <Button variant="ghost" className="w-full justify-start rounded-xl hover:bg-primary/10 hover:text-primary transition-colors h-11" onClick={() => router.push(`/student/quizzes/${classId}`)}>
                  <BookOpen className="mr-3 h-4 w-4" /> Class Quizzes
                </Button>
                <Button variant="ghost" className="w-full justify-start rounded-xl hover:bg-primary/10 hover:text-primary transition-colors h-11" onClick={() => router.push(`/student/quizzes/${classId}/history`)}>
                  <Clock className="mr-3 h-4 w-4" /> Quiz History
                </Button>
                <Button variant="ghost" className="w-full justify-start rounded-xl hover:bg-primary/10 hover:text-primary transition-colors h-11" onClick={() => router.push(`/student/class/${classId}/modules`)}>
                  <BookOpen className="mr-3 h-4 w-4" /> Weekly Modules
                </Button>
                <Button variant="ghost" className="w-full justify-start rounded-xl hover:bg-primary/10 hover:text-primary transition-colors h-11" onClick={() => router.push(`/student/class/${classId}/office-hours`)}>
                  <Clock className="mr-3 h-4 w-4" /> Office Hours
                </Button>
                <Button variant="ghost" className="w-full justify-start rounded-xl hover:bg-primary/10 hover:text-primary transition-colors h-11" onClick={() => router.push(`/student/class/${classId}/forum`)}>
                  <MessageCircleQuestion className="mr-3 h-4 w-4" /> Anonymous Forum
                </Button>
              </div>
            </div>

            {/* What-If Grade Calculator */}
            <div className="space-y-3">
              <button
                onClick={() => setShowWhatIf(!showWhatIf)}
                className="w-full p-4 rounded-2xl bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20 border border-violet-200/50 dark:border-violet-800/30 flex items-center justify-between hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <Calculator className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-foreground">What-If Calculator</p>
                    <p className="text-[10px] text-muted-foreground">See how grades affect your GPA</p>
                  </div>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", showWhatIf && "rotate-180")} />
              </button>

              {showWhatIf && (
                <Card className="rounded-2xl border-violet-200/50 dark:border-violet-800/30 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 space-y-4">
                    {/* Current grade */}
                    {(() => {
                      // Calculate current actual grade
                      const gradedSubs = submissions.filter(s => s.status === 'complete' && s.score != null);
                      const currentEarned = gradedSubs.reduce((sum, s) => {
                        const a = assignments.find(a => a.id === s.assignmentId);
                        return sum + (s.score || 0);
                      }, 0);
                      const currentPossible = gradedSubs.reduce((sum, s) => {
                        const a = assignments.find(a => a.id === s.assignmentId);
                        return sum + (a?.totalPoints || s.totalPoints || 100);
                      }, 0);
                      const currentPct = currentPossible > 0 ? Math.round((currentEarned / currentPossible) * 100) : null;

                      // Calculate What-If grade including hypotheticals
                      const ungradedAssignments = assignments.filter(a => !gradedSubs.some(s => s.assignmentId === a.id));
                      const whatIfEarned = currentEarned + Object.entries(whatIfGrades).reduce((sum, [id, score]) => sum + (parseFloat(score) || 0), 0);
                      const whatIfPossible = currentPossible + Object.entries(whatIfGrades).reduce((sum, [id]) => {
                        const a = assignments.find(a => a.id === id);
                        return sum + (a?.totalPoints || 100);
                      }, 0);
                      const whatIfPct = whatIfPossible > 0 ? Math.round((whatIfEarned / whatIfPossible) * 100) : null;
                      const hasWhatIf = Object.keys(whatIfGrades).length > 0;

                      return (
                        <>
                          {/* Grade display */}
                          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current Grade</p>
                              <p className={cn('text-2xl font-extrabold', currentPct != null ? (currentPct >= 80 ? 'text-green-600' : currentPct >= 60 ? 'text-amber-600' : 'text-red-600') : 'text-muted-foreground')}>
                                {currentPct != null ? `${currentPct}%` : '--'}
                              </p>
                            </div>
                            {hasWhatIf && whatIfPct != null && (
                              <div className="text-right">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Projected</p>
                                <div className="flex items-center gap-1.5">
                                  <TrendingUp className="h-4 w-4 text-violet-500" />
                                  <p className={cn('text-2xl font-extrabold', whatIfPct >= 80 ? 'text-green-600' : whatIfPct >= 60 ? 'text-amber-600' : 'text-red-600')}>
                                    {whatIfPct}%
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Ungraded assignments to fill in */}
                          {ungradedAssignments.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">All assignments are graded!</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Enter hypothetical grades:</p>
                              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                                {ungradedAssignments.map(a => (
                                  <div key={a.id} className="flex items-center gap-2">
                                    <p className="text-xs font-medium text-foreground truncate flex-1">{a.title}</p>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Input
                                        type="number"
                                        min="0"
                                        max={a.totalPoints || 100}
                                        placeholder="?"
                                        className="w-16 h-7 text-xs text-center rounded-lg"
                                        value={whatIfGrades[a.id] ?? ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setWhatIfGrades(prev => {
                                            if (val === '' || val === undefined) {
                                              const next = { ...prev };
                                              delete next[a.id];
                                              return next;
                                            }
                                            return { ...prev, [a.id]: val };
                                          });
                                        }}
                                      />
                                      <span className="text-[10px] text-muted-foreground">/ {a.totalPoints || 100}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {hasWhatIf && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full h-7 text-xs text-muted-foreground"
                                  onClick={() => setWhatIfGrades({})}
                                >
                                  Clear all
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-base font-bold text-foreground">Recent Activity</h3>
                <Link href="/student/dashboard" className="text-xs font-medium text-primary hover:underline">View All</Link>
              </div>
              
              {isSubmissionsLoading ? (
                <div className="space-y-3">
                   {[1,2,3].map((i) => <div key={i} className="h-20 bg-muted/20 animate-pulse rounded-2xl" />)}
                </div>
              ) : submissions.length === 0 ? (
                <div className="text-center py-10 px-6 rounded-2xl border border-dashed border-muted/60 bg-muted/5">
                   <p className="text-sm text-muted-foreground italic">No submissions yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                   {submissions.slice(0, 5).map((sub) => {
                       const assignment = assignments.find(a => a.id === sub.assignmentId);
                       const totalPoints = assignment?.totalPoints || 100;
                       
                       return (
                         <Card key={sub.id} className="p-4 border-muted/50 rounded-2xl hover:border-primary/30 transition-colors cursor-pointer group" onClick={() => router.push(`/student/submission/${sub.id}`)}>
                            <div className="flex items-center justify-between gap-4">
                               <div className="space-y-1 overflow-hidden">
                                  <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                                     {sub.assignmentTitle || 'Assignment'}
                                  </p>
                                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">
                                     {sub.createdAt?.toDate ? sub.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'}
                                  </p>
                               </div>
                               <div className="text-right shrink-0">
                                  {sub.status === 'complete' ? (
                                      <div className="inline-flex flex-col items-end">
                                         <span className="text-sm font-bold text-green-600 dark:text-green-400 bg-green-500/5 px-2 py-0.5 rounded-md border border-green-500/20">{sub.score}/{totalPoints}</span>
                                      </div>
                                  ) : sub.status === 'error' ? (
                                      <Badge variant="destructive" className="h-5 px-1.5 font-bold uppercase text-[9px] tracking-widest">Failed</Badge>
                                  ) : (
                                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary uppercase animate-pulse">
                                         <Loader2 className="h-3 w-3 animate-spin" /> {sub.status}
                                      </div>
                                  )}
                               </div>
                            </div>
                         </Card>
                      );
                   })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentClassDetail, 'student');
