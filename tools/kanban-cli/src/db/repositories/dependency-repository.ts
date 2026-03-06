import type { KanbanDatabase } from '../database.js';
import type { DependencyRow } from './types.js';

export interface DependencyUpsertData {
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  repo_id: number;
  target_repo_name?: string | null;
}

/**
 * Repository for the dependencies table.
 */
export class DependencyRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace a dependency. Uses from_id + to_id to detect duplicates.
   */
  upsert(data: DependencyUpsertData): void {
    const raw = this.db.raw();
    const targetRepoName = data.target_repo_name ?? null;

    const existing = raw
      .prepare('SELECT id FROM dependencies WHERE from_id = ? AND to_id = ?')
      .get(data.from_id, data.to_id) as { id: number } | undefined;

    if (existing) {
      raw
        .prepare(
          'UPDATE dependencies SET from_type = ?, to_type = ?, repo_id = ?, target_repo_name = ? WHERE id = ?'
        )
        .run(data.from_type, data.to_type, data.repo_id, targetRepoName, existing.id);
    } else {
      raw
        .prepare(
          `INSERT INTO dependencies (from_id, to_id, from_type, to_type, repo_id, target_repo_name)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(data.from_id, data.to_id, data.from_type, data.to_type, data.repo_id, targetRepoName);
    }
  }

  /**
   * Mark a dependency as resolved.
   */
  resolve(fromId: string, toId: string): void {
    this.db
      .raw()
      .prepare('UPDATE dependencies SET resolved = 1 WHERE from_id = ? AND to_id = ?')
      .run(fromId, toId);
  }

  /**
   * Check if all dependencies for an item are resolved.
   */
  allResolved(fromId: string): boolean {
    const row = this.db
      .raw()
      .prepare(
        'SELECT COUNT(*) as count FROM dependencies WHERE from_id = ? AND resolved = 0'
      )
      .get(fromId) as { count: number };
    return row.count === 0;
  }

  /**
   * List dependencies OF this item (items it depends on).
   */
  listByTarget(fromId: string): DependencyRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM dependencies WHERE from_id = ?')
      .all(fromId) as DependencyRow[];
  }

  /**
   * List items that depend on this item.
   */
  listBySource(toId: string): DependencyRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM dependencies WHERE to_id = ?')
      .all(toId) as DependencyRow[];
  }

  /**
   * List all dependencies for a repo.
   */
  listByRepo(repoId: number): DependencyRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM dependencies WHERE repo_id = ?')
      .all(repoId) as DependencyRow[];
  }

  /**
   * Delete all dependencies for a repo (used for re-sync).
   */
  deleteByRepo(repoId: number): void {
    this.db
      .raw()
      .prepare('DELETE FROM dependencies WHERE repo_id = ?')
      .run(repoId);
  }
}
