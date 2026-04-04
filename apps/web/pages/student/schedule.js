import { useEffect, useState } from 'react';
import Head from 'next/head';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, CalendarDays, FileText, Calendar, Copy, Check, ExternalLink } from 'lucide-react';
import StudentNavTabs from '@/components/layout/StudentNavTabs';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

const DAY_COLORS = [
  'bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-300',
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-300',
  'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
  'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300',
];

function formatHour(h) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function StudentSchedule() {
  const { user } = useAuth();
  const [scheduleBlocks, setScheduleBlocks] = useState([]);
  const [teacherNames, setTeacherNames] = useState({});
  const [assignmentBlocks, setAssignmentBlocks] = useState([]);
  const [allAssignmentsForExport, setAllAssignmentsForExport] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Calendar subscription
  const [calendarUrl, setCalendarUrl] = useState(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [showCalendarPanel, setShowCalendarPanel] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchSchedule();
  }, [user]);

  const fetchSchedule = async () => {
    setIsLoading(true);
    try {
      // 1. Get student's enrolled classes
      const classesQ = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const classesSnap = await getDocs(classesQ);
      const classIds = [];
      const classMap = {};
      classesSnap.forEach(d => {
        classIds.push(d.id);
        classMap[d.id] = d.data();
      });

      if (classIds.length === 0) {
        setScheduleBlocks([]);
        setIsLoading(false);
        return;
      }

      // 2. Fetch schedule blocks by classId (matches Firestore rules)
      let allBlocks = [];
      for (let i = 0; i < classIds.length; i += 10) {
        const batch = classIds.slice(i, i + 10);
        const schedQ = query(collection(db, 'schedules'), where('classId', 'in', batch));
        const schedSnap = await getDocs(schedQ);
        schedSnap.forEach(d => allBlocks.push({ id: d.id, ...d.data() }));
      }
      setScheduleBlocks(allBlocks);

      // 3. Fetch teacher names
      const teacherIds = [...new Set(allBlocks.map(b => b.teacherId).filter(Boolean))];
      const names = {};
      await Promise.all(teacherIds.map(async (tid) => {
        try {
          const userDoc = await getDoc(doc(db, 'users', tid));
          if (userDoc.exists()) names[tid] = userDoc.data().displayName || userDoc.data().email || 'Teacher';
        } catch (_) {}
      }));
      setTeacherNames(names);

      // 4. Fetch assignments with due dates for this week
      const allAssignments = [];
      for (let i = 0; i < classIds.length; i += 10) {
        const batch = classIds.slice(i, i + 10);
        const assignQ = query(collection(db, 'assignments'), where('classId', 'in', batch));
        const assignSnap = await getDocs(assignQ);
        assignSnap.forEach(d => allAssignments.push({ id: d.id, ...d.data() }));
      }

      // Convert assignments to schedule-like blocks on their due date
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 5); // Friday end

      // Save all assignments for calendar export
      setAllAssignmentsForExport(allAssignments.filter(a => a.dueDate).map(a => ({
        id: a.id,
        title: a.title,
        classId: a.classId,
        className: classMap[a.classId]?.name || 'Class',
        dueDate: a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate),
        totalPoints: a.totalPoints || 100,
      })));

      const aBlocks = allAssignments
        .filter(a => {
          if (!a.dueDate) return false;
          const d = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
          return d >= startOfWeek && d < endOfWeek;
        })
        .map(a => {
          const d = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
          const dayIndex = d.getDay() - 1; // 0=Mon
          const dayName = DAYS[Math.max(0, Math.min(4, dayIndex))];
          return {
            id: `assign-${a.id}`,
            type: 'assignment',
            classId: a.classId,
            className: classMap[a.classId]?.name || 'Class',
            title: a.title,
            day: dayName,
            dueDate: d,
            totalPoints: a.totalPoints || 100,
          };
        });
      setAssignmentBlocks(aBlocks);
    } catch (err) {
      console.error('Error fetching student schedule:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getBlocksAt = (day, hour) => {
    return scheduleBlocks.filter(b => {
      if (b.day !== day) return false;
      const [startH] = b.startTime.split(':').map(Number);
      const [endH, endM] = b.endTime.split(':').map(Number);
      const endHour = endM > 0 ? endH + 1 : endH;
      return hour >= startH && hour < endHour;
    });
  };

  const isBlockStart = (block, hour) => {
    const [startH] = block.startTime.split(':').map(Number);
    return startH === hour;
  };

  const getBlockSpan = (block) => {
    const [startH] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    return (endM > 0 ? endH + 1 : endH) - startH;
  };

  // Get assignments for a specific day
  const getAssignmentsForDay = (day) => {
    return assignmentBlocks.filter(a => a.day === day);
  };

  // Generate calendar subscription link
  const handleConnectCalendar = async () => {
    if (calendarUrl) {
      setShowCalendarPanel(true);
      return;
    }
    setIsGeneratingLink(true);
    try {
      const getTokenFn = httpsCallable(functions, 'getCalendarToken');
      const result = await getTokenFn({});
      const token = result.data.token;
      // Build the feed URL using the Cloud Function endpoint
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const feedUrl = `https://us-central1-${projectId}.cloudfunctions.net/calendarFeed?token=${token}`;
      setCalendarUrl(feedUrl);
      setShowCalendarPanel(true);
    } catch (err) {
      console.error('Error generating calendar link:', err);
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleCopyUrl = () => {
    if (!calendarUrl) return;
    navigator.clipboard.writeText(calendarUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Color by classId (include both schedule and assignment classIds)
  const uniqueClassIds = [...new Set([...scheduleBlocks.map(b => b.classId), ...assignmentBlocks.map(b => b.classId)])];
  const classColorMap = {};
  uniqueClassIds.forEach((cid, idx) => {
    classColorMap[cid] = DAY_COLORS[idx % DAY_COLORS.length];
  });

  return (
    <>
      <Head>
        <title>Schedule - TikiTaka</title>
      </Head>
      <Header />
      <StudentNavTabs active="schedule" />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">My Schedule</h1>
            <p className="text-sm text-muted-foreground mt-1">Your weekly class timetable and assignment due dates.</p>
          </div>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={handleConnectCalendar}
            disabled={isGeneratingLink}
          >
            {isGeneratingLink ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connecting...</>
            ) : (
              <><Calendar className="h-4 w-4 mr-2" /> Connect Google Calendar</>
            )}
          </Button>
        </div>

        {/* Calendar Subscription Panel */}
        {showCalendarPanel && calendarUrl && (
          <div className="bg-card border rounded-2xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold">Google Calendar Connected</h3>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowCalendarPanel(false)}>Close</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Subscribe to this URL in Google Calendar. It auto-updates whenever your teacher adds or changes assignments — with reminders the day before each due date.
            </p>
            <div className="flex gap-2">
              <Input value={calendarUrl} readOnly className="flex-1 text-xs font-mono rounded-xl h-9 bg-muted/30" />
              <Button size="sm" variant="outline" className="h-9 rounded-xl px-3" onClick={handleCopyUrl}>
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-xs"
                onClick={() => window.open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calendarUrl)}`, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Add to Google Calendar
              </Button>
              <p className="text-[10px] text-muted-foreground self-center">
                Or paste the URL into any calendar app (Apple Calendar, Outlook, etc.)
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : scheduleBlocks.length === 0 && assignmentBlocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-2xl bg-muted/5 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No schedule set yet</p>
            <p className="text-sm text-muted-foreground mt-1">Your teachers haven't added class times to the schedule.</p>
          </div>
        ) : (
          <div className="border rounded-2xl overflow-hidden bg-card shadow-sm">
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Header */}
                <div className="grid grid-cols-[80px_repeat(5,1fr)] border-b bg-muted/30">
                  <div className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">Time</div>
                  {DAYS.map(day => (
                    <div key={day} className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center border-l">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Assignment Due Dates Row */}
                {assignmentBlocks.length > 0 && (
                  <div className="grid grid-cols-[80px_repeat(5,1fr)] border-b bg-amber-50/30 dark:bg-amber-950/10">
                    <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-amber-600 text-center flex items-center justify-center">
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    {DAYS.map(day => {
                      const dayAssignments = getAssignmentsForDay(day);
                      return (
                        <div key={day} className="border-l p-1.5 space-y-1">
                          {dayAssignments.map(a => (
                            <div
                              key={a.id}
                              className="bg-amber-100 border border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300 rounded-md px-2 py-1"
                            >
                              <p className="text-[10px] font-bold truncate">{a.title}</p>
                              <p className="text-[9px] opacity-70">{a.className} · {a.totalPoints} pts</p>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Rows */}
                {HOURS.map(hour => (
                  <div key={hour} className="grid grid-cols-[80px_repeat(5,1fr)] border-b last:border-b-0 min-h-[60px]">
                    <div className="p-2 text-[11px] font-medium text-muted-foreground text-center border-r flex items-start justify-center pt-3">
                      {formatHour(hour)}
                    </div>
                    {DAYS.map(day => {
                      const blocksHere = getBlocksAt(day, hour);
                      const startingBlocks = blocksHere.filter(b => isBlockStart(b, hour));

                      return (
                        <div key={day} className="border-l relative min-h-[60px]">
                          {startingBlocks.map(block => {
                            const span = getBlockSpan(block);
                            return (
                              <div
                                key={block.id}
                                className={cn(
                                  'absolute left-1 right-1 rounded-lg border px-2.5 py-1.5 z-10 overflow-hidden',
                                  classColorMap[block.classId] || DAY_COLORS[0]
                                )}
                                style={{ height: `${span * 60 - 4}px`, top: '2px' }}
                              >
                                <p className="text-xs font-bold leading-tight truncate">{block.className}</p>
                                <p className="text-[10px] opacity-80 mt-0.5">
                                  {formatTime(block.startTime)} - {formatTime(block.endTime)}
                                </p>
                                {block.room && (
                                  <p className="text-[10px] opacity-70 mt-0.5">Room: {block.room}</p>
                                )}
                                {teacherNames[block.teacherId] && (
                                  <p className="text-[10px] opacity-70 mt-0.5">{teacherNames[block.teacherId]}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        {uniqueClassIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uniqueClassIds.map((cid, idx) => {
              const block = scheduleBlocks.find(b => b.classId === cid);
              return (
                <Badge key={cid} variant="outline" className={cn('text-xs font-medium border', DAY_COLORS[idx % DAY_COLORS.length])}>
                  {block?.className || 'Class'}
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentSchedule, 'student');
