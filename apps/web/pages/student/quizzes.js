import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import { getRelativeTime } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Brain, Trophy, Target, Play, Clock, CheckCircle, ChevronRight } from 'lucide-react';
import StudentNavTabs from '@/components/layout/StudentNavTabs';

function StudentQuizzes() {
  const { user } = useAuth();
  const router = useRouter();
  const [classes, setClasses] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('all');

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Classes
      const classesQ = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const classesSnap = await getDocs(classesQ);
      const cls = []; classesSnap.forEach(d => cls.push({ id: d.id, ...d.data() }));
      setClasses(cls);

      // Quizzes across all enrolled classes
      const classIds = cls.map(c => c.id);
      let allQuizzes = [];
      for (let i = 0; i < classIds.length; i += 10) {
        const batch = classIds.slice(i, i + 10);
        const quizQ = query(collection(db, 'quizzes'), where('classId', 'in', batch), where('isActive', '==', true));
        const snap = await getDocs(quizQ);
        snap.forEach(d => allQuizzes.push({ id: d.id, ...d.data() }));
      }
      allQuizzes.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setQuizzes(allQuizzes);

      // My attempts
      const attQ = query(collection(db, 'quizAttempts'), where('studentId', '==', user.uid));
      const attSnap = await getDocs(attQ);
      const atts = []; attSnap.forEach(d => atts.push({ id: d.id, ...d.data() }));
      atts.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setAttempts(atts);
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const classMap = {}; classes.forEach(c => { classMap[c.id] = c; });

  const filteredQuizzes = selectedClass === 'all' ? quizzes : quizzes.filter(q => q.classId === selectedClass);

  // Stats
  const totalAttempts = attempts.length;
  const avgScore = (() => {
    const scored = attempts.filter(a => a.score != null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length);
  })();
  const bestScore = attempts.length > 0 ? Math.max(...attempts.filter(a => a.score != null).map(a => a.score), 0) : null;

  const getAttemptsForQuiz = (quizId) => attempts.filter(a => a.quizId === quizId);

  return (
    <>
      <Head><title>Quizzes - TikiTaka</title></Head>
      <Header />
      <StudentNavTabs active="quizzes" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Quizzes</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-generated quizzes that adapt to your weak areas.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-4 text-center">
              <Trophy className="h-5 w-5 mx-auto text-amber-500 mb-1" />
              <p className="text-xl font-extrabold">{totalAttempts}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Attempts</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-4 text-center">
              <Target className="h-5 w-5 mx-auto text-blue-600 mb-1" />
              <p className={cn('text-xl font-extrabold', avgScore != null ? (avgScore >= 80 ? 'text-green-600' : avgScore >= 60 ? 'text-amber-600' : 'text-red-600') : 'text-muted-foreground')}>{avgScore != null ? `${avgScore}%` : '--'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Average</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-4 text-center">
              <CheckCircle className="h-5 w-5 mx-auto text-green-600 mb-1" />
              <p className={cn('text-xl font-extrabold', bestScore != null ? 'text-green-600' : 'text-muted-foreground')}>{bestScore != null ? `${bestScore}%` : '--'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Best</p>
            </CardContent>
          </Card>
        </div>

        {/* Class filter */}
        <Select value={selectedClass} onValueChange={setSelectedClass}>
          <SelectTrigger className="w-[200px] rounded-xl h-9 text-sm"><SelectValue placeholder="All Classes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            {/* Available Quizzes */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold tracking-tight">Available Quizzes</h2>
              {filteredQuizzes.length === 0 ? (
                <Card className="p-10 rounded-2xl text-center border-dashed">
                  <Brain className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No quizzes available{selectedClass !== 'all' ? ' for this class' : ''}.</p>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredQuizzes.map(quiz => {
                    const cls = classMap[quiz.classId];
                    const myAttempts = getAttemptsForQuiz(quiz.id);
                    const bestAttempt = myAttempts.length > 0 ? Math.max(...myAttempts.map(a => a.score || 0)) : null;
                    return (
                      <Card key={quiz.id} className="rounded-2xl hover:shadow-md transition-all group overflow-hidden">
                        <div className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold group-hover:text-primary transition-colors">{quiz.title}</p>
                              {cls && <Badge variant="secondary" className="text-[9px] mt-1">{cls.name}</Badge>}
                            </div>
                            {bestAttempt != null && (
                              <Badge className={cn('shrink-0 text-[10px]', bestAttempt >= 80 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                                Best: {bestAttempt}%
                              </Badge>
                            )}
                          </div>
                          {quiz.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{quiz.description}</p>}
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">{myAttempts.length} attempt{myAttempts.length !== 1 ? 's' : ''}</span>
                            <Button size="sm" className="rounded-xl text-xs" onClick={() => router.push(`/student/quiz/${quiz.classId}?quizId=${quiz.id}`)}>
                              <Play className="h-3.5 w-3.5 mr-1" /> {myAttempts.length > 0 ? 'Retry' : 'Start'}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Attempts */}
            {attempts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-bold tracking-tight">Recent Attempts</h2>
                <div className="space-y-2">
                  {attempts.slice(0, 10).map(att => {
                    const cls = classMap[att.classId];
                    const quiz = quizzes.find(q => q.id === att.quizId);
                    return (
                      <Card key={att.id} className="rounded-xl p-3 flex items-center justify-between group cursor-pointer hover:border-primary/30 transition-colors"
                        onClick={() => router.push(`/student/quizzes/${att.classId}/history`)}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{quiz?.title || 'Quiz'}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                            {cls && <span>{cls.name}</span>}
                            <span>{getRelativeTime(att.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn('text-sm font-bold tabular-nums', att.score >= 80 ? 'text-green-600' : att.score >= 60 ? 'text-amber-600' : 'text-red-600')}>{att.score}%</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
export default withAuth(StudentQuizzes, 'student');
