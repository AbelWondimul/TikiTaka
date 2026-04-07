import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { collection, query, where, getDocs, getDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, ArrowLeft, Check, X, Clock, ChevronLeft, ChevronRight, Download } from 'lucide-react';

function AttendancePage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  if (!router.isReady) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendance, setAttendance] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { if (classId && user) fetchData(); }, [classId, user]);
  useEffect(() => { if (classId && user && classData) fetchAttendance(); }, [selectedDate]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (classDoc.exists()) {
        const cls = { id: classDoc.id, ...classDoc.data() };
        setClassData(cls);
        const studentList = await Promise.all(
          (cls.studentIds || []).map(async uid => {
            try {
              const u = await getDoc(doc(db, 'users', uid));
              return u.exists() ? { uid, ...u.data() } : { uid, displayName: 'Unknown', email: '' };
            } catch { return { uid, displayName: 'Unknown', email: '' }; }
          })
        );
        studentList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        setStudents(studentList);
      }
      await fetchAttendance();
    } catch (err) { console.error('Error:', err); }
    finally { setIsLoading(false); }
  };

  const fetchAttendance = async () => {
    try {
      const docId = `${classId}_${selectedDate}`;
      const attDoc = await getDoc(doc(db, 'attendance', docId));
      if (attDoc.exists()) {
        setAttendance(attDoc.data().records || {});
      } else {
        setAttendance({});
      }
    } catch (err) { console.error('Error fetching attendance:', err); }
  };

  const markAttendance = async (uid, status) => {
    const updated = { ...attendance, [uid]: status };
    setAttendance(updated);
    setIsSaving(true);
    try {
      const docId = `${classId}_${selectedDate}`;
      await setDoc(doc(db, 'attendance', docId), {
        classId,
        teacherId: user.uid,
        date: selectedDate,
        records: updated,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.error('Error saving attendance:', err); }
    finally { setIsSaving(false); }
  };

  const markAllPresent = () => {
    const all = {};
    students.forEach(s => { all[s.uid] = 'present'; });
    setAttendance(all);
    const docId = `${classId}_${selectedDate}`;
    setDoc(doc(db, 'attendance', docId), {
      classId, teacherId: user.uid, date: selectedDate, records: all, updatedAt: serverTimestamp(),
    }, { merge: true }).catch(err => console.error(err));
  };

  const shiftDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const presentCount = Object.values(attendance).filter(v => v === 'present').length;
  const absentCount = Object.values(attendance).filter(v => v === 'absent').length;
  const tardyCount = Object.values(attendance).filter(v => v === 'tardy').length;

  const isTA = classData && (classData.taIds || []).includes(user.uid);

  const exportCSV = () => {
    const headers = ['Student', 'Email', 'Status'];
    const rows = students.map(s => [s.displayName, s.email, attendance[s.uid] || 'unmarked']);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `attendance-${selectedDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head><title>Attendance - TikiTaka</title></Head>
      <Header />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{classData?.name} — Attendance</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={exportCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
            {!isTA && <Button variant="outline" size="sm" className="rounded-lg" onClick={markAllPresent}>All Present</Button>}
          </div>
        </div>

        {/* Date picker */}
        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-auto rounded-xl h-9 text-sm text-center" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        {/* Stats */}
        <div className="flex justify-center gap-3 flex-wrap">
          <Badge className="bg-green-50 text-green-700 border-green-200 px-3 py-1">{presentCount} Present</Badge>
          <Badge className="bg-red-50 text-red-700 border-red-200 px-3 py-1">{absentCount} Absent</Badge>
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1">{tardyCount} Tardy</Badge>
          <Badge variant="outline" className="px-3 py-1 text-muted-foreground">{students.length - presentCount - absentCount - tardyCount} Unmarked</Badge>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {students.map(s => {
              const status = attendance[s.uid] || 'unmarked';
              return (
                <Card key={s.uid} className={cn(
                  'p-3 rounded-xl flex items-center justify-between gap-3 transition-colors',
                  status === 'present' ? 'bg-green-50/50 border-green-200/50' :
                  status === 'absent' ? 'bg-red-50/50 border-red-200/50' :
                  status === 'tardy' ? 'bg-amber-50/50 border-amber-200/50' : 'border-border/50'
                )}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{s.displayName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{s.email}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => !isTA && markAttendance(s.uid, 'present')} disabled={isTA} className={cn('h-8 w-8 rounded-lg flex items-center justify-center transition-all', status === 'present' ? 'bg-green-600 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-green-100', isTA && 'cursor-not-allowed opacity-60')}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => !isTA && markAttendance(s.uid, 'tardy')} disabled={isTA} className={cn('h-8 w-8 rounded-lg flex items-center justify-center transition-all', status === 'tardy' ? 'bg-amber-500 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-amber-100', isTA && 'cursor-not-allowed opacity-60')}>
                      <Clock className="h-4 w-4" />
                    </button>
                    <button onClick={() => !isTA && markAttendance(s.uid, 'absent')} disabled={isTA} className={cn('h-8 w-8 rounded-lg flex items-center justify-center transition-all', status === 'absent' ? 'bg-red-600 text-white' : 'bg-muted/50 text-muted-foreground hover:bg-red-100', isTA && 'cursor-not-allowed opacity-60')}>
                      <X className="h-4 w-4" />
                    </button>
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
export default withAuth(AttendancePage, ['teacher', 'ta']);
