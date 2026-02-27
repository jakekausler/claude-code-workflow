import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { buildBoard } from '../../../../kanban-cli/dist/cli/logic/board.js';
import type {
  BoardEpicRow,
  BoardTicketRow,
  BoardStageRow,
  BoardDependencyRow,
} from '../../../../kanban-cli/dist/cli/logic/board.js';
import { defaultPipelineConfig } from '../../../../kanban-cli/dist/config/defaults.js';
import type { DataService } from '../services/data-service.js';

/** Allowed query-string keys for /api/board. */
const ALLOWED_BOARD_PARAMS = new Set(['epic', 'ticket', 'column', 'excludeDone', 'repo']);

/** Zod schema for /api/board query parameters. */
const boardQuerySchema = z.object({
  epic: z.string().optional(),
  ticket: z.string().optional(),
  column: z.string().optional(),
  excludeDone: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  repo: z.string().optional(),
});

/**
 * Maps database row types to the shapes that buildBoard() expects.
 * DB rows use SQLite conventions (number for booleans, nullable strings);
 * buildBoard input types use stricter TypeScript types.
 */
function mapEpics(rows: { id: string; title: string | null; status: string | null; file_path: string }[]): BoardEpicRow[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '',
    status: r.status ?? '',
    file_path: r.file_path,
  }));
}

function mapTickets(
  rows: {
    id: string;
    epic_id: string | null;
    title: string | null;
    status: string | null;
    jira_key: string | null;
    source: string | null;
    has_stages: number | null;
    file_path: string;
  }[],
): BoardTicketRow[] {
  return rows.map((r) => ({
    id: r.id,
    epic_id: r.epic_id ?? '',
    title: r.title ?? '',
    status: r.status ?? '',
    jira_key: r.jira_key,
    source: r.source ?? '',
    has_stages: (r.has_stages ?? 0) !== 0,
    file_path: r.file_path,
  }));
}

function mapStages(
  rows: {
    id: string;
    ticket_id: string | null;
    epic_id: string | null;
    title: string | null;
    status: string | null;
    kanban_column: string | null;
    refinement_type: string | null;
    worktree_branch: string | null;
    priority: number;
    due_date: string | null;
    session_active: number;
    pending_merge_parents: string | null;
    file_path: string;
  }[],
): BoardStageRow[] {
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id ?? '',
    epic_id: r.epic_id ?? '',
    title: r.title ?? '',
    status: r.status ?? '',
    kanban_column: r.kanban_column ?? 'backlog',
    refinement_type: r.refinement_type ?? '',
    worktree_branch: r.worktree_branch ?? '',
    priority: r.priority,
    due_date: r.due_date,
    session_active: r.session_active !== 0,
    pending_merge_parents: r.pending_merge_parents ?? undefined,
    file_path: r.file_path,
  }));
}

function mapDependencies(
  rows: {
    id: number;
    from_id: string;
    to_id: string;
    from_type: string;
    to_type: string;
    resolved: number;
  }[],
): BoardDependencyRow[] {
  return rows.map((r) => ({
    id: r.id,
    from_id: r.from_id,
    to_id: r.to_id,
    from_type: r.from_type,
    to_type: r.to_type,
    resolved: r.resolved !== 0,
  }));
}

/** Shared data returned by {@link fetchBoardData}. */
interface BoardData {
  repoPath: string;
  epics: BoardEpicRow[];
  tickets: BoardTicketRow[];
  stages: BoardStageRow[];
  dependencies: BoardDependencyRow[];
  global: boolean;
  repos?: string[];
}

/**
 * Fetch and map the common board data.
 *
 * When `repoFilter` is provided, returns data for that single repo.
 * When omitted ("All Repos"), aggregates data across every registered repo
 * and sets `global: true` so that `buildBoard` produces a multi-repo board.
 *
 * Returns `null` when no repos exist (or the requested repo is not found).
 */
function fetchBoardData(dataService: DataService, repoFilter?: string): BoardData | null {
  const repos = dataService.repos.findAll();
  if (repos.length === 0) return null;

  if (repoFilter) {
    // Single-repo mode: find by name first, then try by ID
    const repo =
      repos.find((r) => r.name === repoFilter) ?? repos.find((r) => String(r.id) === repoFilter);
    if (!repo) return null;

    return {
      repoPath: repo.path,
      epics: mapEpics(dataService.epics.listByRepo(repo.id)),
      tickets: mapTickets(dataService.tickets.listByRepo(repo.id)),
      stages: mapStages(dataService.stages.listByRepo(repo.id)),
      dependencies: mapDependencies(dataService.dependencies.listByRepo(repo.id)),
      global: false,
    };
  }

  // All-repos mode: aggregate data from every repo
  const allEpics: BoardEpicRow[] = [];
  const allTickets: BoardTicketRow[] = [];
  const allStages: BoardStageRow[] = [];
  const allDependencies: BoardDependencyRow[] = [];

  for (const repo of repos) {
    allEpics.push(...mapEpics(dataService.epics.listByRepo(repo.id)));
    allTickets.push(...mapTickets(dataService.tickets.listByRepo(repo.id)));
    allStages.push(...mapStages(dataService.stages.listByRepo(repo.id)));
    allDependencies.push(...mapDependencies(dataService.dependencies.listByRepo(repo.id)));
  }

  return {
    repoPath: repos[0].path,
    epics: allEpics,
    tickets: allTickets,
    stages: allStages,
    dependencies: allDependencies,
    global: true,
    repos: repos.map((r) => r.name),
  };
}

const boardPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/api/board', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    // Reject unknown query-string keys before Zod validation
    const rawQuery = request.query as Record<string, unknown>;
    for (const key of Object.keys(rawQuery)) {
      if (!ALLOWED_BOARD_PARAMS.has(key)) {
        return reply.status(400).send({ error: `Unknown parameter: ${key}` });
      }
    }

    const result = boardQuerySchema.safeParse(rawQuery);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: result.error.issues });
    }

    const { epic, ticket, column, excludeDone, repo } = result.data;

    const data = fetchBoardData(app.dataService, repo);
    if (!data) {
      return reply.send({
        generated_at: new Date().toISOString(),
        repo: '',
        columns: {},
        stats: { total_stages: 0, total_tickets: 0, by_column: {} },
      });
    }

    const board = buildBoard({
      config: defaultPipelineConfig,
      repoPath: data.repoPath,
      epics: data.epics,
      tickets: data.tickets,
      stages: data.stages,
      dependencies: data.dependencies,
      filters: { epic, ticket, column, excludeDone },
      global: data.global,
      repos: data.repos,
    });

    return reply.send(board);
  });

  app.get('/api/stats', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const data = fetchBoardData(app.dataService);
    if (!data) {
      return reply.send({ total_stages: 0, total_tickets: 0, by_column: {} });
    }

    const board = buildBoard({
      config: defaultPipelineConfig,
      repoPath: data.repoPath,
      epics: data.epics,
      tickets: data.tickets,
      stages: data.stages,
      dependencies: data.dependencies,
      global: data.global,
      repos: data.repos,
    });

    return reply.send(board.stats);
  });

  done();
};

export const boardRoutes = fp(boardPlugin, { name: 'board-routes' });
