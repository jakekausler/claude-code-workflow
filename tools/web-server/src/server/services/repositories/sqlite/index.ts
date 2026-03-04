/**
 * SQLite repository adapters.
 *
 * Each adapter wraps the corresponding kanban-cli repository class,
 * returning Promises and normalising boolean fields (0/1 → true/false).
 */

import type { KanbanDatabase } from '../../../../../../kanban-cli/dist/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
  StageSessionRepository,
  TicketSessionRepository,
} from '../../../../../../kanban-cli/dist/db/repositories/index.js';
import type {
  EpicRow as SqliteEpicRow,
  TicketRow as SqliteTicketRow,
  StageRow as SqliteStageRow,
  DependencyRow as SqliteDependencyRow,
  StageSessionRow as SqliteStageSessionRow,
  TicketSessionRow as SqliteTicketSessionRow,
} from '../../../../../../kanban-cli/dist/db/repositories/index.js';
import type { RepoRecord } from '../../../../../../kanban-cli/dist/types/work-items.js';
import type {
  IRepoRepository,
  IEpicRepository,
  ITicketRepository,
  IStageRepository,
  IDependencyRepository,
  IStageSessionRepository,
  ITicketSessionRepository,
  RepoRow,
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
  StageSessionRow,
  TicketSessionRow,
  EpicUpsertData,
  TicketUpsertData,
  StageUpsertData,
  DependencyUpsertData,
} from '../types.js';

// ── Normalisation helpers ────────────────────────────────────────────

function toBoolean(v: number | null | undefined): boolean {
  return v !== 0 && v != null;
}

function toBooleanNullable(v: number | null | undefined): boolean | null {
  if (v == null) return null;
  return v !== 0;
}

function normaliseRepo(r: RepoRecord): RepoRow {
  return { id: r.id, path: r.path, name: r.name, registered_at: r.registered_at };
}

function normaliseEpic(r: SqliteEpicRow): EpicRow {
  return { ...r };
}

function normaliseTicket(r: SqliteTicketRow): TicketRow {
  return { ...r, has_stages: toBooleanNullable(r.has_stages) };
}

function normaliseStage(r: SqliteStageRow): StageRow {
  return {
    ...r,
    session_active: toBoolean(r.session_active),
    is_draft: toBoolean(r.is_draft),
  };
}

function normaliseDependency(r: SqliteDependencyRow): DependencyRow {
  return { ...r, resolved: toBoolean(r.resolved) };
}

function normaliseStageSession(r: SqliteStageSessionRow): StageSessionRow {
  return { ...r, is_current: toBoolean(r.is_current) };
}

function normaliseTicketSession(r: SqliteTicketSessionRow): TicketSessionRow {
  return { ...r };
}

// ── Adapters ─────────────────────────────────────────────────────────

export class SqliteRepoRepository implements IRepoRepository {
  constructor(private inner: RepoRepository) {}

  async findAll(): Promise<RepoRow[]> {
    return this.inner.findAll().map(normaliseRepo);
  }

  async findById(id: number): Promise<RepoRow | null> {
    const row = this.inner.findById(id);
    return row ? normaliseRepo(row) : null;
  }

  async findByPath(repoPath: string): Promise<RepoRow | null> {
    const row = this.inner.findByPath(repoPath);
    return row ? normaliseRepo(row) : null;
  }

  async findByName(name: string): Promise<RepoRow | null> {
    const row = this.inner.findByName(name);
    return row ? normaliseRepo(row) : null;
  }

  async upsert(repoPath: string, name: string): Promise<number> {
    return this.inner.upsert(repoPath, name);
  }
}

export class SqliteEpicRepository implements IEpicRepository {
  constructor(private inner: EpicRepository) {}

  async findById(id: string): Promise<EpicRow | null> {
    const row = this.inner.findById(id);
    return row ? normaliseEpic(row) : null;
  }

  async listByRepo(repoId: number): Promise<EpicRow[]> {
    return this.inner.listByRepo(repoId).map(normaliseEpic);
  }

  async findByJiraKey(repoId: number, jiraKey: string): Promise<EpicRow | null> {
    const row = this.inner.findByJiraKey(repoId, jiraKey);
    return row ? normaliseEpic(row) : null;
  }

  async upsert(data: EpicUpsertData): Promise<void> {
    this.inner.upsert(data);
  }
}

export class SqliteTicketRepository implements ITicketRepository {
  constructor(private inner: TicketRepository) {}

  async findById(id: string): Promise<TicketRow | null> {
    const row = this.inner.findById(id);
    return row ? normaliseTicket(row) : null;
  }

  async listByRepo(repoId: number): Promise<TicketRow[]> {
    return this.inner.listByRepo(repoId).map(normaliseTicket);
  }

  async listByEpic(epicId: string, repoId?: number): Promise<TicketRow[]> {
    return this.inner.listByEpic(epicId, repoId).map(normaliseTicket);
  }

  async findByJiraKey(repoId: number, jiraKey: string): Promise<TicketRow | null> {
    const row = this.inner.findByJiraKey(repoId, jiraKey);
    return row ? normaliseTicket(row) : null;
  }

  async upsert(data: TicketUpsertData): Promise<void> {
    this.inner.upsert(data);
  }
}

export class SqliteStageRepository implements IStageRepository {
  constructor(private inner: StageRepository) {}

  async findById(id: string): Promise<StageRow | null> {
    const row = this.inner.findById(id);
    return row ? normaliseStage(row) : null;
  }

  async listByRepo(repoId: number): Promise<StageRow[]> {
    return this.inner.listByRepo(repoId).map(normaliseStage);
  }

  async listByTicket(ticketId: string, repoId?: number): Promise<StageRow[]> {
    return this.inner.listByTicket(ticketId, repoId).map(normaliseStage);
  }

  async listByColumn(repoId: number, column: string): Promise<StageRow[]> {
    return this.inner.listByColumn(repoId, column).map(normaliseStage);
  }

  async listReady(repoId: number): Promise<StageRow[]> {
    return this.inner.listReady(repoId).map(normaliseStage);
  }

  async findBySessionId(sessionId: string): Promise<StageRow | null> {
    const row = this.inner.findBySessionId(sessionId);
    return row ? normaliseStage(row) : null;
  }

  async updateSessionId(stageId: string, sessionId: string | null): Promise<void> {
    this.inner.updateSessionId(stageId, sessionId);
  }

  async upsert(data: StageUpsertData): Promise<void> {
    this.inner.upsert(data);
  }
}

export class SqliteDependencyRepository implements IDependencyRepository {
  constructor(private inner: DependencyRepository) {}

  async listByTarget(fromId: string): Promise<DependencyRow[]> {
    return this.inner.listByTarget(fromId).map(normaliseDependency);
  }

  async listBySource(toId: string): Promise<DependencyRow[]> {
    return this.inner.listBySource(toId).map(normaliseDependency);
  }

  async listByRepo(repoId: number): Promise<DependencyRow[]> {
    return this.inner.listByRepo(repoId).map(normaliseDependency);
  }

  async resolve(fromId: string, toId: string): Promise<void> {
    this.inner.resolve(fromId, toId);
  }

  async allResolved(fromId: string): Promise<boolean> {
    return this.inner.allResolved(fromId);
  }

  async upsert(data: DependencyUpsertData): Promise<void> {
    this.inner.upsert(data);
  }

  async deleteByRepo(repoId: number): Promise<void> {
    this.inner.deleteByRepo(repoId);
  }
}

export class SqliteStageSessionRepository implements IStageSessionRepository {
  constructor(private inner: StageSessionRepository) {}

  async getSessionsByStageId(stageId: string): Promise<StageSessionRow[]> {
    return this.inner.getSessionsByStageId(stageId).map(normaliseStageSession);
  }

  async addSession(stageId: string, sessionId: string, phase: string): Promise<void> {
    this.inner.addSession(stageId, sessionId, phase);
  }

  async endSession(stageId: string, sessionId: string): Promise<void> {
    this.inner.endSession(stageId, sessionId);
  }

  async getCurrentSession(stageId: string): Promise<StageSessionRow | null> {
    const row = this.inner.getCurrentSession(stageId);
    return row ? normaliseStageSession(row) : null;
  }
}

export class SqliteTicketSessionRepository implements ITicketSessionRepository {
  constructor(private inner: TicketSessionRepository) {}

  async getSessionsByTicketId(ticketId: string): Promise<TicketSessionRow[]> {
    return this.inner.getSessionsByTicketId(ticketId).map(normaliseTicketSession);
  }

  async addSession(ticketId: string, sessionId: string, sessionType: string): Promise<void> {
    this.inner.addSession(ticketId, sessionId, sessionType);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export interface SqliteRepositories {
  repos: IRepoRepository;
  epics: IEpicRepository;
  tickets: ITicketRepository;
  stages: IStageRepository;
  dependencies: IDependencyRepository;
  stageSessions: IStageSessionRepository;
  ticketSessions: ITicketSessionRepository;
}

/**
 * Build all SQLite adapter repositories from a KanbanDatabase instance.
 */
export function createSqliteRepositories(db: KanbanDatabase): SqliteRepositories {
  return {
    repos: new SqliteRepoRepository(new RepoRepository(db)),
    epics: new SqliteEpicRepository(new EpicRepository(db)),
    tickets: new SqliteTicketRepository(new TicketRepository(db)),
    stages: new SqliteStageRepository(new StageRepository(db)),
    dependencies: new SqliteDependencyRepository(new DependencyRepository(db)),
    stageSessions: new SqliteStageSessionRepository(new StageSessionRepository(db)),
    ticketSessions: new SqliteTicketSessionRepository(new TicketSessionRepository(db)),
  };
}
