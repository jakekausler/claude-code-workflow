import type { KanbanDatabase } from '../db/database.js';
import type { RepoRecord } from '../types/work-items.js';
import type { EpicRow, TicketRow, StageRow, DependencyRow } from '../db/repositories/types.js';
import type { LoadConfigOptions } from '../config/loader.js';
import type { SyncOptions, SyncResult } from '../sync/sync.js';
import type { PipelineConfig } from '../types/pipeline.js';
import { createRegistry, type RepoRegistry } from './registry.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { EpicRepository } from '../db/repositories/epic-repository.js';
import { TicketRepository } from '../db/repositories/ticket-repository.js';
import { StageRepository } from '../db/repositories/stage-repository.js';
import { DependencyRepository } from '../db/repositories/dependency-repository.js';
import { loadConfig as defaultLoadConfig } from '../config/loader.js';
import { syncRepo as defaultSyncRepo } from '../sync/sync.js';

// ── Types ────────────────────────────────────────────────────────────

export interface RepoInfo {
  repoId: number;
  repoName: string;
  repoPath: string;
}

/** Row types extended with a `repo` field identifying the source repo. */
export type EpicRowWithRepo = EpicRow & { repo: string };
export type TicketRowWithRepo = TicketRow & { repo: string };
export type StageRowWithRepo = StageRow & { repo: string };
export type DependencyRowWithRepo = DependencyRow & { repo: string };

export interface AggregatedData {
  epics: EpicRowWithRepo[];
  tickets: TicketRowWithRepo[];
  stages: StageRowWithRepo[];
  deps: DependencyRowWithRepo[];
}

/** Minimal interfaces for DI — only the methods we actually call. */
export interface RepoRepoLike {
  findByPath(repoPath: string): RepoRecord | null;
  findById(id: number): RepoRecord | null;
}

export interface EpicRepoLike {
  listByRepo(repoId: number): EpicRow[];
}

export interface TicketRepoLike {
  listByRepo(repoId: number): TicketRow[];
}

export interface StageRepoLike {
  listByRepo(repoId: number): StageRow[];
}

export interface DepRepoLike {
  listByRepo(repoId: number): DependencyRow[];
}

export interface MultiRepoDeps {
  registry: RepoRegistry;
  db: KanbanDatabase;
  loadConfig: (options?: LoadConfigOptions) => PipelineConfig;
  syncRepo: (options: SyncOptions) => SyncResult;
  /** Override individual repos for testing. */
  repoRepo: RepoRepoLike;
  epicRepo: EpicRepoLike;
  ticketRepo: TicketRepoLike;
  stageRepo: StageRepoLike;
  depRepo: DepRepoLike;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createMultiRepoHelper(deps: Partial<MultiRepoDeps> = {}) {
  const registry = deps.registry ?? createRegistry();
  const db = deps.db;
  const repoRepo: RepoRepoLike | undefined = deps.repoRepo ?? (db ? new RepoRepository(db) : undefined);
  const epicRepo: EpicRepoLike | undefined = deps.epicRepo ?? (db ? new EpicRepository(db) : undefined);
  const ticketRepo: TicketRepoLike | undefined = deps.ticketRepo ?? (db ? new TicketRepository(db) : undefined);
  const stageRepo: StageRepoLike | undefined = deps.stageRepo ?? (db ? new StageRepository(db) : undefined);
  const depRepo: DepRepoLike | undefined = deps.depRepo ?? (db ? new DependencyRepository(db) : undefined);
  const loadConfigFn = deps.loadConfig ?? defaultLoadConfig;
  const syncRepoFn = deps.syncRepo ?? defaultSyncRepo;

  /**
   * Load the registry, sync each repo, and return info for all synced repos.
   *
   * Flow:
   * 1. Call registry.loadRepos() to get registered repo entries
   * 2. For each repo: loadConfig({ repoPath }) then syncRepo({ repoPath, db, config })
   * 3. Look up each repo's ID via repoRepo.findByPath(repoPath)
   * 4. Return array of { repoId, repoName, repoPath }
   */
  function syncAllRepos(): RepoInfo[] {
    if (!repoRepo || !db) {
      throw new Error('db and repoRepo dependencies are required for syncAllRepos');
    }

    const entries = registry.loadRepos();
    const results: RepoInfo[] = [];

    for (const entry of entries) {
      const config = loadConfigFn({ repoPath: entry.path });
      syncRepoFn({ repoPath: entry.path, db, config });

      const record = repoRepo.findByPath(entry.path);
      if (record) {
        results.push({
          repoId: record.id,
          repoName: record.name,
          repoPath: record.path,
        });
      } else {
        process.stderr.write(`Warning: repo '${entry.name}' at '${entry.path}' not found in database after sync\n`);
      }
    }

    return results;
  }

  /**
   * Query all repos by ID and aggregate their epics, tickets, stages, and deps.
   * Adds a `repo` field to each row with the repo name.
   *
   * Flow:
   * 1. For each repoId, query all repositories
   * 2. Look up repo name via repoRepo.findById(repoId)
   * 3. Add `repo: repoName` field to each item
   * 4. Return aggregated { epics, tickets, stages, deps }
   */
  function loadAllRepoData(repoIds: number[]): AggregatedData {
    const allEpics: EpicRowWithRepo[] = [];
    const allTickets: TicketRowWithRepo[] = [];
    const allStages: StageRowWithRepo[] = [];
    const allDeps: DependencyRowWithRepo[] = [];

    if (!epicRepo || !ticketRepo || !stageRepo || !depRepo || !repoRepo) {
      throw new Error('Repository dependencies are required for loadAllRepoData');
    }

    for (const repoId of repoIds) {
      const record = repoRepo.findById(repoId);
      const repoName = record?.name ?? 'unknown';

      const epics = epicRepo.listByRepo(repoId);
      for (const epic of epics) {
        allEpics.push({ ...epic, repo: repoName });
      }

      const tickets = ticketRepo.listByRepo(repoId);
      for (const ticket of tickets) {
        allTickets.push({ ...ticket, repo: repoName });
      }

      const stages = stageRepo.listByRepo(repoId);
      for (const stage of stages) {
        allStages.push({ ...stage, repo: repoName });
      }

      const depRows = depRepo.listByRepo(repoId);
      for (const dep of depRows) {
        allDeps.push({ ...dep, repo: repoName });
      }
    }

    return {
      epics: allEpics,
      tickets: allTickets,
      stages: allStages,
      deps: allDeps,
    };
  }

  return { syncAllRepos, loadAllRepoData };
}
