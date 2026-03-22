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
  updateDoc
} from 'firebase/firestore';

import { db } from '@/firebase';
import { withAuth } from '@/components/layout/with-auth';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, FileText, CheckCircle, HelpCircle, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function StudentPerformancePage() {
  const router = useRouter();
  const { classId, uid } = router.query;
  
  const [studentData, setStudentData] = useState(null);
  const [classData, setClassData] = useState(null);
  const [gradingJobs, setGradingJobs] = useState([]);
  const [quizAttempts, setQuizAttempts] = useState([]);
  const [topicGapsData, setTopicGapsData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    async function loadData() {
      if (!classId || !uid) return;

      try {
        setIsLoading(true);
        
        // 1. Fetch Student & Class
        const [studentSnap, classSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          getDoc(doc(db, 'classes', classId))
        ]);

        if (!studentSnap.exists()) {
          setError("Student not found.");
          return;
        }
        setStudentData(studentSnap.data());
        
        if (classSnap.exists()) {
          setClassData(classSnap.data());
        }

        // 2. Fetch Performance Data
        const jobsQuery = query(
          collection(db, 'gradingJobs'),
          where('classId', '==', classId),
          where('studentId', '==', uid)
        );
        const quizQuery = query(
          collection(db, 'quizAttempts'),
          where('classId', '==', classId),
          where('studentId', '==', uid)
        );

        const [jobsSnap, quizSnap] = await Promise.all([
          getDocs(jobsQuery),
          getDocs(quizQuery)
        ]);

        const jobs = jobsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const quizzes = quizSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort by dates descending
        jobs.sort((a, b) => (b.completedAt?.toMillis() || 0) - (a.completedAt?.toMillis() || 0));
        quizzes.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        setGradingJobs(jobs);
        setQuizAttempts(quizzes);

        // Aggregate Topic Gaps
        const gapCounts = {};
        quizzes.forEach(q => {
          if (q.topicGaps) {
            q.topicGaps.forEach(topic => {
              gapCounts[topic] = (gapCounts[topic] || 0) + 1;
            });
          }
        });
        const formattedGaps = Object.entries(gapCounts).map(([topic, count]) => ({
          topic,
          count
        })).sort((a, b) => b.count - a.count);

        setTopicGapsData(formattedGaps);

      } catch (err) {
        console.error("Error loading student data:", err);
        setError("Failed to load details.");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [classId, uid]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !studentData) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => router.push(`/teacher/class/${classId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
        </Button>
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || "Failed to load student details."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{studentData.displayName} - Performance</title>
      </Head>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <div className="flex items-center gap-3 mb-4 -ml-4">
            <Button variant="ghost" className="text-muted-foreground" onClick={() => router.push(`/teacher/dashboard`)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>
            <span className="text-muted-foreground">|</span>
            <Button variant="ghost" className="text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
              Back to {classData?.name || 'Class'}
            </Button>
          </div>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {studentData.displayName}
              </h1>
              <p className="text-muted-foreground mt-1 flex items-center">
                {studentData.email}
              </p>
            </div>
            {studentData.createdAt && (
              <div className="text-sm text-muted-foreground flex items-center bg-muted/30 px-3 py-1.5 rounded-lg border">
                <Calendar className="w-4 h-4 mr-1.5 opacity-70" />
                Joined: {new Date(studentData.createdAt.toMillis()).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Submission History */}
          <Card className="border-muted/60 h-fit">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <FileText className="w-5 h-5 mr-2 text-primary" />
                Submission History
              </CardTitle>
              <CardDescription>All graded PDF submissions- completed jobs only</CardDescription>
            </CardHeader>
            <CardContent>
              {gradingJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-lg bg-muted/20">
                  <p className="text-sm font-medium">No submissions yet</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {gradingJobs.map((job) => (
                    <li 
                      key={job.id} 
                      className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/10 transition-colors cursor-pointer"
                      onClick={() => job.score !== null && router.push(`/student/submission/${job.id}`)}
                    >
                      <div className="truncate">
                        <p className="text-sm font-medium text-foreground truncate">Submission</p>
                        <p className="text-xs text-muted-foreground">
                          {job.completedAt ? new Date(job.completedAt.toMillis()).toLocaleDateString() : (job.createdAt ? new Date(job.createdAt.toMillis()).toLocaleDateString() : 'N/A')}
                        </p>
                      </div>
                      <div className="flex items-center shrink-0 ml-4 gap-2">
                        {job.status === 'disputed' && (
                          <Button 
                            variant="default" 
                            size="sm" 
                            onClick={(e) => handleRegrade(job.id, e)}
                            className="text-xs h-7 px-2 bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            Re-grade
                          </Button>
                        )}
                        <span className={`text-sm font-bold ${job.score >= 80 ? 'text-green-600' : job.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {job.score !== null ? `${job.score}%` : (job.status === 'disputed' ? 'Disputed' : 'Pending')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Quiz History */}
          <Card className="border-muted/60 h-fit">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <CheckCircle className="w-5 h-5 mr-2 text-primary" />
                Quiz History
              </CardTitle>
              <CardDescription>Performance across adaptive quizzes</CardDescription>
            </CardHeader>
            <CardContent>
              {quizAttempts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-lg bg-muted/20">
                  <p className="text-sm font-medium">No quizzes taken</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {quizAttempts.map((q) => (
                    <li key={q.id} className="p-3 border rounded-lg bg-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-medium text-foreground">Quiz Attempt</p>
                          <p className="text-xs text-muted-foreground">
                            {q.createdAt ? new Date(q.createdAt.toMillis()).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                        <div className={`text-sm font-bold ${q.score >= 80 ? 'text-green-600' : q.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {q.score}%
                        </div>
                      </div>
                      {q.topicGaps && q.topicGaps.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {q.topicGaps.map((gap, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/30">
                              {gap}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Topic Gap Map Section */}
        {topicGapsData.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <HelpCircle className="w-5 h-5 mr-2 text-primary" />
                Topic Gap Map
              </CardTitle>
              <CardDescription>Frequency of topics identified as areas for improvement</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topicGapsData} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="topic" tick={{ fontSize: 12 }} width={90} />
                    <Tooltip contentStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentPerformancePage, 'teacher');
