import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import type { KanbanDatabase } from '../db/database.js';
import type { PipelineConfig } from '../types/pipeline.js';
import type { Epic, Ticket, Stage, PendingMergeParent } from '../types/work-items.js';
import { COMPLETE_STATUS } from '../types/pipeline.js';
import { StateMachine } from '../engine/state-machine.js';
import { computeKanbanColumn } from '../engine/kanban-columns.js';
import { discoverWorkItems } from '../parser/discovery.js';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
} from '../parser/frontmatter.js';
import { parseDependencyRef } from '../parser/cross-repo-deps.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { EpicRepository } from '../db/repositories/epic-repository.js';
import { TicketRepository } from '../db/repositories/ticket-repository.js';
import { StageRepository } from '../db/repositories/stage-repository.js';
import { DependencyRepository } from '../db/repositories/dependency-repository.js';

/**
 * Statuses that count as "soft-resolved" for stage→stage dependencies.
 * A stage with one of these statuses has a PR open but is not yet Complete.
 */
const SOFT_RESOLVE_STATUSES = ['PR Created', 'Addressing Comments'] as const;

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
  const stageById = new Map<string, Stage>();
  for (const stage of parsedStages) {
    stageStatusMap.set(stage.id, stage.status);
    stageById.set(stage.id, stage);
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
   * Check whether a local dependency target is resolved (hard-resolution):
   * - Stage: resolved when its status is Complete
   * - Ticket: resolved when ALL stages in that ticket are Complete
   * - Epic: resolved when ALL stages across ALL tickets in that epic are Complete
   */
  function isLocalDependencyResolved(targetId: string): boolean {
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
   * Check whether a cross-repo dependency target is resolved (hard-resolution).
   * Queries the database since the target is in a different repo.
   * Returns false if the target repo or item doesn't exist in the DB.
   */
  function isCrossRepoDependencyResolved(targetRepoName: string, targetId: string): boolean {
    const targetRepo = repoRepo.findByName(targetRepoName);
    if (!targetRepo) return false;

    const targetType = getEntityType(targetId);
    const targetRepoId = targetRepo.id;

    if (targetType === 'stage') {
      const stage = stageRepo.findById(targetId);
      return stage !== null && stage.repo_id === targetRepoId && stage.status === COMPLETE_STATUS;
    }

    if (targetType === 'ticket') {
      const stages = stageRepo.listByTicket(targetId, targetRepoId);
      if (stages.length === 0) return false;
      return stages.every((s) => s.status === COMPLETE_STATUS);
    }

    if (targetType === 'epic') {
      const tickets = ticketRepo.listByEpic(targetId);
      const repoTickets = tickets.filter((t) => t.repo_id === targetRepoId);
      if (repoTickets.length === 0) return false;
      return repoTickets.every((t) => {
        const stages = stageRepo.listByTicket(t.id, targetRepoId);
        if (stages.length === 0) return false;
        return stages.every((s) => s.status === COMPLETE_STATUS);
      });
    }

    return false;
  }

  /**
   * Check whether a dependency target is resolved (hard-resolution).
   * Dispatches to local or cross-repo resolution based on the raw dep ref.
   */
  function isDependencyResolved(depRef: string): boolean {
    const parsed = parseDependencyRef(depRef);
    if (parsed.type === 'local') {
      return isLocalDependencyResolved(parsed.itemId);
    }
    return isCrossRepoDependencyResolved(parsed.repoName, parsed.itemId);
  }

  /**
   * Check whether a stage dependency target is soft-resolved.
   * Only applies to stage→stage dependencies.
   * Returns true if the target stage's status is 'PR Created' or 'Addressing Comments'.
   */
  function isStageSoftResolved(depRef: string): boolean {
    const parsed = parseDependencyRef(depRef);
    if (parsed.type === 'local') {
      const status = stageStatusMap.get(parsed.itemId);
      if (!status) return false;
      return (SOFT_RESOLVE_STATUSES as readonly string[]).includes(status);
    }
    // Cross-repo soft resolution: query the DB
    const targetRepo = repoRepo.findByName(parsed.repoName);
    if (!targetRepo) return false;
    const stage = stageRepo.findById(parsed.itemId);
    if (!stage || stage.repo_id !== targetRepo.id) return false;
    return (SOFT_RESOLVE_STATUSES as readonly string[]).includes(stage.status ?? '');
  }

  /**
   * Check whether a dependency is soft-or-hard-resolved.
   * - For stage→stage deps: returns true if hard-resolved OR soft-resolved
   * - For all other dep types (stage→ticket, stage→epic, ticket→ticket, epic→epic):
   *   returns true only if hard-resolved (Complete required)
   */
  function isDependencySoftOrHardResolved(depRef: string): boolean {
    if (isDependencyResolved(depRef)) return true;
    // Soft-resolution only applies to stage→stage deps
    const parsed = parseDependencyRef(depRef);
    const targetType = getEntityType(parsed.itemId);
    if (targetType === 'stage') {
      return isStageSoftResolved(depRef);
    }
    return false;
  }

  /**
   * Upsert a dependency and resolve it if the target is complete.
   * Parses the depRef to handle both local and cross-repo dependencies.
   */
  function upsertDependency(fromId: string, fromType: string, depRef: string): void {
    const parsed = parseDependencyRef(depRef);
    const targetId = parsed.itemId;
    const toType = getEntityType(targetId);
    const targetRepoName = parsed.type === 'cross-repo' ? parsed.repoName : null;

    depRepo.upsert({
      from_id: fromId,
      to_id: targetId,
      from_type: fromType,
      to_type: toType,
      repo_id: repoId,
      target_repo_name: targetRepoName,
    });
    result.dependencies++;

    if (isDependencyResolved(depRef)) {
      depRepo.resolve(fromId, targetId);
    }
  }

  /**
   * Update a stage's frontmatter file with pending_merge_parents and is_draft.
   * Reads the file, modifies the frontmatter, and writes it back.
   */
  function updateStageFrontmatter(
    filePath: string,
    pendingParents: PendingMergeParent[],
  ): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);

      if (pendingParents.length > 0) {
        parsed.data.pending_merge_parents = pendingParents;
        parsed.data.is_draft = true;
      } else {
        parsed.data.pending_merge_parents = [];
        parsed.data.is_draft = false;
      }

      const updated = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(filePath, updated, 'utf-8');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        result.errors.push(`Failed to update frontmatter for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
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

      // Determine if all deps are soft-or-hard-resolved for kanban column
      const allSoftOrHardResolved = stage.depends_on.length === 0 ||
        stage.depends_on.every((depId) => isDependencySoftOrHardResolved(depId));
      const hasUnresolvedDeps = !allSoftOrHardResolved;

      const kanbanColumn = computeKanbanColumn({
        status: stage.status,
        pipelineStatuses,
        hasUnresolvedDeps,
      });

      // Build pending_merge_parents for soft-unblocked stages
      const pendingParents: PendingMergeParent[] = [];
      if (allSoftOrHardResolved) {
        for (const depRef of stage.depends_on) {
          const depParsed = parseDependencyRef(depRef);
          const depType = getEntityType(depParsed.itemId);
          // Only stage→stage deps can be soft-resolved
          if (depType === 'stage' && !isDependencyResolved(depRef) && isStageSoftResolved(depRef)) {
            // For local deps, use the in-memory map; cross-repo soft parents
            // are in another repo so we skip them for pending_merge_parents
            if (depParsed.type === 'local') {
              const parentStage = stageById.get(depParsed.itemId);
              if (parentStage && parentStage.worktree_branch && parentStage.pr_url && parentStage.pr_number != null) {
                pendingParents.push({
                  stage_id: depParsed.itemId,
                  branch: parentStage.worktree_branch,
                  pr_url: parentStage.pr_url,
                  pr_number: parentStage.pr_number,
                });
              }
            }
          }
        }
      }

      // Determine is_draft: true when there are pending merge parents
      const isDraft = pendingParents.length > 0;

      // Upsert stage with pending_merge_parents and is_draft
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
        is_draft: isDraft ? 1 : 0,
        pending_merge_parents: pendingParents.length > 0 ? JSON.stringify(pendingParents) : null,
        mr_target_branch: stage.mr_target_branch,
        file_path: stage.file_path,
        last_synced: now,
      });

      // Write pending_merge_parents to the child stage's YAML frontmatter file
      updateStageFrontmatter(stage.file_path, pendingParents);
    }
    result.stages = parsedStages.length;
  });

  syncTransaction();

  return result;
}
