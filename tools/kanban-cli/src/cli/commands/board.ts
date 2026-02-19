import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { EpicRepository } from '../../db/repositories/epic-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { DependencyRepository } from '../../db/repositories/dependency-repository.js';
import { syncRepo } from '../../sync/sync.js';
import { buildBoard } from '../logic/board.js';
import type { BoardTicketRow, BoardStageRow, BoardEpicRow, BoardDependencyRow } from '../logic/board.js';
import { renderBoardHtml } from '../formatters/board-html.js';
import { writeOutput } from '../utils/output.js';

export const boardCommand = new Command('board')
  .description('Output kanban board as JSON')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--epic <id>', 'Filter to a specific epic')
  .option('--ticket <id>', 'Filter to a specific ticket')
  .option('--column <name>', 'Filter to a specific column (snake_case)')
  .option('--exclude-done', 'Omit completed stages', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--html', 'Output as standalone HTML page', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new KanbanDatabase();

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

      // Map DB rows to logic input types
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
        file_path: s.file_path,
      }));

      const dependencies: BoardDependencyRow[] = depRows.map((d) => ({
        id: d.id,
        from_id: d.from_id,
        to_id: d.to_id,
        from_type: d.from_type,
        to_type: d.to_type,
        resolved: d.resolved === 1,
      }));

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
      db.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
