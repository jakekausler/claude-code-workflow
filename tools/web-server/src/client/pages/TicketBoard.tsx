import { useParams, useNavigate } from 'react-router-dom';
import { useTickets, useEpic } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { statusColor } from '../utils/formatters.js';
import type { TicketListItem } from '../api/hooks.js';

function categorizeTickets(tickets: TicketListItem[]) {
  const notStarted: TicketListItem[] = [];
  const inProgress: TicketListItem[] = [];
  const complete: TicketListItem[] = [];
  const toConvert: TicketListItem[] = [];

  for (const ticket of tickets) {
    if (!ticket.has_stages) {
      toConvert.push(ticket);
      continue;
    }
    switch (ticket.status) {
      case 'complete':
        complete.push(ticket);
        break;
      case 'in_progress':
        inProgress.push(ticket);
        break;
      default:
        notStarted.push(ticket);
        break;
    }
  }

  return { notStarted, inProgress, complete, toConvert };
}

export function TicketBoard() {
  const { epicId } = useParams<{ epicId: string }>();
  const navigate = useNavigate();
  const { data: tickets, isLoading: ticketsLoading, error: ticketsError } = useTickets({ epic: epicId });
  const { data: epic } = useEpic(epicId ?? '');

  const { notStarted, inProgress, complete, toConvert } = categorizeTickets(tickets ?? []);

  const columns = [
    { title: 'Not Started', color: statusColor('not_started'), items: notStarted },
    { title: 'In Progress', color: statusColor('in_progress'), items: inProgress },
    { title: 'Complete', color: statusColor('complete'), items: complete },
  ];

  // Only show "To Convert" column if there are tickets without stages
  if (toConvert.length > 0) {
    columns.push({ title: 'To Convert', color: '#f59e0b', items: toConvert });
  }

  const pageTitle = epic ? `${epic.id} — ${epic.title}` : epicId ?? 'Tickets';

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{pageTitle}</h1>
      <p className="mb-4 text-sm text-slate-500">Tickets for this epic</p>
      <BoardLayout isLoading={ticketsLoading} error={ticketsError ?? null}>
        {columns.map((col) => (
          <BoardColumn key={col.title} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((ticket) => {
              const badges: { label: string; color: string }[] = [];
              if (ticket.jira_key) badges.push({ label: ticket.jira_key, color: '#3b82f6' });
              if (ticket.source === 'jira') badges.push({ label: 'Jira', color: '#0052cc' });

              return (
                <BoardCard
                  key={ticket.id}
                  id={ticket.id}
                  title={ticket.title}
                  subtitle={`${ticket.stage_count} stage${ticket.stage_count !== 1 ? 's' : ''}`}
                  badges={badges.length > 0 ? badges : undefined}
                  progress={ticket.status === 'complete' ? 100 : ticket.status === 'in_progress' ? 50 : 0}
                  onClick={() => navigate(`/epics/${epicId}/tickets/${ticket.id}/stages`)}
                />
              );
            })}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
