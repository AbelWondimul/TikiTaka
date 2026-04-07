import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  onSnapshot,
  orderBy,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleClasses } from '@/lib/classUtils';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MessageSquare, Send, ArrowLeft, Inbox, Plus, Users, ChevronRight, Mail, Clock, CheckCircle } from 'lucide-react';

function TeacherMessages() {
  const { user, role } = useAuth();
  const router = useRouter();
  const hasAutoOpenedRef = useRef(false);

  const [conversations, setConversations] = useState([]);
  const [isLoadingConvs, setIsLoadingConvs] = useState(true);

  // Selected conversation
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // New conversation flow
  const [showNewConv, setShowNewConv] = useState(false);
  const [classes, setClasses] = useState([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [selectedNewClass, setSelectedNewClass] = useState(null);
  const [classStudents, setClassStudents] = useState([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'sent' | 'email'
  const [sentItems, setSentItems] = useState([]);
  const [isLoadingSent, setIsLoadingSent] = useState(false);
  const [selectedSentItem, setSelectedSentItem] = useState(null);

  // Email compose
  const [emailClassId, setEmailClassId] = useState('');
  const [emailRecipientType, setEmailRecipientType] = useState('all');
  const [emailRecipientId, setEmailRecipientId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sentEmails, setSentEmails] = useState([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(null);
  const [showComposeEmail, setShowComposeEmail] = useState(false);
  const [emailClasses, setEmailClasses] = useState([]);
  const [emailStudents, setEmailStudents] = useState([]);
  const [isLoadingEmailStudents, setIsLoadingEmailStudents] = useState(false);

  const messagesEndRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const convUnsubRef = useRef(null);

  // Real-time conversation list
  useEffect(() => {
    if (!user) return;
    setIsLoadingConvs(true);

    // Fetch accessible classes to get TA class IDs
    const fetchConversations = async () => {
      const accessibleClasses = await getAccessibleClasses(user.uid, role);
      const taClassIds = accessibleClasses.filter(c => c._isTA).map(c => c.id);

      const q = query(
        collection(db, 'conversations'),
        where('teacherId', '==', user.uid),
        orderBy('updatedAt', 'desc')
      );

      convUnsubRef.current = onSnapshot(q, (snap) => {
        const convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const seenIds = new Set(convs.map(c => c.id));

        // Also listen for TA class conversations
        if (taClassIds.length > 0) {
          for (let i = 0; i < taClassIds.length; i += 30) {
            const taQ = query(
              collection(db, 'conversations'),
              where('classId', 'in', taClassIds.slice(i, i + 30)),
              orderBy('updatedAt', 'desc')
            );
            onSnapshot(taQ, (taSnap) => {
              const taConvs = taSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(c => !seenIds.has(c.id));
              if (taConvs.length > 0) {
                setConversations(prev => {
                  const merged = [...prev];
                  const mergedIds = new Set(merged.map(c => c.id));
                  taConvs.forEach(c => { if (!mergedIds.has(c.id)) merged.push(c); });
                  merged.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
                  return merged;
                });
              }
            });
          }
        }

        setConversations(convs);
        setIsLoadingConvs(false);
      }, (err) => {
        console.error('Error loading conversations:', err);
        setIsLoadingConvs(false);
      });
    };

    fetchConversations();

    return () => { if (convUnsubRef.current) convUnsubRef.current(); };
  }, [user]);

  // Auto-open conversation if studentId & classId are in query params (from Students page)
  useEffect(() => {
    if (hasAutoOpenedRef.current || isLoadingConvs || !user || !router.isReady) return;
    const { studentId, classId } = router.query;
    if (!studentId || !classId) return;

    hasAutoOpenedRef.current = true;

    // Check if conversation already exists
    const convId = `${classId}_${studentId}`;
    const existing = conversations.find(c => c.id === convId);
    if (existing) {
      openConversation(existing);
      return;
    }

    // Build a new conversation object and open it
    const fetchAndOpen = async () => {
      try {
        const [studentDoc, classDoc] = await Promise.all([
          getDoc(doc(db, 'users', studentId)),
          getDoc(doc(db, 'classes', classId)),
        ]);
        const studentName = studentDoc.exists() ? (studentDoc.data().displayName || studentDoc.data().email || studentId) : studentId;
        const className = classDoc.exists() ? (classDoc.data().name || classId) : classId;

        openConversation({
          id: convId,
          classId,
          className,
          studentId,
          studentName,
          teacherId: user.uid,
        });
      } catch (err) {
        console.error('Error auto-opening conversation:', err);
      }
    };
    fetchAndOpen();
  }, [isLoadingConvs, conversations, router.isReady, user]);

  const openConversation = async (conv) => {
    setSelectedConv(conv);
    setMessages([]);
    setIsLoadingMessages(true);
    setShowNewConv(false);

    // Unsubscribe previous messages listener
    if (unsubscribeRef.current) unsubscribeRef.current();

    // Ensure conversation doc exists before subscribing to messages
    const convRef = doc(db, 'conversations', conv.id);
    try {
      await setDoc(convRef, {
        classId: conv.classId,
        className: conv.className,
        studentId: conv.studentId,
        studentName: conv.studentName,
        teacherId: user.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error('Error ensuring conversation:', err);
      setIsLoadingMessages(false);
      return;
    }

    const messagesRef = collection(db, 'conversations', conv.id, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    unsubscribeRef.current = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
      setIsLoadingMessages(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    // Mark as read by teacher
    try {
      await updateDoc(convRef, { unreadByTeacher: false });
    } catch (_) {}
  };

  useEffect(() => () => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    if (convUnsubRef.current) convUnsubRef.current();
  }, []);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConv || isSending) return;
    setIsSending(true);
    try {
      const convRef = doc(db, 'conversations', selectedConv.id);

      // Update conversation metadata
      await setDoc(convRef, {
        lastMessage: newMessage.trim(),
        updatedAt: serverTimestamp(),
        unreadByTeacher: false,
      }, { merge: true });

      // Add message
      await addDoc(collection(db, 'conversations', selectedConv.id, 'messages'), {
        text: newMessage.trim(),
        senderId: user.uid,
        senderRole: 'teacher',
        createdAt: serverTimestamp(),
      });

      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsSending(false);
    }
  };

  // --- New conversation flow ---

  const openNewConversation = async () => {
    setShowNewConv(true);
    setSelectedConv(null);
    setSelectedNewClass(null);
    setClassStudents([]);
    setIsLoadingClasses(true);

    try {
      const accessibleClasses = await getAccessibleClasses(user.uid, role);
      setClasses(accessibleClasses);
    } catch (err) {
      console.error('Error loading classes:', err);
    } finally {
      setIsLoadingClasses(false);
    }
  };

  const selectClassForNewConv = async (cls) => {
    setSelectedNewClass(cls);
    setIsLoadingStudents(true);
    setClassStudents([]);

    const studentIds = cls.studentIds || [];
    if (studentIds.length === 0) {
      setIsLoadingStudents(false);
      return;
    }

    try {
      const students = await Promise.all(
        studentIds.map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
              return { uid, ...userDoc.data() };
            }
            return { uid, displayName: uid, email: '' };
          } catch (_) {
            return { uid, displayName: uid, email: '' };
          }
        })
      );
      setClassStudents(students);
    } catch (err) {
      console.error('Error loading students:', err);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const startConversationWithStudent = async (student) => {
    const convId = `${selectedNewClass.id}_${student.uid}`;

    // Check if this conversation already exists in our list
    const existing = conversations.find((c) => c.id === convId);
    if (existing) {
      openConversation(existing);
      return;
    }

    // Create new conversation and open it
    const convData = {
      id: convId,
      classId: selectedNewClass.id,
      className: selectedNewClass.name,
      studentId: student.uid,
      studentName: student.displayName || student.email || student.uid,
      teacherId: user.uid,
    };

    openConversation(convData);
  };

  // --- Sent tab ---
  const fetchSentItems = async () => {
    if (!user) return;
    setIsLoadingSent(true);
    try {
      // Fetch announcements sent by this teacher
      const announcementsQ = query(
        collection(db, 'notifications'),
        where('senderId', '==', user.uid),
        where('notifType', '==', 'announcement'),
        orderBy('createdAt', 'desc')
      );
      const announcementSnap = await getDocs(announcementsQ);
      const announcements = announcementSnap.docs.map(d => ({
        id: d.id,
        type: 'announcement',
        ...d.data(),
      }));

      // Deduplicate announcements by title+body+createdAt (same announcement sent to multiple recipients)
      const announcementGroups = {};
      announcements.forEach(a => {
        const key = `${a.title}_${a.body || ''}_${a.createdAt?.toMillis?.() || ''}`;
        if (!announcementGroups[key]) {
          announcementGroups[key] = { ...a, recipientCount: 1 };
        } else {
          announcementGroups[key].recipientCount += 1;
        }
      });
      const uniqueAnnouncements = Object.values(announcementGroups);

      // Fetch sent messages from conversations
      const accessibleClasses = await getAccessibleClasses(user.uid, role);
      const convQ = query(
        collection(db, 'conversations'),
        where('teacherId', '==', user.uid),
        orderBy('updatedAt', 'desc')
      );
      const convSnap = await getDocs(convQ);

      const sentMessages = [];
      for (const convDoc of convSnap.docs) {
        const convData = convDoc.data();
        const msgQ = query(
          collection(db, 'conversations', convDoc.id, 'messages'),
          where('senderId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const msgSnap = await getDocs(msgQ);
        msgSnap.docs.forEach(m => {
          sentMessages.push({
            id: m.id,
            type: 'message',
            conversationId: convDoc.id,
            studentName: convData.studentName,
            className: convData.className,
            ...m.data(),
          });
        });
      }

      // Combine and sort by date
      const allItems = [...uniqueAnnouncements, ...sentMessages];
      allItems.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      setSentItems(allItems);
    } catch (err) {
      console.error('Error fetching sent items:', err);
    } finally {
      setIsLoadingSent(false);
    }
  };

  // --- Email tab ---
  const fetchSentEmails = async () => {
    if (!user) return;
    setIsLoadingEmails(true);
    try {
      const q = query(
        collection(db, 'sentEmails'),
        where('senderId', '==', user.uid),
        orderBy('sentAt', 'desc')
      );
      const snap = await getDocs(q);
      setSentEmails(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching sent emails:', err);
    } finally {
      setIsLoadingEmails(false);
    }
  };

  const loadEmailClasses = async () => {
    try {
      const accessibleClasses = await getAccessibleClasses(user.uid, role);
      setEmailClasses(accessibleClasses);
    } catch (err) {
      console.error('Error loading classes for email:', err);
    }
  };

  const loadStudentsForEmailClass = async (classId) => {
    setIsLoadingEmailStudents(true);
    setEmailStudents([]);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (!classDoc.exists()) return;
      const studentIds = classDoc.data().studentIds || [];
      const students = await Promise.all(
        studentIds.map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) return { uid, ...userDoc.data() };
            return { uid, displayName: uid, email: '' };
          } catch (_) {
            return { uid, displayName: uid, email: '' };
          }
        })
      );
      setEmailStudents(students);
    } catch (err) {
      console.error('Error loading students for email:', err);
    } finally {
      setIsLoadingEmailStudents(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim() || !emailClassId) return;
    if (emailRecipientType === 'individual' && !emailRecipientId) return;
    setIsSendingEmail(true);
    setEmailSuccess(null);
    try {
      const classDoc = await getDoc(doc(db, 'classes', emailClassId));
      const className = classDoc.exists() ? (classDoc.data().name || emailClassId) : emailClassId;

      // Resolve recipient emails
      let recipientEmails = [];
      let recipientName = null;
      let recipientId = null;

      if (emailRecipientType === 'all') {
        const studentIds = classDoc.exists() ? (classDoc.data().studentIds || []) : [];
        const studentDocs = await Promise.all(
          studentIds.map(async (uid) => {
            try {
              const uDoc = await getDoc(doc(db, 'users', uid));
              return uDoc.exists() ? uDoc.data().email : null;
            } catch (_) { return null; }
          })
        );
        recipientEmails = studentDocs.filter(Boolean);
      } else {
        const studentDoc = await getDoc(doc(db, 'users', emailRecipientId));
        if (studentDoc.exists()) {
          recipientEmails = [studentDoc.data().email].filter(Boolean);
          recipientName = studentDoc.data().displayName || studentDoc.data().email || emailRecipientId;
        }
        recipientId = emailRecipientId;
      }

      await addDoc(collection(db, 'sentEmails'), {
        senderId: user.uid,
        classId: emailClassId,
        className,
        recipientType: emailRecipientType,
        recipientId: recipientId || null,
        recipientName: recipientName || null,
        recipientEmails,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        sentAt: serverTimestamp(),
      });

      setEmailSuccess('Email saved successfully! It will be sent when the email Cloud Function is deployed.');
      setEmailSubject('');
      setEmailBody('');
      setEmailRecipientId('');
      setShowComposeEmail(false);
      fetchSentEmails();
    } catch (err) {
      console.error('Error sending email:', err);
      setEmailSuccess('Failed to save email. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'sent') {
      fetchSentItems();
    } else if (activeTab === 'email') {
      loadEmailClasses();
      fetchSentEmails();
    }
  }, [activeTab, user]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatRelative = (timestamp) => {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((new Date() - d) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <TeacherLayout activePage="messages">
      <Head>
        <title>Messages - TikiTaka</title>
      </Head>

      <div className="h-[calc(100vh-10rem)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-border/50 rounded-2xl overflow-hidden h-full bg-card shadow-sm">

          {/* Left Panel — Conversation List / Sent / Email */}
          <div className={cn(
            'border-r border-border/50 flex flex-col',
            (selectedConv || showNewConv || showComposeEmail || selectedSentItem) ? 'hidden md:flex' : 'flex'
          )}>
            <div className="p-5 border-b border-border/50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h1 className="text-lg font-semibold">Messages</h1>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeTab === 'inbox' ? 'Student conversations' : activeTab === 'sent' ? 'Sent messages' : 'Email students'}
                  </p>
                </div>
                {activeTab === 'inbox' && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    onClick={openNewConversation}
                    title="New message"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
                {activeTab === 'email' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs gap-1.5"
                    onClick={() => { setShowComposeEmail(true); setEmailSuccess(null); }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Compose
                  </Button>
                )}
              </div>

              {/* Tab buttons */}
              <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
                {[
                  { key: 'inbox', label: 'Inbox', icon: Inbox },
                  { key: 'sent', label: 'Sent', icon: Send },
                  { key: 'email', label: 'Email', icon: Mail },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      setSelectedConv(null);
                      setShowNewConv(false);
                      setSelectedSentItem(null);
                      setShowComposeEmail(false);
                    }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                      activeTab === tab.key
                        ? 'bg-background shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* INBOX TAB */}
              {activeTab === 'inbox' && (
                <>
                  {isLoadingConvs ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                      <Inbox className="h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">No messages yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Start a conversation or wait for students to message you.</p>
                    </div>
                  ) : (
                    conversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => openConversation(conv)}
                        className={cn(
                          'w-full text-left p-4 border-b border-border/30 hover:bg-muted/50 transition-colors',
                          selectedConv?.id === conv.id && 'bg-muted/70'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            {conv.unreadByTeacher && (
                              <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                            )}
                            <span className="text-sm font-medium truncate">
                              {conv.studentName || 'Student'}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatRelative(conv.updatedAt)}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-[10px] font-mono mb-1">
                          {conv.className || conv.classId}
                        </Badge>
                        <p className="text-xs text-muted-foreground truncate">
                          {conv.lastMessage || 'No messages yet'}
                        </p>
                      </button>
                    ))
                  )}
                </>
              )}

              {/* SENT TAB */}
              {activeTab === 'sent' && (
                <>
                  {isLoadingSent ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : sentItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                      <Send className="h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">No sent messages</p>
                      <p className="text-xs text-muted-foreground mt-1">Messages and announcements you send will appear here.</p>
                    </div>
                  ) : (
                    sentItems.map((item, idx) => (
                      <button
                        key={`${item.type}-${item.id}-${idx}`}
                        onClick={() => setSelectedSentItem(item)}
                        className={cn(
                          'w-full text-left p-4 border-b border-border/30 hover:bg-muted/50 transition-colors',
                          selectedSentItem?.id === item.id && selectedSentItem?.type === item.type && 'bg-muted/70'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            {item.type === 'announcement' ? (
                              <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : (
                              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-sm font-medium truncate">
                              {item.type === 'announcement'
                                ? (item.title || 'Announcement')
                                : `To: ${item.studentName || 'Student'}`}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatRelative(item.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {item.type === 'announcement' ? 'Announcement' : item.className || 'Message'}
                          </Badge>
                          {item.type === 'announcement' && item.recipientCount > 1 && (
                            <span className="text-[10px] text-muted-foreground">
                              {item.recipientCount} recipients
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.type === 'announcement' ? (item.body || item.title) : (item.text || '')}
                        </p>
                      </button>
                    ))
                  )}
                </>
              )}

              {/* EMAIL TAB */}
              {activeTab === 'email' && (
                <>
                  {isLoadingEmails ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : sentEmails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                      <Mail className="h-8 w-8 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">No emails sent</p>
                      <p className="text-xs text-muted-foreground mt-1">Compose an email to your students.</p>
                    </div>
                  ) : (
                    sentEmails.map((email) => (
                      <button
                        key={email.id}
                        onClick={() => setSelectedSentItem({ ...email, type: 'email' })}
                        className={cn(
                          'w-full text-left p-4 border-b border-border/30 hover:bg-muted/50 transition-colors',
                          selectedSentItem?.id === email.id && selectedSentItem?.type === 'email' && 'bg-muted/70'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-sm font-medium truncate">{email.subject}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatRelative(email.sentAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {email.className || email.classId}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {email.recipientType === 'all'
                              ? `All students (${(email.recipientEmails || []).length})`
                              : email.recipientName || 'Individual'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{email.body}</p>
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Panel — Chat, New Conversation, Sent Detail, or Email Compose */}
          <div className={cn(
            'col-span-2 flex flex-col',
            !selectedConv && !showNewConv && !selectedSentItem && !showComposeEmail ? 'hidden md:flex' : 'flex'
          )}>
            {/* Email Compose View */}
            {showComposeEmail ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 p-5 border-b border-border/50">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-1 text-muted-foreground"
                    onClick={() => { setShowComposeEmail(false); setEmailSuccess(null); }}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div>
                    <h2 className="text-base font-semibold">Compose Email</h2>
                    <p className="text-xs text-muted-foreground">Send an email to your students</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {emailSuccess && (
                    <div className={cn(
                      'flex items-center gap-2 p-3 rounded-lg text-sm',
                      emailSuccess.includes('Failed')
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-green-50 text-green-700 border border-green-200'
                    )}>
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      {emailSuccess}
                    </div>
                  )}

                  {/* Class selector */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Class</label>
                    <Select
                      value={emailClassId}
                      onValueChange={(val) => {
                        setEmailClassId(val);
                        setEmailRecipientId('');
                        if (val) loadStudentsForEmailClass(val);
                      }}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Select a class" />
                      </SelectTrigger>
                      <SelectContent>
                        {emailClasses.map(cls => (
                          <SelectItem key={cls.id} value={cls.id}>
                            {cls.name} ({(cls.studentIds || []).length} students)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Recipient toggle */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Recipients</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEmailRecipientType('all'); setEmailRecipientId(''); }}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                          emailRecipientType === 'all'
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'border-border/50 text-muted-foreground hover:bg-muted/30'
                        )}
                      >
                        <Users className="h-4 w-4 inline mr-1.5" />
                        All Students
                      </button>
                      <button
                        onClick={() => setEmailRecipientType('individual')}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                          emailRecipientType === 'individual'
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'border-border/50 text-muted-foreground hover:bg-muted/30'
                        )}
                      >
                        <MessageSquare className="h-4 w-4 inline mr-1.5" />
                        Individual
                      </button>
                    </div>
                  </div>

                  {/* Individual student picker */}
                  {emailRecipientType === 'individual' && emailClassId && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Student</label>
                      {isLoadingEmailStudents ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <Select value={emailRecipientId} onValueChange={setEmailRecipientId}>
                          <SelectTrigger className="rounded-xl">
                            <SelectValue placeholder="Select a student" />
                          </SelectTrigger>
                          <SelectContent>
                            {emailStudents.map(s => (
                              <SelectItem key={s.uid} value={s.uid}>
                                {s.displayName || s.email || s.uid}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  {/* Subject */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Subject</label>
                    <Input
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Email subject line"
                      className="rounded-xl"
                    />
                  </div>

                  {/* Body */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Message</label>
                    <Textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Write your email message..."
                      className="rounded-xl min-h-[160px] resize-y"
                    />
                  </div>

                  {/* Send button */}
                  <Button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail || !emailSubject.trim() || !emailBody.trim() || !emailClassId || (emailRecipientType === 'individual' && !emailRecipientId)}
                    className="w-full rounded-xl bg-gradient-to-r from-[#005c55] to-[#0f766e] text-white hover:opacity-90"
                  >
                    {isSendingEmail ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</>
                    ) : (
                      <><Mail className="h-4 w-4 mr-2" /> Send Email</>
                    )}
                  </Button>
                </div>
              </div>
            ) : selectedSentItem ? (
              // Sent item detail view
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 p-5 border-b border-border/50">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-1 text-muted-foreground"
                    onClick={() => setSelectedSentItem(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold truncate">
                      {selectedSentItem.type === 'announcement'
                        ? (selectedSentItem.title || 'Announcement')
                        : selectedSentItem.type === 'email'
                          ? selectedSentItem.subject
                          : `Message to ${selectedSentItem.studentName || 'Student'}`}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedSentItem.type === 'announcement'
                        ? `Announcement${selectedSentItem.recipientCount > 1 ? ` - ${selectedSentItem.recipientCount} recipients` : ''}`
                        : selectedSentItem.type === 'email'
                          ? `Email - ${selectedSentItem.recipientType === 'all' ? `All students (${(selectedSentItem.recipientEmails || []).length})` : selectedSentItem.recipientName || 'Individual'}`
                          : selectedSentItem.className || ''}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <Clock className="h-3.5 w-3.5" />
                    {formatTime(selectedSentItem.createdAt || selectedSentItem.sentAt)}
                    {' - '}
                    {(() => {
                      const ts = selectedSentItem.createdAt || selectedSentItem.sentAt;
                      if (!ts) return '';
                      const d = ts.toDate ? ts.toDate() : new Date(ts);
                      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                    })()}
                  </div>

                  {selectedSentItem.type === 'email' && (
                    <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Class</p>
                      <p className="text-sm font-medium">{selectedSentItem.className || selectedSentItem.classId}</p>
                    </div>
                  )}

                  {selectedSentItem.type === 'announcement' && (
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold mb-1">{selectedSentItem.title}</h3>
                    </div>
                  )}

                  {selectedSentItem.type === 'email' && (
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold mb-1">{selectedSentItem.subject}</h3>
                    </div>
                  )}

                  <div className="bg-muted/20 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap">
                    {selectedSentItem.type === 'message'
                      ? selectedSentItem.text
                      : selectedSentItem.type === 'email'
                        ? selectedSentItem.body
                        : selectedSentItem.body || selectedSentItem.title}
                  </div>
                </div>
              </div>
            ) : showNewConv && !selectedConv ? (
              // New Conversation Flow
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 p-5 border-b border-border/50">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-1 text-muted-foreground"
                    onClick={() => { setShowNewConv(false); setSelectedNewClass(null); }}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div>
                    <h2 className="text-base font-semibold">New Message</h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedNewClass ? `Select a student from ${selectedNewClass.name}` : 'Select a class'}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {!selectedNewClass ? (
                    // Class selection
                    isLoadingClasses ? (
                      <div className="flex justify-center py-12">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : classes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Users className="h-8 w-8 text-muted-foreground mb-3" />
                        <p className="text-sm font-medium">No classes yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Create a class first to message students.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {classes.map((cls) => (
                          <button
                            key={cls.id}
                            onClick={() => selectClassForNewConv(cls)}
                            className="w-full text-left p-4 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-muted/30 transition-all flex items-center justify-between group"
                          >
                            <div>
                              <p className="text-sm font-medium group-hover:text-primary transition-colors">{cls.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {(cls.studentIds || []).length} student{(cls.studentIds || []).length !== 1 ? 's' : ''}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    // Student selection
                    <>
                      <button
                        onClick={() => setSelectedNewClass(null)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        Back to classes
                      </button>
                      {isLoadingStudents ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : classStudents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <Users className="h-8 w-8 text-muted-foreground mb-3" />
                          <p className="text-sm font-medium">No students enrolled</p>
                          <p className="text-xs text-muted-foreground mt-1">This class has no students yet.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {classStudents.map((student) => (
                            <button
                              key={student.uid}
                              onClick={() => startConversationWithStudent(student)}
                              className="w-full text-left p-4 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-muted/30 transition-all flex items-center justify-between group"
                            >
                              <div>
                                <p className="text-sm font-medium group-hover:text-primary transition-colors">
                                  {student.displayName || student.email || student.uid}
                                </p>
                                {student.email && student.displayName && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{student.email}</p>
                                )}
                              </div>
                              <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : !selectedConv ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <MessageSquare className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-sm font-medium">
                  {activeTab === 'inbox' ? 'Select a conversation' : activeTab === 'sent' ? 'Select a sent item' : 'Compose an email'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {activeTab === 'inbox'
                    ? 'Choose a student message from the list or start a new one.'
                    : activeTab === 'sent'
                      ? 'Click on a sent message or announcement to view details.'
                      : 'Click "Compose" to send an email to your students.'}
                </p>
              </div>
            ) : (
              <>
                {/* Chat Header */}
                <div className="flex items-center gap-3 p-5 border-b border-border/50">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden -ml-1 text-muted-foreground"
                    onClick={() => setSelectedConv(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold truncate">
                      {selectedConv.studentName || 'Student'}
                    </h2>
                    <p className="text-xs text-muted-foreground">{selectedConv.className}</p>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {isLoadingMessages ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <MessageSquare className="h-7 w-7 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No messages yet</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.senderId === user.uid;
                      return (
                        <div key={msg.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                              isMe
                                ? 'bg-primary text-primary-foreground rounded-br-sm'
                                : msg.senderRole === 'ta'
                                  ? 'bg-violet-100 text-violet-900 rounded-bl-sm'
                                  : 'bg-muted text-foreground rounded-bl-sm'
                            )}
                          >
                            {msg.senderRole === 'ta' && msg.senderName && (
                              <p className="text-[10px] font-bold text-violet-700 mb-1">{msg.senderName}</p>
                            )}
                            <p>{msg.text}</p>
                            <p className={cn('text-[10px] mt-1 opacity-70', isMe ? 'text-right' : '')}>
                              {formatTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="flex items-center gap-3 p-4 border-t border-border/50">
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    placeholder={`Reply to ${selectedConv.studentName || 'student'}...`}
                    className="flex-1 rounded-xl"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={isSending || !newMessage.trim()}
                    className="rounded-xl bg-gradient-to-r from-[#005c55] to-[#0f766e] text-white hover:opacity-90"
                    size="icon"
                  >
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}

export default withAuth(TeacherMessages, ['teacher', 'ta']);
