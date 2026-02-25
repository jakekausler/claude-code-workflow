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
import { createMultiRepoHelper } from '../../repos/multi-repo.js';
import { createRegistry } from '../../repos/registry.js';

interface MapNextRowsResult {
  stages: NextStageRow[];
  tickets: NextTicketRow[];
  dependencies: NextDependencyRow[];
}

function mapNextRows(
  stageRows: Array<any>,
  ticketRows: Array<any>,
  depRows: Array<any>,
  options: { includeRepo: boolean }
): MapNextRowsResult {
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
    ...(options.includeRepo && { repo: s.repo }),
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

  return { stages, tickets, dependencies };
}

export const nextCommand = new Command('next')
  .description('Output next workable stages, sorted by priority')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--global', 'Show ready stages across all registered repos', false)
  .option('--max <n>', 'Maximum number of stages to return', '5')
  .option('--pretty', 'Pretty-print JSON output', false)
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

        // Map aggregated data to logic input types (with repo field)
        const { stages, tickets, dependencies } = mapNextRows(aggregated.stages, aggregated.tickets, aggregated.deps, { includeRepo: true });

        const maxValue = parseInt(options.max, 10);

        const result = buildNext({
          config,
          stages,
          dependencies,
          tickets,
          max: isNaN(maxValue) ? 5 : maxValue,
        });

        // Add repos field for global mode
        const output = {
          ...result,
          repos: repoNames,
        };

        const indent = options.pretty ? 2 : undefined;
        const outputStr = JSON.stringify(output, null, indent) + '\n';
        writeOutput(outputStr, options.output);
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
        const ticketRows = new TicketRepository(db).listByRepo(repoId);
        const stageRows = new StageRepository(db).listByRepo(repoId);
        const depRows = new DependencyRepository(db).listByRepo(repoId);

        // Map DB rows to logic input types
        const { stages, tickets, dependencies } = mapNextRows(stageRows, ticketRows, depRows, { includeRepo: false });

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
      }

      db.close();
    } catch (err) {
      db.close();
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
