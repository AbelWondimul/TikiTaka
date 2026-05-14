import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Trash2, Copy, GripVertical, Image as ImageIcon, FileText, Minus, AlignLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const RichMathEditor = dynamic(() => import('@/components/editor/RichMathEditor'), { ssr: false });

const BLOCK_ICONS = {
  question: FileText,
  image: ImageIcon,
  pdf_page: FileText,
  divider: Minus,
  spacer: AlignLeft,
};

export default function BlockRenderer({ block, onUpdate, onDelete, onDuplicate, dragHandleProps, isDragging }) {
  const Icon = BLOCK_ICONS[block.type] || FileText;

  return (
    <div className={cn(
      'group relative rounded-lg border bg-card transition-shadow',
      isDragging ? 'shadow-2xl ring-2 ring-primary' : 'hover:shadow-md'
    )}>
      {/* Block header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        {/* Drag handle — keyboard accessible */}
        <button
          {...dragHandleProps}
          aria-label="Drag to reorder block"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground capitalize">
          {block.type === 'pdf_page' ? 'PDF Page' : block.type}
        </span>
        {block.type === 'question' && (
          <Input
            type="number"
            min={0}
            max={100}
            value={block.points ?? 1}
            onChange={e => onUpdate({ ...block, points: Number(e.target.value) })}
            className="ml-auto w-20 h-6 text-xs"
            placeholder="pts"
            aria-label="Points for this question"
          />
        )}
        <div className={cn('ml-auto flex gap-1', block.type === 'question' && 'ml-1')}>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => onDuplicate(block)}
            aria-label="Duplicate block"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={() => onDelete(block.id)}
            aria-label="Delete block"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Block body */}
      <div className="p-3">
        {block.type === 'question' && (
          <RichMathEditor
            initialContent={block.content || ''}
            onUpdate={html => onUpdate({ ...block, content: html })}
            placeholder="Enter question text here…"
          />
        )}

        {block.type === 'image' && (
          <ImageBlock block={block} onUpdate={onUpdate} />
        )}

        {block.type === 'pdf_page' && (
          <div className="text-center">
            {block.pageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.pageUrl} alt={`PDF page ${block.order}`} className="max-h-64 mx-auto rounded border" />
            ) : (
              <span className="text-sm text-muted-foreground">PDF page loading…</span>
            )}
          </div>
        )}

        {block.type === 'divider' && (
          <Input
            value={block.content || ''}
            onChange={e => onUpdate({ ...block, content: e.target.value })}
            placeholder="Section label, e.g. Part A — Short Answer"
            className="font-semibold"
          />
        )}

        {block.type === 'spacer' && (
          <div className="h-8 flex items-center justify-center border border-dashed rounded text-xs text-muted-foreground">
            Page Break / Spacer
          </div>
        )}
      </div>
    </div>
  );
}

function ImageBlock({ block, onUpdate }) {
  const [draggingOver, setDraggingOver] = useState(false);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => onUpdate({ ...block, imageDataUrl: e.target.result });
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDraggingOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handlePaste = (e) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  };

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
        draggingOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
      )}
      onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onClick={() => document.getElementById(`img-input-${block.id}`)?.click()}
      tabIndex={0}
      aria-label="Image upload area — click, drag, or paste an image"
    >
      {block.imageDataUrl || block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageDataUrl || block.imageUrl}
          alt="Uploaded"
          className="max-h-48 mx-auto rounded"
        />
      ) : (
        <div className="space-y-1">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drag, paste, or click to upload image</p>
        </div>
      )}
      <input
        id={`img-input-${block.id}`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
    </div>
  );
}
