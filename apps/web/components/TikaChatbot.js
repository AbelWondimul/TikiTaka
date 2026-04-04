import { useState, useRef, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MessageCircle, X, Send, Loader2, Bot, User, Sparkles } from 'lucide-react';

export default function TikaChatbot({ enrolledClasses = [], assignments = [], submissions = [] }) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: "Hi! I'm Tika, your learning assistant. Ask me about your assignments, due dates, grades, or class materials!",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build context string from student data
  const buildContext = () => {
    const now = new Date();
    const lines = [];

    lines.push(`Student: ${user?.displayName || user?.email || 'Student'}`);
    lines.push(`Current date: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
    lines.push('');

    // Classes
    lines.push('ENROLLED CLASSES:');
    enrolledClasses.forEach(c => {
      lines.push(`- ${c.name} (Code: ${c.classCode || c.id.slice(0, 6)}, Instructor: ${c.teacherName || 'Unknown'})`);
    });
    lines.push('');

    // Assignments with due dates and status
    lines.push('ASSIGNMENTS:');
    if (assignments.length === 0) {
      lines.push('- No assignments assigned yet.');
    } else {
      assignments.forEach(a => {
        const classObj = enrolledClasses.find(c => c.id === a.classId);
        const className = classObj?.name || 'Unknown Class';
        const dueDate = a.dueDate?.toDate ? a.dueDate.toDate() : (a.dueDate ? new Date(a.dueDate) : null);
        const dueDateStr = dueDate ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date';
        const isOverdue = dueDate && dueDate < now;

        // Check submission status
        const sub = submissions.find(s => s.assignmentId === a.id);
        let status = 'Not submitted';
        let score = '';
        if (sub) {
          if (sub.status === 'complete' && sub.score != null) {
            status = 'Graded';
            score = ` Score: ${sub.score}/${a.totalPoints || 100}`;
          } else if (sub.status === 'processing' || sub.status === 'queued') {
            status = 'Being graded';
          } else {
            status = 'Submitted';
          }
        } else if (isOverdue) {
          status = 'MISSING (overdue)';
        }

        lines.push(`- "${a.title}" | Class: ${className} | Due: ${dueDateStr} | Status: ${status}${score} | Points: ${a.totalPoints || 100}`);
      });
    }
    lines.push('');

    // Recent submissions with grades
    lines.push('RECENT GRADES:');
    const graded = submissions.filter(s => s.status === 'complete' && s.score != null).slice(0, 10);
    if (graded.length === 0) {
      lines.push('- No graded submissions yet.');
    } else {
      graded.forEach(s => {
        lines.push(`- "${s.assignmentTitle || 'Assignment'}" — Score: ${s.score}/${s.totalPoints || 100}`);
      });
    }
    lines.push('');

    // What-If grade calculation data
    lines.push('GRADE CALCULATION DATA (for What-If questions):');
    const gradedSubs = submissions.filter(s => s.status === 'complete' && s.score != null);
    const totalEarned = gradedSubs.reduce((sum, s) => sum + (s.score || 0), 0);
    const totalPossible = gradedSubs.reduce((sum, s) => sum + (s.totalPoints || 100), 0);
    const currentPct = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : null;
    lines.push(`- Current total earned: ${totalEarned} points`);
    lines.push(`- Current total possible: ${totalPossible} points`);
    lines.push(`- Current overall percentage: ${currentPct != null ? currentPct + '%' : 'N/A'}`);
    lines.push(`- Graded assignments: ${gradedSubs.length}`);

    const ungradedAssignments = assignments.filter(a => !gradedSubs.some(s => s.assignmentId === a.id));
    lines.push(`- Ungraded assignments: ${ungradedAssignments.length}`);
    if (ungradedAssignments.length > 0) {
      ungradedAssignments.forEach(a => {
        const classObj = enrolledClasses.find(c => c.id === a.classId);
        lines.push(`  - "${a.title}" (${classObj?.name || 'Class'}) — worth ${a.totalPoints || 100} points — NOT YET GRADED`);
      });
    }
    lines.push('');
    lines.push('WHAT-IF FORMULA: To calculate projected grade when student asks "what if I get X on [assignment]":');
    lines.push('  New % = (current earned + hypothetical score) / (current possible + assignment total points) * 100');
    lines.push('  Show both the current % and the projected % so the student can see the impact.');

    return lines.join('\n');
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setIsLoading(true);

    try {
      const tikaChatFn = httpsCallable(functions, 'tika_chat');
      const result = await tikaChatFn({
        question,
        context: buildContext(),
      });
      setMessages(prev => [...prev, { role: 'bot', text: result.data.answer }]);
    } catch (err) {
      console.error('Tika chat error:', err);
      setMessages(prev => [
        ...prev,
        { role: 'bot', text: "Sorry, I couldn't process that right now. Please try again!" },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-gradient-to-br from-[#005c55] to-[#0f766e] text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center group"
        >
          <Sparkles className="h-6 w-6 group-hover:hidden" />
          <MessageCircle className="h-6 w-6 hidden group-hover:block" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[380px] sm:max-w-[calc(100vw-2rem)] h-[100vh] sm:h-[520px] sm:max-h-[calc(100vh-3rem)] bg-background border border-border/60 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#005c55] to-[#0f766e] text-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none">Tika</p>
                <p className="text-[10px] text-white/70 mt-0.5">Your learning assistant</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'bot' && (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted/60 text-foreground rounded-bl-md'
                  )}
                >
                  {msg.text.split('\n').map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < msg.text.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </div>
                {msg.role === 'user' && (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-2.5">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-muted/60 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t bg-background shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Tika a question..."
                disabled={isLoading}
                className="flex-1 rounded-xl h-10 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="h-10 w-10 rounded-xl shrink-0"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <p className="text-[9px] text-muted-foreground/60 text-center mt-2">
              Tika only answers from your class materials. For anything else, ask your teacher.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
