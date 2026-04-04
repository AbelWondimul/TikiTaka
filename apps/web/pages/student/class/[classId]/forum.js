import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowLeft, MessageCircleQuestion, ThumbsUp, Send, ShieldAlert, Lock, Reply, GraduationCap } from 'lucide-react';
import { getRelativeTime } from '@/lib/dateUtils';

function StudentForum() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  if (!router.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [classData, setClassData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);

  useEffect(() => {
    if (!classId || !user) return;
    fetchData();
  }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (classDoc.exists()) {
        const cls = { id: classDoc.id, ...classDoc.data() };
        setClassData(cls);
        setIsBlocked((cls.blockedForumUsers || []).includes(user.uid));
      }

      const postsQ = query(collection(db, 'forumPosts'), where('classId', '==', classId));
      const postsSnap = await getDocs(postsQ);
      const postList = [];
      postsSnap.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (!data.removed) postList.push(data);
      });
      postList.sort((a, b) => {
        const upA = (a.upvotedBy || []).length;
        const upB = (b.upvotedBy || []).length;
        if (upB !== upA) return upB - upA;
        return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
      });
      setPosts(postList);
    } catch (err) {
      console.error('Error fetching forum:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitPost = async () => {
    if (!newPost.trim() || isSubmitting || isBlocked) return;
    setIsSubmitting(true);
    try {
      const postRef = await addDoc(collection(db, 'forumPosts'), {
        classId,
        authorId: user.uid,
        content: newPost.trim(),
        upvotedBy: [],
        replies: [],
        removed: false,
        createdAt: serverTimestamp(),
      });
      setPosts(prev => [{
        id: postRef.id,
        classId,
        authorId: user.uid,
        content: newPost.trim(),
        upvotedBy: [],
        replies: [],
        removed: false,
        createdAt: new Date(),
      }, ...prev]);
      setNewPost('');
    } catch (err) {
      console.error('Error posting:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpvote = async (post) => {
    const hasUpvoted = (post.upvotedBy || []).includes(user.uid);
    try {
      await updateDoc(doc(db, 'forumPosts', post.id), {
        upvotedBy: hasUpvoted ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
      setPosts(prev => prev.map(p => {
        if (p.id !== post.id) return p;
        const newUpvotes = hasUpvoted
          ? (p.upvotedBy || []).filter(uid => uid !== user.uid)
          : [...(p.upvotedBy || []), user.uid];
        return { ...p, upvotedBy: newUpvotes };
      }));
    } catch (err) {
      console.error('Error upvoting:', err);
    }
  };

  const isTA = (classData?.taIds || []).includes(user?.uid);

  const handleReply = async (postId) => {
    if (!replyText.trim() || isReplying || isBlocked) return;
    setIsReplying(true);
    try {
      const reply = {
        content: replyText.trim(),
        role: isTA ? 'ta' : 'student',
        authorId: user.uid,
        ...(isTA ? { displayName: `${user.displayName || user.email} (TA)` } : {}),
        createdAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'forumPosts', postId), {
        replies: arrayUnion(reply),
      });
      setPosts(prev => prev.map(p =>
        p.id === postId ? { ...p, replies: [...(p.replies || []), reply] } : p
      ));
      setReplyText('');
      setReplyingToId(null);
    } catch (err) {
      console.error('Error replying:', err);
    } finally {
      setIsReplying(false);
    }
  };

  const forumEnabled = classData?.forumEnabled !== false;

  return (
    <>
      <Head>
        <title>Forum - {classData?.name || 'Class'} - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/student/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          <div className="flex items-center gap-3">
            <MessageCircleQuestion className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{classData?.name || 'Class'} — Anonymous Forum</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask questions anonymously. Your identity is never shared with the teacher. Upvote questions you also have.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !forumEnabled ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
            <Lock className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">Forum Disabled</p>
            <p className="text-sm text-muted-foreground mt-1">Your teacher has turned off the anonymous forum for this class.</p>
          </div>
        ) : (
          <>
            {isBlocked ? (
              <Alert className="bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-sm text-red-700 dark:text-red-400">
                  You have been blocked from posting in this forum. You can still view and upvote existing posts.
                </AlertDescription>
              </Alert>
            ) : (
              <Card className="p-4 rounded-2xl border-border/50">
                <Textarea
                  placeholder="Ask a question anonymously... Your name will not be shown."
                  value={newPost}
                  onChange={(e) => setNewPost(e.target.value)}
                  className="min-h-[80px] rounded-xl border-border/50 resize-none mb-3"
                  maxLength={1000}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{newPost.length}/1000</span>
                  <Button onClick={handleSubmitPost} disabled={isSubmitting || !newPost.trim()} className="rounded-xl" size="sm">
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                    Post Anonymously
                  </Button>
                </div>
              </Card>
            )}

            {posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
                <MessageCircleQuestion className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No questions yet. Be the first to ask!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map(post => {
                  const upvotes = (post.upvotedBy || []).length;
                  const hasUpvoted = (post.upvotedBy || []).includes(user.uid);
                  const isOwn = post.authorId === user.uid;
                  const replies = post.replies || [];

                  return (
                    <Card key={post.id} className="rounded-2xl border-border/50 overflow-hidden">
                      <div className="p-4 flex gap-3">
                        <button
                          onClick={() => handleUpvote(post)}
                          className={cn(
                            'flex flex-col items-center gap-0.5 pt-1 shrink-0 transition-colors',
                            hasUpvoted ? 'text-primary' : 'text-muted-foreground hover:text-primary'
                          )}
                        >
                          <ThumbsUp className={cn('h-5 w-5', hasUpvoted && 'fill-primary')} />
                          <span className="text-xs font-bold tabular-nums">{upvotes}</span>
                        </button>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{post.content}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[10px] text-muted-foreground">{getRelativeTime(post.createdAt)}</span>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">Anonymous</Badge>
                            {isOwn && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Your post</Badge>}
                            {!isBlocked && (
                              <button
                                className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                                onClick={() => { setReplyingToId(replyingToId === post.id ? null : post.id); setReplyText(''); }}
                              >
                                <Reply className="h-3 w-3" /> Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Replies */}
                      {replies.length > 0 && (
                        <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                          {replies.map((reply, idx) => (
                            <div key={idx} className="flex gap-2.5">
                              <div className={cn(
                                'h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold',
                                reply.role === 'teacher'
                                  ? 'bg-primary/15 text-primary'
                                  : reply.role === 'ta'
                                    ? 'bg-violet-100 text-violet-700'
                                    : 'bg-muted text-muted-foreground'
                              )}>
                                {reply.role === 'teacher' ? <GraduationCap className="h-3.5 w-3.5" /> : reply.role === 'ta' ? 'TA' : 'A'}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {reply.role === 'teacher' ? (
                                    <span className="text-xs font-semibold text-primary">{reply.displayName || 'Teacher'}</span>
                                  ) : reply.role === 'ta' ? (
                                    <span className="text-xs font-semibold text-violet-700">{reply.displayName || 'TA'}</span>
                                  ) : (
                                    <span className="text-xs font-medium text-muted-foreground">Anonymous</span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">{getRelativeTime(reply.createdAt)}</span>
                                </div>
                                <p className="text-sm text-foreground/90 leading-relaxed mt-0.5 whitespace-pre-line">{reply.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply input */}
                      {replyingToId === post.id && (
                        <div className="border-t px-4 py-3 flex gap-2">
                          <Input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder={isTA ? "Reply as TA (your name will be shown)..." : "Add a reply anonymously..."}
                            className="flex-1 h-9 rounded-lg text-sm"
                            maxLength={500}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(post.id); } }}
                          />
                          <Button size="sm" className="h-9 rounded-lg px-3" onClick={() => handleReply(post.id)} disabled={isReplying || !replyText.trim()}>
                            {isReplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentForum, 'student');
