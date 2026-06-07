import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Loader2, MessageCircle, Pin, CheckCircle, Trash2, ThumbsUp, Send, ChevronDown
} from 'lucide-react';

export default function QAThread({ assignmentId, isTeacher = false, enabled = true }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [isReplySubmitting, setIsReplySubmitting] = useState(false);

  useEffect(() => {
    if (assignmentId && enabled) fetchComments();
  }, [assignmentId, enabled]);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const q = query(
        collection(db, 'assignments', assignmentId, 'comments'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort: pinned first, then by upvotes, then recency
      items.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        const aVotes = (a.upvotes || []).length;
        const bVotes = (b.upvotes || []).length;
        if (aVotes !== bVotes) return bVotes - aVotes;
        return 0;
      });
      setComments(items);
    } catch (err) {
      console.error('Error fetching Q&A:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitQuestion = async () => {
    if (!newQuestion.trim() || !user) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'assignments', assignmentId, 'comments'), {
        authorId: user.uid,
        authorRole: isTeacher ? 'teacher' : 'student',
        content: newQuestion.trim().slice(0, 1000),
        isAnonymous: isTeacher ? false : isAnonymous,
        isPinned: false,
        isResolved: false,
        upvotes: [],
        replies: [],
        createdAt: serverTimestamp(),
      });
      setNewQuestion('');
      fetchComments();
    } catch (err) {
      console.error('Error posting question:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim() || !user) return;
    setIsReplySubmitting(true);
    try {
      const commentRef = doc(db, 'assignments', assignmentId, 'comments', commentId);
      const comment = comments.find(c => c.id === commentId);
      const newReply = {
        authorId: user.uid,
        authorRole: isTeacher ? 'teacher' : 'student',
        content: replyText.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
      };
      await updateDoc(commentRef, {
        replies: [...(comment.replies || []), newReply],
      });
      setReplyText('');
      setReplyingTo(null);
      fetchComments();
    } catch (err) {
      console.error('Error replying:', err);
    } finally {
      setIsReplySubmitting(false);
    }
  };

  const handleUpvote = async (commentId) => {
    if (!user) return;
    const commentRef = doc(db, 'assignments', assignmentId, 'comments', commentId);
    const comment = comments.find(c => c.id === commentId);
    const hasUpvoted = (comment.upvotes || []).includes(user.uid);
    await updateDoc(commentRef, {
      upvotes: hasUpvoted ? arrayRemove(user.uid) : arrayUnion(user.uid),
    });
    fetchComments();
  };

  const handlePin = async (commentId) => {
    const comment = comments.find(c => c.id === commentId);
    await updateDoc(doc(db, 'assignments', assignmentId, 'comments', commentId), {
      isPinned: !comment.isPinned,
    });
    fetchComments();
  };

  const handleResolve = async (commentId) => {
    const comment = comments.find(c => c.id === commentId);
    await updateDoc(doc(db, 'assignments', assignmentId, 'comments', commentId), {
      isResolved: !comment.isResolved,
    });
    fetchComments();
  };

  const handleDelete = async (commentId) => {
    await deleteDoc(doc(db, 'assignments', assignmentId, 'comments', commentId));
    fetchComments();
  };

  if (!enabled) return null;

  const unresolvedCount = comments.filter(c => !c.isResolved).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          Q&A
          {unresolvedCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{unresolvedCount}</Badge>
          )}
        </h3>
      </div>

      {/* New question input */}
      <div className="space-y-2 p-4 border rounded-xl bg-muted/20">
        <Textarea
          placeholder="Ask a question about this assignment..."
          value={newQuestion}
          onChange={e => setNewQuestion(e.target.value)}
          rows={2}
          maxLength={1000}
          className="text-sm resize-none"
        />
        <div className="flex items-center justify-between">
          {!isTeacher && (
            <div className="flex items-center gap-2">
              <Switch checked={isAnonymous} onCheckedChange={setIsAnonymous} id="anon-toggle" />
              <Label htmlFor="anon-toggle" className="text-xs text-muted-foreground">Post anonymously</Label>
            </div>
          )}
          <Button
            size="sm"
            onClick={handleSubmitQuestion}
            disabled={isSubmitting || !newQuestion.trim()}
            className="rounded-lg ml-auto"
          >
            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Post
          </Button>
        </div>
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No questions yet. Be the first to ask!
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map(comment => {
            const upvoteCount = (comment.upvotes || []).length;
            const hasUpvoted = (comment.upvotes || []).includes(user?.uid);
            const replyCount = (comment.replies || []).length;

            return (
              <div
                key={comment.id}
                className={cn(
                  "p-4 border rounded-xl space-y-3",
                  comment.isPinned && "border-primary/30 bg-primary/5",
                  comment.isResolved && "opacity-70"
                )}
              >
                {/* Question header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                      {comment.isAnonymous ? '?' : (comment.authorRole === 'teacher' ? 'P' : 'S')}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">
                          {comment.isAnonymous ? 'Anonymous Student' :
                            comment.authorRole === 'teacher' ? 'Professor' : 'Student'}
                        </span>
                        {comment.authorRole === 'teacher' && <Badge className="text-[9px] px-1 py-0 bg-primary/10 text-primary border-none">Instructor</Badge>}
                        {comment.isPinned && <Pin className="h-3 w-3 text-primary" />}
                        {comment.isResolved && <Badge className="text-[9px] px-1 py-0 bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-none">Resolved</Badge>}
                      </div>
                    </div>
                  </div>
                  {isTeacher && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handlePin(comment.id)} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="Pin">
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleResolve(comment.id)} className="p-1 text-muted-foreground hover:text-green-600 transition-colors" title="Mark resolved">
                        <CheckCircle className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(comment.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Question content */}
                <p className="text-sm text-foreground">{comment.content}</p>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleUpvote(comment.id)}
                    className={cn(
                      "flex items-center gap-1 text-xs transition-colors",
                      hasUpvoted ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ThumbsUp className="h-3 w-3" /> {upvoteCount > 0 ? upvoteCount : 'Upvote'}
                  </button>
                  <button
                    onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <MessageCircle className="h-3 w-3" /> {replyCount > 0 ? `${replyCount} replies` : 'Reply'}
                  </button>
                </div>

                {/* Replies */}
                {replyCount > 0 && (
                  <div className="ml-6 space-y-2 border-l-2 border-muted pl-3">
                    {comment.replies.map((reply, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium text-xs">
                          {reply.authorRole === 'teacher' ? 'Professor' : 'Student'}
                        </span>
                        {reply.authorRole === 'teacher' && (
                          <Badge className="text-[9px] px-1 py-0 ml-1 bg-primary/10 text-primary border-none">Instructor</Badge>
                        )}
                        <p className="text-muted-foreground mt-0.5">{reply.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input */}
                {replyingTo === comment.id && (
                  <div className="ml-6 flex gap-2">
                    <Textarea
                      placeholder="Write a reply..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      rows={1}
                      maxLength={1000}
                      className="text-sm resize-none flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleReply(comment.id)}
                      disabled={isReplySubmitting || !replyText.trim()}
                      className="shrink-0"
                    >
                      {isReplySubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
