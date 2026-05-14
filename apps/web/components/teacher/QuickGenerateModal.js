import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Zap, ChevronDown, ChevronUp } from 'lucide-react';

const STEPS = [
  'Parsing your prompt…',
  'Generating questions…',
  'Building rubric…',
  'Ready to review',
];

const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'];
const QUESTION_TYPES = ['mcq', 'short', 'long'];

export default function QuickGenerateModal({ open, onClose, classId, onGenerated, prefill = '' }) {
  const [prompt, setPrompt] = useState(prefill);
  const [advanced, setAdvanced] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState('mixed');
  const [questionTypes, setQuestionTypes] = useState(['mcq']);
  const [useKB, setUseKB] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');

  const toggleType = (t) =>
    setQuestionTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError('Please describe the quiz or test you want.'); return; }
    setError('');
    setIsLoading(true);
    setStepIdx(0);

    const stepTimer = setInterval(() => {
      setStepIdx(prev => (prev < STEPS.length - 2 ? prev + 1 : prev));
    }, 1800);

    try {
      const fn = httpsCallable(functions, 'generate_quick_content');
      const { data } = await fn({
        classId,
        prompt: prompt.trim(),
        useKnowledgeBase: useKB,
        questionCount,
        difficulty,
        questionTypes: questionTypes.length ? questionTypes : ['mcq'],
      });
      clearInterval(stepTimer);
      setStepIdx(STEPS.length - 1);
      await new Promise(r => setTimeout(r, 600));
      onGenerated(data);
      onClose();
    } catch (e) {
      clearInterval(stepTimer);
      setError(e.message || 'Generation failed. Please try again.');
    } finally {
      setIsLoading(false);
      setStepIdx(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isLoading) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Generate with AI
          </DialogTitle>
          <DialogDescription>
            Describe what you want in plain English. The AI will build the questions for you to review before publishing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="qg-prompt">What do you want to generate?</Label>
            <Input
              id="qg-prompt"
              placeholder="e.g. 10-question Civil War quiz, 8th grade, mixed difficulty"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={isLoading}
              className="mt-1"
              onKeyDown={e => e.key === 'Enter' && !isLoading && handleGenerate()}
            />
          </div>

          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced(v => !v)}
          >
            {advanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Advanced options
          </button>

          {advanced && (
            <div className="space-y-4 rounded-md border p-4">
              <div>
                <Label className="mb-2 block">Question types</Label>
                <div className="flex gap-2 flex-wrap">
                  {QUESTION_TYPES.map(t => (
                    <Badge
                      key={t}
                      variant={questionTypes.includes(t) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => toggleType(t)}
                    >
                      {t === 'mcq' ? 'Multiple Choice' : t === 'short' ? 'Short Answer' : 'Long Answer'}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="qg-count">Number of questions: {questionCount}</Label>
                <input
                  id="qg-count"
                  type="range"
                  min={1}
                  max={30}
                  value={questionCount}
                  onChange={e => setQuestionCount(Number(e.target.value))}
                  className="w-full mt-1"
                />
              </div>

              <div>
                <Label className="mb-2 block">Difficulty</Label>
                <div className="flex gap-2 flex-wrap">
                  {DIFFICULTIES.map(d => (
                    <Badge
                      key={d}
                      variant={difficulty === d ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => setDifficulty(d)}
                    >
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label>Tie to knowledge base</Label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useKB}
                  onClick={() => setUseKB(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${useKB ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${useKB ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="space-y-2">
              <Progress value={(stepIdx / (STEPS.length - 1)) * 100} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">{STEPS[stepIdx]}</p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={isLoading || !prompt.trim()}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
