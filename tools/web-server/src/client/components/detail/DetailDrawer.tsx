import { useEffect, useCallback, useRef } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import { useDrawerStore } from '../../store/drawer-store.js';

interface DetailDrawerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DetailDrawer({ title, subtitle, children }: DetailDrawerProps) {
  const { stack, back, closeAll } = useDrawerStore();
  const canGoBack = stack.length > 1;
  const closeRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    },
    [closeAll],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity"
        onMouseDown={closeAll}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          {canGoBack && (
            <button
              onClick={back}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Go back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && (
              <p className="truncate text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            ref={closeRef}
            onClick={closeAll}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  );
}
