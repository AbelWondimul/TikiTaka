import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import katex from 'katex';

const SYMBOL_CATEGORIES = [
  {
    label: 'Common',
    symbols: [
      { label: 'Fraction', latex: '\\frac{a}{b}', display: '\\frac{a}{b}' },
      { label: 'Power', latex: 'x^{n}', display: 'x^n' },
      { label: 'Subscript', latex: 'x_{i}', display: 'x_i' },
      { label: 'Square Root', latex: '\\sqrt{x}', display: '\\sqrt{x}' },
      { label: 'Nth Root', latex: '\\sqrt[n]{x}', display: '\\sqrt[n]{x}' },
      { label: 'Plus/Minus', latex: '\\pm', display: '\\pm' },
      { label: 'Infinity', latex: '\\infty', display: '\\infty' },
      { label: 'Not Equal', latex: '\\neq', display: '\\neq' },
      { label: 'Approx', latex: '\\approx', display: '\\approx' },
      { label: 'Leq', latex: '\\leq', display: '\\leq' },
      { label: 'Geq', latex: '\\geq', display: '\\geq' },
    ]
  },
  {
    label: 'Calculus',
    symbols: [
      { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx', display: '\\int_a^b' },
      { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i', display: '\\sum_{i=1}^n' },
      { label: 'Product', latex: '\\prod_{i=1}^{n} x_i', display: '\\prod_{i=1}^n' },
      { label: 'Limit', latex: '\\lim_{x \\to \\infty}', display: '\\lim_{x\\to\\infty}' },
      { label: 'Derivative', latex: '\\frac{dy}{dx}', display: '\\frac{dy}{dx}' },
      { label: 'Partial', latex: '\\frac{\\partial f}{\\partial x}', display: '\\frac{\\partial}{\\partial x}' },
      { label: 'Nabla', latex: '\\nabla', display: '\\nabla' },
    ]
  },
  {
    label: 'Greek',
    symbols: [
      { label: 'alpha', latex: '\\alpha', display: '\\alpha' },
      { label: 'beta', latex: '\\beta', display: '\\beta' },
      { label: 'gamma', latex: '\\gamma', display: '\\gamma' },
      { label: 'delta', latex: '\\delta', display: '\\delta' },
      { label: 'epsilon', latex: '\\epsilon', display: '\\epsilon' },
      { label: 'theta', latex: '\\theta', display: '\\theta' },
      { label: 'lambda', latex: '\\lambda', display: '\\lambda' },
      { label: 'mu', latex: '\\mu', display: '\\mu' },
      { label: 'pi', latex: '\\pi', display: '\\pi' },
      { label: 'sigma', latex: '\\sigma', display: '\\sigma' },
      { label: 'phi', latex: '\\phi', display: '\\phi' },
      { label: 'omega', latex: '\\omega', display: '\\omega' },
      { label: 'Sigma', latex: '\\Sigma', display: '\\Sigma' },
      { label: 'Delta', latex: '\\Delta', display: '\\Delta' },
      { label: 'Omega', latex: '\\Omega', display: '\\Omega' },
    ]
  },
  {
    label: 'Matrices',
    symbols: [
      { label: '2x2 Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', display: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}' },
      { label: '3x3 Matrix', latex: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}', display: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}' },
      { label: 'Determinant', latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', display: '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}' },
      { label: 'Brackets', latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', display: '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}' },
    ]
  },
  {
    label: 'Logic & Sets',
    symbols: [
      { label: 'For All', latex: '\\forall', display: '\\forall' },
      { label: 'Exists', latex: '\\exists', display: '\\exists' },
      { label: 'In', latex: '\\in', display: '\\in' },
      { label: 'Not In', latex: '\\notin', display: '\\notin' },
      { label: 'Subset', latex: '\\subset', display: '\\subset' },
      { label: 'Union', latex: '\\cup', display: '\\cup' },
      { label: 'Intersect', latex: '\\cap', display: '\\cap' },
      { label: 'Implies', latex: '\\Rightarrow', display: '\\Rightarrow' },
      { label: 'Iff', latex: '\\Leftrightarrow', display: '\\Leftrightarrow' },
    ]
  },
  {
    label: 'Trig',
    symbols: [
      { label: 'sin', latex: '\\sin(x)', display: '\\sin' },
      { label: 'cos', latex: '\\cos(x)', display: '\\cos' },
      { label: 'tan', latex: '\\tan(x)', display: '\\tan' },
      { label: 'log', latex: '\\log(x)', display: '\\log' },
      { label: 'ln', latex: '\\ln(x)', display: '\\ln' },
    ]
  },
];

function SymbolButton({ symbol, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      try {
        katex.render(symbol.display, ref.current, { throwOnError: false });
      } catch {
        ref.current.textContent = symbol.label;
      }
    }
  }, [symbol]);

  return (
    <button
      type="button"
      onClick={() => onClick(symbol.latex)}
      className="h-9 min-w-[40px] px-2 rounded-lg border border-border/50 bg-background hover:bg-accent hover:border-primary/30 transition-colors flex items-center justify-center"
      title={symbol.label}
    >
      <span ref={ref} className="text-sm" />
    </button>
  );
}

export default function EquationModal({ open, onOpenChange, onInsert, initialLatex = '', displayMode = false }) {
  const [latex, setLatex] = useState(initialLatex);
  const [isDisplay, setIsDisplay] = useState(displayMode);
  const [activeCategory, setActiveCategory] = useState('Common');
  const previewRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) {
      setLatex(initialLatex);
      setIsDisplay(displayMode);
    }
  }, [open, initialLatex, displayMode]);

  useEffect(() => {
    if (previewRef.current && latex.trim()) {
      try {
        katex.render(latex, previewRef.current, {
          throwOnError: false,
          displayMode: isDisplay,
        });
      } catch {
        previewRef.current.textContent = 'Invalid LaTeX';
      }
    } else if (previewRef.current) {
      previewRef.current.textContent = 'Type LaTeX to see preview...';
    }
  }, [latex, isDisplay]);

  const insertSymbol = (symbolLatex) => {
    if (!textareaRef.current) {
      setLatex(prev => prev + symbolLatex);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = latex.substring(0, start) + symbolLatex + latex.substring(end);
    setLatex(newValue);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + symbolLatex.length;
    }, 0);
  };

  const handleInsert = () => {
    if (latex.trim()) {
      onInsert(latex.trim(), isDisplay);
      onOpenChange(false);
      setLatex('');
    }
  };

  const activeSymbols = SYMBOL_CATEGORIES.find(c => c.label === activeCategory)?.symbols || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Insert Equation</span>
            <Badge variant="secondary" className="text-[10px] font-mono">LaTeX</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Symbol categories */}
          <div className="space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {SYMBOL_CATEGORIES.map(cat => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setActiveCategory(cat.label)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                    activeCategory === cat.label
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap p-2 border rounded-xl bg-muted/20 min-h-[44px]">
              {activeSymbols.map((sym, i) => (
                <SymbolButton key={i} symbol={sym} onClick={insertSymbol} />
              ))}
            </div>
          </div>

          {/* LaTeX input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">LaTeX Code</label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDisplay}
                  onChange={(e) => setIsDisplay(e.target.checked)}
                  className="rounded"
                />
                Display mode (centered, large)
              </label>
            </div>
            <Textarea
              ref={textareaRef}
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              placeholder="e.g., \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
              className="font-mono text-sm min-h-[80px] rounded-xl"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleInsert();
                }
              }}
            />
          </div>

          {/* Live preview */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Preview</label>
            <div className="border rounded-xl p-4 bg-white dark:bg-background min-h-[60px] flex items-center justify-center overflow-x-auto">
              <span ref={previewRef} className="text-muted-foreground text-sm" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={!latex.trim()} className="rounded-xl">
            Insert Equation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
