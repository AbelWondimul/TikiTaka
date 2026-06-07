import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db, functions, storage } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import BlockRenderer from '@/components/teacher/builder/BlockRenderer';
import MathRenderer from '@/components/editor/MathRenderer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  FileText, Image as ImageIcon, FileIcon, Minus, AlignLeft,
  Monitor, Smartphone, Save, Send, ArrowLeft, Loader2, Plus
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// Toolbox block types
const BLOCK_TYPES = [
  { type: 'question',  label: 'Question',      icon: FileText },
  { type: 'image',     label: 'Image',          icon: ImageIcon },
  { type: 'pdf_page',  label: 'PDF Page',       icon: FileIcon },
  { type: 'divider',   label: 'Section Divider',icon: Minus },
  { type: 'spacer',    label: 'Page Break',     icon: AlignLeft },
];

function makeBlock(type, order) {
  return { id: `block_${uuidv4()}`, type, order, content: '', points: type === 'question' ? 1 : 0 };
}

// Sortable wrapper
function SortableBlock({ block, onUpdate, onDelete, onDuplicate }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BlockRenderer
        block={block}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

// Student preview panel
function PreviewPanel({ blocks, title, previewMode }) {
  return (
    <div className={cn(
      'mx-auto bg-white dark:bg-zinc-900 rounded-lg shadow-inner p-6 border overflow-y-auto',
      previewMode === 'mobile' ? 'max-w-sm' : 'max-w-2xl'
    )}>
      <h1 className="text-xl font-bold mb-4">{title || 'Untitled Assignment'}</h1>
      {blocks.map(b => (
        <div key={b.id} className="mb-4">
          {b.type === 'question' && (
            <div className="space-y-2">
              <MathRenderer content={b.content || '<em>Empty question</em>'} className="prose dark:prose-invert max-w-none text-sm" />
              <div className="text-xs text-muted-foreground">{b.points} pt{b.points !== 1 ? 's' : ''}</div>
              {b.questionType === 'mcq' && b.options?.length ? (
                <ul className="ml-4 space-y-1">
                  {b.options.map((o, i) => <li key={i} className="text-sm">{o}</li>)}
                </ul>
              ) : (
                <div className="h-16 border rounded bg-muted/30" />
              )}
            </div>
          )}
          {b.type === 'image' && (b.imageDataUrl || b.imageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.imageDataUrl || b.imageUrl} alt="" className="max-w-full rounded border" />
          )}
          {b.type === 'pdf_page' && b.pageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.pageUrl} alt="" className="max-w-full rounded border" />
          )}
          {b.type === 'divider' && (
            <div className="border-t-2 pt-2 font-semibold text-sm">{b.content || '────'}</div>
          )}
          {b.type === 'spacer' && <div className="h-8" />}
        </div>
      ))}
    </div>
  );
}

function AssignmentBuilderPage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPdfExtracting, setIsPdfExtracting] = useState(false);
  const assignmentIdRef = useRef(uuidv4());
  const autoSaveTimer = useRef(null);
  const saveRef = useRef(null);

  // Load pre-generated blocks from QuickGenerateModal (via URL param)
  useEffect(() => {
    if (!router.isReady) return;
    const generated = router.query.generated;
    if (generated) {
      try {
        const data = JSON.parse(decodeURIComponent(generated));
        setTitle(data.title || '');
        setBlocks((data.blocks || []).map((b, i) => ({ ...b, order: i + 1 })));
      } catch (_) {}
    }
  }, [router.isReady, router.query.generated]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setBlocks(prev => {
      const oldIdx = prev.findIndex(b => b.id === active.id);
      const newIdx = prev.findIndex(b => b.id === over.id);
      const reordered = arrayMove(prev, oldIdx, newIdx);
      return reordered.map((b, i) => ({ ...b, order: i + 1 }));
    });
    scheduleSave();
  };

  const addBlock = (type) => {
    const newBlock = makeBlock(type, blocks.length + 1);
    setBlocks(prev => [...prev, newBlock]);
    scheduleSave();
  };

  const updateBlock = (updated) => {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
    scheduleSave();
  };

  const deleteBlock = (id) => {
    setBlocks(prev => prev.filter(b => b.id !== id).map((b, i) => ({ ...b, order: i + 1 })));
    scheduleSave();
  };

  const duplicateBlock = (block) => {
    const copy = { ...block, id: `block_${uuidv4()}`, order: block.order + 0.5 };
    setBlocks(prev => {
      const next = [...prev, copy].sort((a, b) => a.order - b.order).map((b, i) => ({ ...b, order: i + 1 }));
      return next;
    });
    scheduleSave();
  };

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveRef.current('draft'), 2000);
  }, []);

  const saveToFirestore = async (status = 'draft') => {
    if (!classId || !user) return;
    setSaveStatus('saving');
    const totalPoints = blocks.filter(b => b.type === 'question').reduce((sum, b) => sum + (b.points || 0), 0);
    const assignmentDoc = {
      id: assignmentIdRef.current,
      classId,
      teacherId: user.uid,
      title: title || 'Untitled Assignment',
      blocks: blocks.map(b => {
        const { imageDataUrl, ...rest } = b;
        return rest; // don't store base64 data URLs in Firestore
      }),
      totalPoints,
      status,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(
      doc(db, 'assignments', assignmentIdRef.current),
      assignmentDoc,
      { merge: true }
    );
    setSaveStatus('saved');
  };
  saveRef.current = saveToFirestore;

  // Auto-save every 30 seconds — use saveRef to avoid stale closure
  useEffect(() => {
    const interval = setInterval(() => {
      if (saveStatus === 'unsaved') saveRef.current('draft');
    }, 30000);
    return () => clearInterval(interval);
  }, [saveStatus]);

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(autoSaveTimer.current);
  }, []);

  const handlePublish = async () => {
    setIsPublishing(true);
    await saveToFirestore('published');
    setIsPublishing(false);
    router.push(`/teacher/class/${classId}`);
  };

  const handlePdfUploadForExtraction = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsPdfExtracting(true);
    try {
      // Upload PDF to assignments/ path first
      const path = `assignments/${classId}/${assignmentIdRef.current}_extract_${Date.now()}.pdf`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);

      const fn = httpsCallable(functions, 'extract_pdf_pages');
      const { data } = await fn({
        classId,
        assignmentId: assignmentIdRef.current,
        storagePath: path,
      });

      const pdfBlocks = (data.pages || []).map((p, i) => ({
        id: `block_${uuidv4()}`,
        type: 'pdf_page',
        order: blocks.length + i + 1,
        content: '',
        points: 0,
        pageUrl: p.url,
        storagePath: p.storagePath,
      }));
      setBlocks(prev => [...prev, ...pdfBlocks].map((b, i) => ({ ...b, order: i + 1 })));
      scheduleSave();
    } catch (err) {
      alert(`PDF extraction failed: ${err.message}`);
    } finally {
      setIsPdfExtracting(false);
      e.target.value = '';
    }
  };

  if (!router.isReady) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <>
      <Head><title>Assignment Builder — TikiTaka</title></Head>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* LEFT PANEL — Toolbox */}
        <aside className="w-48 border-r bg-muted/20 flex flex-col shrink-0">
          <div className="p-3 border-b">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Add Block</p>
            <div className="space-y-1">
              {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => type === 'pdf_page' ? document.getElementById('pdf-extract-input')?.click() : addBlock(type)}
                  className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors text-left"
                  aria-label={`Add ${label} block`}
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            {/* Hidden PDF input for extraction */}
            <input id="pdf-extract-input" type="file" accept="application/pdf" className="hidden" onChange={handlePdfUploadForExtraction} />
            {isPdfExtracting && <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Extracting pages…</p>}
          </div>
        </aside>

        {/* CENTER — Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="border-b px-4 py-2 flex items-center gap-3 bg-background">
            <Input
              value={title}
              onChange={e => { setTitle(e.target.value); scheduleSave(); }}
              placeholder="Assignment title"
              className="max-w-xs font-semibold"
              aria-label="Assignment title"
            />
            <span className="ml-auto text-xs text-muted-foreground">
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </span>
            <Button variant="outline" size="sm" onClick={() => saveToFirestore('draft')}>
              <Save className="h-4 w-4 mr-1" /> Save Draft
            </Button>
            <Button size="sm" onClick={handlePublish} disabled={isPublishing}>
              {isPublishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Publish
            </Button>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="max-w-2xl mx-auto space-y-3">
                  {blocks.length === 0 && (
                    <Card className="p-12 text-center border-dashed">
                      <Plus className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground">Add blocks from the left panel to build your assignment.</p>
                    </Card>
                  )}
                  {blocks.map(block => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      onUpdate={updateBlock}
                      onDelete={deleteBlock}
                      onDuplicate={duplicateBlock}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </main>

        {/* RIGHT PANEL — Preview */}
        <aside className="w-80 border-l bg-muted/10 flex flex-col shrink-0">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium">Student Preview</span>
            <div className="flex gap-1">
              <Button
                variant={previewMode === 'desktop' ? 'default' : 'ghost'}
                size="icon" className="h-7 w-7"
                onClick={() => setPreviewMode('desktop')}
                aria-label="Desktop preview"
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                variant={previewMode === 'mobile' ? 'default' : 'ghost'}
                size="icon" className="h-7 w-7"
                onClick={() => setPreviewMode('mobile')}
                aria-label="Mobile preview"
              >
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <PreviewPanel blocks={blocks} title={title} previewMode={previewMode} />
          </div>
        </aside>
      </div>
    </>
  );
}

export default withAuth(AssignmentBuilderPage, 'teacher');
