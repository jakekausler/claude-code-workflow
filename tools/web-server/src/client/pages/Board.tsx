import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBoard, useEpics, useTickets } from '../api/hooks.js';
import { useBoardStore } from '../store/board-store.js';
import type { SessionMapEntry } from '../store/board-store.js';
import { useDrawerStore, type DrawerEntry } from '../store/drawer-store.js';
import { FilterBar } from '../components/board/FilterBar.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { slugToTitle, columnColor, statusColor } from '../utils/formatters.js';
import { useSSE } from '../api/use-sse.js';
import type { BoardStageItem, BoardTicketItem, BoardItem, EpicListItem, TicketListItem } from '../api/hooks.js';

/** Priority map for known system columns; lower = further left. */
const COLUMN_ORDER: Record<string, number> = {
  epics: -3,
  converted: -2,
  to_convert: -1,
  backlog: 0,
  ready_for_work: 1,
  // pipeline columns get 100 + their index (preserving API order)
  done: 9999,
};

/** Return a numeric sort key for a column slug. `index` is the column's
 *  position in the original Object.entries() iteration so that pipeline
 *  columns (not in COLUMN_ORDER) keep their natural API order. */
function columnSortKey(slug: string, index: number): number {
  return COLUMN_ORDER[slug] ?? (100 + index);
}

/** Numeric priority for status-based sorting: not_started first, then in_progress, then complete. */
const STATUS_SORT: Record<string, number> = {
  not_started: 0,
  in_progress: 1,
  complete: 2,
};

function statusSortKey(status: string): number {
  return STATUS_SORT[status] ?? 1;
}

export function Board() {
  const { selectedRepo, selectedEpic, selectedTicket } = useBoardStore();
  const sessionMap = useBoardStore((s) => s.sessionMap);
  const { open, stack } = useDrawerStore();
  const currentDrawerId = stack.length > 0 ? stack[stack.length - 1].id : null;

  const queryClient = useQueryClient();

  const handleSSE = useCallback(
    (_channel: string, _data: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['epics'] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    [queryClient],
  );

  useSSE(['board-update'], handleSSE);

  const filters: Record<string, string | boolean | undefined> = {};
  if (selectedRepo) filters.repo = selectedRepo;
  if (selectedEpic) filters.epic = selectedEpic;
  if (selectedTicket) filters.ticket = selectedTicket;

  const { data: board, isLoading, error } = useBoard(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  const { data: epics } = useEpics();
  const { data: tickets } = useTickets();

  // Build board columns from API data
  const boardColumns = board
    ? Object.entries(board.columns).map(([slug, items], index) => ({
        slug,
        title: slugToTitle(slug),
        color: columnColor(slug),
        items,
        _sortKey: columnSortKey(slug, index),
      }))
    : [];

  // Synthetic "epics" column — all epics sorted by status
  const epicCards: EpicListItem[] = epics
    ? [...epics].sort((a, b) => statusSortKey(a.status) - statusSortKey(b.status))
    : [];

  if (epicCards.length > 0) {
    boardColumns.push({
      slug: 'epics',
      title: 'Epics',
      color: columnColor('epics'),
      items: [], // rendered separately below
      _sortKey: columnSortKey('epics', 0),
    });
  }

  // Synthetic "converted" column — tickets that have stages
  const convertedTickets: TicketListItem[] = tickets
    ? tickets
        .filter((t) => t.has_stages)
        .sort((a, b) => statusSortKey(a.status) - statusSortKey(b.status))
    : [];

  if (convertedTickets.length > 0) {
    boardColumns.push({
      slug: 'converted',
      title: 'Converted',
      color: columnColor('converted'),
      items: [], // rendered separately below
      _sortKey: columnSortKey('converted', 0),
    });
  }

  const columns = boardColumns.sort((a, b) => a._sortKey - b._sortKey);

  // Find which column contains the currently-selected drawer item
  const selectedColumnIndex = useMemo<number | null>(() => {
    if (!currentDrawerId) return null;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.slug === 'epics') {
        if (epicCards.some((e) => e.id === currentDrawerId)) return i;
      } else if (col.slug === 'converted') {
        if (convertedTickets.some((t) => t.id === currentDrawerId)) return i;
      } else {
        if (col.items.some((item) => item.id === currentDrawerId)) return i;
      }
    }
    return null;
  }, [currentDrawerId, columns, epicCards, convertedTickets]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Board</h1>
      <FilterBar />
      <BoardLayout isLoading={isLoading} error={error ?? null} isEmpty={columns.length === 0} selectedColumnIndex={selectedColumnIndex}>
        {columns.map((col) => {
          if (col.slug === 'epics') {
            return (
              <BoardColumn key={col.slug} title={col.title} color={col.color} count={epicCards.length}>
                {epicCards.map((epic) => renderEpicCard(epic, open, currentDrawerId))}
              </BoardColumn>
            );
          }
          if (col.slug === 'converted') {
            return (
              <BoardColumn key={col.slug} title={col.title} color={col.color} count={convertedTickets.length}>
                {convertedTickets.map((ticket) => renderConvertedTicketCard(ticket, open, currentDrawerId))}
              </BoardColumn>
            );
          }
          return (
            <BoardColumn key={col.slug} title={col.title} color={col.color} count={col.items.length}>
              {col.items.map((item) => renderCard(item, open, currentDrawerId, sessionMap))}
            </BoardColumn>
          );
        })}
      </BoardLayout>
    </div>
  );
}

function renderCard(
  item: BoardItem,
  open: (entry: DrawerEntry) => void,
  currentDrawerId: string | null,
  sessionMap: Map<string, SessionMapEntry>,
) {
  if (item.type === 'stage') {
    return renderStageCard(item, open, currentDrawerId, sessionMap);
  }
  return renderTicketCard(item, open, currentDrawerId);
}

function renderStageCard(
  stage: BoardStageItem,
  open: (entry: DrawerEntry) => void,
  currentDrawerId: string | null,
  sessionMap: Map<string, SessionMapEntry>,
) {
  const badges: { label: string; color: string }[] = [];
  if (stage.blocked_by && stage.blocked_by.length > 0) {
    badges.push({ label: `Blocked by ${stage.blocked_by.length}`, color: '#ef4444' });
  }

  const sessionStatus = sessionMap.get(stage.id) ?? null;

  return (
    <BoardCard
      key={stage.id}
      id={stage.id}
      title={stage.title}
      subtitle={`${stage.epic} / ${stage.ticket}`}
      badges={badges.length > 0 ? badges : undefined}
      statusDot={!sessionStatus && stage.session_active ? '#22c55e' : undefined}
      sessionStatus={sessionStatus}
      isSelected={currentDrawerId === stage.id}
      onClick={() => open({ type: 'stage', id: stage.id })}
    />
  );
}

function renderTicketCard(
  ticket: BoardTicketItem,
  open: (entry: DrawerEntry) => void,
  currentDrawerId: string | null,
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
      isSelected={currentDrawerId === ticket.id}
      onClick={() => open({ type: 'ticket', id: ticket.id })}
    />
  );
}

function renderEpicCard(
  epic: EpicListItem,
  open: (entry: DrawerEntry) => void,
  currentDrawerId: string | null,
) {
  const badges: { label: string; color: string }[] = [
    { label: slugToTitle(epic.status), color: statusColor(epic.status) },
  ];
  if (epic.jira_key) {
    badges.push({ label: epic.jira_key, color: '#3b82f6' });
  }

  return (
    <BoardCard
      key={epic.id}
      id={epic.id}
      title={epic.title}
      subtitle={`${epic.ticket_count} ticket${epic.ticket_count === 1 ? '' : 's'}`}
      badges={badges}
      isSelected={currentDrawerId === epic.id}
      onClick={() => open({ type: 'epic', id: epic.id })}
    />
  );
}

function renderConvertedTicketCard(
  ticket: TicketListItem,
  open: (entry: DrawerEntry) => void,
  currentDrawerId: string | null,
) {
  const badges: { label: string; color: string }[] = [
    { label: slugToTitle(ticket.status), color: statusColor(ticket.status) },
  ];
  if (ticket.jira_key) {
    badges.push({ label: ticket.jira_key, color: '#3b82f6' });
  }

  return (
    <BoardCard
      key={ticket.id}
      id={ticket.id}
      title={ticket.title}
      subtitle={`${ticket.stage_count} stage${ticket.stage_count === 1 ? '' : 's'}`}
      badges={badges}
      isSelected={currentDrawerId === ticket.id}
      onClick={() => open({ type: 'ticket', id: ticket.id })}
    />
  );
}
