import type { KanbanDatabase } from '../database.js';
import type { SummaryRow } from './types.js';

export interface SummaryUpsertData {
  item_id: string;
  item_type: string;
  content_hash: string;
  model: string;
  summary: string;
  repo_id: number;
}

/**
 * Repository for the summaries table.
 * Caches LLM-generated summaries keyed by (item_id, item_type, repo_id).
 */
export class SummaryRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace a summary cache entry.
   */
  upsert(data: SummaryUpsertData): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO summaries
         (item_id, item_type, content_hash, model, summary, created_at, repo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.item_id,
        data.item_type,
        data.content_hash,
        data.model,
        data.summary,
        new Date().toISOString(),
        data.repo_id
      );
  }

  /**
   * Find a cached summary by item_id, item_type, and repo_id.
   */
  findByItem(itemId: string, itemType: string, repoId: number): SummaryRow | null {
    const row = this.db
      .raw()
      .prepare(
        'SELECT * FROM summaries WHERE item_id = ? AND item_type = ? AND repo_id = ?'
      )
      .get(itemId, itemType, repoId) as SummaryRow | undefined;
    return row ?? null;
  }

  /**
   * List all cached summaries for a repo.
   */
  listByRepo(repoId: number): SummaryRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM summaries WHERE repo_id = ?')
      .all(repoId) as SummaryRow[];
  }

  /**
   * Delete all cached summaries for a repo.
   */
  deleteByRepo(repoId: number): void {
    this.db
      .raw()
      .prepare('DELETE FROM summaries WHERE repo_id = ?')
      .run(repoId);
  }

  /**
   * Delete a specific cached summary.
   */
  deleteByItem(itemId: string, itemType: string, repoId: number): void {
    this.db
      .raw()
      .prepare(
        'DELETE FROM summaries WHERE item_id = ? AND item_type = ? AND repo_id = ?'
      )
      .run(itemId, itemType, repoId);
  }
}
