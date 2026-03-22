import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/firebase';
import { doc, getDoc, getDocs, query, collection, where, orderBy } from 'firebase/firestore';
import { 
  ArrowLeft, Award, CheckCircle, Clock, FileText, AlertCircle 
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function QuizPerformancePage() {
  const router = useRouter();
  const { classId, quizId } = router.query;
  const { user } = useAuth();

  const [quiz, setQuiz] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [studentsMap, setStudentsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!classId || !quizId || !user) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch Quiz Details
        const quizRef = doc(db, 'quizzes', quizId);
        const quizSnap = await getDoc(quizRef);
        if (quizSnap.exists()) {
          setQuiz({ id: quizSnap.id, ...quizSnap.data() });
        } else {
          // If not found, it might be a practice quiz (no quizId record but attempt exists)
          setQuiz({ title: 'Standard Quiz', description: 'Class Quiz Analytics' });
        }

        // 2. Fetch Attempts
        const attemptsQuery = query(
          collection(db, 'quizAttempts'),
          where('classId', '==', classId),
          where('quizId', '==', quizId),
          orderBy('createdAt', 'desc')
        );
        const attemptsSnap = await getDocs(attemptsQuery);
        const fetchedAttempts = attemptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAttempts(fetchedAttempts);

        // 3. Fetch Student Names
        const studentIds = [...new Set(fetchedAttempts.map(a => a.studentId))];
        if (studentIds.length > 0) {
          // Firebase 'in' queries are capped at 30
          const batchPromises = [];
          for (let i = 0; i < studentIds.length; i += 30) {
            const batch = studentIds.slice(i, i + 30);
            const q = query(collection(db, 'users'), where('uid', 'in', batch));
            batchPromises.push(getDocs(q));
          }
          const snapshots = await Promise.all(batchPromises);
          const map = {};
          snapshots.forEach(snap => {
            snap.forEach(doc => {
              const u = doc.data();
              map[u.uid] = u.displayName || u.email || 'Unknown Student';
            });
          });
          setStudentsMap(map);
        }

      } catch (err) {
        console.error("Error fetching quiz analytics:", err);
        setError("Failed to load analytics data.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [classId, quizId, user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <ArrowLeft className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // AGGREGATES
  const totalAttempts = attempts.length;
  const avgScore = totalAttempts > 0 
    ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / totalAttempts) 
    : 0;
  const highestScore = totalAttempts > 0 
    ? Math.max(...attempts.map(a => a.score || 0)) 
    : 0;

  // Chart Data: Score Distribution
  const distributionGroups = [
    { range: '0-20%', count: 0 },
    { range: '21-40%', count: 0 },
    { range: '41-60%', count: 0 },
    { range: '61-80%', count: 0 },
    { range: '81-100%', count: 0 }
  ];

  attempts.forEach(a => {
    const score = a.score || 0;
    if (score <= 20) distributionGroups[0].count++;
    else if (score <= 40) distributionGroups[1].count++;
    else if (score <= 60) distributionGroups[2].count++;
    else if (score <= 80) distributionGroups[3].count++;
    else distributionGroups[4].count++;
  });

  // Topic Gaps
  const gapCounts = {};
  attempts.forEach(a => {
    if (a.topicGaps) {
      a.topicGaps.forEach(topic => {
        gapCounts[topic] = (gapCounts[topic] || 0) + 1;
      });
    }
  });
  const topGaps = Object.entries(gapCounts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const handleViewAttempt = (attempt) => {
    setSelectedAttempt(attempt);
    setIsDialogOpen(true);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="pl-0 text-muted-foreground hover:bg-transparent">
              <Link href={`/teacher/dashboard`} className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" /> Back to Dashboard
              </Link>
            </Button>
            <span className="text-muted-foreground">|</span>
            <Button variant="ghost" size="sm" asChild className="pl-0 text-muted-foreground hover:bg-transparent">
              <Link href={`/teacher/class/${classId}`} className="flex items-center gap-2">
                Back to Class
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{quiz?.title || 'Quiz Analytics'}</h1>
          <p className="text-sm text-muted-foreground">{quiz?.description}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Attempts</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAttempts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgScore}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Highest Score</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highestScore}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Score Distribution Chart */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Score Distribution</CardTitle>
            <CardDescription>Frequency of scores broken down into bands</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {totalAttempts > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributionGroups}>
                  <XAxis dataKey="range" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <p className="text-sm">No data available</p>
                </div>
            )}
          </CardContent>
        </Card>

        {/* Topic Gaps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Topic Gaps Frequency</CardTitle>
            <CardDescription>Weak areas identified across attempts</CardDescription>
          </CardHeader>
          <CardContent>
            {topGaps.length > 0 ? (
              <div className="space-y-4">
                {topGaps.map((gap, index) => (
                  <div key={gap.topic} className="flex items-center justify-between">
                    <span className="text-sm font-medium line-clamp-1">{gap.topic}</span>
                    <Badge variant="secondary">{gap.count} students</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p className="text-sm">No topics flagged</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attempts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Attempts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {totalAttempts > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[100px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="font-medium">
                      {studentsMap[attempt.studentId] || 'Loading...'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={attempt.score >= 80 ? 'default' : attempt.score >= 50 ? 'secondary' : 'destructive'}>
                        {attempt.score}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {attempt.createdAt
                        ? new Date(attempt.createdAt.toMillis()).toLocaleDateString()
                        : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleViewAttempt(attempt)}>
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">No attempts yet</p>
              <p className="text-sm text-muted-foreground">
                Students haven't submitted this quiz.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attempt Review Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attempt Details</DialogTitle>
            <DialogDescription>
              Review of submission by {studentsMap[selectedAttempt?.studentId] || 'Student'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedAttempt && (
            <div className="space-y-6 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{selectedAttempt.score}%</p>
                  <p className="text-sm text-muted-foreground">Score</p>
                </div>
                <Badge variant={selectedAttempt.score >= 80 ? 'default' : 'secondary'}>
                  {selectedAttempt.score >= 80 ? 'Passed' : 'Review Needed'}
                </Badge>
              </div>

              {selectedAttempt.topicGaps && selectedAttempt.topicGaps.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Focus Areas</AlertTitle>
                  <AlertDescription className="flex flex-wrap gap-1 mt-2">
                    {selectedAttempt.topicGaps.map((topic, i) => (
                      <Badge key={i} variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive">
                        {topic}
                      </Badge>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <h3 className="text-lg font-medium">Questions</h3>
                {selectedAttempt.questions?.map((q, index) => (
                  <Card key={index} className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{index + 1}. {q.text}</p>
                        <Badge variant={q.correct ? "default" : "destructive"}>
                          {q.correct ? 'Correct' : 'Incorrect'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 gap-2 pt-2">
                        {q.options?.map((option, optIdx) => {
                          const isStudentAnswer = q.studentAnswer === option;
                          const isCorrect = q.answer === option;
                          
                          let variant = "outline";
                          if (isStudentAnswer) variant = q.correct ? "default" : "destructive";
                          if (isCorrect && !q.correct) variant = "default"; // Highlight correct answer on failure

                          return (
                            <div key={optIdx} className="flex items-center gap-2">
                              <Badge variant={variant} className="w-full text-left justify-start">
                                {option}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>

                      {q.explanation && (
                        <p className="text-xs text-muted-foreground pt-2">
                          <span className="font-medium">Explanation:</span> {q.explanation}
                        </p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
