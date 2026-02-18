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
import { validateWorkItems } from '../logic/validate.js';
import type { ValidateOutput, ValidateEpicRow, ValidateTicketRow, ValidateStageRow, ValidateDependencyRow } from '../logic/validate.js';
import { validatePipeline } from '../../validators/pipeline-validator.js';
import { ResolverRegistry } from '../../resolvers/registry.js';
import { registerBuiltinResolvers } from '../../resolvers/builtins/index.js';
import { StateMachine } from '../../engine/state-machine.js';
import { RESERVED_STATUSES } from '../../types/pipeline.js';

export const validateCommand = new Command('validate')
  .description('Validate all frontmatter and dependency integrity')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new KanbanDatabase();

      // Sync files into database
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

      // Load all data from repositories
      const epicRows = new EpicRepository(db).listByRepo(repoId);
      const ticketRows = new TicketRepository(db).listByRepo(repoId);
      const stageRows = new StageRepository(db).listByRepo(repoId);
      const depRows = new DependencyRepository(db).listByRepo(repoId);

      // Build the set of all known IDs
      const allIds = new Set<string>();
      for (const e of epicRows) allIds.add(e.id);
      for (const t of ticketRows) allIds.add(t.id);
      for (const s of stageRows) allIds.add(s.id);

      // Build valid status set: reserved + pipeline statuses + common statuses
      const sm = StateMachine.fromConfig(config);
      const validStatuses = new Set<string>([
        ...RESERVED_STATUSES,
        'Complete',
        'In Progress',
        'Skipped',
        ...sm.getAllStatuses(),
      ]);

      // Build dependency lookup for depends_on arrays
      const depsByFromId = new Map<string, string[]>();
      for (const d of depRows) {
        const existing = depsByFromId.get(d.from_id) || [];
        existing.push(d.to_id);
        depsByFromId.set(d.from_id, existing);
      }

      // Build stage-to-ticket lookup for ticket.stages
      const stagesByTicket = new Map<string, string[]>();
      for (const s of stageRows) {
        if (s.ticket_id) {
          const existing = stagesByTicket.get(s.ticket_id) || [];
          existing.push(s.id);
          stagesByTicket.set(s.ticket_id, existing);
        }
      }

      // Build ticket-to-epic lookup for epic.tickets
      const ticketsByEpic = new Map<string, string[]>();
      for (const t of ticketRows) {
        if (t.epic_id) {
          const existing = ticketsByEpic.get(t.epic_id) || [];
          existing.push(t.id);
          ticketsByEpic.set(t.epic_id, existing);
        }
      }

      // Map DB rows to validate logic input types
      const epics: ValidateEpicRow[] = epicRows.map((e) => ({
        id: e.id,
        title: e.title ?? '',
        status: e.status ?? 'Not Started',
        jira_key: e.jira_key,
        tickets: ticketsByEpic.get(e.id) || [],
        depends_on: depsByFromId.get(e.id) || [],
        file_path: e.file_path,
      }));

      const tickets: ValidateTicketRow[] = ticketRows.map((t) => ({
        id: t.id,
        epic_id: t.epic_id ?? '',
        title: t.title ?? '',
        status: t.status ?? 'Not Started',
        jira_key: t.jira_key,
        source: t.source ?? 'local',
        stages: stagesByTicket.get(t.id) || [],
        depends_on: depsByFromId.get(t.id) || [],
        file_path: t.file_path,
      }));

      const stages: ValidateStageRow[] = stageRows.map((s) => ({
        id: s.id,
        ticket_id: s.ticket_id ?? '',
        epic_id: s.epic_id ?? '',
        title: s.title ?? '',
        status: s.status ?? 'Not Started',
        refinement_type: s.refinement_type ?? '[]',
        worktree_branch: s.worktree_branch ?? '',
        priority: s.priority,
        due_date: s.due_date,
        session_active: s.session_active === 1,
        depends_on: depsByFromId.get(s.id) || [],
        file_path: s.file_path,
      }));

      const dependencies: ValidateDependencyRow[] = depRows.map((d) => ({
        from_id: d.from_id,
        to_id: d.to_id,
        resolved: d.resolved === 1,
      }));

      // Run work-item validation
      const workItemResult = validateWorkItems({
        epics,
        tickets,
        stages,
        dependencies,
        allIds,
        validStatuses,
      });

      // Also run pipeline validation
      const registry = new ResolverRegistry();
      registerBuiltinResolvers(registry);
      const pipelineResult = await validatePipeline(config, { registry });

      // Combine results
      const combined: ValidateOutput & { pipeline_valid: boolean } = {
        valid: workItemResult.valid && pipelineResult.valid,
        errors: [
          ...workItemResult.errors,
          ...pipelineResult.errors.map((e) => ({
            file: '.kanban-workflow.yaml',
            field: 'pipeline',
            error: e,
          })),
        ],
        warnings: [
          ...workItemResult.warnings,
          ...pipelineResult.warnings.map((w) => ({
            file: '.kanban-workflow.yaml',
            field: 'pipeline',
            warning: w,
          })),
        ],
        pipeline_valid: pipelineResult.valid,
      };

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(combined, null, indent) + '\n');
      db.close();
      process.exit(combined.valid ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
