import { useState, useEffect, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useCurrentUser } from '../../api/hooks.js';
import { can } from '../../utils/permissions.js';

interface CreateEpicBody {
  title: string;
  status: string;
  description?: string;
}

interface CreateEpicResponse {
  id: string;
  title: string;
  status: string;
  file_path: string;
}

function useCreateEpic() {
  return useMutation({
    mutationFn: (body: CreateEpicBody) =>
      apiFetch<CreateEpicResponse>('/epics', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

export function NewEpicButton() {
  const { data: me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const queryClient = useQueryClient();
  const mutation = useCreateEpic();

  if (!can(me, 'create:epic')) return null;

  const handleClose = useCallback(() => {
    setOpen(false);
    setTitle('');
    setDescription('');
    mutation.reset();
  }, [mutation]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate(
      { title: title.trim(), status: 'to_convert', description: description.trim() || undefined },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['epics'] });
          void queryClient.invalidateQueries({ queryKey: ['board'] });
          handleClose();
        },
      },
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        <Plus size={14} />
        New Epic
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-epic-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 id="new-epic-title" className="text-sm font-semibold text-slate-900">
                New Epic
              </h2>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
              <div>
                <label htmlFor="epic-title" className="mb-1 block text-xs font-medium text-slate-700">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="epic-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Epic title"
                  required
                  autoFocus
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="epic-description" className="mb-1 block text-xs font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  id="epic-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={4}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                />
              </div>

              {mutation.isError && (
                <p className="text-xs text-red-600">{mutation.error?.message ?? 'Failed to create epic'}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending || !title.trim()}
                  className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {mutation.isPending ? 'Creating…' : 'Create Epic'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
