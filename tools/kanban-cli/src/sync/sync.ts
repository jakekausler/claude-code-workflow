import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KanbanDatabase } from '../db/database.js';
import type { PipelineConfig } from '../types/pipeline.js';
import type { Epic, Ticket, Stage } from '../types/work-items.js';
import { COMPLETE_STATUS } from '../types/pipeline.js';
import { StateMachine } from '../engine/state-machine.js';
import { computeKanbanColumn } from '../engine/kanban-columns.js';
import { discoverWorkItems } from '../parser/discovery.js';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
} from '../parser/frontmatter.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { EpicRepository } from '../db/repositories/epic-repository.js';
import { TicketRepository } from '../db/repositories/ticket-repository.js';
import { StageRepository } from '../db/repositories/stage-repository.js';
import { DependencyRepository } from '../db/repositories/dependency-repository.js';

export interface SyncOptions {
  repoPath: string;
  db: KanbanDatabase;
  config: PipelineConfig;
}

export interface SyncResult {
  epics: number;
  tickets: number;
  stages: number;
  dependencies: number;
  errors: string[];
}

/**
 * Sync all work items from the filesystem into the SQLite database.
 *
 * Process:
 * 1. Discover files in the `epics/` directory
 * 2. Parse frontmatter from each file
 * 3. Register/upsert the repo
 * 4. Upsert epics, tickets, stages into the database
 * 5. Create dependency records
 * 6. Compute kanban columns for stages (based on status + dependency resolution)
 * 7. Update stage rows with computed columns
 */
export function syncRepo(options: SyncOptions): SyncResult {
  const { repoPath, db, config } = options;
  const sm = StateMachine.fromConfig(config);
  const pipelineStatuses = sm.getAllStatuses();

  const repoRepo = new RepoRepository(db);
  const epicRepo = new EpicRepository(db);
  const ticketRepo = new TicketRepository(db);
  const stageRepo = new StageRepository(db);
  const depRepo = new DependencyRepository(db);

  const result: SyncResult = {
    epics: 0,
    tickets: 0,
    stages: 0,
    dependencies: 0,
    errors: [],
  };

  // 1. Discover files
  const files = discoverWorkItems(repoPath);
  if (files.length === 0) return result;

  // 2. Register repo
  const repoName = path.basename(repoPath);
  const repoId = repoRepo.upsert(repoPath, repoName);
  const now = new Date().toISOString();

  // 3. Parse all files, collecting data
  const parsedEpics: Epic[] = [];
  const parsedTickets: Ticket[] = [];
  const parsedStages: Stage[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.filePath, 'utf-8');
      switch (file.type) {
        case 'epic': {
          const epic = parseEpicFrontmatter(content, file.filePath);
          parsedEpics.push(epic);
          break;
        }
        case 'ticket': {
          const ticket = parseTicketFrontmatter(content, file.filePath);
          parsedTickets.push(ticket);
          break;
        }
        case 'stage': {
          const stage = parseStageFrontmatter(content, file.filePath);
          parsedStages.push(stage);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${file.filePath}: ${msg}`);
    }
  }

  // 4. Build maps for dependency resolution
  const stageStatusMap = new Map<string, string>();
  for (const stage of parsedStages) {
    stageStatusMap.set(stage.id, stage.status);
  }

  // Build ticket→stages map for resolving ticket-level dependencies
  const ticketStagesMap = new Map<string, string[]>();
  for (const stage of parsedStages) {
    const existing = ticketStagesMap.get(stage.ticket) || [];
    existing.push(stage.id);
    ticketStagesMap.set(stage.ticket, existing);
  }

  // Build epic→tickets map for resolving epic-level dependencies
  const epicTicketsMap = new Map<string, string[]>();
  for (const ticket of parsedTickets) {
    const existing = epicTicketsMap.get(ticket.epic) || [];
    existing.push(ticket.id);
    epicTicketsMap.set(ticket.epic, existing);
  }

  /**
   * Detect entity type from ID prefix.
   */
  function getEntityType(id: string): 'epic' | 'ticket' | 'stage' {
    if (id.startsWith('EPIC-')) return 'epic';
    if (id.startsWith('TICKET-')) return 'ticket';
    return 'stage';
  }

  /**
   * Check whether a dependency target is resolved:
   * - Stage: resolved when its status is Complete
   * - Ticket: resolved when ALL stages in that ticket are Complete
   * - Epic: resolved when ALL stages across ALL tickets in that epic are Complete
   */
  function isDependencyResolved(targetId: string): boolean {
    const targetType = getEntityType(targetId);

    if (targetType === 'stage') {
      return stageStatusMap.get(targetId) === COMPLETE_STATUS;
    }

    if (targetType === 'ticket') {
      const stageIds = ticketStagesMap.get(targetId) || [];
      if (stageIds.length === 0) return false; // no stages = not resolved
      return stageIds.every((sid) => stageStatusMap.get(sid) === COMPLETE_STATUS);
    }

    if (targetType === 'epic') {
      const ticketIds = epicTicketsMap.get(targetId) || [];
      if (ticketIds.length === 0) return false; // no tickets = not resolved
      return ticketIds.every((tid) => {
        const stageIds = ticketStagesMap.get(tid) || [];
        if (stageIds.length === 0) return false; // ticket with no stages = not resolved
        return stageIds.every((sid) => stageStatusMap.get(sid) === COMPLETE_STATUS);
      });
    }

    return false;
  }

  /**
   * Upsert a dependency and resolve it if the target is complete.
   */
  function upsertDependency(fromId: string, fromType: string, depId: string): void {
    const toType = getEntityType(depId);
    depRepo.upsert({
      from_id: fromId,
      to_id: depId,
      from_type: fromType,
      to_type: toType,
      repo_id: repoId,
    });
    result.dependencies++;

    if (isDependencyResolved(depId)) {
      depRepo.resolve(fromId, depId);
    }
  }

  // 5. Upsert all data into the database within a transaction
  const syncTransaction = db.raw().transaction(() => {
    // Clear old dependencies for this repo and rebuild
    depRepo.deleteByRepo(repoId);

    // Upsert epics and their dependencies
    for (const epic of parsedEpics) {
      epicRepo.upsert({
        id: epic.id,
        repo_id: repoId,
        title: epic.title,
        status: epic.status,
        jira_key: epic.jira_key,
        file_path: epic.file_path,
        last_synced: now,
      });

      for (const depId of epic.depends_on) {
        upsertDependency(epic.id, 'epic', depId);
      }
    }
    result.epics = parsedEpics.length;

    // Upsert tickets and their dependencies
    for (const ticket of parsedTickets) {
      ticketRepo.upsert({
        id: ticket.id,
        epic_id: ticket.epic,
        repo_id: repoId,
        title: ticket.title,
        status: ticket.status,
        jira_key: ticket.jira_key,
        source: ticket.source,
        has_stages: ticket.stages.length > 0 ? 1 : 0,
        file_path: ticket.file_path,
        last_synced: now,
      });

      for (const depId of ticket.depends_on) {
        upsertDependency(ticket.id, 'ticket', depId);
      }
    }
    result.tickets = parsedTickets.length;

    // Upsert stages and create dependencies
    for (const stage of parsedStages) {
      // Create dependency records (supports stage→stage, stage→ticket, stage→epic)
      for (const depId of stage.depends_on) {
        upsertDependency(stage.id, 'stage', depId);
      }

      // Compute kanban column
      const hasUnresolvedDeps = !depRepo.allResolved(stage.id);
      const kanbanColumn = computeKanbanColumn({
        status: stage.status,
        pipelineStatuses,
        hasUnresolvedDeps,
      });

      // Upsert stage
      stageRepo.upsert({
        id: stage.id,
        ticket_id: stage.ticket,
        epic_id: stage.epic,
        repo_id: repoId,
        title: stage.title,
        status: stage.status,
        kanban_column: kanbanColumn,
        refinement_type: JSON.stringify(stage.refinement_type),
        worktree_branch: stage.worktree_branch,
        pr_url: stage.pr_url,
        pr_number: stage.pr_number,
        priority: stage.priority,
        due_date: stage.due_date,
        session_active: stage.session_active ? 1 : 0,
        locked_at: null,
        locked_by: null,
        file_path: stage.file_path,
        last_synced: now,
      });
    }
    result.stages = parsedStages.length;
  });

  syncTransaction();

  return result;
}
