import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  doc, 
  updateDoc, 
  arrayUnion,
  arrayRemove,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

import { db, storage } from '@/firebase';
import { ref, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { getClassByCode } from '@/lib/classUtils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import StudentNavTabs from '@/components/layout/StudentNavTabs';
import { Loader2, BookOpen, UserPlus, Brain, FlaskConical, Sigma, LayoutDashboard, ClipboardList, Sparkles, CalendarCheck, MoreVertical, LogOut } from 'lucide-react';
import TikaChatbot from '@/components/TikaChatbot';

// Map class index to icon colors for variety
const CLASS_ICON_COLORS = [
  { bg: 'bg-teal-50 dark:bg-teal-900/20', icon: 'text-teal-600 dark:text-teal-400', gradient: 'from-teal-600 to-teal-500' },
  { bg: 'bg-orange-50 dark:bg-orange-900/20', icon: 'text-orange-600 dark:text-orange-400', gradient: 'from-orange-600 to-orange-500' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20', icon: 'text-violet-600 dark:text-violet-400', gradient: 'from-violet-600 to-violet-500' },
  { bg: 'bg-blue-50 dark:bg-blue-900/20', icon: 'text-blue-600 dark:text-blue-400', gradient: 'from-blue-600 to-blue-500' },
];

const CLASS_ICONS = [FlaskConical, Sigma, Brain, BookOpen];

function formatRelativeDate(date) {
  if (!date) return 'N/A';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDueDate(date) {
  if (!date) return null;
  const d = date?.toDate ? date.toDate() : new Date(date);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: 'Overdue', urgent: true };
  if (diffDays === 0) return { label: 'Due today', urgent: true };
  if (diffDays === 1) return { label: 'Due tomorrow', urgent: true };
  if (diffDays <= 7) return { label: `Due in ${diffDays} days`, urgent: false };
  return { label: `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, urgent: false };
}

const joinFormSchema = z.object({
  classCode: z.string().length(6, { message: "Class code must be exactly 6 characters." }).toUpperCase(),
});

function StudentDashboard() {
  const { user } = useAuth();
  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Join Class State
  const [joinError, setJoinError] = useState(null);
  const [joinSuccess, setJoinSuccess] = useState(null);

  // Class menu state
  const [openMenuId, setOpenMenuId] = useState(null);
  const [leaveConfirmId, setLeaveConfirmId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLeaveClass = async (classId) => {
    try {
      const classToLeave = enrolledClasses.find(c => c.id === classId);

      // Remove from studentIds and add to archivedStudents
      await updateDoc(doc(db, 'classes', classId), {
        studentIds: arrayRemove(user.uid),
        archivedStudents: arrayUnion(user.uid),
      });

      // Send notification to teacher
      if (classToLeave?.teacherId) {
        await addDoc(collection(db, 'notifications'), {
          senderId: user.uid,
          recipientId: classToLeave.teacherId,
          notifType: 'student_left',
          title: `${user.displayName || user.email || 'A student'} left ${classToLeave.name || 'a class'}`,
          message: `Student profile has been archived. You can reinvite or remove them from the class settings.`,
          href: `/teacher/class/${classId}`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      setEnrolledClasses(prev => prev.filter(c => c.id !== classId));
      setLeaveConfirmId(null);
    } catch (err) {
      console.error('Error leaving class:', err);
    }
  };

  // Recent Submissions State
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [isSubmissionsLoading, setIsSubmissionsLoading] = useState(true);

  const joinForm = useForm({
    resolver: zodResolver(joinFormSchema),
    defaultValues: { classCode: "" },
  });

  // Assignment State
  const [upcomingAssignments, setUpcomingAssignments] = useState([]);
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(true);

  // Syllabus URLs per class { classId: downloadUrl }
  const [syllabusUrls, setSyllabusUrls] = useState({});

  // Extension due dates { assignmentId: Date }
  const [extensionDueDates, setExtensionDueDates] = useState({});

  // User settings
  const [chatbotEnabled, setChatbotEnabled] = useState(true);

  const fetchEnrolledClasses = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      // Load user settings
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const prefs = userDoc.data().settings || {};
          setChatbotEnabled(prefs.chatbotEnabled !== false);
        }
      } catch (_) {}
      const q = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
      const querySnapshot = await getDocs(q);
      
      const classPromises = querySnapshot.docs.map(async (classDoc) => {
        const classData = { id: classDoc.id, ...classDoc.data() };
        if (classData.teacherId) {
          try {
            const teacherDoc = await getDoc(doc(db, 'users', classData.teacherId));
            if (teacherDoc.exists()) {
              classData.teacherName = teacherDoc.data().displayName;
            }
          } catch (err) {
            console.error(`Error fetching teacher for class ${classDoc.id}:`, err);
          }
        }
        return classData;
      });

      const fetchedClasses = await Promise.all(classPromises);
      setEnrolledClasses(fetchedClasses);

      // Parse extension due dates from all classes
      const extDates = {};
      fetchedClasses.forEach(c => {
        const dueDatesMap = c.extensionDueDates || {};
        Object.entries(dueDatesMap).forEach(([key, val]) => {
          if (key.startsWith(user.uid + '_')) {
            const assignId = key.slice(user.uid.length + 1);
            extDates[assignId] = val?.toDate ? val.toDate() : new Date(val);
          }
        });
      });
      setExtensionDueDates(extDates);

      // Fetch syllabus for each class
      if (fetchedClasses.length > 0) {
        const syllabusMap = {};
        await Promise.all(fetchedClasses.map(async (c) => {
          try {
            const kbQ = query(
              collection(db, 'knowledgeBase'),
              where('classId', '==', c.id),
              where('isSyllabus', '==', true),
            );
            const kbSnap = await getDocs(kbQ);
            if (!kbSnap.empty) {
              const syllabusDoc = kbSnap.docs[0].data();
              if (syllabusDoc.storageUrl) {
                const url = await getDownloadURL(ref(storage, syllabusDoc.storageUrl));
                syllabusMap[c.id] = url;
              }
            }
          } catch (err) {
            console.error(`Error fetching syllabus for class ${c.id}:`, err);
          }
        }));
        setSyllabusUrls(syllabusMap);
      }

      // Once classes are fetched, fetch assignments assigned to these classes
      if (fetchedClasses.length > 0) {
        setIsAssignmentsLoading(true);
        // Using in up to 10 classes
        const classIds = fetchedClasses.map(c => c.id).slice(0, 10);
        const assignmentsQ = query(
          collection(db, 'assignments'),
          where('classId', 'in', classIds)
        );
        const assignmentsSnap = await getDocs(assignmentsQ);
        
        // Also fetch user's gradingJobs to filter out completed ones
        const jobsQ = query(collection(db, 'gradingJobs'), where('studentId', '==', user.uid));
        const jobsSnap = await getDocs(jobsQ);
        const submittedAssignmentIds = jobsSnap.docs.map(d => d.data().assignmentId || d.data().rawPdfUrl /* temp fallback if string matched */);

        const loadedAssignments = [];
        assignmentsSnap.forEach(docSnap => {
          const dat = docSnap.data();
          // Ideally check if this assignmentId has already a grading job linked to it.
          loadedAssignments.push({ id: docSnap.id, ...dat });
        });
        
        // Sort by dueDate
        loadedAssignments.sort((a, b) => {
          const dA = a.dueDate?.toDate ? a.dueDate.toDate() : new Date("2099-01-01");
          const dB = b.dueDate?.toDate ? b.dueDate.toDate() : new Date("2099-01-01");
          return dA - dB;
        });

        setUpcomingAssignments(loadedAssignments);
        setIsAssignmentsLoading(false);
      } else {
        setUpcomingAssignments([]);
        setIsAssignmentsLoading(false);
      }

    } catch (error) {
      console.error("Error fetching enrolled classes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecentSubmissions = async () => {
    if (!user) return;
    try {
      setIsSubmissionsLoading(true);
      const q = query(
        collection(db, 'gradingJobs'),
        where('studentId', '==', user.uid),
      );
      const snapshot = await getDocs(q);
      const jobs = [];
      snapshot.forEach((docSnap) => {
        jobs.push({ id: docSnap.id, ...docSnap.data() });
      });
      jobs.sort((a, b) => {
        const dateA = a.submittedAt?.toDate ? a.submittedAt.toDate() : new Date(a.submittedAt || 0);
        const dateB = b.submittedAt?.toDate ? b.submittedAt.toDate() : new Date(b.submittedAt || 0);
        return dateB - dateA;
      });
      setRecentSubmissions(jobs.slice(0, 5));
    } catch (error) {
      console.error('Error fetching recent submissions:', error);
    } finally {
      setIsSubmissionsLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrolledClasses();
    fetchRecentSubmissions();
  }, [user]);

  async function onJoinSubmit(values) {
    if (!user) return;
    setJoinError(null);
    setJoinSuccess(null);

    try {
      const classData = await getClassByCode(values.classCode);
      if (!classData) {
        setJoinError("Class not found. Please check the code and try again.");
        return;
      }
      if (classData.invitesDisabled) {
        setJoinError("This class is not accepting new students right now.");
        return;
      }
      if (classData.studentIds && classData.studentIds.includes(user.uid)) {
        setJoinError("You are already enrolled in this class.");
        return;
      }

      await updateDoc(doc(db, 'classes', classData.id), {
        studentIds: arrayUnion(user.uid)
      });
      
      joinForm.reset();
      setJoinSuccess(`Successfully joined ${classData.name}!`);
      fetchEnrolledClasses();
      
      setTimeout(() => setJoinSuccess(null), 5000);
    } catch (error) {
      console.error("Error joining class:", error);
      setJoinError("An error occurred while joining the class. Please try again.");
    }
  }

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Compute how many assignments are due this week (next 7 days)
  const assignmentsDueThisWeek = upcomingAssignments.filter(a => {
    if (!a.dueDate) return false;
    const d = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
    const diffDays = (d - today) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  return (
    <>
      <Head>
        <title>Student Dashboard - TikiTaka</title>
      </Head>
      <Header />
      
      <StudentNavTabs active="dashboard" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          <LayoutDashboard className="h-3 w-3" />
          <span>Dashboard</span>
        </div>

        {/* ── Welcome Card ── */}
        <section>
          <div className="relative overflow-hidden rounded-2xl bg-card border shadow-sm p-8 md:p-10">
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute left-8 bottom-8 opacity-[0.05] pointer-events-none">
              <Sparkles className="h-24 w-24 text-primary rotate-12" />
            </div>
            <div className="absolute right-12 top-12 opacity-[0.05] pointer-events-none">
              <Sparkles className="h-16 w-16 text-primary -rotate-12" />
            </div>
            
            <div className="relative z-10">
              <Badge className="mb-6 bg-teal-50 text-teal-800 border-none px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                {dateLabel}
              </Badge>
              <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-foreground mb-4">
                Welcome back{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
              </h1>
              <p className="text-base text-muted-foreground max-w-xl leading-relaxed">
                You have <span className="font-semibold text-foreground">{assignmentsDueThisWeek}</span> assignment{assignmentsDueThisWeek !== 1 && 's'} due this week.
              </p>
            </div>
          </div>
        </section>

        {/* ── Enrolled Classes ── */}
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Enrolled Classes</h2>
          </div>

          {isLoading && enrolledClasses.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[1, 2].map((i) => (
                <Card key={i} className="h-48 animate-pulse bg-muted/50 rounded-2xl" />
              ))}
            </div>
          ) : enrolledClasses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-base font-medium">No classes yet</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">Join a class using the form below to see your coursework.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {enrolledClasses.map((c, idx) => {
                const color = CLASS_ICON_COLORS[idx % CLASS_ICON_COLORS.length];
                const ClassIcon = CLASS_ICONS[idx % CLASS_ICONS.length];
                return (
                  <Card key={c.id} className="flex flex-col justify-between shadow-sm rounded-2xl hover:shadow-md transition-all border-border/50 relative">
                    <CardHeader className="pb-4">
                      <div className="flex justify-between items-start mb-4">
                        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shadow-sm', color.bg)}>
                          <ClassIcon className={cn('h-6 w-6', color.icon)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs text-muted-foreground border-border/50">
                            {c.classCode || c.id.slice(0, 6).toUpperCase()}
                          </Badge>
                          <div className="relative" ref={openMenuId === c.id ? menuRef : null}>
                            <button
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id); setLeaveConfirmId(null); }}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            {openMenuId === c.id && (
                              <div className="absolute right-0 top-8 z-50 w-44 bg-popover rounded-xl shadow-xl border py-1 animate-in fade-in zoom-in-95 duration-150">
                                <button
                                  className="w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 flex items-center gap-2.5 transition-colors"
                                  onClick={() => { setLeaveConfirmId(c.id); setOpenMenuId(null); }}
                                >
                                  <LogOut className="h-4 w-4" />
                                  Leave Class
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <CardTitle className="text-xl font-semibold mb-1">{c.name}</CardTitle>
                      {c.teacherName && (
                        <CardDescription className="text-sm font-medium">Instructor: {c.teacherName}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="pt-2">
                      {leaveConfirmId === c.id ? (
                        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 space-y-3">
                          <p className="text-sm font-medium text-destructive">Leave "{c.name}"? You'll lose access to assignments and grades.</p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="rounded-xl"
                              onClick={() => handleLeaveClass(c.id)}
                            >
                              Leave
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-xl"
                              onClick={() => setLeaveConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <Button asChild className="flex-1 bg-gradient-to-r from-[#005c55] to-[#0f766e] text-white hover:opacity-90 font-semibold rounded-xl h-11">
                            <Link href={`/student/class/${c.id}`}>Open</Link>
                          </Button>
                          {syllabusUrls[c.id] ? (
                            <Button
                              variant="outline"
                              className="flex-1 border-border/50 hover:bg-accent h-11 rounded-xl"
                              onClick={() => window.open(syllabusUrls[c.id], '_blank')}
                            >
                              Course Info
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              className="flex-1 border-border/50 h-11 rounded-xl opacity-50 cursor-not-allowed"
                              disabled
                            >
                              Course Info
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Assignments, Submissions & Join ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column (Assignments & Submissions) */}
          <div className="lg:col-span-2 space-y-10">
            
            {/* Upcoming Assignments */}
            <div className="space-y-5">
              <h2 className="text-xl font-semibold tracking-tight">Upcoming Assignments</h2>
              {isAssignmentsLoading ? (
                <div className="flex gap-5 overflow-x-auto pb-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="min-w-[280px] h-32 rounded-2xl bg-muted/50 animate-pulse flex-shrink-0" />
                  ))}
                </div>
              ) : upcomingAssignments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed rounded-2xl bg-muted/5">
                  <CalendarCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-base font-medium">No upcoming assignments</p>
                  <p className="text-sm text-muted-foreground">You are all caught up!</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {upcomingAssignments.map((assignment) => {
                    const effectiveDueDate = extensionDueDates[assignment.id] || assignment.dueDate;
                    const dueInfo = formatDueDate(effectiveDueDate);
                    const classObj = enrolledClasses.find(c => c.id === assignment.classId);
                    
                    return (
                      <div
                        key={assignment.id}
                        className="bg-card border border-border/50 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm hover:shadow-md transition-all gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                             <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300">
                               {classObj?.classCode || 'CLASS'}
                             </Badge>
                             {dueInfo && (
                               <Badge variant={dueInfo.urgent ? 'destructive' : 'outline'} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">
                                 {dueInfo.label}
                               </Badge>
                             )}
                          </div>
                          <h3 className="text-base font-semibold leading-tight text-foreground">
                            {assignment.title}
                          </h3>
                          <p className="text-sm font-medium text-muted-foreground mt-1">
                            {classObj?.name || 'Class'} · {assignment.totalPoints || 100} Points
                          </p>
                        </div>
                        <Button className="shrink-0 rounded-xl bg-gradient-to-r from-[#005c55] to-[#0f766e] text-white hover:opacity-90" asChild>
                          <Link href={`/student/class/${assignment.classId}`}>
                            Start Assignment
                          </Link>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Submissions */}
            <div className="space-y-5">
              <h2 className="text-xl font-semibold tracking-tight">Recent Submissions</h2>
              {isSubmissionsLoading ? (
                <div className="flex gap-5 overflow-x-auto pb-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="min-w-[280px] h-40 rounded-2xl bg-muted/50 animate-pulse flex-shrink-0" />
                  ))}
                </div>
              ) : recentSubmissions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
                  <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-base font-medium">No submissions</p>
                  <p className="text-sm text-muted-foreground">Submit assignments to track your progress.</p>
                </div>
              ) : (
                <div className="flex gap-5 overflow-x-auto pb-4 -mx-1 px-1 custom-scrollbar">
                  {recentSubmissions.map((job) => {
                    const isGraded = job.score !== null && job.score !== undefined;
                    return (
                      <Link
                        key={job.id}
                        href={`/student/submission/${job.id}`}
                        className="min-w-[280px] flex-shrink-0 bg-card border border-border/50 rounded-2xl p-6 flex flex-col shadow-sm hover:shadow-md transition-all group"
                      >
                        <div className="flex justify-between items-start mb-5">
                          <Badge
                            className={cn(
                              'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border-none',
                              isGraded 
                                ? 'bg-primary/10 text-primary' 
                                : 'bg-amber-100 text-amber-700'
                            )}
                          >
                            {isGraded ? 'GRADED' : 'PENDING'}
                          </Badge>
                          <span className="text-xs font-medium text-muted-foreground">
                            {formatRelativeDate(job.submittedAt)}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold leading-tight mb-auto group-hover:text-primary transition-colors">
                          {job.assignmentTitle || 'Assignment'}
                        </h3>
                        <div className="flex items-center justify-between pt-6 mt-4 border-t border-border/30">
                          <div className="flex items-baseline gap-1.5">
                            <span className={cn('text-3xl font-bold tabular-nums tracking-tight', isGraded ? 'text-foreground' : 'text-muted-foreground/30')}>
                              {isGraded ? job.score : '--'}
                            </span>
                            <span className="text-sm font-medium text-muted-foreground">/ {job.totalPoints || 100}</span>
                          </div>
                          {isGraded && (
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Join Class */}
          <div className="space-y-5">
            <h2 className="text-xl font-semibold tracking-tight">Join Class</h2>
            <Card className="rounded-2xl border-primary/20 bg-primary/[0.02] shadow-sm">
              <CardHeader className="pb-5">
                <CardTitle className="flex items-center text-base font-semibold">
                  <UserPlus className="w-5 h-5 mr-2 text-primary" />
                  Enter Class Code
                </CardTitle>
                <CardDescription className="text-sm font-medium">
                  Join a course to see your assignments.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...joinForm}>
                  <form onSubmit={joinForm.handleSubmit(onJoinSubmit)} className="space-y-5">
                    <FormField
                      control={joinForm.control}
                      name="classCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              placeholder="CODE123"
                              className="h-12 bg-background border-border/50 font-mono font-bold text-center text-lg tracking-widest uppercase rounded-xl"
                              maxLength={6}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage className="text-xs font-medium" />
                        </FormItem>
                      )}
                    />
                    {joinError && <Alert variant="destructive" className="py-2 px-3 rounded-lg"><AlertDescription className="text-xs font-medium">{joinError}</AlertDescription></Alert>}
                    {joinSuccess && <Alert className="py-2 px-3 bg-green-50 text-green-800 border-green-200 rounded-lg dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"><AlertDescription className="text-xs font-medium">{joinSuccess}</AlertDescription></Alert>}
                    <Button type="submit" className="w-full h-12 rounded-xl font-bold text-base bg-primary hover:bg-primary/90 shadow-sm" disabled={joinForm.formState.isSubmitting}>
                      {joinForm.formState.isSubmitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> JOINING...</> : 'JOIN CLASS'}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Tika Chatbot */}
      {chatbotEnabled && (
        <TikaChatbot
          enrolledClasses={enrolledClasses}
          assignments={upcomingAssignments}
          submissions={recentSubmissions}
        />
      )}
    </>
  );
}

export default withAuth(StudentDashboard, 'student');
