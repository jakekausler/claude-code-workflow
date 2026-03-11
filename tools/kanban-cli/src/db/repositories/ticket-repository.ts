import type { KanbanDatabase } from '../database.js';
import type { TicketRow } from './types.js';

export interface TicketUpsertData {
  id: string;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  source: string | null;
  has_stages: number | null;
  file_path: string;
  last_synced: string;
}

/**
 * Repository for the tickets table.
 */
export class TicketRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace a ticket.
   */
  upsert(data: TicketUpsertData): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO tickets (id, epic_id, repo_id, title, status, jira_key, source, has_stages, file_path, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.id,
        data.epic_id,
        data.repo_id,
        data.title,
        data.status,
        data.jira_key,
        data.source,
        data.has_stages,
        data.file_path,
        data.last_synced
      );
  }

  /**
   * Find a ticket by id.
   */
  findById(id: string): TicketRow | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM tickets WHERE id = ?')
      .get(id) as TicketRow | undefined;
    return row ?? null;
  }

  /**
   * List all tickets for a repo.
   */
  listByRepo(repoId: number): TicketRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM tickets WHERE repo_id = ?')
      .all(repoId) as TicketRow[];
  }

  /**
   * List all tickets for an epic, optionally scoped to a specific repo.
   */
  listByEpic(epicId: string, repoId?: number): TicketRow[] {
    if (repoId !== undefined) {
      return this.db
        .raw()
        .prepare('SELECT * FROM tickets WHERE epic_id = ? AND repo_id = ?')
        .all(epicId, repoId) as TicketRow[];
    }
    return this.db
      .raw()
      .prepare('SELECT * FROM tickets WHERE epic_id = ?')
      .all(epicId) as TicketRow[];
  }

  /**
   * Find a ticket by its Jira key within a repo.
   */
  findByJiraKey(repoId: number, jiraKey: string): TicketRow | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM tickets WHERE jira_key = ? AND repo_id = ?')
      .get(jiraKey, repoId) as TicketRow | undefined;
    return row ?? null;
  }

  /**
   * Delete a ticket by id.
   */
  deleteById(id: string): void {
    this.db.raw().prepare('DELETE FROM tickets WHERE id = ?').run(id);
  }

  /**
   * Delete all tickets for an epic, returning the deleted ticket ids.
   * Note: uses IN(...) placeholders — assumes item counts stay well below
   * SQLite's SQLITE_MAX_VARIABLE_NUMBER limit (default 999).
   */
  deleteByEpicId(epicId: string): string[] {
    const tickets = this.db
      .raw()
      .prepare('SELECT id FROM tickets WHERE epic_id = ?')
      .all(epicId) as { id: string }[];
    if (tickets.length > 0) {
      const ids = tickets.map((t) => t.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .raw()
        .prepare(`DELETE FROM tickets WHERE id IN (${placeholders})`)
        .run(...ids);
    }
    return tickets.map((t) => t.id);
  }
}
