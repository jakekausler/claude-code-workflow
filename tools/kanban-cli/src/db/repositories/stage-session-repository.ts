import type { KanbanDatabase } from '../database.js';
import type { StageSessionRow } from './types.js';

export class StageSessionRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /** Return all sessions for a stage, current first, then by started_at desc. */
  getSessionsByStageId(stageId: string): StageSessionRow[] {
    return this.db
      .raw()
      .prepare(
        `SELECT * FROM stage_sessions
         WHERE stage_id = ?
         ORDER BY is_current DESC, started_at DESC`
      )
      .all(stageId) as StageSessionRow[];
  }

  /** Add a new current session for a stage, ending any previous current session. */
  addSession(stageId: string, sessionId: string, phase: string): void {
    const now = new Date().toISOString();
    const txn = this.db.raw().transaction(() => {
      // Clear previous current session for this stage
      this.db
        .raw()
        .prepare(
          `UPDATE stage_sessions SET is_current = 0, ended_at = ?
           WHERE stage_id = ? AND is_current = 1`
        )
        .run(now, stageId);

      // Insert new session as current
      this.db
        .raw()
        .prepare(
          `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
           VALUES (?, ?, ?, ?, 1)`
        )
        .run(stageId, sessionId, phase, now);
    });
    txn();
  }

  /** End a specific session by setting ended_at and clearing is_current. */
  endSession(stageId: string, sessionId: string): void {
    const now = new Date().toISOString();
    this.db
      .raw()
      .prepare(
        `UPDATE stage_sessions SET is_current = 0, ended_at = ?
         WHERE stage_id = ? AND session_id = ?`
      )
      .run(now, stageId, sessionId);
  }

  /** Return the current (active) session for a stage, or null. */
  getCurrentSession(stageId: string): StageSessionRow | null {
    const row = this.db
      .raw()
      .prepare(
        'SELECT * FROM stage_sessions WHERE stage_id = ? AND is_current = 1'
      )
      .get(stageId) as StageSessionRow | undefined;
    return row ?? null;
  }
}
