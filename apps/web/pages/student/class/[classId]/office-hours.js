import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { collection, query, where, getDocs, getDoc, addDoc, doc, serverTimestamp } from 'firebase/firestore';
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
import { Loader2, ArrowLeft, Clock, Calendar, ExternalLink, CheckCircle } from 'lucide-react';

function StudentOfficeHours() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  if (!router.isReady) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const [classData, setClassData] = useState(null);
  const [slots, setSlots] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookingSlotId, setBookingSlotId] = useState(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingReason, setBookingReason] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(null);

  useEffect(() => { if (classId && user) fetchData(); }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (classDoc.exists()) setClassData({ id: classDoc.id, ...classDoc.data() });

      const slotsQ = query(collection(db, 'officeHours'), where('classId', '==', classId));
      const slotsSnap = await getDocs(slotsQ);
      const s = []; slotsSnap.forEach(d => s.push({ id: d.id, ...d.data() })); setSlots(s);

      const bookQ = query(collection(db, 'officeHourBookings'), where('classId', '==', classId), where('studentId', '==', user.uid));
      const bookSnap = await getDocs(bookQ);
      const b = []; bookSnap.forEach(d => b.push({ id: d.id, ...d.data() })); setMyBookings(b);
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const handleBook = async (slot) => {
    if (!bookingDate) return;
    setIsBooking(true);
    try {
      const data = {
        classId, slotId: slot.id, studentId: user.uid,
        studentName: user.displayName || user.email,
        teacherId: slot.teacherId,
        date: bookingDate, day: slot.day,
        startTime: slot.startTime, endTime: slot.endTime,
        location: slot.location || '',
        reason: bookingReason.trim(),
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'officeHourBookings'), data);
      setMyBookings(prev => [...prev, { id: ref.id, ...data }]);

      // Notify teacher
      await addDoc(collection(db, 'notifications'), {
        senderId: user.uid, recipientId: slot.teacherId,
        notifType: 'system',
        title: `Office Hours: ${user.displayName || 'Student'} booked ${slot.day} ${fmtTime(slot.startTime)}`,
        message: bookingReason.trim() || 'No reason provided',
        href: `/teacher/class/${classId}/office-hours`,
        read: false, createdAt: serverTimestamp(),
      });

      setBookingSlotId(null); setBookingDate(''); setBookingReason('');
      setBookingSuccess(slot.id);
      setTimeout(() => setBookingSuccess(null), 3000);
    } catch (err) { console.error(err); }
    finally { setIsBooking(false); }
  };

  const fmtTime = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h>12?h-12:h||12}:${m.toString().padStart(2,'0')} ${h>=12?'PM':'AM'}`; };

  return (
    <>
      <Head><title>Office Hours - TikiTaka</title></Head>
      <Header />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/student/class/${classId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{classData?.name} — Office Hours</h1>
          <p className="text-sm text-muted-foreground mt-1">Book a time slot with your instructor.</p>
        </div>

        {isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <>
            {slots.length === 0 ? (
              <Card className="p-8 text-center rounded-2xl border-dashed"><p className="text-sm text-muted-foreground">Your teacher hasn't set up office hours yet.</p></Card>
            ) : (
              <div className="space-y-3">
                {slots.map(slot => {
                  const isExpanded = bookingSlotId === slot.id;
                  const isBooked = bookingSuccess === slot.id;
                  const alreadyBooked = myBookings.some(b => b.slotId === slot.id);
                  return (
                    <Card key={slot.id} className={cn('rounded-2xl overflow-hidden', isBooked && 'border-green-300 bg-green-50/30')}>
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{slot.day}</p>
                          <p className="text-xs text-muted-foreground">{fmtTime(slot.startTime)} - {fmtTime(slot.endTime)}{slot.location ? ` · ${slot.location}` : ''}</p>
                        </div>
                        {isBooked ? (
                          <Badge className="bg-green-50 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Booked!</Badge>
                        ) : alreadyBooked ? (
                          <Badge variant="secondary">Already booked</Badge>
                        ) : (
                          <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setBookingSlotId(isExpanded ? null : slot.id)}>
                            {isExpanded ? 'Cancel' : 'Book'}
                          </Button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="border-t p-4 space-y-3 bg-muted/5">
                          <div className="space-y-2">
                            <Label className="text-xs">Date</Label>
                            <Input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} min={new Date().toISOString().split('T')[0]} className="rounded-xl h-9" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Reason (optional)</Label>
                            <Input value={bookingReason} onChange={e => setBookingReason(e.target.value)} placeholder="What do you need help with?" className="rounded-xl h-9" maxLength={200} />
                          </div>
                          <Button onClick={() => handleBook(slot)} disabled={isBooking || !bookingDate} className="w-full rounded-xl">
                            {isBooking ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Calendar className="h-4 w-4 mr-2" /> Confirm Booking</>}
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {myBookings.length > 0 && (
              <div className="space-y-3 pt-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Your Bookings</h2>
                {myBookings.map(b => {
                  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Office Hours - ${classData?.name}`)}&dates=${b.date?.replace(/-/g,'')}T${b.startTime?.replace(':','')}00/${b.date?.replace(/-/g,'')}T${b.endTime?.replace(':','')}00&details=${encodeURIComponent(b.reason || 'Office hours meeting')}&location=${encodeURIComponent(b.location || '')}`;
                  return (
                    <Card key={b.id} className="p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{b.date} · {b.day}</p>
                        <p className="text-xs text-muted-foreground">{fmtTime(b.startTime)} - {fmtTime(b.endTime)}{b.location ? ` · ${b.location}` : ''}</p>
                      </div>
                      <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => window.open(gcalUrl, '_blank')}>
                        <ExternalLink className="h-3 w-3 mr-1" /> Add to Calendar
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
export default withAuth(StudentOfficeHours, 'student');
