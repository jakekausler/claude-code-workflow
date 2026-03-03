import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useEpics } from '../../api/hooks.js';
import { apiFetch } from '../../api/client.js';
import type { EpicListItem } from '../../api/hooks.js';

interface EpicSelectModalProps {
  ticketId: string;
  /** Called with the resolved epicId when user confirms. */
  onConfirm: (epicId: string) => void;
  onCancel: () => void;
}

/**
 * Modal shown when a ticket has no epic attached and the user clicks Convert.
 * Lets them pick an existing epic or create a new one.
 */
export function EpicSelectModal({ ticketId: _ticketId, onConfirm, onCancel }: EpicSelectModalProps) {
  const { data: epics, isLoading: epicsLoading } = useEpics();
  const [selectedEpicId, setSelectedEpicId] = useState<string>('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newEpicTitle, setNewEpicTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = isCreatingNew ? newEpicTitle.trim().length > 0 : selectedEpicId !== '';

  async function handleConfirm() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isCreatingNew) {
        const result = await apiFetch<{ id: string }>('/epics', {
          method: 'POST',
          body: JSON.stringify({ title: newEpicTitle.trim(), status: 'in_progress' }),
        });
        onConfirm(result.id);
      } else {
        onConfirm(selectedEpicId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create epic');
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-60 bg-black/40"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="epic-select-title"
        className="fixed left-1/2 top-1/2 z-70 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="epic-select-title" className="text-base font-semibold text-slate-900">
            Select Epic for Conversion
          </h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-500">
          This ticket has no epic attached. Choose an existing epic or create a new one to proceed.
        </p>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Toggle: existing vs. new */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setIsCreatingNew(false)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !isCreatingNew
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Existing epic
          </button>
          <button
            onClick={() => setIsCreatingNew(true)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isCreatingNew
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Create new epic
          </button>
        </div>

        {isCreatingNew ? (
          <div className="mb-4">
            <label htmlFor="new-epic-title" className="mb-1 block text-xs font-medium text-slate-700">
              Epic title
            </label>
            <input
              id="new-epic-title"
              type="text"
              value={newEpicTitle}
              onChange={(e) => setNewEpicTitle(e.target.value)}
              placeholder="e.g. User Authentication"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirm && !isSubmitting) {
                  void handleConfirm();
                }
              }}
            />
          </div>
        ) : (
          <div className="mb-4">
            {epicsLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-400">
                <Loader2 className="animate-spin" size={14} />
                Loading epics…
              </div>
            ) : epics && epics.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {epics.map((epic: EpicListItem) => (
                  <li key={epic.id}>
                    <button
                      onClick={() => setSelectedEpicId(epic.id)}
                      className={`w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                        selectedEpicId === epic.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-800'
                      }`}
                    >
                      <span className="font-mono text-xs text-slate-400 mr-2">{epic.id}</span>
                      {epic.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic text-slate-400">No epics found. Create a new one instead.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={!canConfirm || isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="animate-spin" size={14} />}
            {isCreatingNew ? 'Create & Convert' : 'Convert'}
          </button>
        </div>
      </div>
    </>
  );
}
