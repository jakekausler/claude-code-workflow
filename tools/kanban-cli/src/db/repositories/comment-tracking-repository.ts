import type { KanbanDatabase } from '../database.js';
import type { MrCommentTrackingRow } from './types.js';

export interface CommentTrackingUpsertData {
  stageId: string;
  timestamp: string;
  count: number;
  repoId: number;
}

/**
 * Repository for the mr_comment_tracking table.
 * Tracks the last poll timestamp and unresolved comment count per stage.
 */
export class CommentTrackingRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Get tracking data for a stage. Returns null if no tracking exists.
   */
  getCommentTracking(stageId: string): MrCommentTrackingRow | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM mr_comment_tracking WHERE stage_id = ?')
      .get(stageId) as MrCommentTrackingRow | undefined;
    return row ?? null;
  }

  /**
   * Insert or update tracking data for a stage.
   */
  upsertCommentTracking(data: CommentTrackingUpsertData): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO mr_comment_tracking
         (stage_id, last_poll_timestamp, last_known_unresolved_count, repo_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(data.stageId, data.timestamp, data.count, data.repoId);
  }
}
