import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleClasses } from '@/lib/classUtils';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { getRelativeTime } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
  Filter,
} from 'lucide-react';

function TeacherSubmissions() {
  const { user, role } = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('all');
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('all');
  const [gradingJobs, setGradingJobs] = useState([]);
  const [studentProfiles, setStudentProfiles] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  // Read status filter from URL query param
  useEffect(() => {
    if (router.isReady && router.query.status) {
      setStatusFilter(router.query.status);
    }
  }, [router.isReady, router.query.status]);

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch all classes (owned + TA)
      const cls = await getAccessibleClasses(user.uid, role);
      setClasses(cls);

      // 2. Fetch all assignments across classes
      const allAssignments = [];
      const classIds = cls.map(c => c.id);
      for (let i = 0; i < classIds.length; i += 10) {
        const batch = classIds.slice(i, i + 10);
        const assignQ = query(collection(db, 'assignments'), where('classId', 'in', batch));
        const assignSnap = await getDocs(assignQ);
        assignSnap.forEach(d => allAssignments.push({ id: d.id, ...d.data() }));
      }
      allAssignments.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setAssignments(allAssignments);

      // 3. Fetch all grading jobs (owned + TA classes)
      const taClassIds = cls.filter(c => c._isTA).map(c => c.id);
      const jobs = [];
      const seenJobIds = new Set();

      const jobsQ = query(collection(db, 'gradingJobs'), where('teacherId', '==', user.uid));
      const jobsSnap = await getDocs(jobsQ);
      jobsSnap.forEach(d => { jobs.push({ id: d.id, ...d.data() }); seenJobIds.add(d.id); });

      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taSnap = await getDocs(query(collection(db, 'gradingJobs'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taSnap.forEach(d => { if (!seenJobIds.has(d.id)) { jobs.push({ id: d.id, ...d.data() }); seenJobIds.add(d.id); } });
        }
      }

      setGradingJobs(jobs);

      // 4. Fetch student profiles for all enrolled students
      const allStudentIds = new Set();
      cls.forEach(c => (c.studentIds || []).forEach(uid => allStudentIds.add(uid)));
      const profiles = {};
      await Promise.all(
        [...allStudentIds].map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) profiles[uid] = userDoc.data();
          } catch (_) {}
        })
      );
      setStudentProfiles(profiles);
    } catch (err) {
      console.error('Error fetching submissions data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Derive filtered data
  const filteredClasses = selectedClassId === 'all' ? classes : classes.filter(c => c.id === selectedClassId);
  const filteredAssignments = assignments.filter(a => {
    if (selectedClassId !== 'all' && a.classId !== selectedClassId) return false;
    if (selectedAssignmentId !== 'all' && a.id !== selectedAssignmentId) return false;
    return true;
  });
  const assignmentsForClassFilter = selectedClassId === 'all' ? assignments : assignments.filter(a => a.classId === selectedClassId);

  // Build student rows for the selected assignment(s)
  const buildStudentRows = () => {
    const rows = [];
    const now = new Date();

    filteredClasses.forEach(cls => {
      const classAssignments = filteredAssignments.filter(a => a.classId === cls.id);
      if (classAssignments.length === 0) return;

      (cls.studentIds || []).forEach(uid => {
        const profile = studentProfiles[uid] || {};

        classAssignments.forEach(assignment => {
          const job = gradingJobs.find(j => j.assignmentId === assignment.id && j.studentId === uid);
          const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : (assignment.dueDate ? new Date(assignment.dueDate) : null);
          const isOverdue = dueDate && dueDate < now;

          let status = 'not_submitted';
          let score = null;
          if (job) {
            if (job.status === 'complete' && job.score != null) {
              status = 'graded';
              score = job.score;
            } else if (job.status === 'error') {
              status = 'error';
            } else {
              status = 'processing';
            }
          } else if (isOverdue) {
            status = 'missing';
          }

          rows.push({
            key: `${uid}-${assignment.id}`,
            uid,
            displayName: profile.displayName || profile.email || uid,
            email: profile.email || '',
            classId: cls.id,
            className: cls.name,
            assignmentId: assignment.id,
            assignmentTitle: assignment.title,
            totalPoints: assignment.totalPoints || 100,
            dueDate,
            status,
            score,
            jobId: job?.id,
            submittedAt: job?.submittedAt || job?.createdAt,
          });
        });
      });
    });

    // Sort: missing first, then not submitted, then processing, then graded
    const statusOrder = { missing: 0, not_submitted: 1, error: 2, processing: 3, graded: 4 };
    rows.sort((a, b) => (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5));

    return rows;
  };

  const studentRows = isLoading ? [] : buildStudentRows();

  const statusConfig = {
    graded: { label: 'Graded', color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle },
    processing: { label: 'Processing', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Clock },
    not_submitted: { label: 'Not Submitted', color: 'bg-slate-50 text-slate-500 border-slate-200', icon: FileText },
    missing: { label: 'Missing', color: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
    error: { label: 'Error', color: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
  };

  // Stats
  const gradedCount = studentRows.filter(r => r.status === 'graded').length;
  const missingCount = studentRows.filter(r => r.status === 'missing').length;
  const pendingCount = studentRows.filter(r => r.status === 'processing').length;
  const notSubmittedCount = studentRows.filter(r => r.status === 'not_submitted').length;

  return (
    <TeacherLayout activePage="submissions">
      <Head>
        <title>Submissions - TikiTaka</title>
      </Head>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Submissions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and track assignment submissions across all your classes.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Filter:</span>
          </div>
          <Select value={selectedClassId} onValueChange={(v) => { setSelectedClassId(v); setSelectedAssignmentId('all'); }}>
            <SelectTrigger className="w-[200px] rounded-xl h-9 text-sm">
              <SelectValue placeholder="All Classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classes.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedAssignmentId} onValueChange={setSelectedAssignmentId}>
            <SelectTrigger className="w-[250px] rounded-xl h-9 text-sm">
              <SelectValue placeholder="All Assignments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignments</SelectItem>
              {assignmentsForClassFilter.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] rounded-xl h-9 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending / Processing</SelectItem>
              <SelectItem value="graded">Graded</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
              <SelectItem value="not_submitted">Not Submitted</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats row */}
        {!isLoading && studentRows.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <Badge variant="outline" className={cn("px-3 py-1 text-xs font-semibold cursor-pointer transition-colors", statusFilter === 'graded' ? 'bg-green-200 text-green-900 border-green-400' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100')} onClick={() => setStatusFilter(statusFilter === 'graded' ? 'all' : 'graded')}>
              {gradedCount} Graded
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-xs font-semibold cursor-pointer transition-colors", statusFilter === 'pending' ? 'bg-blue-200 text-blue-900 border-blue-400' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100')} onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}>
              {pendingCount} Processing
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-xs font-semibold cursor-pointer transition-colors", statusFilter === 'not_submitted' ? 'bg-slate-200 text-slate-900 border-slate-400' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100')} onClick={() => setStatusFilter(statusFilter === 'not_submitted' ? 'all' : 'not_submitted')}>
              {notSubmittedCount} Not Submitted
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-xs font-semibold cursor-pointer transition-colors", statusFilter === 'missing' ? 'bg-red-200 text-red-900 border-red-400' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100')} onClick={() => setStatusFilter(statusFilter === 'missing' ? 'all' : 'missing')}>
              {missingCount} Missing
            </Badge>
          </div>
        )}

        {/* Apply status filter */}
        {(() => {
          const displayRows = statusFilter === 'all' ? studentRows : studentRows.filter(r => {
            if (statusFilter === 'pending') return r.status === 'processing' || r.status === 'error';
            return r.status === statusFilter;
          });

          return <>
        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
            <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No submissions found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {assignments.length === 0 ? 'Create assignments first to track submissions.' : 'Adjust your filters to see submissions.'}
            </p>
          </div>
        ) : (
          <Card className="rounded-2xl border-border/50 overflow-hidden shadow-sm">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold min-w-[180px]">Student</TableHead>
                    {selectedClassId === 'all' && <TableHead className="font-semibold min-w-[120px]">Class</TableHead>}
                    <TableHead className="font-semibold min-w-[180px]">Assignment</TableHead>
                    <TableHead className="font-semibold text-center min-w-[100px]">Status</TableHead>
                    <TableHead className="font-semibold text-center min-w-[80px]">Score</TableHead>
                    <TableHead className="font-semibold text-center min-w-[100px]">Submitted</TableHead>
                    <TableHead className="font-semibold text-center w-[80px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((row) => {
                    const sc = statusConfig[row.status] || statusConfig.not_submitted;
                    const StatusIcon = sc.icon;

                    return (
                      <TableRow key={row.key} className="hover:bg-muted/20 transition-colors">
                        {/* Student */}
                        <TableCell>
                          <Link href={`/teacher/class/${row.classId}/student/${row.uid}`} className="group">
                            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{row.displayName}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{row.email}</p>
                          </Link>
                        </TableCell>

                        {/* Class */}
                        {selectedClassId === 'all' && (
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] font-semibold">{row.className}</Badge>
                          </TableCell>
                        )}

                        {/* Assignment */}
                        <TableCell>
                          <p className="text-sm font-medium truncate">{row.assignmentTitle}</p>
                          {row.dueDate && (
                            <p className="text-[10px] text-muted-foreground">
                              Due: {row.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center">
                          <Badge variant="outline" className={cn('text-[10px] font-bold px-2 py-0.5', sc.color)}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {sc.label}
                          </Badge>
                        </TableCell>

                        {/* Score */}
                        <TableCell className="text-center">
                          {row.score != null ? (
                            <span className={cn(
                              'text-sm font-bold tabular-nums',
                              (row.score / row.totalPoints) >= 0.8 ? 'text-green-600' :
                              (row.score / row.totalPoints) >= 0.6 ? 'text-amber-600' : 'text-red-600'
                            )}>
                              {row.score}/{row.totalPoints}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                        </TableCell>

                        {/* Submitted time */}
                        <TableCell className="text-center">
                          <span className="text-xs text-muted-foreground">
                            {row.submittedAt ? getRelativeTime(row.submittedAt) : '--'}
                          </span>
                        </TableCell>

                        {/* Action */}
                        <TableCell className="text-center">
                          {row.jobId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs rounded-lg"
                              onClick={() => router.push(`/teacher/homework/${row.assignmentId}/submissions/${row.jobId}`)}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
        </>;
        })()}
      </div>
    </TeacherLayout>
  );
}

export default withAuth(TeacherSubmissions, ['teacher', 'ta']);
