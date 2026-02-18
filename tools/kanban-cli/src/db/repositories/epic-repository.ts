import type { KanbanDatabase } from '../database.js';
import type { EpicRow } from './types.js';

export interface EpicUpsertData {
  id: string;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  file_path: string;
  last_synced: string;
}

/**
 * Repository for the epics table.
 */
export class EpicRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace an epic.
   */
  upsert(data: EpicUpsertData): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO epics (id, repo_id, title, status, jira_key, file_path, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.id,
        data.repo_id,
        data.title,
        data.status,
        data.jira_key,
        data.file_path,
        data.last_synced
      );
  }

  /**
   * Find an epic by id.
   */
  findById(id: string): EpicRow | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM epics WHERE id = ?')
      .get(id) as EpicRow | undefined;
    return row ?? null;
  }

  /**
   * List all epics for a repo.
   */
  listByRepo(repoId: number): EpicRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM epics WHERE repo_id = ?')
      .all(repoId) as EpicRow[];
  }
}
