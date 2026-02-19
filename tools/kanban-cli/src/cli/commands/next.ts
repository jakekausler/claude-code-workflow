import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { DependencyRepository } from '../../db/repositories/dependency-repository.js';
import { syncRepo } from '../../sync/sync.js';
import { buildNext } from '../logic/next.js';
import type { NextStageRow, NextTicketRow, NextDependencyRow } from '../logic/next.js';
import { writeOutput } from '../utils/output.js';

export const nextCommand = new Command('next')
  .description('Output next workable stages, sorted by priority')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--max <n>', 'Maximum number of stages to return', '5')
  .option('--pretty', 'Pretty-print JSON output', false)
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
      const ticketRows = new TicketRepository(db).listByRepo(repoId);
      const stageRows = new StageRepository(db).listByRepo(repoId);
      const depRows = new DependencyRepository(db).listByRepo(repoId);

      // Map DB rows to logic input types
      const stages: NextStageRow[] = stageRows.map((s) => ({
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
      }));

      const tickets: NextTicketRow[] = ticketRows.map((t) => ({
        id: t.id,
        epic_id: t.epic_id ?? '',
        has_stages: (t.has_stages ?? 0) === 1,
      }));

      const dependencies: NextDependencyRow[] = depRows.map((d) => ({
        id: d.id,
        from_id: d.from_id,
        to_id: d.to_id,
        from_type: d.from_type,
        to_type: d.to_type,
        resolved: d.resolved === 1,
      }));

      const maxValue = parseInt(options.max, 10);

      const result = buildNext({
        config,
        stages,
        dependencies,
        tickets,
        max: isNaN(maxValue) ? 5 : maxValue,
      });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
      db.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
