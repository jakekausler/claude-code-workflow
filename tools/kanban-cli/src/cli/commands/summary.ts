import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { syncRepo } from '../../sync/sync.js';
import { buildSummary } from '../logic/summary.js';
import type { SummaryStageInput } from '../logic/summary.js';
import { writeOutput } from '../utils/output.js';

/**
 * Determine the type of a work item ID by its prefix.
 */
function getIdType(id: string): 'epic' | 'ticket' | 'stage' | 'unknown' {
  if (id.startsWith('STAGE-')) return 'stage';
  if (id.startsWith('TICKET-')) return 'ticket';
  if (id.startsWith('EPIC-')) return 'epic';
  return 'unknown';
}

export const summaryCommand = new Command('summary')
  .description('Summarize what happened for stages, tickets, or epics')
  .argument('<ids...>', 'One or more IDs (STAGE-*, TICKET-*, EPIC-*)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (ids: string[], options) => {
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
      const ticketRepo = new TicketRepository(db);
      const stageRepo = new StageRepository(db);

      // Pre-load all tickets and stages for this repo to scope queries correctly
      const allRepoTickets = ticketRepo.listByRepo(repoId);
      const allRepoStages = stageRepo.listByRepo(repoId);

      // Build lookup maps scoped to this repo
      const ticketsByEpic = new Map<string, string[]>();
      for (const t of allRepoTickets) {
        const epicId = t.epic_id ?? '';
        const existing = ticketsByEpic.get(epicId) ?? [];
        existing.push(t.id);
        ticketsByEpic.set(epicId, existing);
      }

      const stagesByTicket = new Map<string, string[]>();
      const repoStageIds = new Set<string>();
      for (const s of allRepoStages) {
        repoStageIds.add(s.id);
        const ticketId = s.ticket_id ?? '';
        const existing = stagesByTicket.get(ticketId) ?? [];
        existing.push(s.id);
        stagesByTicket.set(ticketId, existing);
      }

      // Resolve all IDs to stage rows
      const stageIds = new Set<string>();

      for (const id of ids) {
        const idType = getIdType(id);

        switch (idType) {
          case 'stage': {
            if (repoStageIds.has(id)) {
              stageIds.add(id);
            }
            break;
          }
          case 'ticket': {
            // Get all stages for this ticket within this repo
            const ticketStages = stagesByTicket.get(id) ?? [];
            for (const sId of ticketStages) {
              stageIds.add(sId);
            }
            break;
          }
          case 'epic': {
            // Get all tickets for this epic, then all stages for each ticket
            const epicTickets = ticketsByEpic.get(id) ?? [];
            for (const tId of epicTickets) {
              const ticketStages = stagesByTicket.get(tId) ?? [];
              for (const sId of ticketStages) {
                stageIds.add(sId);
              }
            }
            break;
          }
          default: {
            process.stderr.write(`Warning: Unknown ID format "${id}" — skipping\n`);
          }
        }
      }

      // Build stage inputs by reading file content
      const stages: SummaryStageInput[] = [];

      for (const stageId of stageIds) {
        const stageRow = stageRepo.findById(stageId);
        if (!stageRow) {
          process.stderr.write(`Warning: Stage ${stageId} not found in database — skipping\n`);
          continue;
        }

        // Read the actual file content for markdown body parsing
        const filePath = path.isAbsolute(stageRow.file_path)
          ? stageRow.file_path
          : path.join(repoPath, stageRow.file_path);

        let fileContent: string;
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8');
        } catch {
          process.stderr.write(`Warning: Cannot read file ${filePath} for ${stageId} — skipping\n`);
          continue;
        }

        stages.push({
          id: stageRow.id,
          title: stageRow.title ?? '',
          status: stageRow.status ?? 'Not Started',
          file_content: fileContent,
        });
      }

      const result = buildSummary({ stages });

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
