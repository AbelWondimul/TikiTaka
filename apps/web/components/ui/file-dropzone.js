import { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Upload, FileText, X } from 'lucide-react';

export default function FileDropzone({ accept = '.pdf', maxSize = 20, onFileSelect, disabled = false, file = null, className }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragOut = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) {
      if (droppedFile.size > maxSize * 1024 * 1024) {
        alert(`File must be under ${maxSize}MB`);
        return;
      }
      onFileSelect?.(droppedFile);
    }
  }, [disabled, maxSize, onFileSelect]);

  const handleChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > maxSize * 1024 * 1024) {
        alert(`File must be under ${maxSize}MB`);
        return;
      }
      onFileSelect?.(selected);
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onFileSelect?.(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      onClick={() => !disabled && !file && inputRef.current?.click()}
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-xl border-2 border-dashed transition-all cursor-pointer',
        isDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border/50 hover:border-primary/40 hover:bg-muted/20',
        disabled && 'opacity-50 cursor-not-allowed',
        file ? 'p-3' : 'p-6',
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
      />

      {file ? (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{file.name}</p>
            <p className="text-[10px] text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
          </div>
          {!disabled && (
            <button onClick={handleClear} className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors shrink-0">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-center pointer-events-none">
          <Upload className={cn('h-8 w-8 mb-2', isDragging ? 'text-primary' : 'text-muted-foreground/40')} />
          <p className="text-sm font-medium text-muted-foreground">
            {isDragging ? 'Drop file here' : 'Drag & drop or click to browse'}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {accept.replace(/\./g, '').toUpperCase()} up to {maxSize}MB
          </p>
        </div>
      )}
    </div>
  );
}
