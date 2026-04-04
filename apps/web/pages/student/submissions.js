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
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle, Clock, AlertTriangle, FileText, ExternalLink, Filter } from 'lucide-react';
import StudentNavTabs from '@/components/layout/StudentNavTabs';

function StudentSubmissions() {
  const { user } = useAuth();
  const router = useRouter();
  const [classes, setClasses] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => { if (user) fetchData(); }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classesQ = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const classesSnap = await getDocs(classesQ);
      const cls = []; classesSnap.forEach(d => cls.push({ id: d.id, ...d.data() }));
      setClasses(cls);

      const jobsQ = query(collection(db, 'gradingJobs'), where('studentId', '==', user.uid));
      const jobsSnap = await getDocs(jobsQ);
      const jobs = []; jobsSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
      jobs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setSubmissions(jobs);
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const classMap = {}; classes.forEach(c => { classMap[c.id] = c; });

  const filtered = submissions.filter(s => {
    if (filterClass !== 'all' && s.classId !== filterClass) return false;
    if (filterStatus === 'graded' && !(s.status === 'complete' && s.score != null)) return false;
    if (filterStatus === 'pending' && s.status === 'complete') return false;
    return true;
  });

  const gradedCount = submissions.filter(s => s.status === 'complete' && s.score != null).length;
  const pendingCount = submissions.filter(s => s.status !== 'complete').length;
  const avgScore = (() => {
    const graded = submissions.filter(s => s.status === 'complete' && s.score != null && s.totalPoints);
    if (graded.length === 0) return null;
    return Math.round(graded.reduce((sum, s) => sum + (s.score / s.totalPoints) * 100, 0) / graded.length);
  })();

  return (
    <>
      <Head><title>Submissions - TikiTaka</title></Head>
      <Header />
      <StudentNavTabs active="submissions" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Submissions</h1>
          <p className="text-sm text-muted-foreground mt-1">All your assignment submissions across classes.</p>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-3">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 px-3 py-1">{gradedCount} Graded</Badge>
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1">{pendingCount} Pending</Badge>
          {avgScore != null && <Badge variant="outline" className="px-3 py-1">Avg: {avgScore}%</Badge>}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterClass} onValueChange={setFilterClass}>
            <SelectTrigger className="w-[180px] rounded-xl h-9 text-sm"><SelectValue placeholder="All Classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px] rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="graded">Graded</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 rounded-2xl text-center border-dashed">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">{submissions.length === 0 ? 'No submissions yet' : 'No submissions match your filters'}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(sub => {
              const cls = classMap[sub.classId];
              const isGraded = sub.status === 'complete' && sub.score != null;
              const pct = isGraded && sub.totalPoints ? Math.round((sub.score / sub.totalPoints) * 100) : null;
              return (
                <Card
                  key={sub.id}
                  className={cn('rounded-2xl p-4 cursor-pointer hover:shadow-md transition-all group', isGraded ? 'border-green-200/50' : 'border-border/50')}
                  onClick={() => router.push(`/student/submission/${sub.id}`)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{sub.assignmentTitle || 'Assignment'}</p>
                        {isGraded ? (
                          <Badge className="bg-green-50 text-green-700 border-none text-[9px] shrink-0"><CheckCircle className="h-3 w-3 mr-0.5" /> Graded</Badge>
                        ) : sub.status === 'error' ? (
                          <Badge variant="destructive" className="text-[9px] shrink-0"><AlertTriangle className="h-3 w-3 mr-0.5" /> Error</Badge>
                        ) : (
                          <Badge className="bg-amber-50 text-amber-700 border-none text-[9px] shrink-0"><Clock className="h-3 w-3 mr-0.5" /> {sub.status}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {cls && <span>{cls.name}</span>}
                        <span>{getRelativeTime(sub.createdAt)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {isGraded ? (
                        <div>
                          <span className={cn('text-lg font-bold tabular-nums', pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600')}>{sub.score}</span>
                          <span className="text-xs text-muted-foreground">/{sub.totalPoints || 100}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
export default withAuth(StudentSubmissions, 'student');
