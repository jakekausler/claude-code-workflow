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
   * List all tickets for an epic.
   */
  listByEpic(epicId: string): TicketRow[] {
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
}
