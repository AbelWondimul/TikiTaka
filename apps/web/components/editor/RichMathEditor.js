import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Bold, Italic, List, ListOrdered, Sigma, Undo, Redo, Minus } from 'lucide-react';
import { MathNode, MathBlock } from './MathExtension';
import EquationModal from './EquationModal';

// Paste handler: detects LaTeX delimiters in pasted text and converts to math nodes
function createPastePlugin(editor) {
  return {
    key: 'mathPaste',
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        // Check if pasted text contains LaTeX delimiters
        const hasLatex = /\$\$.+?\$\$|\$[^$]+?\$|\\\(.+?\\\)|\\\[.+?\\\]/s.test(text);
        if (!hasLatex) return false;

        event.preventDefault();

        // Parse and insert content with math nodes
        let remaining = text;
        const fragments = [];

        // Process display math first ($$...$$), then inline ($...$)
        const patterns = [
          { regex: /\$\$(.+?)\$\$/gs, display: true },
          { regex: /\\\[(.+?)\\\]/gs, display: true },
          { regex: /\$([^$]+?)\$/g, display: false },
          { regex: /\\\((.+?)\\\)/g, display: false },
        ];

        // Simple approach: split on all math delimiters
        const parts = [];
        let lastIndex = 0;
        const allMatches = [];

        for (const { regex, display } of patterns) {
          let match;
          const r = new RegExp(regex.source, regex.flags);
          while ((match = r.exec(text)) !== null) {
            allMatches.push({ index: match.index, end: match.index + match[0].length, latex: match[1], display });
          }
        }

        // Sort by position, filter overlapping
        allMatches.sort((a, b) => a.index - b.index);
        const filtered = [];
        let lastEnd = 0;
        for (const m of allMatches) {
          if (m.index >= lastEnd) {
            filtered.push(m);
            lastEnd = m.end;
          }
        }

        // Build content array
        const content = [];
        let cursor = 0;
        for (const m of filtered) {
          if (m.index > cursor) {
            content.push({ type: 'text', text: text.substring(cursor, m.index) });
          }
          if (m.display) {
            content.push({ type: 'mathBlock', attrs: { latex: m.latex.trim() } });
          } else {
            content.push({ type: 'mathNode', attrs: { latex: m.latex.trim(), display: 'false' } });
          }
          cursor = m.end;
        }
        if (cursor < text.length) {
          content.push({ type: 'text', text: text.substring(cursor) });
        }

        editor.chain().focus().insertContent(content).run();
        return true;
      },
    },
  };
}

function ToolbarButton({ onClick, active, disabled, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      {children}
    </button>
  );
}

export default function RichMathEditor({
  initialContent = '',
  onUpdate,
  placeholder = 'Start typing...',
  maxLength,
  compact = false,
  className,
}) {
  const [equationOpen, setEquationOpen] = useState(false);
  const [charCount, setCharCount] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
      }),
      Placeholder.configure({ placeholder }),
      ...(maxLength ? [CharacterCount.configure({ limit: maxLength })] : [CharacterCount]),
      MathNode,
      MathBlock,
    ],
    content: initialContent || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const textLen = editor.storage.characterCount?.characters() || 0;
      setCharCount(textLen);
      onUpdate?.(html);
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          compact ? 'min-h-[40px] max-h-[120px]' : 'min-h-[100px]',
          'px-3 py-2'
        ),
      },
    },
  });

  // Register paste plugin
  useEffect(() => {
    if (editor) {
      const plugin = createPastePlugin(editor);
      // TipTap doesn't have a direct addPlugin API, so we register via prosemirror
      // The paste handling is done via editorProps instead
    }
  }, [editor]);

  // Override paste handler on editor
  useEffect(() => {
    if (!editor) return;
    const view = editor.view;
    const originalHandlePaste = view.props.handlePaste;

    // We set this via editor options instead
  }, [editor]);

  // Update editor props with paste handler
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;

          const hasLatex = /\$\$.+?\$\$|\$[^$]+?\$|\\\(.+?\\\)|\\\[.+?\\\]/s.test(text);
          if (!hasLatex) return false;

          event.preventDefault();

          const allMatches = [];
          const patterns = [
            { regex: /\$\$(.+?)\$\$/gs, display: true },
            { regex: /\\\[(.+?)\\\]/gs, display: true },
            { regex: /\$([^$]+?)\$/g, display: false },
            { regex: /\\\((.+?)\\\)/g, display: false },
          ];

          for (const { regex, display } of patterns) {
            let match;
            const r = new RegExp(regex.source, regex.flags);
            while ((match = r.exec(text)) !== null) {
              allMatches.push({ index: match.index, end: match.index + match[0].length, latex: match[1], display });
            }
          }

          allMatches.sort((a, b) => a.index - b.index);
          const filtered = [];
          let lastEnd = 0;
          for (const m of allMatches) {
            if (m.index >= lastEnd) { filtered.push(m); lastEnd = m.end; }
          }

          const content = [];
          let cursor = 0;
          for (const m of filtered) {
            if (m.index > cursor) content.push({ type: 'text', text: text.substring(cursor, m.index) });
            if (m.display) {
              content.push({ type: 'mathBlock', attrs: { latex: m.latex.trim() } });
            } else {
              content.push({ type: 'mathNode', attrs: { latex: m.latex.trim(), display: 'false' } });
            }
            cursor = m.end;
          }
          if (cursor < text.length) content.push({ type: 'text', text: text.substring(cursor) });

          editor.chain().focus().insertContent(content).run();
          return true;
        },
      },
    });
  }, [editor]);

  const handleInsertEquation = useCallback((latex, isDisplay) => {
    if (!editor) return;
    if (isDisplay) {
      editor.chain().focus().insertMathBlock(latex).run();
    } else {
      editor.chain().focus().insertMath(latex).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={cn('border rounded-xl overflow-hidden bg-background', className)}>
      {/* Toolbar */}
      <div className={cn(
        'flex items-center gap-0.5 px-2 py-1 border-b bg-muted/30',
        compact && 'py-0.5'
      )}>
        {!compact && (
          <>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive('bold')}
              title="Bold (Ctrl+B)"
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive('italic')}
              title="Italic (Ctrl+I)"
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <div className="w-px h-5 bg-border mx-1" />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive('bulletList')}
              title="Bullet List"
            >
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive('orderedList')}
              title="Numbered List"
            >
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              title="Horizontal Rule"
            >
              <Minus className="h-4 w-4" />
            </ToolbarButton>
            <div className="w-px h-5 bg-border mx-1" />
          </>
        )}
        <ToolbarButton
          onClick={() => setEquationOpen(true)}
          title="Insert Equation"
        >
          <Sigma className="h-4 w-4" />
        </ToolbarButton>
        {!compact && (
          <>
            <div className="flex-1" />
            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
              <Undo className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
              <Redo className="h-4 w-4" />
            </ToolbarButton>
          </>
        )}
        {maxLength && (
          <span className={cn('text-[10px] ml-auto tabular-nums', charCount > maxLength * 0.9 ? 'text-destructive font-bold' : 'text-muted-foreground')}>
            {charCount}/{maxLength}
          </span>
        )}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Equation Modal */}
      <EquationModal
        open={equationOpen}
        onOpenChange={setEquationOpen}
        onInsert={handleInsertEquation}
      />
    </div>
  );
}
