import { useState, useEffect } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';
import NotificationDropdown from './NotificationDropdown';

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
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <style>{`
          body { background-color: #F9FAFB; color: #191c1d; }
          .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          }
        `}</style>
      </Head>

      {/* Top Navigation Bar */}
      <header className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-md shadow-[0_1px_3px_rgba(17,24,39,0.06)] flex items-center justify-between px-4 sm:px-8 h-14 sm:h-16">
        <div className="flex items-center gap-4 sm:gap-12">
          {/* Mobile hamburger */}
          <button className="lg:hidden text-slate-600" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <span className="material-symbols-outlined">{sidebarOpen ? 'close' : 'menu'}</span>
          </button>
          <Link href="/teacher/dashboard">
            <Logo />
          </Link>
          <nav className="hidden md:flex items-center space-x-8 h-full font-['Manrope']">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.key}
                href={item.href}
                className={
                  activePage === item.key
                    ? 'text-teal-700 font-bold border-b-2 border-teal-700 py-5 transition-colors duration-200'
                    : 'text-slate-600 font-medium py-5 hover:text-teal-600 transition-colors duration-200'
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center space-x-3 sm:space-x-6">
          <div className="flex items-center space-x-2 sm:space-x-4 text-slate-600">
            <button
              className="material-symbols-outlined cursor-pointer hover:text-teal-600 transition-colors"
              onClick={() => {
                const dark = document.documentElement.classList.toggle('dark');
                localStorage.setItem('tikitaka-theme', dark ? 'dark' : 'light');
                setIsDark(dark);
              }}
            >{isDark ? 'light_mode' : 'dark_mode'}</button>
            <NotificationDropdown variant="material" />
            <span className="material-symbols-outlined cursor-pointer hover:text-teal-600 transition-colors hidden sm:block">help</span>
            <div className="h-8 w-8 rounded-full overflow-hidden bg-slate-200 border border-slate-200">
              {user?.photoURL ? (
                <img className="w-full h-full object-cover" src={user.photoURL} alt="Profile" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-teal-100 text-teal-800 font-bold text-xs">
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
      <aside className={`fixed left-0 top-14 sm:top-16 h-[calc(100vh-56px)] sm:h-[calc(100vh-64px)] w-64 bg-slate-50 flex flex-col p-4 space-y-2 border-r border-slate-200 z-40 transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 py-4 sm:py-6 mb-2">
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
          {SIDEBAR_ITEMS.map(item => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={
                activePage === item.key
                  ? 'flex items-center space-x-3 px-4 py-3 bg-[#CCFBF1] text-[#0F766E] font-bold shadow-sm rounded-lg border-l-4 border-[#0F766E] transition-all duration-200'
                  : 'flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50 hover:translate-x-1 transition-all duration-200'
              }
            >
              <span
                className="material-symbols-outlined"
                style={activePage === item.key ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >{item.icon}</span>
              <span className="text-sm tracking-normal">{item.label}</span>
            </Link>
          ))}

          {/* Mobile-only nav items */}
          <div className="md:hidden pt-3 border-t border-slate-200 mt-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={
                  activePage === item.key
                    ? 'flex items-center space-x-3 px-4 py-3 bg-[#CCFBF1] text-[#0F766E] font-bold shadow-sm rounded-lg border-l-4 border-[#0F766E]'
                    : 'flex items-center space-x-3 px-4 py-3 text-slate-600 font-medium hover:bg-slate-200/50'
                }
              >
                <span className="text-sm tracking-normal">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-200">
          <button className="w-full bg-[#005c55] py-3 px-4 rounded-lg text-white font-semibold text-sm flex items-center justify-center space-x-2 hover:brightness-110 active:scale-95 transition-transform shadow-lg shadow-teal-900/10">
            <span className="material-symbols-outlined text-lg">add</span>
            <span>New Class</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area — responsive margin */}
      <main className="lg:ml-64 mt-14 sm:mt-16 p-4 sm:p-6 lg:p-10 min-h-[calc(100vh-56px)] sm:min-h-[calc(100vh-64px)] bg-[#F9FAFB]">
        {children}
      </main>
    </>
  );
}
