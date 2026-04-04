import { createContext, useContext, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-foreground text-background',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback(({ title, type = 'success', duration = 3000 }) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-200',
                STYLES[t.type] || STYLES.info
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium flex-1">{t.title}</span>
              <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
