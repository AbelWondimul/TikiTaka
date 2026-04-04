import Link from 'next/link';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/student/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/student/submissions', label: 'Submissions', key: 'submissions' },
  { href: '/student/quizzes', label: 'Quizzes', key: 'quizzes' },
  { href: '/student/progress', label: 'Progress', key: 'progress' },
  { href: '/student/schedule', label: 'Schedule', key: 'schedule' },
  { href: '/student/messages', label: 'Messages', key: 'messages' },
];

export default function StudentNavTabs({ active = 'dashboard' }) {
  return (
    <div className="border-b bg-card">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <nav className="flex gap-6 sm:gap-8 overflow-x-auto h-12 sm:h-14 scrollbar-hide">
          {TABS.map(tab => (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                'shrink-0 flex items-center text-sm font-medium transition-colors border-b-2 px-0',
                active === tab.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
