import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowLeft, Plus, Trash2, Clock, Calendar, ExternalLink, User } from 'lucide-react';
import { getRelativeTime } from '@/lib/dateUtils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function TeacherOfficeHours() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  if (!router.isReady) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const [classData, setClassData] = useState(null);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [studentMap, setStudentMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formDay, setFormDay] = useState('Monday');
  const [formStart, setFormStart] = useState('10:00');
  const [formEnd, setFormEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { if (classId && user) fetchData(); }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      const cls = classDoc.exists() ? { id: classDoc.id, ...classDoc.data() } : null;
      if (cls) setClassData(cls);

      const isTA = cls && (cls.taIds || []).includes(user.uid);
      const slotsQ = isTA
        ? query(collection(db, 'officeHours'), where('classId', '==', classId))
        : query(collection(db, 'officeHours'), where('classId', '==', classId), where('teacherId', '==', user.uid));
      const slotsSnap = await getDocs(slotsQ);
      const s = []; slotsSnap.forEach(d => s.push({ id: d.id, ...d.data() }));
      setSlots(s);

      const bookQ = query(collection(db, 'officeHourBookings'), where('classId', '==', classId));
      const bookSnap = await getDocs(bookQ);
      const b = []; bookSnap.forEach(d => b.push({ id: d.id, ...d.data() }));
      b.sort((a, b2) => (b2.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setBookings(b);

      const uids = [...new Set(b.map(bk => bk.studentId))];
      const map = {};
      await Promise.all(uids.map(async uid => {
        try { const u = await getDoc(doc(db, 'users', uid)); if (u.exists()) map[uid] = u.data(); } catch {}
      }));
      setStudentMap(map);
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const handleAddSlot = async () => {
    setIsSaving(true);
    try {
      const data = { classId, teacherId: user.uid, day: formDay, startTime: formStart, endTime: formEnd, location: formLocation.trim(), createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db, 'officeHours'), data);
      setSlots(prev => [...prev, { id: ref.id, ...data }]);
      setIsDialogOpen(false);
    } catch (err) { console.error(err); }
    finally { setIsSaving(false); }
  };

  const handleDeleteSlot = async (id) => {
    await deleteDoc(doc(db, 'officeHours', id));
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  const handleCancelBooking = async (booking) => {
    await deleteDoc(doc(db, 'officeHourBookings', booking.id));
    setBookings(prev => prev.filter(b => b.id !== booking.id));
  };

  const isTA = classData && (classData.taIds || []).includes(user.uid);

  const fmtTime = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h>12?h-12:h||12}:${m.toString().padStart(2,'0')} ${h>=12?'PM':'AM'}`; };

  return (
    <>
      <Head><title>Office Hours - TikiTaka</title></Head>
      <Header />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{classData?.name} — Office Hours</h1>
            <p className="text-sm text-muted-foreground mt-1">Set availability for students to book time with you.</p>
          </div>
          {!isTA && <Button onClick={() => setIsDialogOpen(true)} className="rounded-xl"><Plus className="h-4 w-4 mr-2" /> Add Slot</Button>}
        </div>

        {isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <>
            {/* Available Slots */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Available Slots</h2>
              {slots.length === 0 ? (
                <Card className="p-8 text-center rounded-2xl border-dashed"><p className="text-sm text-muted-foreground">No office hour slots set. Click "Add Slot" to create one.</p></Card>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {slots.map(s => (
                    <Card key={s.id} className="p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{s.day}</p>
                        <p className="text-xs text-muted-foreground">{fmtTime(s.startTime)} - {fmtTime(s.endTime)}{s.location ? ` · ${s.location}` : ''}</p>
                      </div>
                      {!isTA && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteSlot(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Bookings */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Bookings ({bookings.length})</h2>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No bookings yet.</p>
              ) : (
                <div className="space-y-2">
                  {bookings.map(b => {
                    const student = studentMap[b.studentId] || {};
                    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Office Hours: ${student.displayName || 'Student'}`)}&dates=${b.date?.replace(/-/g,'')}T${b.startTime?.replace(':','')}00/${b.date?.replace(/-/g,'')}T${b.endTime?.replace(':','')}00&details=${encodeURIComponent(`Office hours with ${student.displayName || 'student'} for ${classData?.name || 'class'}`)}&location=${encodeURIComponent(b.location || '')}`;
                    return (
                      <Card key={b.id} className="p-4 rounded-2xl flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="h-4 w-4 text-primary" /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{student.displayName || 'Student'}</p>
                            <p className="text-[10px] text-muted-foreground">{b.date} · {fmtTime(b.startTime)} - {fmtTime(b.endTime)}{b.reason ? ` · "${b.reason}"` : ''}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => window.open(gcalUrl, '_blank')}><Calendar className="h-3 w-3 mr-1" /> GCal</Button>
                          {!isTA && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleCancelBooking(b)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Office Hours Slot</DialogTitle><DialogDescription>Set a recurring weekly availability.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Day</Label>
              <Select value={formDay} onValueChange={setFormDay}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Start</Label><Input type="time" value={formStart} onChange={e => setFormStart(e.target.value)} className="rounded-xl" /></div>
              <div className="space-y-2"><Label>End</Label><Input type="time" value={formEnd} onChange={e => setFormEnd(e.target.value)} className="rounded-xl" /></div>
            </div>
            <div className="space-y-2"><Label>Location (optional)</Label><Input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="Room 301 or Zoom link" className="rounded-xl" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleAddSlot} disabled={isSaving} className="rounded-xl">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Slot'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export default withAuth(TeacherOfficeHours, ['teacher', 'ta']);
