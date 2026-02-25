import { useNavigate } from 'react-router-dom';
import { useEpics } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { statusColor } from '../utils/formatters.js';
import type { EpicListItem } from '../api/hooks.js';

function categorizeEpics(epics: EpicListItem[]) {
  const notStarted: EpicListItem[] = [];
  const inProgress: EpicListItem[] = [];
  const complete: EpicListItem[] = [];

  for (const epic of epics) {
    switch (epic.status) {
      case 'complete':
        complete.push(epic);
        break;
      case 'in_progress':
        inProgress.push(epic);
        break;
      default:
        notStarted.push(epic);
        break;
    }
  }

  return { notStarted, inProgress, complete };
}

export function EpicBoard() {
  const navigate = useNavigate();
  const { data: epics, isLoading, error } = useEpics();

  const { notStarted, inProgress, complete } = categorizeEpics(epics ?? []);

  const columns = [
    { title: 'Not Started', color: statusColor('not_started'), items: notStarted },
    { title: 'In Progress', color: statusColor('in_progress'), items: inProgress },
    { title: 'Complete', color: statusColor('complete'), items: complete },
  ];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Epic Board</h1>
      <BoardLayout isLoading={isLoading} error={error ?? null}>
        {columns.map((col) => (
          <BoardColumn key={col.title} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((epic) => (
              <BoardCard
                key={epic.id}
                id={epic.id}
                title={epic.title}
                subtitle={`${epic.ticket_count} ticket${epic.ticket_count !== 1 ? 's' : ''}`}
                badges={epic.jira_key ? [{ label: epic.jira_key, color: '#3b82f6' }] : undefined}
                progress={epic.status === 'complete' ? 100 : epic.status === 'in_progress' ? 50 : 0}
                onClick={() => navigate(`/epics/${epic.id}/tickets`)}
              />
            ))}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
