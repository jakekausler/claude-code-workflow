/**
 * PostgreSQL repository implementations.
 *
 * Each class implements the same interface as the SQLite adapter,
 * but issues SQL queries against a pg.Pool instead of better-sqlite3.
 * PostgreSQL returns native booleans for BOOLEAN columns, so no
 * normalisation is needed on read paths.
 */

import type { Pool } from 'pg';
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

// ── Repo ─────────────────────────────────────────────────────────────

export class PgRepoRepository implements IRepoRepository {
  constructor(private pool: Pool) {}

  async findAll(): Promise<RepoRow[]> {
    const { rows } = await this.pool.query<RepoRow>(
      'SELECT id, path, name, registered_at FROM repos ORDER BY name',
    );
    return rows;
  }

  async findById(id: number): Promise<RepoRow | null> {
    const { rows } = await this.pool.query<RepoRow>(
      'SELECT id, path, name, registered_at FROM repos WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByPath(repoPath: string): Promise<RepoRow | null> {
    const { rows } = await this.pool.query<RepoRow>(
      'SELECT id, path, name, registered_at FROM repos WHERE path = $1',
      [repoPath],
    );
    return rows[0] ?? null;
  }

  async findByName(name: string): Promise<RepoRow | null> {
    const { rows } = await this.pool.query<RepoRow>(
      'SELECT id, path, name, registered_at FROM repos WHERE name = $1',
      [name],
    );
    return rows[0] ?? null;
  }

  async upsert(repoPath: string, name: string): Promise<number> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO repos (path, name, registered_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [repoPath, name, now],
    );
    return rows[0].id;
  }
}

// ── Epic ─────────────────────────────────────────────────────────────

export class PgEpicRepository implements IEpicRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<EpicRow | null> {
    const { rows } = await this.pool.query<EpicRow>(
      'SELECT * FROM epics WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async listByRepo(repoId: number): Promise<EpicRow[]> {
    const { rows } = await this.pool.query<EpicRow>(
      'SELECT * FROM epics WHERE repo_id = $1',
      [repoId],
    );
    return rows;
  }

  async findByJiraKey(repoId: number, jiraKey: string): Promise<EpicRow | null> {
    const { rows } = await this.pool.query<EpicRow>(
      'SELECT * FROM epics WHERE jira_key = $1 AND repo_id = $2',
      [jiraKey, repoId],
    );
    return rows[0] ?? null;
  }

  async upsert(data: EpicUpsertData): Promise<void> {
    await this.pool.query(
      `INSERT INTO epics (id, repo_id, title, status, jira_key, file_path, last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         repo_id = EXCLUDED.repo_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         jira_key = EXCLUDED.jira_key,
         file_path = EXCLUDED.file_path,
         last_synced = EXCLUDED.last_synced`,
      [data.id, data.repo_id, data.title, data.status, data.jira_key, data.file_path, data.last_synced],
    );
  }
}

// ── Ticket ───────────────────────────────────────────────────────────

export class PgTicketRepository implements ITicketRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<TicketRow | null> {
    const { rows } = await this.pool.query<TicketRow>(
      'SELECT * FROM tickets WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async listByRepo(repoId: number): Promise<TicketRow[]> {
    const { rows } = await this.pool.query<TicketRow>(
      'SELECT * FROM tickets WHERE repo_id = $1',
      [repoId],
    );
    return rows;
  }

  async listByEpic(epicId: string, repoId?: number): Promise<TicketRow[]> {
    if (repoId !== undefined) {
      const { rows } = await this.pool.query<TicketRow>(
        'SELECT * FROM tickets WHERE epic_id = $1 AND repo_id = $2',
        [epicId, repoId],
      );
      return rows;
    }
    const { rows } = await this.pool.query<TicketRow>(
      'SELECT * FROM tickets WHERE epic_id = $1',
      [epicId],
    );
    return rows;
  }

  async findByJiraKey(repoId: number, jiraKey: string): Promise<TicketRow | null> {
    const { rows } = await this.pool.query<TicketRow>(
      'SELECT * FROM tickets WHERE jira_key = $1 AND repo_id = $2',
      [jiraKey, repoId],
    );
    return rows[0] ?? null;
  }

  async upsert(data: TicketUpsertData): Promise<void> {
    await this.pool.query(
      `INSERT INTO tickets (id, epic_id, repo_id, title, status, jira_key, source, source_id, has_stages, file_path, last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         epic_id = EXCLUDED.epic_id,
         repo_id = EXCLUDED.repo_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         jira_key = EXCLUDED.jira_key,
         source = EXCLUDED.source,
         source_id = EXCLUDED.source_id,
         has_stages = EXCLUDED.has_stages,
         file_path = EXCLUDED.file_path,
         last_synced = EXCLUDED.last_synced`,
      [data.id, data.epic_id, data.repo_id, data.title, data.status, data.jira_key, data.source, data.source_id, data.has_stages, data.file_path, data.last_synced],
    );
  }
}

// ── Stage ────────────────────────────────────────────────────────────

export class PgStageRepository implements IStageRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<StageRow | null> {
    const { rows } = await this.pool.query<StageRow>(
      'SELECT * FROM stages WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async listByRepo(repoId: number): Promise<StageRow[]> {
    const { rows } = await this.pool.query<StageRow>(
      'SELECT * FROM stages WHERE repo_id = $1',
      [repoId],
    );
    return rows;
  }

  async listByTicket(ticketId: string, repoId?: number): Promise<StageRow[]> {
    if (repoId !== undefined) {
      const { rows } = await this.pool.query<StageRow>(
        'SELECT * FROM stages WHERE ticket_id = $1 AND repo_id = $2',
        [ticketId, repoId],
      );
      return rows;
    }
    const { rows } = await this.pool.query<StageRow>(
      'SELECT * FROM stages WHERE ticket_id = $1',
      [ticketId],
    );
    return rows;
  }

  async listByColumn(repoId: number, column: string): Promise<StageRow[]> {
    const { rows } = await this.pool.query<StageRow>(
      'SELECT * FROM stages WHERE repo_id = $1 AND kanban_column = $2',
      [repoId, column],
    );
    return rows;
  }

  async listReady(repoId: number): Promise<StageRow[]> {
    const { rows } = await this.pool.query<StageRow>(
      `SELECT * FROM stages
       WHERE repo_id = $1
         AND session_active = false
         AND kanban_column != 'backlog'
         AND kanban_column != 'done'`,
      [repoId],
    );
    return rows;
  }

  async findBySessionId(sessionId: string): Promise<StageRow | null> {
    const { rows } = await this.pool.query<StageRow>(
      'SELECT * FROM stages WHERE session_id = $1',
      [sessionId],
    );
    return rows[0] ?? null;
  }

  async updateSessionId(stageId: string, sessionId: string | null): Promise<void> {
    await this.pool.query(
      'UPDATE stages SET session_id = $1 WHERE id = $2',
      [sessionId, stageId],
    );
  }

  async upsert(data: StageUpsertData): Promise<void> {
    await this.pool.query(
      `INSERT INTO stages
       (id, ticket_id, epic_id, repo_id, title, status, kanban_column, refinement_type,
        worktree_branch, pr_url, pr_number, priority, due_date, session_active, locked_at, locked_by,
        is_draft, pending_merge_parents, mr_target_branch, session_id, file_path, last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       ON CONFLICT (id) DO UPDATE SET
         ticket_id = EXCLUDED.ticket_id,
         epic_id = EXCLUDED.epic_id,
         repo_id = EXCLUDED.repo_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         kanban_column = EXCLUDED.kanban_column,
         refinement_type = EXCLUDED.refinement_type,
         worktree_branch = EXCLUDED.worktree_branch,
         pr_url = EXCLUDED.pr_url,
         pr_number = EXCLUDED.pr_number,
         priority = EXCLUDED.priority,
         due_date = EXCLUDED.due_date,
         session_active = EXCLUDED.session_active,
         locked_at = EXCLUDED.locked_at,
         locked_by = EXCLUDED.locked_by,
         is_draft = EXCLUDED.is_draft,
         pending_merge_parents = EXCLUDED.pending_merge_parents,
         mr_target_branch = EXCLUDED.mr_target_branch,
         session_id = EXCLUDED.session_id,
         file_path = EXCLUDED.file_path,
         last_synced = EXCLUDED.last_synced`,
      [
        data.id, data.ticket_id, data.epic_id, data.repo_id,
        data.title, data.status, data.kanban_column, data.refinement_type,
        data.worktree_branch, data.pr_url, data.pr_number, data.priority,
        data.due_date, data.session_active, data.locked_at, data.locked_by,
        data.is_draft ?? 0, data.pending_merge_parents ?? null,
        data.mr_target_branch ?? null, data.session_id ?? null,
        data.file_path, data.last_synced,
      ],
    );
  }
}

// ── Dependency ───────────────────────────────────────────────────────

export class PgDependencyRepository implements IDependencyRepository {
  constructor(private pool: Pool) {}

  async listByTarget(fromId: string): Promise<DependencyRow[]> {
    const { rows } = await this.pool.query<DependencyRow>(
      'SELECT * FROM dependencies WHERE from_id = $1',
      [fromId],
    );
    return rows;
  }

  async listBySource(toId: string): Promise<DependencyRow[]> {
    const { rows } = await this.pool.query<DependencyRow>(
      'SELECT * FROM dependencies WHERE to_id = $1',
      [toId],
    );
    return rows;
  }

  async listByRepo(repoId: number): Promise<DependencyRow[]> {
    const { rows } = await this.pool.query<DependencyRow>(
      'SELECT * FROM dependencies WHERE repo_id = $1',
      [repoId],
    );
    return rows;
  }

  async resolve(fromId: string, toId: string): Promise<void> {
    await this.pool.query(
      'UPDATE dependencies SET resolved = true WHERE from_id = $1 AND to_id = $2',
      [fromId, toId],
    );
  }

  async allResolved(fromId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM dependencies WHERE from_id = $1 AND resolved = false',
      [fromId],
    );
    return parseInt(rows[0].count, 10) === 0;
  }

  async upsert(data: DependencyUpsertData): Promise<void> {
    const targetRepoName = data.target_repo_name ?? null;
    await this.pool.query(
      `INSERT INTO dependencies (from_id, to_id, from_type, to_type, repo_id, target_repo_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (from_id, to_id) DO UPDATE SET
         from_type = EXCLUDED.from_type,
         to_type = EXCLUDED.to_type,
         repo_id = EXCLUDED.repo_id,
         target_repo_name = EXCLUDED.target_repo_name`,
      [data.from_id, data.to_id, data.from_type, data.to_type, data.repo_id, targetRepoName],
    );
  }

  async deleteByRepo(repoId: number): Promise<void> {
    await this.pool.query(
      'DELETE FROM dependencies WHERE repo_id = $1',
      [repoId],
    );
  }
}

// ── Stage Session ────────────────────────────────────────────────────

export class PgStageSessionRepository implements IStageSessionRepository {
  constructor(private pool: Pool) {}

  async getSessionsByStageId(stageId: string): Promise<StageSessionRow[]> {
    const { rows } = await this.pool.query<StageSessionRow>(
      `SELECT * FROM stage_sessions
       WHERE stage_id = $1
       ORDER BY is_current DESC, started_at DESC`,
      [stageId],
    );
    return rows;
  }

  async addSession(stageId: string, sessionId: string, phase: string): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE stage_sessions SET is_current = 0, ended_at = $1
         WHERE stage_id = $2 AND is_current = 1`,
        [now, stageId],
      );
      await client.query(
        `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
         VALUES ($1, $2, $3, $4, 1)`,
        [stageId, sessionId, phase, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async endSession(stageId: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE stage_sessions SET is_current = 0, ended_at = $1
       WHERE stage_id = $2 AND session_id = $3`,
      [now, stageId, sessionId],
    );
  }

  async getCurrentSession(stageId: string): Promise<StageSessionRow | null> {
    const { rows } = await this.pool.query<StageSessionRow>(
      'SELECT * FROM stage_sessions WHERE stage_id = $1 AND is_current = 1',
      [stageId],
    );
    return rows[0] ?? null;
  }
}

// ── Ticket Session ───────────────────────────────────────────────────

export class PgTicketSessionRepository implements ITicketSessionRepository {
  constructor(private pool: Pool) {}

  async getSessionsByTicketId(ticketId: string): Promise<TicketSessionRow[]> {
    const { rows } = await this.pool.query<TicketSessionRow>(
      'SELECT * FROM ticket_sessions WHERE ticket_id = $1 ORDER BY started_at DESC',
      [ticketId],
    );
    return rows;
  }

  async addSession(ticketId: string, sessionId: string, sessionType: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
       VALUES ($1, $2, $3, $4)`,
      [ticketId, sessionId, sessionType, now],
    );
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export interface PgRepositories {
  repos: IRepoRepository;
  epics: IEpicRepository;
  tickets: ITicketRepository;
  stages: IStageRepository;
  dependencies: IDependencyRepository;
  stageSessions: IStageSessionRepository;
  ticketSessions: ITicketSessionRepository;
}

/**
 * Build all PostgreSQL repository implementations from a connection pool.
 */
export function createPgRepositories(pool: Pool): PgRepositories {
  return {
    repos: new PgRepoRepository(pool),
    epics: new PgEpicRepository(pool),
    tickets: new PgTicketRepository(pool),
    stages: new PgStageRepository(pool),
    dependencies: new PgDependencyRepository(pool),
    stageSessions: new PgStageSessionRepository(pool),
    ticketSessions: new PgTicketSessionRepository(pool),
  };
}
