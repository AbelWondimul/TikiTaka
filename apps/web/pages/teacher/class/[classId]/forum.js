import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  arrayUnion,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  ArrowLeft,
  MessageCircleQuestion,
  ThumbsUp,
  Trash2,
  ShieldBan,
  Eye,
  EyeOff,
  Reply,
  Send,
  GraduationCap,
} from 'lucide-react';
import { getRelativeTime } from '@/lib/dateUtils';

function TeacherForum() {
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
  const [forumEnabled, setForumEnabled] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [blockConfirmId, setBlockConfirmId] = useState(null);
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
        setForumEnabled(cls.forumEnabled !== false);
      }

      const postsQ = query(collection(db, 'forumPosts'), where('classId', '==', classId));
      const postsSnap = await getDocs(postsQ);
      const postList = [];
      postsSnap.forEach(d => postList.push({ id: d.id, ...d.data() }));
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

  const handleToggleForum = async (enabled) => {
    setForumEnabled(enabled);
    try {
      await updateDoc(doc(db, 'classes', classId), { forumEnabled: enabled });
    } catch (err) {
      console.error('Error toggling forum:', err);
      setForumEnabled(!enabled);
    }
  };

  const handleDeletePost = async (postId) => {
    try {
      await deleteDoc(doc(db, 'forumPosts', postId));
      setPosts(prev => prev.filter(p => p.id !== postId));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Error deleting post:', err);
    }
  };

  const handleBlockAuthor = async (post) => {
    try {
      const blockedUsers = classData?.blockedForumUsers || [];
      await updateDoc(doc(db, 'classes', classId), {
        blockedForumUsers: [...blockedUsers, post.authorId],
      });
      setClassData(prev => ({
        ...prev,
        blockedForumUsers: [...(prev?.blockedForumUsers || []), post.authorId],
      }));
      setPosts(prev => prev.map(p =>
        p.authorId === post.authorId ? { ...p, authorBlocked: true } : p
      ));
      setBlockConfirmId(null);
    } catch (err) {
      console.error('Error blocking author:', err);
    }
  };

  const handleUnblockAll = async () => {
    try {
      await updateDoc(doc(db, 'classes', classId), { blockedForumUsers: [] });
      setClassData(prev => ({ ...prev, blockedForumUsers: [] }));
      setPosts(prev => prev.map(p => ({ ...p, authorBlocked: false })));
    } catch (err) {
      console.error('Error unblocking:', err);
    }
  };

  const handleReply = async (postId) => {
    if (!replyText.trim() || isReplying) return;
    setIsReplying(true);
    try {
      const reply = {
        content: replyText.trim(),
        role: 'teacher',
        authorId: user.uid,
        displayName: user.displayName || user.email || 'Teacher',
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

  const blockedCount = (classData?.blockedForumUsers || []).length;
  const isAuthorBlocked = (post) => (classData?.blockedForumUsers || []).includes(post.authorId);

  return (
    <>
      <Head>
        <title>Forum - {classData?.name || 'Class'} - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          <div className="flex items-center gap-3">
            <MessageCircleQuestion className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{classData?.name || 'Class'} — Anonymous Forum</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Students post anonymously. You cannot see who posted — only moderate content. Your replies show your name.
          </p>
        </div>

        {/* Controls */}
        <Card className="p-4 rounded-2xl border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Switch checked={forumEnabled} onCheckedChange={handleToggleForum} id="forum-toggle" />
                <Label htmlFor="forum-toggle" className="text-sm font-medium cursor-pointer">
                  {forumEnabled ? (
                    <span className="flex items-center gap-1.5 text-green-700"><Eye className="h-4 w-4" /> Forum Active</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground"><EyeOff className="h-4 w-4" /> Forum Disabled</span>
                  )}
                </Label>
              </div>
              {blockedCount > 0 && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{blockedCount} blocked</Badge>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={handleUnblockAll}>Unblock all</Button>
                </div>
              )}
            </div>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {posts.length} post{posts.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
            <MessageCircleQuestion className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No posts yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map(post => {
              const upvotes = (post.upvotedBy || []).length;
              const blocked = isAuthorBlocked(post) || post.authorBlocked;
              const replies = post.replies || [];

              return (
                <Card
                  key={post.id}
                  className={cn(
                    'rounded-2xl border-border/50 overflow-hidden',
                    blocked && 'border-red-200/60 bg-red-50/20 dark:border-red-800/30 dark:bg-red-950/10'
                  )}
                >
                  <div className="p-4 flex gap-3">
                    <div className="flex flex-col items-center gap-0.5 pt-1 shrink-0 text-muted-foreground">
                      <ThumbsUp className="h-5 w-5" />
                      <span className="text-xs font-bold tabular-nums">{upvotes}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{post.content}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-muted-foreground">{getRelativeTime(post.createdAt)}</span>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">Anonymous</Badge>
                        {blocked && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Author blocked</Badge>}
                        <button
                          className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                          onClick={() => { setReplyingToId(replyingToId === post.id ? null : post.id); setReplyText(''); }}
                        >
                          <Reply className="h-3 w-3" /> Reply
                        </button>
                      </div>
                    </div>

                    {/* Moderation actions */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {deleteConfirmId === post.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" className="h-7 text-[10px] rounded-lg px-2" onClick={() => handleDeletePost(post.id)}>Delete</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] rounded-lg px-2" onClick={() => setDeleteConfirmId(null)}>No</Button>
                        </div>
                      ) : blockConfirmId === post.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" className="h-7 text-[10px] rounded-lg px-2" onClick={() => handleBlockAuthor(post)}>Block</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] rounded-lg px-2" onClick={() => setBlockConfirmId(null)}>No</Button>
                        </div>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg" title="Remove post" onClick={() => setDeleteConfirmId(post.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          {!blocked && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg" title="Block author" onClick={() => setBlockConfirmId(post.id)}>
                              <ShieldBan className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
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
                        placeholder="Reply as teacher (your name will be shown)..."
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
      </div>
    </>
  );
}

export default withAuth(TeacherForum, 'teacher');
