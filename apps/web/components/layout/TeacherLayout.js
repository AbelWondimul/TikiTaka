import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';
import NotificationDropdown from './NotificationDropdown';
import { useTA } from '@/lib/useTA';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase';
import { generateClassCode } from '@/lib/classUtils';
import {
  Menu,
  X,
  Sun,
  Moon,
  HelpCircle,
  School,
  ArrowLeft,
  Loader2,
  Plus,
  LayoutDashboard,
  ClipboardList,
  MessageSquare,
  Users,
  Settings
} from 'lucide-react';

const ICON_MAP = {
  dashboard: LayoutDashboard,
  assignment: ClipboardList,
  chat: MessageSquare,
  group: Users,
  settings: Settings
};

const NAV_ITEMS = [
  { href: '/teacher/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/teacher/schedule', label: 'Schedule', key: 'schedule' },
  { href: '/teacher/resources', label: 'Resources', key: 'resources' },
];

const SIDEBAR_ITEMS = [
  { href: '/teacher/dashboard', label: 'Overview', icon: 'dashboard', key: 'dashboard' },
  { href: '/teacher/submissions', label: 'Submissions', icon: 'assignment', key: 'submissions' },
  { href: '/teacher/messages', label: 'Messages', icon: 'chat', key: 'messages' },
  { href: '/teacher/students', label: 'Students', icon: 'group', key: 'students' },
  { href: '/teacher/settings', label: 'Settings', icon: 'settings', key: 'settings' },
];

export default function TeacherLayout({ children, activePage = 'dashboard' }) {
  const { user, role } = useAuth();
  const router = useRouter();
  const isStudentTA = role === 'student';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isCreatingClass, setIsCreatingClass] = useState(false);

  const handleCreateClass = async () => {
    if (isCreatingClass) return;
    setIsCreatingClass(true);
    try {
      const classCode = generateClassCode();
      const newClass = await addDoc(collection(db, 'classes'), {
        teacherId: user.uid,
        name: 'New Class',
        classCode,
        studentIds: [],
        createdAt: serverTimestamp(),
      });
      router.push(`/teacher/class/${newClass.id}`);
    } catch (err) {
      console.error('Error creating class:', err);
    } finally {
      setIsCreatingClass(false);
    }
  };

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      {/* Top Navigation Bar */}
      <header className="fixed top-0 w-full z-50 bg-background/85 backdrop-blur-md shadow-[0_1px_3px_rgba(17,24,39,0.06)] flex items-center justify-between px-4 sm:px-8 h-14 sm:h-16 border-b border-border">
        <div className="flex items-center gap-4 sm:gap-12">
          {/* Mobile hamburger */}
          <button className="lg:hidden text-muted-foreground" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link href="/teacher/dashboard">
            <Logo />
          </Link>
          <nav className="hidden md:flex items-center space-x-8 h-full font-sans">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.key}
                href={item.href}
                className={
                  activePage === item.key
                    ? 'text-primary font-bold border-b-2 border-primary py-5 transition-colors duration-200'
                    : 'text-muted-foreground font-medium py-5 hover:text-primary transition-colors duration-200'
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center space-x-3 sm:space-x-6">
          <div className="flex items-center space-x-2 sm:space-x-4 text-muted-foreground">
            <button
              className="cursor-pointer hover:text-primary transition-colors h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted/50"
              onClick={() => {
                const dark = document.documentElement.classList.toggle('dark');
                localStorage.setItem('tikitaka-theme', dark ? 'dark' : 'light');
                setIsDark(dark);
              }}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationDropdown />
            <a href="mailto:support@tikitaka.ai" title="Contact Support" className="cursor-pointer hover:text-primary transition-colors hidden sm:flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted/50">
              <HelpCircle className="h-5 w-5" />
            </a>
            <div className="h-8 w-8 rounded-full overflow-hidden bg-muted border border-border">
              {user?.photoURL ? (
                <img className="w-full h-full object-cover" src={user.photoURL} alt="Profile" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200 font-bold text-xs">
                  {user?.displayName?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'U'}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
        </div>
      )}

      {/* Side Navigation Bar — hidden on mobile, slides in when toggled */}
      <aside className={`fixed left-0 top-14 sm:top-16 h-[calc(100vh-56px)] sm:h-[calc(100vh-64px)] w-64 bg-muted/50 flex flex-col p-4 space-y-2 border-r border-border z-40 transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 py-4 sm:py-6 mb-2">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
              <School className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-teal-800 dark:text-teal-200 leading-none">{isStudentTA ? 'TA Dashboard' : 'Main Menu'}</h2>
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground mt-1">{isStudentTA ? 'Teaching Assistant' : 'Academic Management'}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {SIDEBAR_ITEMS.map(item => {
            const IconComponent = ICON_MAP[item.icon] || ClipboardList;
            const isActive = activePage === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={
                  isActive
                    ? 'flex items-center space-x-3 px-4 py-3 bg-primary/10 text-primary font-bold shadow-sm rounded-lg border-l-4 border-primary transition-all duration-200'
                    : 'flex items-center space-x-3 px-4 py-3 text-muted-foreground font-medium hover:bg-muted/50 hover:translate-x-1 transition-all duration-200'
                }
              >
                <IconComponent className="h-5 w-5" />
                <span className="text-sm tracking-normal">{item.label}</span>
              </Link>
            );
          })}

          {/* Mobile-only nav items */}
          <div className="md:hidden pt-3 border-t border-border mt-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={
                  activePage === item.key
                    ? 'flex items-center space-x-3 px-4 py-3 bg-primary/10 text-primary font-bold shadow-sm rounded-lg border-l-4 border-primary'
                    : 'flex items-center space-x-3 px-4 py-3 text-muted-foreground font-medium hover:bg-muted/50'
                }
              >
                <span className="text-sm tracking-normal">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-auto pt-4 border-t border-border space-y-2">
          {isStudentTA ? (
            <Link href="/student/dashboard" className="w-full bg-violet-600 py-3 px-4 rounded-lg text-white font-semibold text-sm flex items-center justify-center space-x-2 hover:brightness-110 active:scale-95 transition-transform shadow-lg shadow-violet-900/10">
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Student</span>
            </Link>
          ) : (
            <button
              onClick={handleCreateClass}
              disabled={isCreatingClass}
              className="w-full bg-primary py-3 px-4 rounded-lg text-white font-semibold text-sm flex items-center justify-center space-x-2 hover:brightness-110 active:scale-95 transition-transform shadow-lg shadow-teal-900/10 disabled:opacity-50"
            >
              {isCreatingClass ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span>{isCreatingClass ? 'Creating...' : 'New Class'}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area — responsive margin */}
      <main className="lg:ml-64 mt-14 sm:mt-16 p-4 sm:p-6 lg:p-10 min-h-[calc(100vh-56px)] sm:min-h-[calc(100vh-64px)] bg-background">
        {children}
      </main>
    </>
  );
}
