import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';

function SubmissionDetail() {
  const router = useRouter();
  const { jobId } = router.query;
  const { user } = useAuth();
  
  const [job, setJob] = useState(null);
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
      <Head>
        <title>Submission Details - Grader</title>
      </Head>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="pl-0 text-muted-foreground hover:bg-transparent" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          
          {job.status === 'complete' && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRequestRegrade} 
              disabled={isUpdating}
              className="border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/20"
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
              Request Re-grade (Appeal)
            </Button>
          )}

          {job.status === 'disputed' && (
             <span className="text-sm font-medium text-amber-600 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-full dark:bg-amber-950/20">
                 <AlertTriangle className="h-4 w-4" /> Re-grade Requested
             </span>
          )}
        </div>

        <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Submission Details
            </h1>
            <p className="text-sm text-muted-foreground">
              Submitted on {job.createdAt?.toDate ? job.createdAt.toDate().toLocaleDateString() : 'N/A'}
            </p>
        </div>

        {job.hasEdgeCases && (
           <Alert className="bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
             <AlertTriangle className="w-4 h-4 mr-2" />
             <AlertDescription className="font-medium">
               Some answers were difficult to read. Your teacher may adjust your grade.
             </AlertDescription>
           </Alert>
        )}

        {job.status === 'complete' && (
           <div className="space-y-4">
             <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
               <CheckCircle className="w-4 h-4 mr-2" />
               <AlertDescription className="font-medium">
                 Grading complete! Final Score: {job.score}{assignment ? ` / ${assignment.totalPoints}` : ''}
               </AlertDescription>
             </Alert>

              {job.gradedQuestions && job.gradedQuestions.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">Question Breakdown</h3>
                    <Button variant="outline" size="sm" onClick={() => setShowFeedback(!showFeedback)} className="text-xs transition-colors duration-150">
                      {showFeedback ? "Hide Details" : "Expand to read feedback"}
                    </Button>
                  </div>
                  
                  {showFeedback && (
                    <div className="grid gap-3 md:grid-cols-2 mt-2 transition-all duration-200 ease-in-out">
                      {job.gradedQuestions.map((q) => {
                        const statusText = String(q.status || '').charAt(0).toUpperCase() + String(q.status || '').slice(1);
                        return (
                          <Card key={q.questionNumber || Math.random()} className="p-4 space-y-2 border-muted/60 shadow-none">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{q.questionNumber}</span>
                              <span className="text-xs text-muted-foreground">{statusText} ({q.pointsEarned}/{q.pointsPossible} pts)</span>
                            </div>
                            <p className="text-sm text-foreground">{q.feedback}</p>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

        )}

        {job.status === 'disputed' && (
           <Alert className="bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
             <AlertTriangle className="w-4 h-4 mr-2" />
             <AlertDescription className="font-medium">
               You have requested a re-grade. Your teacher is reviewing this submission.
             </AlertDescription>
           </Alert>
        )}


        {downloadUrl && (
          <div className="relative border rounded-xl overflow-hidden h-[650px] w-full mt-4 bg-muted/20 shadow-sm">
             {iframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30 backdrop-blur-sm z-10 space-y-3">
                   <Loader2 className="h-8 w-8 animate-spin text-primary" />
                   <p className="text-sm font-medium text-foreground">Loading graded PDF annotations...</p>
                </div>
             )}
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
    </>
  );
}

export default withAuth(SubmissionDetail, 'student');
