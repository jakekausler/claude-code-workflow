import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { EpicRepository } from '../../db/repositories/epic-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { DependencyRepository } from '../../db/repositories/dependency-repository.js';
import type { EpicRow, TicketRow, StageRow, DependencyRow } from '../../db/repositories/types.js';
import { syncRepo } from '../../sync/sync.js';
import { buildBoard } from '../logic/board.js';
import type { BoardTicketRow, BoardStageRow, BoardEpicRow, BoardDependencyRow } from '../logic/board.js';
import { renderBoardHtml } from '../formatters/board-html.js';
import { writeOutput } from '../utils/output.js';
import { createMultiRepoHelper } from '../../repos/multi-repo.js';
import { createRegistry } from '../../repos/registry.js';

// ── Shared row-mapping helper ──

interface EpicLikeRow { id: string; title: string | null; status: string | null; file_path: string; repo?: string }
interface TicketLikeRow { id: string; epic_id: string | null; title: string | null; status: string | null; jira_key: string | null; source: string | null; has_stages: number | null; file_path: string; repo?: string }
interface StageLikeRow { id: string; ticket_id: string | null; epic_id: string | null; title: string | null; status: string | null; kanban_column: string | null; refinement_type: string | null; worktree_branch: string | null; priority: number; due_date: string | null; session_active: number; pending_merge_parents: string | null; file_path: string; repo?: string }
interface DepLikeRow { id: number; from_id: string; to_id: string; from_type: string; to_type: string; resolved: number; repo?: string }

function mapBoardRows(
  epicRows: EpicLikeRow[],
  ticketRows: TicketLikeRow[],
  stageRows: StageLikeRow[],
  depRows: DepLikeRow[],
  options: { includeRepo: boolean },
): { epics: BoardEpicRow[]; tickets: BoardTicketRow[]; stages: BoardStageRow[]; dependencies: BoardDependencyRow[] } {
  const epics: BoardEpicRow[] = epicRows.map((e) => ({
    id: e.id,
    title: e.title ?? '',
    status: e.status ?? 'Not Started',
    file_path: e.file_path,
  }));

  const tickets: BoardTicketRow[] = ticketRows.map((t) => ({
    id: t.id,
    epic_id: t.epic_id ?? '',
    title: t.title ?? '',
    status: t.status ?? 'Not Started',
    jira_key: t.jira_key,
    source: t.source ?? 'local',
    has_stages: (t.has_stages ?? 0) === 1,
    file_path: t.file_path,
    ...(options.includeRepo && t.repo ? { repo: t.repo } : {}),
  }));

  const stages: BoardStageRow[] = stageRows.map((s) => ({
    id: s.id,
    ticket_id: s.ticket_id ?? '',
    epic_id: s.epic_id ?? '',
    title: s.title ?? '',
    status: s.status ?? 'Not Started',
    kanban_column: s.kanban_column ?? 'backlog',
    refinement_type: s.refinement_type ?? '[]',
    worktree_branch: s.worktree_branch ?? '',
    priority: s.priority,
    due_date: s.due_date,
    session_active: s.session_active === 1,
    pending_merge_parents: s.pending_merge_parents ?? undefined,
    file_path: s.file_path,
    ...(options.includeRepo && s.repo ? { repo: s.repo } : {}),
  }));

  const dependencies: BoardDependencyRow[] = depRows.map((d) => ({
    id: d.id,
    from_id: d.from_id,
    to_id: d.to_id,
    from_type: d.from_type,
    to_type: d.to_type,
    resolved: d.resolved === 1,
  }));

  return { epics, tickets, stages, dependencies };
}

// ── Command ──

export const boardCommand = new Command('board')
  .description('Output kanban board as JSON')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--global', 'Aggregate board across all registered repos', false)
  .option('--epic <id>', 'Filter to a specific epic')
  .option('--ticket <id>', 'Filter to a specific ticket')
  .option('--column <name>', 'Filter to a specific column (snake_case)')
  .option('--exclude-done', 'Omit completed stages', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--html', 'Output as standalone HTML page', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    const db = new KanbanDatabase();
    try {
      if (options.global) {
        // ── Global mode: aggregate across all registered repos ──
        const registry = createRegistry();
        const helper = createMultiRepoHelper({ registry, db });

        const repoInfos = helper.syncAllRepos();
        if (repoInfos.length === 0) {
          process.stderr.write('Error: No repos registered. Use register-repo to add repos.\n');
          process.exit(2);
          return;
        }

        const repoIds = repoInfos.map((r) => r.repoId);
        const repoNames = repoInfos.map((r) => r.repoName);
        const aggregated = helper.loadAllRepoData(repoIds);

        // TODO: Global mode currently uses the first repo's pipeline config for column layout.
        // Repos with different pipeline phases may have stages placed in unexpected columns.
        // Fix: merge workflow.phases from all repos into a superset.
        const config = loadConfig({ repoPath: repoInfos[0].repoPath });

        const { epics, tickets, stages, dependencies } = mapBoardRows(
          aggregated.epics,
          aggregated.tickets,
          aggregated.stages,
          aggregated.deps,
          { includeRepo: true },
        );

        const result = buildBoard({
          config,
          repoPath: '(global)',
          epics,
          tickets,
          stages,
          dependencies,
          filters: {
            epic: options.epic,
            ticket: options.ticket,
            column: options.column,
            excludeDone: options.excludeDone,
          },
          global: true,
          repos: repoNames,
        });

        let output: string;
        if (options.html) {
          output = renderBoardHtml(result);
        } else {
          const indent = options.pretty ? 2 : undefined;
          output = JSON.stringify(result, null, indent) + '\n';
        }
        writeOutput(output, options.output);
      } else {
        // ── Single-repo mode: existing behavior unchanged ──
        const repoPath = path.resolve(options.repo);
        const config = loadConfig({ repoPath });

        // Ensure data is fresh
        syncRepo({ repoPath, db, config });

        // Get the repo ID
        const repoRepo = new RepoRepository(db);
        const repo = repoRepo.findByPath(repoPath);
        if (!repo) {
          process.stderr.write('Error: Repository not found after sync\n');
          process.exit(2);
          return;
        }
        const repoId = repo.id;

        // Query all data
        const epicRows = new EpicRepository(db).listByRepo(repoId);
        const ticketRows = new TicketRepository(db).listByRepo(repoId);
        const stageRows = new StageRepository(db).listByRepo(repoId);
        const depRows = new DependencyRepository(db).listByRepo(repoId);

        const { epics, tickets, stages, dependencies } = mapBoardRows(
          epicRows,
          ticketRows,
          stageRows,
          depRows,
          { includeRepo: false },
        );

        const result = buildBoard({
          config,
          repoPath,
          epics,
          tickets,
          stages,
          dependencies,
          filters: {
            epic: options.epic,
            ticket: options.ticket,
            column: options.column,
            excludeDone: options.excludeDone,
          },
        });

        let output: string;
        if (options.html) {
          output = renderBoardHtml(result);
        } else {
          const indent = options.pretty ? 2 : undefined;
          output = JSON.stringify(result, null, indent) + '\n';
        }
        writeOutput(output, options.output);
      }

      db.close();
    } catch (err) {
      db.close();
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
