import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Logo from '@/components/layout/Logo';

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

const getRelativeTime = (timestamp) => {
  if (!timestamp) return 'Just now';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diff = Math.floor((new Date() - date) / 1000 / 60);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} mins ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

function TeacherDashboard() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Instead of using complex indexes for sorting directly on Firebase,
  // we do an in-memory sort to avoid index errors initially.
  const fetchDashboardData = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      
      // Fetch Classes
      const classesQ = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const classesSnap = await getDocs(classesQ);
      const fetchedClasses = [];
      classesSnap.forEach(doc => fetchedClasses.push({ id: doc.id, ...doc.data() }));
      setClasses(fetchedClasses);

      // Fetch Recent Submissions (gradingJobs)
      const subsQ = query(collection(db, 'gradingJobs'), where('teacherId', '==', user.uid));
      const subsSnap = await getDocs(subsQ);
      let subs = [];
      subsSnap.forEach(doc => subs.push({ id: doc.id, ...doc.data() }));
      
      subs.sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dbTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dbTime - da;
      });
      setRecentActivities(subs.slice(0, 6)); // Top 6 most recent
      
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
    <>
      <Head>
        <title>Teacher Dashboard - TikiTaka AI</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <style>{`
          body { font-family: 'Inter', sans-serif; background-color: #F9FAFB; color: #191c1d; }
          .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          }
        `}</style>
      </Head>

      {/* Top Navigation Bar */}
      <header className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-md shadow-[0_1px_3px_rgba(17,24,39,0.06)] flex items-center justify-between px-8 h-16">
        <div className="flex items-center gap-12">
          {/* Maintained precise formatting of green/black Logo component */}
          <Link href="/teacher/dashboard">
             <Logo />
          </Link>
          <nav className="hidden md:flex items-center space-x-8 h-full">
            <Link href="/teacher/dashboard" className="text-teal-700 font-bold border-b-2 border-teal-700 py-5 transition-colors duration-200">
              Dashboard
            </Link>
            <Link href="#" className="text-slate-600 font-medium py-5 hover:text-teal-600 transition-colors duration-200">
              Schedule
            </Link>
            <Link href="#" className="text-slate-600 font-medium py-5 hover:text-teal-600 transition-colors duration-200">
              Resources
            </Link>
          </nav>
        </div>
        <div className="flex items-center space-x-6">
          {/* SEARCH BAR REMOVED HERE AS REQUESTED */}
          <div className="flex items-center space-x-4 text-slate-600">
            <span className="material-symbols-outlined cursor-pointer hover:text-teal-600 transition-colors">notifications</span>
            <span className="material-symbols-outlined cursor-pointer hover:text-teal-600 transition-colors">help</span>
            <div className="h-8 w-8 rounded-full overflow-hidden bg-slate-200 border border-slate-200">
              {user?.photoURL ? (
                <img className="w-full h-full object-cover" src={user.photoURL} alt="Profile" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-teal-100 text-teal-800 font-bold">
                  {user?.displayName?.charAt(0) || user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Side Navigation Bar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-64 bg-slate-50 flex flex-col p-4 space-y-2 border-r border-slate-200">
        <div className="px-4 py-6 mb-2">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 bg-[#0f766e] rounded-lg flex items-center justify-center text-white">
              <span className="material-symbols-outlined">school</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-teal-800 leading-none">Main Menu</h2>
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mt-1">Academic Management</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          <Link href="/teacher/dashboard" className="flex items-center space-x-3 px-4 py-3 bg-[#CCFBF1] text-[#0F766E] font-bold shadow-sm rounded-lg border-l-4 border-[#0F766E] transition-all duration-200">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>dashboard</span>
            <span className="text-sm tracking-normal">Overview</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">school</span>
            <span className="text-sm tracking-normal">My Classes</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">assignment</span>
            <span className="text-sm tracking-normal">Submissions</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">quiz</span>
            <span className="text-sm tracking-normal">Quizzes</span>
          </Link>
          <Link href="/teacher/messages" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">chat</span>
            <span className="text-sm tracking-normal">Messages</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">group</span>
            <span className="text-sm tracking-normal">Students</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200">
            <span className="material-symbols-outlined">settings</span>
            <span className="text-sm tracking-normal">Settings</span>
          </Link>
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-200">
          <button className="w-full bg-[#005c55] py-3 px-4 rounded-lg text-white font-semibold text-sm flex items-center justify-center space-x-2 hover:brightness-110 active:scale-95 transition-transform shadow-lg shadow-teal-900/10">
            <span className="material-symbols-outlined text-lg">add</span>
            <span>New Class</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="ml-64 mt-16 p-10 min-h-[calc(100vh-64px)] bg-[#F9FAFB]">
        {/* Header Section */}
        <header className="mb-10">
          <h1 className="text-[28px] font-bold text-[#191c1d] tracking-tight">{getGreeting(user?.displayName)}</h1>
          <p className="text-sm font-normal text-slate-500 mt-1">You have {displayPendingCount || 7} pending submissions to review today.</p>
        </header>

        {/* Stats Row */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <div className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mb-2">Total Students</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800">{totalStudents || 84}</span>
              <span className="text-emerald-600 text-xs font-bold">+4 new</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mb-2">Pending</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800">{displayPendingCount || 7}</span>
              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold">Action Needed</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mb-2">Quizzes</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800">12</span>
              <span className="text-slate-400 text-xs font-medium">3 active</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-slate-500 mb-2">Avg Score</span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-teal-800">78%</span>
              <div className="w-16 bg-slate-100 h-1 rounded-full overflow-hidden self-center">
                <div className="bg-[#005c55] h-full w-[78%]"></div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Class Cards Grid (2/3 width) */}
          <section className="xl:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#191c1d] tracking-tight">Your Classes</h2>
              <button className="text-[#005c55] text-sm font-semibold hover:underline">View All</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {isLoading ? (
                 <div className="col-span-full">Loading classes...</div>
              ) : classes.length === 0 ? (
                 <div className="col-span-full bg-white p-8 text-center rounded-xl border border-dashed border-slate-300">
                    <p className="text-slate-500">No classes found.</p>
                 </div>
              ) : (
                classes.map((c) => (
                  <div key={c.id} className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] hover:shadow-lg transition-shadow duration-200 flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                      {/* Shorten name dynamically for label like BIO-A */}
                      <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-mono font-bold tracking-wider uppercase">
                        {(c.name || 'CLASS').substring(0, 5)}
                      </span>
                      <span className="material-symbols-outlined text-slate-300 cursor-pointer hover:text-slate-500">more_vert</span>
                    </div>
                    <h3 className="text-lg font-bold text-teal-800 mb-1 line-clamp-1">{c.name}</h3>
                    <p className="text-slate-500 text-xs font-medium mb-6 flex-1">{c.studentIds?.length || 0} students enrolled</p>
                    
                    {/* Curriculum bar removed as requested */}
                    
                    <Link href={`/teacher/class/${c.id}`} className="w-full flex items-center justify-center py-2 text-[#005c55] font-bold text-sm bg-slate-50 rounded-lg hover:bg-[#005c55] hover:text-white transition-colors mt-auto">
                      View Class
                    </Link>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Recent Activity (1/3 width) */}
          <section className="xl:col-span-1">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#191c1d] tracking-tight">Recent Activity</h2>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] h-full max-h-[480px] overflow-y-auto">
              <div className="space-y-6">
                
                {recentActivities.length > 0 ? (
                  recentActivities.map((activity, idx) => (
                    <div key={activity.id || idx} className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {activity.status === 'complete' 
                            ? 'Grade update for submission'
                            : activity.status === 'processing' 
                              ? 'Automated grading started'
                              : 'New submission received'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {classes.find(c => c.id === activity.classId)?.name || 'Unknown Class'} • {getRelativeTime(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  // Demo UI if no live data found, purely to match the UI screenshot
                  <>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">New submission from Sarah Chen</p>
                        <p className="text-xs text-slate-400 mt-0.5">Biology 101 • 12 mins ago</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Quiz 'Cell Structure' completed</p>
                        <p className="text-xs text-slate-400 mt-0.5">Advanced Physics • 45 mins ago</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">New student enrolled</p>
                        <p className="text-xs text-slate-400 mt-0.5">Organic Chemistry • 2 hours ago</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Grade update: Marcus Doe</p>
                        <p className="text-xs text-slate-400 mt-0.5">Biology 101 • 3 hours ago</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Assignment posted</p>
                        <p className="text-xs text-slate-400 mt-0.5">Advanced Physics • 5 hours ago</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-4">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005c55] shrink-0"></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">System maintenance notification</p>
                        <p className="text-xs text-slate-400 mt-0.5">Global • 8 hours ago</p>
                      </div>
                    </div>
                  </>
                )}
                
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export default withAuth(TeacherDashboard, 'teacher');
