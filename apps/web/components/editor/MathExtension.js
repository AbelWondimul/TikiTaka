import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import katex from 'katex';
import { useRef, useState, useEffect } from 'react';

// Inline math node view component
function MathNodeView({ node, updateAttributes, selected, editor }) {
  const [isEditing, setIsEditing] = useState(false);
  const [latex, setLatex] = useState(node.attrs.latex || '');
  const inputRef = useRef(null);
  const renderedRef = useRef(null);

  useEffect(() => {
    if (!isEditing && renderedRef.current) {
      try {
        katex.render(node.attrs.latex || '', renderedRef.current, {
          throwOnError: false,
          displayMode: node.attrs.display === 'true',
        });
      } catch {
        renderedRef.current.textContent = node.attrs.latex || '?';
      }
    }
  }, [node.attrs.latex, node.attrs.display, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleConfirm = () => {
    updateAttributes({ latex });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <NodeViewWrapper as="span" className="inline">
        <span className="inline-flex items-center gap-1 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-md px-1.5 py-0.5">
          <input
            ref={inputRef}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
              if (e.key === 'Escape') { setLatex(node.attrs.latex); setIsEditing(false); }
            }}
            onBlur={handleConfirm}
            className="bg-transparent border-none outline-none text-sm font-mono text-violet-800 dark:text-violet-200 w-auto min-w-[60px]"
            style={{ width: `${Math.max(60, latex.length * 8)}px` }}
            placeholder="LaTeX..."
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={node.attrs.display === 'true' ? 'div' : 'span'}
      className={`${node.attrs.display === 'true' ? 'block my-2 text-center' : 'inline'} ${selected ? 'ring-2 ring-violet-400 rounded' : ''}`}
    >
      <span
        ref={renderedRef}
        onDoubleClick={() => { if (editor.isEditable) { setLatex(node.attrs.latex); setIsEditing(true); } }}
        className="cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded px-0.5 transition-colors"
        title="Double-click to edit"
      />
    </NodeViewWrapper>
  );
}

// The TipTap math node extension
const MathNode = Node.create({
  name: 'mathNode',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: { default: '' },
      display: { default: 'false' },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-math]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-math': 'true' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addCommands() {
    return {
      insertMath: (latex, display = false) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { latex, display: display ? 'true' : 'false' },
        });
      },
    };
  },

  // Input rules: typing $...$ converts to inline math
  addInputRules() {
    return [
      {
        // Match $...$ (inline math) — requires non-empty content
        find: /\$([^$]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex, display: 'false' }));
        },
      },
    ];
  },
});

// Display math (block-level) node
const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: { default: '' },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-math-block]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-math-block': 'true' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node, updateAttributes, selected, editor }) => (
      <MathNodeView node={{ ...node, attrs: { ...node.attrs, display: 'true' } }} updateAttributes={updateAttributes} selected={selected} editor={editor} />
    ));
  },

  addCommands() {
    return {
      insertMathBlock: (latex) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { latex },
        });
      },
    };
  },

  // Input rule: typing $$...$$ converts to display math
  addInputRules() {
    return [
      {
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      },
    ];
  },
});

export { MathNode, MathBlock };
