import { useParams, useNavigate } from 'react-router-dom';
import { useBoard, useEpic, useTicket } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { slugToTitle, columnColor } from '../utils/formatters.js';
import type { BoardStageItem } from '../api/hooks.js';

export function StageBoard() {
  const { epicId, ticketId } = useParams<{ epicId: string; ticketId: string }>();
  const navigate = useNavigate();
  const { data: board, isLoading, error } = useBoard({ ticket: ticketId });
  const { data: epic } = useEpic(epicId ?? '');
  const { data: ticket } = useTicket(ticketId ?? '');

  const columns = board
    ? Object.entries(board.columns).map(([slug, items]) => ({
        slug,
        title: slugToTitle(slug),
        color: columnColor(slug),
        items: items.filter((item): item is BoardStageItem => item.type === 'stage'),
      }))
    : [];

  const pageTitle = ticket
    ? `${ticket.id} — ${ticket.title}`
    : ticketId ?? 'Stages';

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{pageTitle}</h1>
      {epic && (
        <p className="mb-4 text-sm text-slate-500">
          {epic.id} — {epic.title}
        </p>
      )}
      <BoardLayout isLoading={isLoading} error={error ?? null} isEmpty={columns.length === 0}>
        {columns.map((col) => (
          <BoardColumn key={col.slug} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((stage) => {
              const badges: { label: string; color: string }[] = [];
              if (stage.blocked_by && stage.blocked_by.length > 0) {
                badges.push({ label: `${stage.blocked_by.length} blocked`, color: '#ef4444' });
              }

              return (
                <BoardCard
                  key={stage.id}
                  id={stage.id}
                  title={stage.title}
                  badges={badges.length > 0 ? badges : undefined}
                  statusDot={stage.session_active ? '#22c55e' : undefined}
                  onClick={() => navigate(`/stages/${stage.id}`)}
                />
              );
            })}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
