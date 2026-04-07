import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { getRelativeTime } from '@/lib/dateUtils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Bell, MessageSquare, FileText, Clock, AlertCircle, UserMinus, Megaphone } from 'lucide-react';
import Link from 'next/link';

const MathRenderer = dynamic(() => import('@/components/editor/MathRenderer'), { ssr: false });

export default function NotificationDropdown({ variant = 'default' }) {
  const { user, role } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const lastFetchRef = useRef(0);
  const CACHE_TTL = 30000; // 30 seconds

  const fetchNotifications = async (force = false) => {
    // Skip if cached data is fresh
    if (!force && Date.now() - lastFetchRef.current < CACHE_TTL && notifications.length > 0) {
      return;
    }
    if (!user) return;
    setLoading(true);
    const items = [];

    try {
      // --- Fetch recent messages ---
      if (role === 'teacher') {
        // Teacher: conversations with unread or recent messages
        const convsQ = query(
          collection(db, 'conversations'),
          where('teacherId', '==', user.uid),
        );
        const convsSnap = await getDocs(convsQ);
        const convs = [];
        convsSnap.forEach(d => convs.push({ id: d.id, ...d.data() }));
        convs.sort((a, b) => {
          const tA = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
          const tB = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
          return tB - tA;
        });
        convs.slice(0, 5).forEach(conv => {
          items.push({
            id: `msg-${conv.id}`,
            type: 'message',
            title: `Message from ${conv.studentName || 'Student'}`,
            subtitle: conv.lastMessage ? (conv.lastMessage.length > 60 ? conv.lastMessage.slice(0, 60) + '...' : conv.lastMessage) : 'New conversation',
            time: conv.updatedAt,
            unread: !!conv.unreadByTeacher,
            href: '/teacher/messages',
          });
        });
      } else {
        // Student: find conversations where they participated
        const convsQ = query(
          collection(db, 'conversations'),
          where('studentId', '==', user.uid),
        );
        const convsSnap = await getDocs(convsQ);
        const convs = [];
        convsSnap.forEach(d => convs.push({ id: d.id, ...d.data() }));
        convs.sort((a, b) => {
          const tA = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
          const tB = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
          return tB - tA;
        });
        convs.slice(0, 5).forEach(conv => {
          items.push({
            id: `msg-${conv.id}`,
            type: 'message',
            title: `Message in ${conv.className || 'Class'}`,
            subtitle: conv.lastMessage ? (conv.lastMessage.length > 60 ? conv.lastMessage.slice(0, 60) + '...' : conv.lastMessage) : 'New conversation',
            time: conv.updatedAt,
            unread: false,
            href: '/student/messages',
          });
        });
      }

      // --- Fetch recently posted assignments ---
      if (role === 'student') {
        // Get student's enrolled classes
        const classesQ = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
        const classesSnap = await getDocs(classesQ);
        const classIds = [];
        const classMap = {};
        classesSnap.forEach(d => {
          classIds.push(d.id);
          classMap[d.id] = d.data();
        });

        if (classIds.length > 0) {
          const assignQ = query(
            collection(db, 'assignments'),
            where('classId', 'in', classIds.slice(0, 10)),
          );
          const assignSnap = await getDocs(assignQ);
          const assignments = [];
          assignSnap.forEach(d => assignments.push({ id: d.id, ...d.data() }));

          // Sort by createdAt descending for "recently posted"
          assignments.sort((a, b) => {
            const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
            return tB - tA;
          });

          // Recently posted (within last 7 days)
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          assignments.filter(a => {
            const t = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
            return t > sevenDaysAgo;
          }).slice(0, 5).forEach(a => {
            items.push({
              id: `assign-${a.id}`,
              type: 'assignment',
              title: `New: ${a.title}`,
              subtitle: classMap[a.classId]?.name || 'Class',
              time: a.createdAt,
              unread: false,
              href: `/student/class/${a.classId}`,
            });
          });

          // Due tomorrow reminders
          const now = new Date();
          const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
          const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);

          assignments.filter(a => {
            if (!a.dueDate) return false;
            const d = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
            return d >= tomorrowStart && d < tomorrowEnd;
          }).forEach(a => {
            items.push({
              id: `reminder-${a.id}`,
              type: 'reminder',
              title: `Due tomorrow: ${a.title}`,
              subtitle: `${classMap[a.classId]?.name || 'Class'} — ${a.totalPoints || 100} pts`,
              time: null,
              unread: true,
              href: `/student/class/${a.classId}`,
            });
          });
        }
      } else {
        // Teacher: recently posted assignments by them
        const assignQ = query(
          collection(db, 'assignments'),
          where('teacherId', '==', user.uid),
        );
        const assignSnap = await getDocs(assignQ);
        const assignments = [];
        assignSnap.forEach(d => assignments.push({ id: d.id, ...d.data() }));

        assignments.sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return tB - tA;
        });

        // Get class names
        const classIds = [...new Set(assignments.map(a => a.classId).filter(Boolean))];
        const classMap = {};
        if (classIds.length > 0) {
          const classesQ = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
          const classesSnap = await getDocs(classesQ);
          classesSnap.forEach(d => { classMap[d.id] = d.data(); });
        }

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        assignments.filter(a => {
          const t = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          return t > sevenDaysAgo;
        }).slice(0, 5).forEach(a => {
          items.push({
            id: `assign-${a.id}`,
            type: 'assignment',
            title: `Posted: ${a.title}`,
            subtitle: classMap[a.classId]?.name || 'Class',
            time: a.createdAt,
            unread: false,
            href: `/teacher/class/${a.classId}`,
          });
        });

        // Assignments due tomorrow (reminder for teacher too)
        const now = new Date();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);

        assignments.filter(a => {
          if (!a.dueDate) return false;
          const d = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
          return d >= tomorrowStart && d < tomorrowEnd;
        }).forEach(a => {
          items.push({
            id: `reminder-${a.id}`,
            type: 'reminder',
            title: `Due tomorrow: ${a.title}`,
            subtitle: `${classMap[a.classId]?.name || 'Class'} — ${a.totalPoints || 100} pts`,
            time: null,
            unread: true,
            href: `/teacher/class/${a.classId}`,
          });
        });
      }
      // --- Fetch system notifications (e.g. student left class) ---
      const notifsQ = query(
        collection(db, 'notifications'),
        where('recipientId', '==', user.uid),
      );
      const notifsSnap = await getDocs(notifsQ);
      const notifs = [];
      notifsSnap.forEach(d => notifs.push({ id: d.id, ...d.data() }));
      notifs.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return tB - tA;
      });
      notifs.slice(0, 10).forEach(n => {
        items.push({
          id: `notif-${n.id}`,
          type: n.notifType || 'system',
          title: n.title || 'Notification',
          subtitle: n.message || '',
          time: n.createdAt,
          unread: !n.read,
          href: n.href || (role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard'),
        });
      });
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }

    // Sort: reminders first, then by time
    items.sort((a, b) => {
      if (a.type === 'reminder' && b.type !== 'reminder') return -1;
      if (b.type === 'reminder' && a.type !== 'reminder') return 1;
      const tA = a.time?.toDate ? a.time.toDate().getTime() : (a.time ? new Date(a.time).getTime() : 0);
      const tB = b.time?.toDate ? b.time.toDate().getTime() : (b.time ? new Date(b.time).getTime() : 0);
      return tB - tA;
    });

    setNotifications(items.slice(0, 15));
    setHasUnread(items.some(n => n.unread));
    lastFetchRef.current = Date.now();
    setLoading(false);
  };

  // Fetch when popover opens
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, user]);

  const iconMap = {
    message: MessageSquare,
    assignment: FileText,
    reminder: AlertCircle,
    student_left: UserMinus,
    announcement: Megaphone,
    system: Bell,
  };

  const colorMap = {
    message: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
    assignment: 'text-teal-600 bg-teal-50 dark:bg-teal-900/20 dark:text-teal-400',
    reminder: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
    student_left: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
    announcement: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400',
    system: 'text-slate-600 bg-slate-50 dark:bg-slate-900/20 dark:text-slate-400',
  };

  // Teacher dashboard uses material icons styling
  const isMaterial = variant === 'material';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {isMaterial ? (
          <button className="relative material-symbols-outlined cursor-pointer hover:text-teal-600 transition-colors">
            notifications
            {hasUnread && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-rose-500 rounded-full border-2 border-white" />
            )}
          </button>
        ) : (
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
            <Bell className="h-5 w-5" />
            {hasUnread && (
              <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-primary rounded-full border-2 border-background" />
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-96 p-0 rounded-xl shadow-xl border">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground tracking-tight">Notifications</h3>
          <div className="flex items-center gap-3">
            {notifications.some(n => n.unread) && (
              <button
                className="text-[10px] font-semibold text-primary hover:underline"
                onClick={async () => {
                  const unreadNotifs = notifications.filter(n => n.unread && n.id.startsWith('notif-'));
                  await Promise.all(unreadNotifs.map(n =>
                    updateDoc(doc(db, 'notifications', n.id.replace('notif-', '')), { read: true }).catch(() => {})
                  ));
                  setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
                  setHasUnread(false);
                }}
              >
                Mark all read
              </button>
            )}
            <span className="text-[11px] font-semibold text-muted-foreground">
              {notifications.filter(n => n.unread).length || 0} new
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No notifications</p>
              <p className="text-xs text-muted-foreground/70 mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            <div>
              {notifications.map((notif) => {
                const Icon = iconMap[notif.type] || Bell;
                const colorClass = colorMap[notif.type] || '';
                return (
                  <Link
                    key={notif.id}
                    href={notif.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-5 py-3.5 hover:bg-accent/50 transition-colors border-b border-border/30 last:border-b-0 ${notif.unread ? 'bg-accent/20' : ''}`}
                  >
                    <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${notif.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                          {notif.title}
                        </p>
                        {notif.unread && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <MathRenderer content={notif.subtitle} plainText className="text-xs text-muted-foreground mt-0.5 truncate" />
                      {notif.time && (
                        <p className="text-[11px] text-muted-foreground/60 mt-1">{getRelativeTime(notif.time)}</p>
                      )}
                      {notif.type === 'reminder' && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          <Clock className="h-3 w-3" /> Reminder
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="px-5 py-3 border-t">
            <Link
              href={role === 'teacher' ? '/teacher/messages' : '/student/messages'}
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all messages
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
