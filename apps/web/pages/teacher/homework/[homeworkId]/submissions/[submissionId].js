import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle, Edit3 } from 'lucide-react';

function TeacherSubmissionReview() {
  const router = useRouter();
  const { homeworkId, submissionId } = router.query;
  const { user } = useAuth();
  
  const [submission, setSubmission] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [overridePoints, setOverridePoints] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!submissionId || !user) return;

    // Technically gradingJobs or submissions collection
    // Let's read from gradingJobs as mapped in student view
    const docRef = doc(db, 'gradingJobs', submissionId);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSubmission({ id: docSnap.id, ...data });
        
        if (data.resultPdfUrl) {
          try {
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
  }, [submissionId, user]);

  const handleOverrideGrade = async () => {
    if (!submission || !selectedQuestion || overridePoints === '') return;
    setIsUpdating(true);
    try {
      const docRef = doc(db, 'gradingJobs', submission.id);
      
      const updatedQuestions = submission.gradedQuestions.map(q => {
         if (q.questionNumber === selectedQuestion.questionNumber) {
            return { ...q, pointsEarned: parseFloat(overridePoints), status: 'partial' }; // simplistic update
         }
         return q;
      });

      // Recalculate Score totals
      const newScore = updatedQuestions.reduce((sum, q) => sum + (q.pointsEarned || 0), 0);
      
      await updateDoc(docRef, {
        gradedQuestions: updatedQuestions,
        score: newScore,
        status: 'queued' // trigger re-annotation optionally
      });
      setSelectedQuestion(null);
      setOverridePoints('');
    } catch (err) {
      console.error("Failed to override grade:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const performanceLabel = (score) => {
    const pct = parseFloat(score) * 10; // assuming scale 10
    if (pct >= 85) return 'Strong performance';
    if (pct >= 60) return 'Satisfactory';
    return 'Needs improvement';
  };

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (error || !submission) return <div className="max-w-md mx-auto mt-12 bg-background border px-4 py-6 rounded-xl space-y-4"><Alert variant="destructive"><AlertTriangle className="h-4 w-4 mr-2" /><AlertDescription>{error || "Loaded incorrectly."}</AlertDescription></Alert><Button variant="link" onClick={() => router.back()} className="text-muted-foreground"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Button></div>;

  return (
    <>
      <Head><title>Teacher Review - Grader</title></Head>
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="pl-0 text-muted-foreground"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Student Submission Review</h1>
          
          {submission.hasEdgeCases && (
             <Alert className="bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
               <AlertTriangle className="w-4 h-4 mr-2" />
               <AlertDescription className="font-medium">Edge Cases Detected: Verify difficult to read sections below.</AlertDescription>
             </Alert>
          )}

          {downloadUrl && (
            <div className="border rounded-xl overflow-hidden h-[750px] bg-muted/20 shadow-sm">
               <iframe src={`${downloadUrl}#toolbar=0`} width="100%" height="100%" className="border-0" title="Graded PDF" />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">Grading Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-medium">Final Score: {submission.score}/10</p>
              <p className="text-xs text-muted-foreground">Label: {performanceLabel(submission.score)}</p>

              {submission.gradedQuestions && submission.gradedQuestions.length > 0 && (
                <div className="space-y-4 mt-4">
                  {submission.gradedQuestions.map((q) => (
                    <Card key={q.questionNumber || Math.random()} className="p-4 space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-sm font-semibold">{q.questionNumber} ({q.pointsEarned}/{q.pointsPossible} pts)</span>
                         <Dialog>
                           <DialogTrigger asChild>
                             <Button variant="outline" size="sm" onClick={() => setSelectedQuestion(q)}><Edit3 className="h-3 w-3 mr-1" /> Override</Button>
                           </DialogTrigger>
                           <DialogContent>
                             <DialogHeader><DialogTitle>Override Grade for {q.questionNumber}</DialogTitle></DialogHeader>
                             <div className="space-y-2 py-4">
                               <Label>New Points Earned</Label>
                               <Input type="number" step="0.5" value={overridePoints} onChange={(e) => setOverridePoints(e.target.value)} />
                             </div>
                             <DialogFooter><Button onClick={handleOverrideGrade} disabled={isUpdating}>{isUpdating ? "Updating..." : "Save Score"}</Button></DialogFooter>
                           </DialogContent>
                         </Dialog>
                       </div>
                       
                       <p className="text-sm text-foreground">{q.feedback}</p>
                       {q.edgeCaseNote && <p className="text-xs bg-amber-50 p-2 rounded text-amber-800 border-amber-200 border"><strong>Grading Note:</strong> {q.edgeCaseNote}</p>}
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </>
  );
}

export default withAuth(TeacherSubmissionReview, 'teacher');
