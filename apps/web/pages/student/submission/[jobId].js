import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle, Upload, MessageSquare } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { serverTimestamp } from 'firebase/firestore';

function SubmissionDetail() {
  const router = useRouter();
  const { jobId } = router.query;
  const { user } = useAuth();

  // Don't render until router params are available (required for static export)
  if (!router.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [job, setJob] = useState(null);
  const [appealReason, setAppealReason] = useState('');
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [isAppealing, setIsAppealing] = useState(false);

  const handleAppeal = async () => {
    if (!appealReason.trim() || !job) return;
    setIsAppealing(true);
    try {
      await updateDoc(doc(db, 'gradingJobs', jobId), {
        status: 'disputed',
        appealReason: appealReason.trim(),
        appealedAt: serverTimestamp(),
      });
      setShowAppealForm(false);
    } catch (err) { console.error('Appeal error:', err); }
    finally { setIsAppealing(false); }
  };
  const [assignment, setAssignment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState(null);
  
  // Interactive UI State
  const [showFeedback, setShowFeedback] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  useEffect(() => {

    if (!jobId || !user) return;

    const jobRef = doc(db, 'gradingJobs', jobId);
    const unsubscribe = onSnapshot(jobRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setJob({ id: docSnap.id, ...data });
        
        if (data.resultPdfUrl) {
          try {
             // resultPdfUrl is often relative like results/id.pdf
             const fullPath = data.resultPdfUrl.startsWith('http') 
                  ? data.resultPdfUrl 
                  : `https://firebasestorage.googleapis.com/v0/b/${storage.app.options.storageBucket}/o/${encodeURIComponent(data.resultPdfUrl)}?alt=media`;
             
             // Wait, standard getDownloadURL is safer:
             const url = await getDownloadURL(ref(storage, data.resultPdfUrl));
             setDownloadUrl(url);
          } catch (err) {
             console.error("Failed to load PDF URL:", err);
          }
        }
      } else {
        setError("Submission not found.");
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [jobId, user]);

  useEffect(() => {
    if (!job?.assignmentId) return;

    const fetchAssignment = async () => {
      try {
        const assignmentSnap = await getDoc(doc(db, 'assignments', job.assignmentId));
        if (assignmentSnap.exists()) {
          setAssignment({ id: assignmentSnap.id, ...assignmentSnap.data() });
        }
      } catch (err) {
        console.error("Failed to fetch assignment details:", err);
      }
    };

    fetchAssignment();
  }, [job?.assignmentId]);

  const handleRequestRegrade = async () => {
    if (!job) return;
    setIsUpdating(true);
    try {
      const jobRef = doc(db, 'gradingJobs', job.id);
      // Student can update their status to 'disputed'
      await updateDoc(jobRef, {
        status: 'disputed'
      });
    } catch (err) {
      console.error("Failed to request re-grade:", err);
      setError("Failed to submit request.");
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-background border px-4 py-6 rounded-xl space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4 mr-2" />
          <AlertDescription>{error || "Job loaded incorrectly."}</AlertDescription>
        </Alert>
        <Button variant="link" onClick={() => router.back()} className="text-muted-foreground"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Button>
      </div>
    );
  }

  return (
    <>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8 min-h-screen">
        <header className="space-y-4">
          <Button 
            variant="ghost" 
            size="sm"
            className="-ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors" 
            onClick={() => router.back()}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="font-semibold text-[10px] uppercase tracking-wider bg-primary/5 text-primary border-primary/20">
                  {job.status === 'complete' ? 'Graded' : job.status}
                </Badge>
                {job.hasEdgeCases && (
                   <Badge variant="outline" className="font-semibold text-[10px] uppercase tracking-wider bg-amber-50 text-amber-600 border-amber-200">
                     Review Needed
                   </Badge>
                )}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Submission Results
              </h1>
              <p className="text-sm text-muted-foreground">
                Submitted on <span className="text-foreground font-medium">{job.createdAt?.toDate ? job.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A'}</span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              {job.status === 'complete' && (
                <Button 
                  variant="outline" 
                  size="lg" 
                  onClick={handleRequestRegrade} 
                  disabled={isUpdating}
                  className="rounded-xl border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/20 font-semibold"
                >
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                  Appeal Grade
                </Button>
              )}

              {job.status === 'disputed' && (
                 <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-xl dark:bg-amber-950/20 dark:border-amber-800">
                     <AlertTriangle className="h-4 w-4 text-amber-600" />
                     <span className="text-sm font-bold text-amber-700 dark:text-amber-400">Re-grade Pending</span>
                 </div>
              )}
            </div>
          </div>
        </header>

        {job.hasEdgeCases && (
           <Alert className="bg-amber-50/50 border-amber-200/50 text-amber-800 rounded-2xl p-4 animate-in slide-in-from-top-4 duration-500">
             <AlertTriangle className="w-5 h-5 mr-3 text-amber-600" />
             <div className="space-y-1">
               <p className="font-bold text-sm">Handwriting Notice</p>
               <AlertDescription className="text-xs opacity-90 leading-relaxed">
                 AI detected some ambiguous handwriting. Your instructor has been notified to verify these segments.
               </AlertDescription>
             </div>
           </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <Card className="rounded-3xl border-muted/60 shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/5 border-b pb-6">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Performance Overview</CardTitle>
                <div className="mt-6 flex flex-col items-center">
                  <div className="relative h-32 w-32 flex items-center justify-center">
                    <svg className="h-full w-full rotate-[-90deg]">
                      <circle cx="64" cy="64" r="58" className="stroke-muted/20" strokeWidth="8" fill="none" />
                      <circle 
                        cx="64" cy="64" r="58" 
                        className="stroke-primary transition-all duration-1000 ease-out" 
                        strokeWidth="8" fill="none" 
                        strokeDasharray={364} 
                        strokeDashoffset={364 - (364 * (job.score || 0) / (assignment?.totalPoints || 100))}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-black">{job.score || 0}</span>
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">of {assignment?.totalPoints || 100}</span>
                    </div>
                  </div>
                  <Badge className="mt-6 rounded-full px-4 py-1 bg-green-500/10 text-green-600 border-none font-bold">
                    {Math.round((job.score || 0) / (assignment?.totalPoints || 100) * 100)}% Accuracy
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {job.gradedQuestions && job.gradedQuestions.length > 0 && (
                  <div className="divide-y divide-muted/40">
                    {job.gradedQuestions.map((q, idx) => (
                      <div key={idx} className="p-4 hover:bg-muted/5 transition-colors cursor-pointer group" onClick={() => setShowFeedback(true)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-muted-foreground uppercase">Q{q.questionNumber || idx + 1}</span>
                          <span className="text-xs font-bold">{q.pointsEarned}/{q.pointsPossible} pts</span>
                        </div>
                        <p className={`text-sm line-clamp-1 ${q.pointsEarned === q.pointsPossible ? 'text-foreground' : 'text-amber-600 font-medium'}`}>
                          {q.feedback}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button 
              variant="outline" 
              className="w-full rounded-2xl py-6 h-auto flex flex-col gap-1 border-muted/60 hover:border-primary/50 hover:bg-primary/5 transition-all"
              onClick={() => setShowFeedback(!showFeedback)}
            >
              <span className="text-sm font-bold">{showFeedback ? "Close Feedback" : "View Detailed Feedback"}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{job.gradedQuestions?.length || 0} Questions Analyzed</span>
            </Button>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {downloadUrl && (
              <div className="relative border rounded-3xl overflow-hidden h-[750px] w-full bg-muted/20 shadow-lg group">
                 {iframeLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md z-10 space-y-4">
                       <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                       <p className="text-sm font-bold text-foreground tracking-tight uppercase">Rendering Annotations...</p>
                    </div>
                 )}
                 <div className="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="secondary" size="sm" className="rounded-full shadow-lg h-9" asChild>
                      <a href={downloadUrl} download>
                        <Upload className="h-4 w-4 mr-2 rotate-180" /> Download PDF
                      </a>
                    </Button>
                 </div>
                 <iframe 
                    src={`${downloadUrl}#toolbar=0`} 
                    width="100%" 
                    height="100%" 
                    className="border-0" 
                    title="Graded PDF" 
                    onLoad={() => setIframeLoading(false)}
                 />
              </div>
            )}
          </div>
        </div>

        {/* Detailed Feedback Modal/Overlay */}
        {showFeedback && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-xl" onClick={() => setShowFeedback(false)} />
            <Card className="relative w-full max-w-4xl max-h-[80vh] overflow-hidden rounded-3xl shadow-2xl border-muted/40 flex flex-col animate-in zoom-in-95 duration-300">
              <CardHeader className="border-b px-8 py-6 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-2xl font-bold">Question Breakdown</CardTitle>
                  <CardDescription>Detailed feedback and point distribution from AI Grader</CardDescription>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowFeedback(false)}>
                  <Upload className="h-5 w-5 rotate-45" />
                </Button>
              </CardHeader>
              <CardContent className="p-8 overflow-y-auto space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  {job.gradedQuestions?.map((q, idx) => (
                    <div key={idx} className={`p-5 rounded-2xl border transition-all ${q.pointsEarned === q.pointsPossible ? 'bg-green-500/5 border-green-500/10' : 'bg-amber-500/5 border-amber-500/10'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="outline" className={`font-bold ${q.pointsEarned === q.pointsPossible ? 'text-green-600 border-green-500/30' : 'text-amber-600 border-amber-500/30'}`}>
                          Question {q.questionNumber || idx + 1}
                        </Badge>
                        <span className="text-sm font-bold">{q.pointsEarned} / {q.pointsPossible} pts</span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">
                        {q.feedback}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Grade Appeal Section */}
        {job && job.status === 'complete' && (
          <div className="max-w-3xl mx-auto mt-6 px-4 sm:px-0">
            {job.appealResponse ? (
              <Card className="rounded-2xl border-blue-200/50 bg-blue-50/30 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Teacher Response to Your Appeal</p>
                <p className="text-sm text-foreground">{job.appealResponse}</p>
              </Card>
            ) : showAppealForm ? (
              <Card className="rounded-2xl p-4 space-y-3">
                <p className="text-sm font-bold">Appeal This Grade</p>
                <Textarea value={appealReason} onChange={e => setAppealReason(e.target.value)} placeholder="Explain why you believe this grade should be reconsidered..." className="rounded-xl min-h-[80px] resize-none" maxLength={1000} />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{appealReason.length}/1000</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setShowAppealForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAppeal} disabled={isAppealing || !appealReason.trim()} className="rounded-xl">
                      {isAppealing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Appeal'}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Button variant="outline" className="w-full rounded-xl" onClick={() => setShowAppealForm(true)}>
                <MessageSquare className="h-4 w-4 mr-2" /> Appeal This Grade
              </Button>
            )}
          </div>
        )}
        {job && job.status === 'disputed' && (
          <div className="max-w-3xl mx-auto mt-6 px-4 sm:px-0">
            <Card className="rounded-2xl border-amber-200/50 bg-amber-50/30 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Appeal Submitted</p>
              <p className="text-sm text-foreground">{job.appealReason}</p>
              <p className="text-[10px] text-muted-foreground">Waiting for teacher review...</p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(SubmissionDetail, 'student');
