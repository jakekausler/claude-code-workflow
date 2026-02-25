import { useEpic } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { JIRA_BASE_URL } from '../../utils/constants.js';

interface EpicDetailContentProps {
  epicId: string;
}

export function EpicDetailContent({ epicId }: EpicDetailContentProps) {
  const { data: epic, isLoading, error } = useEpic(epicId);
  const { open } = useDrawerStore();

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
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Tickets ({epic.tickets.length})
        </h3>
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

      {/* Markdown content placeholder */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Content</h3>
        <p className="text-sm italic text-slate-400">
          Content available in future update
        </p>
      </div>
    </div>
  );
}
