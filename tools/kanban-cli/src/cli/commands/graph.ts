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
import { buildGraph } from '../logic/graph.js';
import type { GraphEpicRow, GraphTicketRow, GraphStageRow, GraphDependencyRow } from '../logic/graph.js';
import { formatGraphAsMermaid } from '../formatters/graph-mermaid.js';
import { writeOutput } from '../utils/output.js';
import { createMultiRepoHelper } from '../../repos/multi-repo.js';
import { createRegistry } from '../../repos/registry.js';

export const graphCommand = new Command('graph')
  .description('Output dependency graph as JSON')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--global', 'Show dependency graph across all registered repos', false)
  .option('--epic <id>', 'Filter to a specific epic')
  .option('--ticket <id>', 'Filter to a specific ticket')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--mermaid', 'Output as Mermaid diagram instead of JSON', false)
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

        // Map aggregated rows to GraphEpicRow types with repo field
        const epics: GraphEpicRow[] = aggregated.epics.map((e) => ({
          id: e.id,
          title: e.title ?? '',
          status: e.status ?? 'Not Started',
          repo: e.repo,
        }));

        const tickets: GraphTicketRow[] = aggregated.tickets.map((t) => ({
          id: t.id,
          epic_id: t.epic_id ?? '',
          title: t.title ?? '',
          status: t.status ?? 'Not Started',
          repo: t.repo,
        }));

        const stages: GraphStageRow[] = aggregated.stages.map((s) => ({
          id: s.id,
          ticket_id: s.ticket_id ?? '',
          epic_id: s.epic_id ?? '',
          title: s.title ?? '',
          status: s.status ?? 'Not Started',
          repo: s.repo,
        }));

        const dependencies: GraphDependencyRow[] = aggregated.deps.map((d) => ({
          id: d.id,
          from_id: d.from_id,
          to_id: d.to_id,
          from_type: d.from_type,
          to_type: d.to_type,
          resolved: d.resolved === 1,
          repo: d.repo,
        }));

        const result = buildGraph({
          epics,
          tickets,
          stages,
          dependencies,
          filters: {
            epic: options.epic,
            ticket: options.ticket,
          },
          global: true,
          repos: repoNames,
        });

        let output: string;
        if (options.mermaid) {
          output = formatGraphAsMermaid(result) + '\n';
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

        // Map DB rows to logic input types
        const epics: GraphEpicRow[] = epicRows.map((e) => ({
          id: e.id,
          title: e.title ?? '',
          status: e.status ?? 'Not Started',
        }));

        const tickets: GraphTicketRow[] = ticketRows.map((t) => ({
          id: t.id,
          epic_id: t.epic_id ?? '',
          title: t.title ?? '',
          status: t.status ?? 'Not Started',
        }));

        const stages: GraphStageRow[] = stageRows.map((s) => ({
          id: s.id,
          ticket_id: s.ticket_id ?? '',
          epic_id: s.epic_id ?? '',
          title: s.title ?? '',
          status: s.status ?? 'Not Started',
        }));

        const dependencies: GraphDependencyRow[] = depRows.map((d) => ({
          id: d.id,
          from_id: d.from_id,
          to_id: d.to_id,
          from_type: d.from_type,
          to_type: d.to_type,
          resolved: d.resolved === 1,
        }));

        const result = buildGraph({
          epics,
          tickets,
          stages,
          dependencies,
          filters: {
            epic: options.epic,
            ticket: options.ticket,
          },
        });

        let output: string;
        if (options.mermaid) {
          output = formatGraphAsMermaid(result) + '\n';
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
