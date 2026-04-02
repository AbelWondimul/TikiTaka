import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
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
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, MessageSquare, Send, ArrowLeft, Inbox, Plus, Users, ChevronRight } from 'lucide-react';

function TeacherMessages() {
  const { user } = useAuth();

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

  const messagesEndRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const convUnsubRef = useRef(null);

  // Real-time conversation list
  useEffect(() => {
    if (!user) return;
    setIsLoadingConvs(true);

    const q = query(
      collection(db, 'conversations'),
      where('teacherId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    convUnsubRef.current = onSnapshot(q, (snap) => {
      const convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setConversations(convs);
      setIsLoadingConvs(false);
    }, (err) => {
      console.error('Error loading conversations:', err);
      setIsLoadingConvs(false);
    });

    return () => { if (convUnsubRef.current) convUnsubRef.current(); };
  }, [user]);

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
      const q = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const snap = await getDocs(q);
      setClasses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
    <>
      <Head>
        <title>Messages - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-5xl mx-auto px-6 py-8 h-[calc(100vh-5rem)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-border/50 rounded-2xl overflow-hidden h-full bg-card shadow-sm">

          {/* Left Panel — Conversation List */}
          <div className={cn(
            'border-r border-border/50 flex flex-col',
            (selectedConv || showNewConv) ? 'hidden md:flex' : 'flex'
          )}>
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold">Messages</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Student conversations</p>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={openNewConversation}
                title="New message"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
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
            </div>
          </div>

          {/* Right Panel — Chat or New Conversation */}
          <div className={cn(
            'col-span-2 flex flex-col',
            !selectedConv && !showNewConv ? 'hidden md:flex' : 'flex'
          )}>
            {showNewConv && !selectedConv ? (
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
                <p className="text-sm font-medium">Select a conversation</p>
                <p className="text-sm text-muted-foreground">Choose a student message from the list or start a new one.</p>
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
                                : 'bg-muted text-foreground rounded-bl-sm'
                            )}
                          >
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
    </>
  );
}

export default withAuth(TeacherMessages, 'teacher');
