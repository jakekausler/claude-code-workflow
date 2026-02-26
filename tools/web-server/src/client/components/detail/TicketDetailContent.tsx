import { useTicket } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { slugToTitle, columnColor } from '../../utils/formatters.js';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { JIRA_BASE_URL } from '../../utils/constants.js';

interface TicketDetailContentProps {
  ticketId: string;
}

export function TicketDetailContent({ ticketId }: TicketDetailContentProps) {
  const { data: ticket, isLoading, error } = useTicket(ticketId);
  const { open } = useDrawerStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load ticket: {error?.message ?? 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header metadata */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} type="ticket" />
          {ticket.epic_id && (
            <button
              onClick={() => open({ type: 'epic', id: ticket.epic_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {ticket.epic_id}
            </button>
          )}
          {ticket.source && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {ticket.source}
            </span>
          )}
          {ticket.jira_key && (
            <a
              href={`${JIRA_BASE_URL}/${ticket.jira_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              {ticket.jira_key}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Stage list */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Stages ({ticket.stages.length})
        </h3>
        {ticket.stages.length === 0 ? (
          <p className="text-sm italic text-slate-400">No stages</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2 text-center">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ticket.stages.map((stage) => (
                <tr
                  key={stage.id}
                  tabIndex={0}
                  role="button"
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => open({ type: 'stage', id: stage.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open({ type: 'stage', id: stage.id });
                    }
                  }}
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {stage.id}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{stage.title}</td>
                  <td className="px-3 py-2">
                    {stage.kanban_column ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: columnColor(stage.kanban_column) + '20',
                          color: columnColor(stage.kanban_column),
                        }}
                      >
                        {slugToTitle(stage.kanban_column)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {stage.session_active && (
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Session active" />
                    )}
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
