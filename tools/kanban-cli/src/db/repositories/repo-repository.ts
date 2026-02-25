import type { KanbanDatabase } from '../database.js';
import type { RepoRecord } from '../../types/work-items.js';

/**
 * Repository for the repos table.
 */
export class RepoRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or update a repo by path. Returns the repo id.
   */
  upsert(repoPath: string, name: string): number {
    const now = new Date().toISOString();
    const raw = this.db.raw();

    const existing = raw
      .prepare('SELECT id FROM repos WHERE path = ?')
      .get(repoPath) as { id: number } | undefined;

    if (existing) {
      raw
        .prepare('UPDATE repos SET name = ? WHERE id = ?')
        .run(name, existing.id);
      return existing.id;
    }

    const result = raw
      .prepare('INSERT INTO repos (path, name, registered_at) VALUES (?, ?, ?)')
      .run(repoPath, name, now);

    return result.lastInsertRowid as number;
  }

  /**
   * Find a repo by its filesystem path.
   */
  findByPath(repoPath: string): RepoRecord | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM repos WHERE path = ?')
      .get(repoPath) as RepoRecord | undefined;
    return row ?? null;
  }

  /**
   * Find a repo by its id.
   */
  findById(id: number): RepoRecord | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM repos WHERE id = ?')
      .get(id) as RepoRecord | undefined;
    return row ?? null;
  }

  /**
   * Return all registered repos.
   */
  findAll(): RepoRecord[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM repos')
      .all() as RepoRecord[];
  }

  /**
   * Find a repo by its name (case-sensitive).
   */
  findByName(name: string): RepoRecord | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM repos WHERE name = ?')
      .get(name) as RepoRecord | undefined;
    return row ?? null;
  }
}
