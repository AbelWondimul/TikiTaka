import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { generateClassCode, getAccessibleClasses } from '@/lib/classUtils';
import { getRelativeTime } from '@/lib/dateUtils';

// Convert user's name format to "Good morning, Professor [Lastname]"
const getGreeting = (displayName) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (!displayName) return `${greeting}, Professor`;

  const parts = displayName.trim().split(' ');
  let lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  if (lastName) {
    lastName = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase();
  }

  return `${greeting}, Professor ${lastName}`;
};

function TeacherDashboard() {
  const { user, role } = useAuth();
  const router = useRouter();
  const [classes, setClasses] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quizCount, setQuizCount] = useState(0);
  const [avgScore, setAvgScore] = useState(null);

  // Class menu state
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingClassId, setEditingClassId] = useState(null);
  const [editingClassName, setEditingClassName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyCode = (classCode, classId) => {
    navigator.clipboard.writeText(classCode);
    setCopiedId(classId);
    setOpenMenuId(null);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleInvites = async (c) => {
    try {
      await updateDoc(doc(db, 'classes', c.id), {
        invitesDisabled: !c.invitesDisabled
      });
      setClasses(prev => prev.map(cls => cls.id === c.id ? { ...cls, invitesDisabled: !cls.invitesDisabled } : cls));
    } catch (err) {
      console.error('Error toggling invites:', err);
    }
    setOpenMenuId(null);
  };

  const handleArchiveClass = async (c) => {
    try {
      await updateDoc(doc(db, 'classes', c.id), {
        archived: !c.archived
      });
      setClasses(prev => prev.map(cls => cls.id === c.id ? { ...cls, archived: !cls.archived } : cls));
    } catch (err) {
      console.error('Error archiving class:', err);
    }
    setOpenMenuId(null);
  };

  const handleRenameClass = async (classId) => {
    if (!editingClassName.trim()) return;
    try {
      await updateDoc(doc(db, 'classes', classId), { name: editingClassName.trim() });
      setClasses(prev => prev.map(cls => cls.id === classId ? { ...cls, name: editingClassName.trim() } : cls));
    } catch (err) {
      console.error('Error renaming class:', err);
    }
    setEditingClassId(null);
    setEditingClassName('');
  };

  const handleCloneClass = async (c) => {
    try {
      const newCode = generateClassCode();
      const newClassRef = await addDoc(collection(db, 'classes'), {
        teacherId: user.uid,
        name: `${c.name} (Copy)`,
        classCode: newCode,
        studentIds: [],
        createdAt: serverTimestamp(),
      });
      // Clone assignments
      const assignQ = query(collection(db, 'assignments'), where('classId', '==', c.id));
      const assignSnap = await getDocs(assignQ);
      for (const d of assignSnap.docs) {
        const data = d.data();
        await addDoc(collection(db, 'assignments'), { ...data, classId: newClassRef.id, createdAt: serverTimestamp() });
      }
      // Clone modules
      const modQ = query(collection(db, 'modules'), where('classId', '==', c.id));
      const modSnap = await getDocs(modQ);
      const moduleIdMap = {};
      for (const d of modSnap.docs) {
        const data = d.data();
        const newMod = await addDoc(collection(db, 'modules'), { ...data, classId: newClassRef.id, teacherId: user.uid, createdAt: serverTimestamp() });
        moduleIdMap[d.id] = newMod.id;
      }
      // Clone module resources
      const resQ = query(collection(db, 'moduleResources'), where('classId', '==', c.id));
      const resSnap = await getDocs(resQ);
      for (const d of resSnap.docs) {
        const data = d.data();
        await addDoc(collection(db, 'moduleResources'), { ...data, classId: newClassRef.id, teacherId: user.uid, moduleId: moduleIdMap[data.moduleId] || data.moduleId, createdAt: serverTimestamp() });
      }
      // Clone schedules
      const schedQ = query(collection(db, 'schedules'), where('classId', '==', c.id));
      const schedSnap = await getDocs(schedQ);
      for (const d of schedSnap.docs) {
        const data = d.data();
        await addDoc(collection(db, 'schedules'), { ...data, classId: newClassRef.id, teacherId: user.uid, updatedAt: serverTimestamp() });
      }
      setOpenMenuId(null);
      fetchDashboardData();
    } catch (err) {
      console.error('Error cloning class:', err);
    }
  };

  const handleDeleteClass = async (classId) => {
    try {
      await deleteDoc(doc(db, 'classes', classId));
      setClasses(prev => prev.filter(cls => cls.id !== classId));
    } catch (err) {
      console.error('Error deleting class:', err);
    }
    setDeleteConfirmId(null);
    setOpenMenuId(null);
  };

  // Instead of using complex indexes for sorting directly on Firebase,
  // we do an in-memory sort to avoid index errors initially.
  const fetchDashboardData = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      
      // Fetch Classes (owned + TA)
      const fetchedClasses = await getAccessibleClasses(user.uid, role);
      setClasses(fetchedClasses);

      // Fetch Recent Submissions (gradingJobs)
      // For owned classes query by teacherId, for TA classes query by classId
      const taClassIds = fetchedClasses.filter(c => c._isTA).map(c => c.id);
      const queries = [query(collection(db, 'gradingJobs'), where('teacherId', '==', user.uid))];
      if (taClassIds.length > 0) {
        // Firestore 'in' supports up to 30 items
        for (let i = 0; i < taClassIds.length; i += 30) {
          queries.push(query(collection(db, 'gradingJobs'), where('classId', 'in', taClassIds.slice(i, i + 30))));
        }
      }
      const snapshots = await Promise.all(queries.map(q => getDocs(q)));
      const seenIds = new Set();
      const subsSnap = { docs: [] };
      for (const snap of snapshots) {
        snap.forEach(d => {
          if (!seenIds.has(d.id)) { seenIds.add(d.id); subsSnap.docs.push(d); }
        });
      }
      let subs = [];
      subsSnap.docs.forEach(doc => subs.push({ id: doc.id, ...doc.data() }));

      subs.sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dbTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dbTime - da;
      });
      setRecentActivities(subs.slice(0, 6)); // Top 6 most recent

      // Compute average score from completed grading jobs
      const gradedJobs = subs.filter(s => s.status === 'complete' && s.score != null && s.totalPoints);
      if (gradedJobs.length > 0) {
        const totalPct = gradedJobs.reduce((sum, j) => sum + (j.score / j.totalPoints) * 100, 0);
        setAvgScore(Math.round(totalPct / gradedJobs.length));
      } else {
        setAvgScore(null);
      }

      // Fetch quizzes across all accessible classes
      let quizTotal = 0;
      const quizzesSnap1 = await getDocs(query(collection(db, 'quizzes'), where('teacherId', '==', user.uid)));
      quizTotal += quizzesSnap1.size;
      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taQuizSnap = await getDocs(query(collection(db, 'quizzes'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taQuizSnap.forEach(d => { if (!seenIds.has('quiz_' + d.id)) { seenIds.add('quiz_' + d.id); quizTotal++; } });
        }
      }
      setQuizCount(quizTotal);
      
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [user]);

  const totalStudents = classes.reduce((sum, c) => sum + (c.studentIds ? c.studentIds.length : 0), 0);
  const displayPendingCount = Math.max(recentActivities.filter(sub => sub.status !== 'complete').length, 0);

  return (
    <TeacherLayout activePage="dashboard">
      <Head>
        <title>Teacher Dashboard - TikiTaka AI</title>
      </Head>
        {/* Header Section */}
        <header className="mb-10">
          <h1 className="text-[28px] font-bold text-foreground tracking-tight">{role === 'student' ? `Welcome back, ${user?.displayName?.split(' ')[0] || 'TA'}` : getGreeting(user?.displayName)}</h1>
          <p className="text-sm font-normal text-muted-foreground mt-1">You have {displayPendingCount} pending submission{displayPendingCount !== 1 ? 's' : ''} to review today.</p>
        </header>

        {/* Stats Row */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <div className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground mb-2">Total Students</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800 dark:text-teal-200">{totalStudents}</span>
            </div>
          </div>
          <div className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground mb-2">Pending</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800 dark:text-teal-200">{displayPendingCount}</span>
              {displayPendingCount > 0 && (
                <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold">Action Needed</span>
              )}
            </div>
          </div>
          <div className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground mb-2">Quizzes</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800 dark:text-teal-200">{quizCount}</span>
            </div>
          </div>
          <div className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground mb-2">Avg Score</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800 dark:text-teal-200">{avgScore != null ? `${avgScore}%` : '--'}</span>
              {avgScore != null && (
                <div className="w-16 bg-muted h-1 rounded-full overflow-hidden self-center">
                  <div className="bg-[#005c55] h-full" style={{ width: `${avgScore}%` }}></div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Class Cards Grid (2/3 width) */}
          <section className="xl:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground tracking-tight">Your Classes</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {isLoading ? (
                 <div className="col-span-full">Loading classes...</div>
              ) : classes.length === 0 ? (
                 <div className="col-span-full bg-card p-12 text-center rounded-xl border border-dashed border-border space-y-4">
                    <div className="h-16 w-16 mx-auto bg-teal-50 dark:bg-teal-950 rounded-2xl flex items-center justify-center">
                      <span className="material-symbols-outlined text-teal-600 dark:text-teal-400 text-3xl">school</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Welcome to TikiTaka!</h3>
                      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">Create your first class to get started. Upload a knowledge base, post assignments, and let AI handle the grading.</p>
                    </div>
                    <div className="flex flex-col items-center gap-2 pt-2">
                      <div className="flex items-center gap-6 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-bold">1</span> Create a Class</span>
                        <span className="flex items-center gap-1"><span className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-bold">2</span> Upload Materials</span>
                        <span className="flex items-center gap-1"><span className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-bold">3</span> Assign Work</span>
                      </div>
                    </div>
                 </div>
              ) : (
                classes.filter(c => !c.archived).map((c) => (
                  <div key={c.id} className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] hover:shadow-lg transition-shadow duration-200 flex flex-col relative">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-1.5">
                        <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-[10px] font-mono font-bold tracking-wider uppercase">
                          {(c.name || 'CLASS').substring(0, 5)}
                        </span>
                        {c._isTA && (
                          <span className="bg-violet-100 text-violet-700 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase">TA</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className="material-symbols-outlined text-muted-foreground/50 cursor-pointer hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-[20px]"
                          title="Analytics"
                          onClick={() => router.push(`/teacher/class/${c.id}/analytics`)}
                        >bar_chart</span>
                        {!c._isTA && (
                        <div className="relative" ref={openMenuId === c.id ? menuRef : null}>
                          <span
                            className="material-symbols-outlined text-muted-foreground/50 cursor-pointer hover:text-muted-foreground"
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id); }}
                          >more_vert</span>

                          {openMenuId === c.id && (
                            <div className="absolute right-0 top-8 z-50 w-52 bg-card rounded-lg shadow-xl border border-border py-1 dark:shadow-2xl animate-in fade-in zoom-in-95 duration-150">
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
                                onClick={() => { handleCopyCode(c.classCode, c.id); }}
                              >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                Copy Invite Code
                              </button>
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
                                onClick={() => { setEditingClassId(c.id); setEditingClassName(c.name); setOpenMenuId(null); }}
                              >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                                Edit Name
                              </button>
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
                                onClick={() => handleToggleInvites(c)}
                              >
                                <span className="material-symbols-outlined text-[18px]">{c.invitesDisabled ? 'lock_open' : 'lock'}</span>
                                {c.invitesDisabled ? 'Enable Invites' : 'Close Invites'}
                              </button>
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
                                onClick={() => handleCloneClass(c)}
                              >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                Clone Class
                              </button>
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
                                onClick={() => { setArchiveConfirmId(c.id); setOpenMenuId(null); }}
                              >
                                <span className="material-symbols-outlined text-[18px]">archive</span>
                                Archive Class
                              </button>
                              <div className="border-t border-border my-1" />
                              <button
                                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                                onClick={() => { setDeleteConfirmId(c.id); setOpenMenuId(null); }}
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                Delete Class
                              </button>
                            </div>
                          )}
                        </div>
                        )}
                      </div>
                    </div>

                    {/* Inline rename */}
                    {editingClassId === c.id ? (
                      <div className="mb-4">
                        <input
                          className="w-full border border-teal-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-teal-800 dark:text-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          value={editingClassName}
                          onChange={(e) => setEditingClassName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameClass(c.id); if (e.key === 'Escape') setEditingClassId(null); }}
                          autoFocus
                        />
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleRenameClass(c.id)} className="px-3 py-1 text-xs font-semibold bg-teal-600 text-white rounded-md hover:bg-teal-700">Save</button>
                          <button onClick={() => setEditingClassId(null)} className="px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-bold text-teal-800 dark:text-teal-200 mb-1 line-clamp-1">{c.name}</h3>
                        <div className="flex items-center gap-2 mb-6 flex-1">
                          <p className="text-muted-foreground text-xs font-medium">{c.studentIds?.length || 0} students enrolled</p>
                          {c.invitesDisabled && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Invites off</span>
                          )}
                        </div>
                      </>
                    )}

                    {copiedId === c.id && (
                      <div className="absolute top-14 right-4 bg-teal-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg animate-in fade-in zoom-in-95 duration-150">
                        Code copied!
                      </div>
                    )}

                    {/* Archive confirmation */}
                    {archiveConfirmId === c.id ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-auto">
                        <p className="text-xs font-semibold text-amber-700 mb-2">Are you sure you want to archive "{c.name}"?</p>
                        <div className="flex gap-2">
                          <button onClick={() => { handleArchiveClass(c); setArchiveConfirmId(null); }} className="px-3 py-1.5 text-xs font-bold bg-amber-600 text-white rounded-md hover:bg-amber-700">Archive</button>
                          <button onClick={() => setArchiveConfirmId(null)} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      </div>
                    ) : deleteConfirmId === c.id ? (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-auto">
                        <p className="text-xs font-semibold text-red-700 mb-2">Are you sure you want to delete "{c.name}"? This cannot be undone.</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteClass(c.id)} className="px-3 py-1.5 text-xs font-bold bg-red-600 text-white rounded-md hover:bg-red-700">Delete</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <Link href={`/teacher/class/${c.id}`} className="w-full flex items-center justify-center py-2 text-primary font-bold text-sm bg-muted/50 rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors mt-auto">
                        View Class
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Archived Classes */}
            {classes.some(c => c.archived) && (
              <div className="mt-8">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Archived</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {classes.filter(c => c.archived).map((c) => (
                    <div key={c.id} className="bg-muted/50 p-5 rounded-xl border border-border opacity-70 hover:opacity-100 transition-opacity flex flex-col">
                      <h3 className="text-sm font-bold text-muted-foreground mb-1 line-clamp-1">{c.name}</h3>
                      <p className="text-muted-foreground text-xs font-medium mb-3">{c.studentIds?.length || 0} students</p>
                      <button
                        onClick={() => handleArchiveClass(c)}
                        className="text-xs font-semibold text-teal-600 hover:text-teal-800 dark:text-teal-200 mt-auto"
                      >
                        Unarchive
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Recent Activity (1/3 width) */}
          <section className="xl:col-span-1">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground tracking-tight">Recent Activity</h2>
            </div>
            <div className="bg-card p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] h-full max-h-[480px] overflow-y-auto">
              <div className="space-y-6">
                
                {recentActivities.length > 0 ? (
                  recentActivities.map((activity, idx) => (
                    <div key={activity.id || idx} className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {activity.status === 'complete' 
                            ? 'Grade update for submission'
                            : activity.status === 'processing' 
                              ? 'Automated grading started'
                              : 'New submission received'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {classes.find(c => c.id === activity.classId)?.name || 'Unknown Class'} • {getRelativeTime(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No recent activity yet.</p>
                  </div>
                )}
                
              </div>
            </div>
          </section>
        </div>
    </TeacherLayout>
  );
}

export default withAuth(TeacherDashboard, ['teacher', 'ta']);
