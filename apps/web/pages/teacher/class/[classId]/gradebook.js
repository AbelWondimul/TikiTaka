import { useEffect, useState, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection, query, where, getDocs, getDoc, doc, updateDoc, addDoc, serverTimestamp, onSnapshot
} from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Loader2, ArrowLeft, Download, Save, CheckCircle, AlertTriangle, FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';
import InsightsPanel from '@/components/teacher/InsightsPanel';
import QuickGenerateModal from '@/components/teacher/QuickGenerateModal';

function GradebookPage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [gradingJobs, setGradingJobs] = useState([]);
  const [attendanceData, setAttendanceData] = useState(null); // { uid: pct }
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inline editing state
  const [editingCell, setEditingCell] = useState(null); // "uid_assignmentId"
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // Sort
  const [sortOrder, setSortOrder] = useState('asc');

  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);

  const [insights, setInsights] = useState(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatePrefill, setGeneratePrefill] = useState('');

  useEffect(() => {
    if (classId && user) fetchAll();
  }, [classId, user]);

  useEffect(() => {
    if (assignments.length > 0 && !selectedAssignmentId) {
      setSelectedAssignmentId(assignments[0].id);
    }
  }, [assignments, selectedAssignmentId]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    const unsub = onSnapshot(doc(db, 'assignmentInsights', selectedAssignmentId), snap => {
      setInsights(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [selectedAssignmentId]);

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      // 1. Class data
      const classSnap = await getDoc(doc(db, 'classes', classId));
      if (!classSnap.exists()) { setError('Class not found.'); setIsLoading(false); return; }
      const cls = { id: classSnap.id, ...classSnap.data() };

      const isOwner = cls.teacherId === user.uid;
      const isTA = (cls.taIds || []).includes(user.uid);
      if (!isOwner && !isTA) { setError('No permission.'); setIsLoading(false); return; }

      setClassData(cls);

      // 2. Students
      const studentList = await Promise.all(
        (cls.studentIds || []).map(async uid => {
          try {
            const u = await getDoc(doc(db, 'users', uid));
            return u.exists() ? { uid, ...u.data() } : { uid, displayName: 'Unknown', email: '' };
          } catch { return { uid, displayName: 'Unknown', email: '' }; }
        })
      );
      setStudents(studentList);

      // 3. Assignments
      const assignQ = isOwner
        ? query(collection(db, 'assignments'), where('classId', '==', classId), where('teacherId', '==', user.uid))
        : query(collection(db, 'assignments'), where('classId', '==', classId));
      const assignSnap = await getDocs(assignQ);
      const assigns = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      assigns.sort((a, b) => {
        const da = a.createdAt?.toMillis?.() || 0;
        const db2 = b.createdAt?.toMillis?.() || 0;
        return da - db2;
      });
      setAssignments(assigns);

      // 4. Grading jobs
      const jobsQ = isOwner
        ? query(collection(db, 'gradingJobs'), where('classId', '==', classId), where('teacherId', '==', user.uid))
        : query(collection(db, 'gradingJobs'), where('classId', '==', classId));
      const jobsSnap = await getDocs(jobsQ);
      setGradingJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // 5. Attendance (if enabled)
      if (cls.attendanceGradeEnabled) {
        const attQ = query(collection(db, 'attendance'), where('classId', '==', classId));
        const attSnap = await getDocs(attQ);
        const records = attSnap.docs.map(d => d.data());
        const totalSessions = records.length;
        const freebies = cls.attendanceFreebieAbsences ?? 3;
        const attMap = {};

        if (totalSessions > 0) {
          for (const student of studentList) {
            let absences = 0;
            for (const rec of records) {
              const status = rec.records?.[student.uid];
              if (status && status !== 'present') absences++;
            }
            const effective = Math.max(0, absences - freebies);
            attMap[student.uid] = Math.round(((totalSessions - effective) / totalSessions) * 100);
          }
        }
        setAttendanceData(attMap);
      }
    } catch (err) {
      console.error('Error loading gradebook:', err);
      setError('Failed to load gradebook.');
    } finally {
      setIsLoading(false);
    }
  };

  // Get best grading job for a student+assignment (highest score if multiple)
  const getJob = (uid, assignmentId) => {
    const jobs = gradingJobs.filter(j => j.studentId === uid && j.assignmentId === assignmentId && j.status === 'complete');
    if (jobs.length === 0) return null;
    return jobs.reduce((best, j) => (j.score ?? 0) > (best.score ?? 0) ? j : best, jobs[0]);
  };

  // Calculate overall grade for a student
  const calcOverall = (uid) => {
    const pcts = [];
    for (const a of assignments) {
      const job = getJob(uid, a.id);
      if (job && job.score != null) {
        pcts.push((job.score / (a.totalPoints || 100)) * 100);
      }
    }
    if (pcts.length === 0) return null;

    let arr = [...pcts];

    // Drop lowest
    if (classData?.dropLowest && arr.length > 1) {
      const attLinked = classData.dropLowestAttendanceLinked;
      const minAtt = classData.dropLowestMinAttendance ?? 90;
      const canDrop = !attLinked || (attendanceData?.[uid] ?? 100) >= minAtt;
      if (canDrop) {
        arr.sort((a, b) => a - b);
        arr = arr.slice(1);
      }
    }

    let assignmentAvg = arr.reduce((a, b) => a + b, 0) / arr.length;

    // Attendance weighting
    if (classData?.attendanceGradeEnabled && attendanceData) {
      const weight = classData.attendanceGradeWeight ?? 10;
      const attPct = attendanceData[uid] ?? 100;
      assignmentAvg = (assignmentAvg * (100 - weight) / 100) + (attPct * weight / 100);
    }

    // Grade cap
    if (classData?.attendanceGradeEnabled && classData?.attendanceGradeCap && attendanceData) {
      const capMin = classData.attendanceCapMinPct ?? 80;
      const capMax = classData.attendanceCapMaxGrade ?? 80;
      if ((attendanceData[uid] ?? 100) < capMin) {
        assignmentAvg = Math.min(assignmentAvg, capMax);
      }
    }

    return Math.round(assignmentAvg * 10) / 10;
  };

  const getLetterGrade = (pct) => {
    if (pct == null) return '--';
    if (pct >= 93) return 'A';
    if (pct >= 90) return 'A-';
    if (pct >= 87) return 'B+';
    if (pct >= 83) return 'B';
    if (pct >= 80) return 'B-';
    if (pct >= 77) return 'C+';
    if (pct >= 73) return 'C';
    if (pct >= 70) return 'C-';
    if (pct >= 67) return 'D+';
    if (pct >= 60) return 'D';
    return 'F';
  };

  const getGradeColor = (pct) => {
    if (pct == null) return '';
    if (pct >= 90) return 'text-green-600 dark:text-green-400';
    if (pct >= 80) return 'text-blue-600 dark:text-blue-400';
    if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Edit a grade
  const handleSaveGrade = async (uid, assignmentId) => {
    const newScore = parseFloat(editValue);
    if (isNaN(newScore) || newScore < 0) { setEditingCell(null); return; }

    setIsSaving(true);
    try {
      const existingJob = getJob(uid, assignmentId);
      if (existingJob) {
        await updateDoc(doc(db, 'gradingJobs', existingJob.id), { score: newScore });
        setGradingJobs(prev => prev.map(j => j.id === existingJob.id ? { ...j, score: newScore } : j));
      } else {
        // Create a stub grading job
        const assignment = assignments.find(a => a.id === assignmentId);
        const newJob = await addDoc(collection(db, 'gradingJobs'), {
          status: 'complete',
          studentId: uid,
          classId,
          assignmentId,
          assignmentTitle: assignment?.title || '',
          teacherId: classData.teacherId,
          score: newScore,
          totalPoints: assignment?.totalPoints || 100,
          rubric: assignment?.rubric || {},
          rubricType: 'text',
          rawPdfUrl: null,
          resultPdfUrl: null,
          gradedQuestions: [],
          createdAt: serverTimestamp(),
          completedAt: serverTimestamp(),
        });
        setGradingJobs(prev => [...prev, {
          id: newJob.id, status: 'complete', studentId: uid, assignmentId,
          score: newScore, totalPoints: assignment?.totalPoints || 100, classId
        }]);
      }
      setSaveSuccess(`${editingCell}`);
      setTimeout(() => setSaveSuccess(null), 1500);
    } catch (err) {
      console.error('Error saving grade:', err);
    } finally {
      setIsSaving(false);
      setEditingCell(null);
    }
  };

  // Build export rows (shared by CSV and XLSX)
  const buildExportRows = () => {
    const headers = ['Student', 'Email', ...assignments.map(a => a.title || 'Untitled')];
    if (attendanceData) headers.push('Attendance %');
    headers.push('Overall %', 'Letter');
    const rows = [headers];

    for (const s of sortedStudents) {
      const row = [s.displayName || '', s.email || ''];
      for (const a of assignments) {
        const job = getJob(s.uid, a.id);
        row.push(job?.score != null ? job.score : '');
      }
      if (attendanceData) row.push(attendanceData[s.uid] ?? '');
      const overall = calcOverall(s.uid);
      row.push(overall != null ? overall : '');
      row.push(overall != null ? getLetterGrade(overall) : '');
      rows.push(row);
    }
    return rows;
  };

  const fileName = (classData?.name || 'gradebook').replace(/[^a-z0-9]/gi, '_') + '_gradebook';

  // CSV export
  const handleExportCSV = () => {
    const rows = buildExportRows();
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // XLSX export with auto-fitted column widths
  const handleExportXLSX = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto-fit column widths
    const colWidths = rows[0].map((_, colIdx) => {
      let maxLen = 0;
      for (const row of rows) {
        const val = String(row[colIdx] ?? '');
        maxLen = Math.max(maxLen, val.length);
      }
      return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
    });
    ws['!cols'] = colWidths;

    // Bold header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = { font: { bold: true } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gradebook');
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  // Sorted students
  const sortedStudents = [...students].sort((a, b) => {
    const lastA = (a.displayName || '').trim().split(' ').pop().toLowerCase();
    const lastB = (b.displayName || '').trim().split(' ').pop().toLowerCase();
    return sortOrder === 'asc' ? lastA.localeCompare(lastB) : lastB.localeCompare(lastA);
  });

  const pagedStudents = useMemo(
    () => sortedStudents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sortedStudents, page]
  );

  if (!router.isReady || isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (error) return (
    <div className="max-w-md mx-auto mt-12 p-6 space-y-4">
      <p className="text-destructive font-medium">{error}</p>
      <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
    </div>
  );

  const isClassOwner = classData?.teacherId === user.uid;

  return (
    <>
      <Head><title>Gradebook - {classData?.name || 'Class'}</title></Head>
      <div className="max-w-[95vw] mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Gradebook</h1>
              <p className="text-sm text-muted-foreground">{classData?.name} — {students.length} students, {assignments.length} assignments</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" onClick={handleExportXLSX}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
          </div>
        </div>

        {/* Settings summary */}
        <div className="flex flex-wrap gap-2 text-xs">
          {classData?.dropLowest && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800">
              Drop Lowest {classData.dropLowestAttendanceLinked ? `(Attendance >= ${classData.dropLowestMinAttendance ?? 90}%)` : ''}
            </Badge>
          )}
          {classData?.attendanceGradeEnabled && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800">
              Attendance: {classData.attendanceGradeWeight ?? 10}% weight
            </Badge>
          )}
          {classData?.attendanceGradeCap && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800">
              Grade Cap: {classData.attendanceCapMaxGrade ?? 80}% below {classData.attendanceCapMinPct ?? 80}% attendance
            </Badge>
          )}
        </div>

        <InsightsPanel
          insights={insights}
          classId={classId}
          onGenerateRetouchQuiz={(question, topics) => {
            const topicStr = topics.slice(0, 2).join(', ');
            setGeneratePrefill(`Re-teaching quiz on ${question.questionId} mistakes${topicStr ? ` — topics: ${topicStr}` : ''}`);
            setShowGenerateModal(true);
          }}
        />

        <QuickGenerateModal
          open={showGenerateModal}
          onClose={() => setShowGenerateModal(false)}
          classId={classId}
          prefill={generatePrefill}
          onGenerated={(data) => {
            const encoded = encodeURIComponent(JSON.stringify(data));
            router.push(`/teacher/assignment-builder/${classId}?generated=${encoded}`);
          }}
        />

        {/* Gradebook Table */}
        {students.length === 0 || assignments.length === 0 ? (
          <Card className="p-12 text-center border-dashed rounded-2xl">
            <p className="text-muted-foreground">{students.length === 0 ? 'No students enrolled.' : 'No assignments created yet.'}</p>
          </Card>
        ) : (
          <div className="border rounded-xl overflow-auto bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead
                    className="sticky left-0 bg-muted/30 z-10 min-w-[180px] cursor-pointer select-none"
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  >
                    Student {sortOrder === 'asc' ? '(A-Z)' : '(Z-A)'}
                  </TableHead>
                  {assignments.map(a => (
                    <TableHead key={a.id} className="text-center min-w-[100px]">
                      <div className="text-xs font-semibold truncate max-w-[120px]" title={a.title}>{a.title}</div>
                      <div className="text-[10px] text-muted-foreground font-normal">/{a.totalPoints || 100}</div>
                    </TableHead>
                  ))}
                  {attendanceData && (
                    <TableHead className="text-center min-w-[80px]">
                      <div className="text-xs font-semibold">Attend.</div>
                    </TableHead>
                  )}
                  <TableHead className="text-center min-w-[80px] bg-muted/50">
                    <div className="text-xs font-semibold">Overall</div>
                  </TableHead>
                  <TableHead className="text-center min-w-[60px] bg-muted/50">
                    <div className="text-xs font-semibold">Grade</div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedStudents.map(student => {
                  const overall = calcOverall(student.uid);
                  return (
                    <TableRow key={student.uid} className="hover:bg-muted/20">
                      {/* Student name — sticky */}
                      <TableCell className="sticky left-0 bg-card z-10 border-r">
                        <div className="font-medium text-sm truncate max-w-[170px]">{student.displayName || 'Unknown'}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{student.email}</div>
                      </TableCell>

                      {/* Grade cells */}
                      {assignments.map(a => {
                        const job = getJob(student.uid, a.id);
                        const score = job?.score;
                        const cellKey = `${student.uid}_${a.id}`;
                        const isEditing = editingCell === cellKey;
                        const justSaved = saveSuccess === cellKey;

                        return (
                          <TableCell key={a.id} className="text-center p-1">
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.5"
                                min="0"
                                max={a.totalPoints || 100}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveGrade(student.uid, a.id);
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                onBlur={() => handleSaveGrade(student.uid, a.id)}
                                className="w-16 h-7 text-center text-sm mx-auto"
                                autoFocus
                                disabled={isSaving}
                              />
                            ) : (
                              <button
                                className={cn(
                                  'w-full h-full min-h-[32px] rounded-md text-sm font-medium transition-colors',
                                  score != null ? 'hover:bg-primary/10' : 'hover:bg-muted text-muted-foreground',
                                  justSaved && 'bg-green-50 dark:bg-green-950/20',
                                  !isClassOwner && 'cursor-default'
                                )}
                                onClick={() => {
                                  if (!isClassOwner) return;
                                  setEditingCell(cellKey);
                                  setEditValue(score != null ? String(score) : '');
                                }}
                                title={isClassOwner ? 'Click to edit' : ''}
                              >
                                {justSaved ? (
                                  <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                                ) : score != null ? (
                                  <span className={cn(
                                    (score / (a.totalPoints || 100)) >= 0.9 ? 'text-green-600 dark:text-green-400' :
                                    (score / (a.totalPoints || 100)) >= 0.7 ? 'text-foreground' :
                                    'text-red-600 dark:text-red-400'
                                  )}>
                                    {score}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/40">--</span>
                                )}
                              </button>
                            )}
                          </TableCell>
                        );
                      })}

                      {/* Attendance */}
                      {attendanceData && (
                        <TableCell className="text-center">
                          <span className={cn('text-sm font-medium', getGradeColor(attendanceData[student.uid]))}>
                            {attendanceData[student.uid] ?? '--'}%
                          </span>
                        </TableCell>
                      )}

                      {/* Overall */}
                      <TableCell className="text-center bg-muted/10">
                        <span className={cn('text-sm font-bold', getGradeColor(overall))}>
                          {overall != null ? `${overall}%` : '--'}
                        </span>
                      </TableCell>

                      {/* Letter */}
                      <TableCell className="text-center bg-muted/10">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs font-bold',
                            overall != null && overall >= 90 ? 'border-green-300 text-green-700 dark:text-green-400' :
                            overall != null && overall >= 80 ? 'border-blue-300 text-blue-700 dark:text-blue-400' :
                            overall != null && overall >= 70 ? 'border-amber-300 text-amber-700 dark:text-amber-400' :
                            overall != null ? 'border-red-300 text-red-700 dark:text-red-400' : ''
                          )}
                        >
                          {getLetterGrade(overall)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {sortedStudents.length > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 px-1">
                <span className="text-sm text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedStudents.length)} of {sortedStudents.length} students
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= sortedStudents.length}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Class averages */}
        {students.length > 0 && assignments.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {assignments.map(a => {
              const scores = students.map(s => getJob(s.uid, a.id)?.score).filter(s => s != null);
              const avg = scores.length > 0 ? (scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1) : null;
              return (
                <div key={a.id} className="text-center">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider truncate max-w-[100px]">{a.title}</p>
                  <p className="text-sm font-bold">{avg ?? '--'}<span className="text-muted-foreground font-normal">/{a.totalPoints || 100}</span></p>
                </div>
              );
            })}
            <div className="text-center border-l pl-4">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Class Avg</p>
              <p className="text-sm font-bold">
                {(() => {
                  const overalls = students.map(s => calcOverall(s.uid)).filter(o => o != null);
                  return overalls.length > 0 ? `${(overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1)}%` : '--';
                })()}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(GradebookPage, ['teacher', 'ta']);
