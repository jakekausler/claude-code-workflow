import { useBoard } from '../api/hooks.js';
import { useBoardStore } from '../store/board-store.js';
import { useDrawerStore, type DrawerEntry } from '../store/drawer-store.js';
import { FilterBar } from '../components/board/FilterBar.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { slugToTitle, columnColor } from '../utils/formatters.js';
import type { BoardStageItem, BoardTicketItem, BoardItem } from '../api/hooks.js';

export function Board() {
  const { selectedRepo, selectedEpic, selectedTicket } = useBoardStore();
  const { open } = useDrawerStore();

  const filters: Record<string, string | boolean | undefined> = {};
  if (selectedRepo) filters.repo = selectedRepo;
  if (selectedEpic) filters.epic = selectedEpic;
  if (selectedTicket) filters.ticket = selectedTicket;

  const { data: board, isLoading, error } = useBoard(
    Object.keys(filters).length > 0 ? filters : undefined,
  );

  const columns = board
    ? Object.entries(board.columns).map(([slug, items]) => ({
        slug,
        title: slugToTitle(slug),
        color: columnColor(slug),
        items,
      }))
    : [];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Board</h1>
      <FilterBar />
      <BoardLayout isLoading={isLoading} error={error ?? null} isEmpty={columns.length === 0}>
        {columns.map((col) => (
          <BoardColumn key={col.slug} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((item) => renderCard(item, open))}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}

function renderCard(
  item: BoardItem,
  open: (entry: DrawerEntry) => void,
) {
  if (item.type === 'stage') {
    return renderStageCard(item, open);
  }
  return renderTicketCard(item, open);
}

function renderStageCard(
  stage: BoardStageItem,
  open: (entry: DrawerEntry) => void,
) {
  const badges: { label: string; color: string }[] = [];
  if (stage.blocked_by && stage.blocked_by.length > 0) {
    badges.push({ label: `Blocked by ${stage.blocked_by.length}`, color: '#ef4444' });
  }

  return (
    <BoardCard
      key={stage.id}
      id={stage.id}
      title={stage.title}
      subtitle={`${stage.epic} / ${stage.ticket}`}
      badges={badges.length > 0 ? badges : undefined}
      statusDot={stage.session_active ? '#22c55e' : undefined}
      onClick={() => open({ type: 'stage', id: stage.id })}
    />
  );
}

function renderTicketCard(
  ticket: BoardTicketItem,
  open: (entry: DrawerEntry) => void,
) {
  const badges: { label: string; color: string }[] = [];
  if (ticket.jira_key) {
    badges.push({ label: ticket.jira_key, color: '#3b82f6' });
  }

  return (
    <BoardCard
      key={ticket.id}
      id={ticket.id}
      title={ticket.title}
      subtitle={ticket.epic}
      badges={badges.length > 0 ? badges : undefined}
      onClick={() => open({ type: 'ticket', id: ticket.id })}
    />
  );
}
