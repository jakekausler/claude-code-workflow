import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';

export interface DeletePreview {
  item: { id: string; title: string; type: string };
  childrenToDelete: { id: string; title: string; type: string }[];
  dependenciesRemoved: number;
  dependenciesCreated: { from: string; to: string }[];
}

export interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  preview: DeletePreview | null;
  error?: string | null;
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  preview,
  error,
}: DeleteConfirmationDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDeleting) return;
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  const childSummary = useMemo(() => {
    if (!preview || preview.childrenToDelete.length === 0) return null;
    const grouped: Record<string, number> = {};
    for (const child of preview.childrenToDelete) {
      const typeLower = child.type.toLowerCase();
      grouped[typeLower] = (grouped[typeLower] || 0) + 1;
    }
    return Object.entries(grouped)
      .map(([type, count]) => `${count} ${count === 1 ? type : type + 's'}`)
      .join(', ');
  }, [preview]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {preview === null ? (
          <div className="flex items-center justify-center px-4 py-12">
            <Loader2 size={24} className="animate-spin text-zinc-400" />
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">
                Delete {preview.item.type}: {preview.item.title}
              </h3>
            </div>

            <div className="px-4 py-3 space-y-3">
              {preview.childrenToDelete.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-400">This will also delete:</p>
                  <ul className="mt-1 list-disc list-inside text-xs text-zinc-300">
                    {childSummary?.split(', ').map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(preview.dependenciesRemoved > 0 || preview.dependenciesCreated.length > 0) && (
                <div>
                  <p className="text-xs font-medium text-zinc-300">Dependencies:</p>
                  <ul className="mt-1 list-disc list-inside text-xs text-zinc-400">
                    {preview.dependenciesRemoved > 0 && (
                      <li>
                        {preview.dependenciesRemoved} link{preview.dependenciesRemoved === 1 ? '' : 's'} will be
                        removed
                      </li>
                    )}
                    {preview.dependenciesCreated.length > 0 && (
                      <li>
                        {preview.dependenciesCreated.length} link
                        {preview.dependenciesCreated.length === 1 ? '' : 's'} will be re-routed
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {error && (
              <div className="mx-4 rounded bg-red-900/50 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
              <button
                onClick={onClose}
                disabled={isDeleting}
                className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-50"
              >
                {isDeleting && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
