import { useState, useEffect, useCallback } from 'react';
import { useEpic } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { ExternalLink, Loader2, AlertCircle, Plus, X } from 'lucide-react';
import { JIRA_BASE_URL } from '../../utils/constants.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';

interface CreateTicketBody {
  title: string;
  epic_id: string;
  status: string;
  description?: string;
}

interface CreateTicketResponse {
  id: string;
  title: string;
  status: string;
  epic_id: string;
  file_path: string;
}

function useCreateTicket() {
  return useMutation({
    mutationFn: (body: CreateTicketBody) =>
      apiFetch<CreateTicketResponse>('/tickets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

interface NewTicketModalProps {
  epicId: string;
  onClose: () => void;
}

function NewTicketModal({ epicId, onClose }: NewTicketModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const queryClient = useQueryClient();
  const mutation = useCreateTicket();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate(
      { title: title.trim(), epic_id: epicId, status: 'to_convert', description: description.trim() || undefined },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['epics', epicId] });
          void queryClient.invalidateQueries({ queryKey: ['board'] });
          onClose();
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="new-ticket-title" className="text-sm font-semibold text-slate-900">
            New Ticket
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Epic</label>
            <p className="text-sm font-mono text-slate-500">{epicId}</p>
          </div>

          <div>
            <label htmlFor="ticket-title" className="mb-1 block text-xs font-medium text-slate-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="ticket-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ticket title"
              required
              autoFocus
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="ticket-description" className="mb-1 block text-xs font-medium text-slate-700">
              Description
            </label>
            <textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={4}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-xs text-red-600">{mutation.error?.message ?? 'Failed to create ticket'}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !title.trim()}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EpicDetailContentProps {
  epicId: string;
}

export function EpicDetailContent({ epicId }: EpicDetailContentProps) {
  const { data: epic, isLoading, error } = useEpic(epicId);
  const { open } = useDrawerStore();
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const handleNewTicketClose = useCallback(() => setNewTicketOpen(false), []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !epic) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load epic: {error?.message ?? 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <StatusBadge status={epic.status} type="epic" />
          {epic.jira_key && (
            <a
              href={`${JIRA_BASE_URL}/${epic.jira_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              {epic.jira_key}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Ticket list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Tickets ({epic.tickets.length})
          </h3>
          <button
            onClick={() => setNewTicketOpen(true)}
            className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            <Plus size={12} />
            New Ticket
          </button>
        </div>
        {epic.tickets.length === 0 ? (
          <p className="text-sm italic text-slate-400">No tickets</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Stages</th>
                <th className="px-3 py-2">Jira</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {epic.tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  tabIndex={0}
                  role="button"
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => open({ type: 'ticket', id: ticket.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open({ type: 'ticket', id: ticket.id });
                    }
                  }}
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {ticket.id}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{ticket.title}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={ticket.status} type="ticket" />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {ticket.stage_count}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {ticket.jira_key ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* TODO: Add dependencies section when /api/epics/:id returns depends_on data */}

      {/* Markdown content placeholder */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Content</h3>
        <p className="text-sm italic text-slate-400">
          Content available in future update
        </p>
      </div>

      {newTicketOpen && (
        <NewTicketModal epicId={epicId} onClose={handleNewTicketClose} />
      )}
    </div>
  );
}
