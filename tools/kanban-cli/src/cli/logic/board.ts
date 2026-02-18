import type { PipelineConfig } from '../../types/pipeline.js';
import { StateMachine } from '../../engine/state-machine.js';

// ---------- Row types for board output ----------

export interface TicketBoardItem {
  type: 'ticket';
  id: string;
  epic: string;
  title: string;
  jira_key: string | null;
  source: string;
}

export interface StageBoardItem {
  type: 'stage';
  id: string;
  ticket: string;
  epic: string;
  title: string;
  blocked_by?: string[];
  blocked_by_resolved?: boolean;
  session_active?: boolean;
  worktree_branch?: string;
}

export type BoardItem = TicketBoardItem | StageBoardItem;

export interface BoardOutput {
  generated_at: string;
  repo: string;
  columns: Record<string, BoardItem[]>;
  stats: {
    total_stages: number;
    total_tickets: number;
    by_column: Record<string, number>;
  };
}

// ---------- Input data shapes (from 1A repositories) ----------

export interface BoardTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: string;
  has_stages: boolean;
  file_path: string;
}

export interface BoardStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  kanban_column: string;
  refinement_type: string;
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
  file_path: string;
}

export interface BoardEpicRow {
  id: string;
  title: string;
  status: string;
  file_path: string;
}

export interface BoardDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

export interface BoardFilters {
  epic?: string;
  ticket?: string;
  column?: string;
  excludeDone?: boolean;
}

export interface BuildBoardInput {
  config: PipelineConfig;
  repoPath: string;
  epics: BoardEpicRow[];
  tickets: BoardTicketRow[];
  stages: BoardStageRow[];
  dependencies: BoardDependencyRow[];
  filters?: BoardFilters;
}

// ---------- Helpers ----------

/**
 * Convert a display name (e.g. "User Design Feedback") to a snake_case column key.
 */
export function toColumnKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

// ---------- Core logic ----------

const SYSTEM_COLUMNS = ['to_convert', 'backlog', 'ready_for_work', 'done'] as const;

export function buildBoard(input: BuildBoardInput): BoardOutput {
  const { config, repoPath, tickets, stages, dependencies, filters } = input;

  // Build column list from pipeline config
  const sm = StateMachine.fromConfig(config);
  const pipelineColumnKeys = sm.getAllStates().map((s) => toColumnKey(s.name));

  // Initialize all columns (system + pipeline)
  const columns: Record<string, BoardItem[]> = {};
  for (const col of SYSTEM_COLUMNS) {
    columns[col] = [];
  }
  for (const col of pipelineColumnKeys) {
    columns[col] = [];
  }

  // Build a dependency lookup: from_id -> list of unresolved to_ids
  const unresolvedDeps = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!dep.resolved) {
      const existing = unresolvedDeps.get(dep.from_id) || [];
      existing.push(dep.to_id);
      unresolvedDeps.set(dep.from_id, existing);
    }
  }

  // Place tickets without stages in to_convert
  let filteredTickets = tickets.filter((t) => !t.has_stages);
  if (filters?.epic) {
    filteredTickets = filteredTickets.filter((t) => t.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredTickets = filteredTickets.filter((t) => t.id === filters.ticket);
  }

  const shouldIncludeToConvert = !filters?.column || filters.column === 'to_convert';
  if (shouldIncludeToConvert) {
    for (const ticket of filteredTickets) {
      columns.to_convert.push({
        type: 'ticket',
        id: ticket.id,
        epic: ticket.epic_id,
        title: ticket.title,
        jira_key: ticket.jira_key,
        source: ticket.source,
      });
    }
  }

  // Place stages
  let filteredStages = [...stages];
  if (filters?.epic) {
    filteredStages = filteredStages.filter((s) => s.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredStages = filteredStages.filter((s) => s.ticket_id === filters.ticket);
  }
  if (filters?.excludeDone) {
    filteredStages = filteredStages.filter((s) => s.kanban_column !== 'done');
  }

  for (const stage of filteredStages) {
    const colKey = stage.kanban_column;
    if (filters?.column && colKey !== filters.column) {
      continue;
    }

    const blockedBy = unresolvedDeps.get(stage.id);

    const item: StageBoardItem = {
      type: 'stage',
      id: stage.id,
      ticket: stage.ticket_id,
      epic: stage.epic_id,
      title: stage.title,
    };

    if (colKey === 'backlog' && blockedBy && blockedBy.length > 0) {
      item.blocked_by = blockedBy;
      item.blocked_by_resolved = false;
    }

    if (stage.session_active) {
      item.session_active = true;
    }

    if (stage.worktree_branch) {
      item.worktree_branch = stage.worktree_branch;
    }

    // Ensure the column exists (it should, but guard against unknown kanban_column values)
    if (columns[colKey] !== undefined) {
      columns[colKey].push(item);
    }
  }

  // Compute stats
  const byColumn: Record<string, number> = {};
  for (const [key, items] of Object.entries(columns)) {
    if (items.length > 0) {
      byColumn[key] = items.length;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    repo: repoPath,
    columns,
    stats: {
      total_stages: filteredStages.length,
      total_tickets: filteredTickets.length,
      by_column: byColumn,
    },
  };
}
