import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  addDoc,
  onSnapshot,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, MessageSquare, Send, ArrowLeft, BookOpen } from 'lucide-react';

function StudentMessages() {
  const { user } = useAuth();

  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(true);

  // Selected conversation
  const [selectedClass, setSelectedClass] = useState(null); // { id, name, teacherId, teacherName }
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef(null);
  const unsubscribeRef = useRef(null);

  // Fetch enrolled classes with teacher names
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoadingClasses(true);
      try {
        const q = query(collection(db, 'classes'), where('studentIds', 'array-contains', user.uid));
        const snap = await getDocs(q);
        const classes = await Promise.all(
          snap.docs.map(async (docSnap) => {
            const data = { id: docSnap.id, ...docSnap.data() };
            if (data.teacherId) {
              try {
                const teacherDoc = await getDoc(doc(db, 'users', data.teacherId));
                if (teacherDoc.exists()) data.teacherName = teacherDoc.data().displayName;
              } catch (_) {}
            }
            return data;
          })
        );
        setEnrolledClasses(classes);
      } catch (err) {
        console.error('Error loading classes:', err);
      } finally {
        setIsLoadingClasses(false);
      }
    };
    load();
  }, [user]);

  // Open a conversation thread
  const openConversation = async (cls) => {
    setSelectedClass(cls);
    setMessages([]);
    setIsLoadingMessages(true);

    // Unsubscribe previous listener
    if (unsubscribeRef.current) unsubscribeRef.current();

    const convId = `${cls.id}_${user.uid}`;
    const convRef = doc(db, 'conversations', convId);

    // Ensure conversation doc exists before subscribing to messages
    try {
      await setDoc(convRef, {
        classId: cls.id,
        className: cls.name,
        studentId: user.uid,
        studentName: user.displayName || user.email,
        teacherId: cls.teacherId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error('Error creating conversation:', err);
      setIsLoadingMessages(false);
      return;
    }

    const messagesRef = collection(db, 'conversations', convId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    unsubscribeRef.current = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
      setIsLoadingMessages(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });
  };

  // Cleanup on unmount
  useEffect(() => () => { if (unsubscribeRef.current) unsubscribeRef.current(); }, []);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedClass || isSending) return;
    setIsSending(true);
    try {
      const convId = `${selectedClass.id}_${user.uid}`;
      const convRef = doc(db, 'conversations', convId);

      // Upsert conversation metadata
      await setDoc(convRef, {
        classId: selectedClass.id,
        className: selectedClass.name,
        studentId: user.uid,
        studentName: user.displayName || user.email,
        teacherId: selectedClass.teacherId,
        lastMessage: newMessage.trim(),
        updatedAt: serverTimestamp(),
        unreadByTeacher: true,
      }, { merge: true });

      // Add message to subcollection
      await addDoc(collection(db, 'conversations', convId, 'messages'), {
        text: newMessage.trim(),
        senderId: user.uid,
        senderRole: 'student',
        createdAt: serverTimestamp(),
      });

      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <>
      <Head>
        <title>Messages - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-5xl mx-auto px-6 py-8">
        {!selectedClass ? (
          // Class Selection View
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Select a class to message your teacher.
              </p>
            </div>

            {isLoadingClasses ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : enrolledClasses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-sm font-medium">No classes yet</p>
                <p className="text-sm text-muted-foreground">Join a class first to message your teacher.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {enrolledClasses.map((cls) => (
                  <button
                    key={cls.id}
                    onClick={() => openConversation(cls)}
                    className="text-left bg-card border border-border/50 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <MessageSquare className="h-5 w-5 text-primary" />
                      </div>
                      <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                        {cls.classCode || cls.id.slice(0, 6).toUpperCase()}
                      </Badge>
                    </div>
                    <h3 className="text-base font-medium group-hover:text-primary transition-colors">{cls.name}</h3>
                    {cls.teacherName && (
                      <p className="text-sm text-muted-foreground mt-1">Teacher: {cls.teacherName}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          // Chat View
          <div className="flex flex-col h-[calc(100vh-10rem)]">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 text-muted-foreground"
                onClick={() => {
                  setSelectedClass(null);
                  if (unsubscribeRef.current) unsubscribeRef.current();
                }}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h2 className="text-lg font-semibold">{selectedClass.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedClass.teacherName ? `Teacher: ${selectedClass.teacherName}` : 'Your Teacher'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {isLoadingMessages ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">No messages yet</p>
                  <p className="text-sm text-muted-foreground">Send a message to start the conversation.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.senderId === user.uid;
                  return (
                    <div
                      key={msg.id}
                      className={cn('flex', isMe ? 'justify-end' : 'justify-start')}
                    >
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
            <div className="flex items-center gap-3 pt-4 border-t border-border">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Type a message..."
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
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentMessages, 'student');
