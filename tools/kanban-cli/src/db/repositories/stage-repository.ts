import type { KanbanDatabase } from '../database.js';
import type { StageRow } from './types.js';

export interface StageUpsertData {
  id: string;
  ticket_id: string | null;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  kanban_column: string | null;
  refinement_type: string | null;
  worktree_branch: string | null;
  priority: number;
  due_date: string | null;
  session_active: number;
  locked_at: string | null;
  locked_by: string | null;
  file_path: string;
  last_synced: string;
}

/**
 * Repository for the stages table.
 */
export class StageRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace a stage.
   */
  upsert(data: StageUpsertData): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO stages
         (id, ticket_id, epic_id, repo_id, title, status, kanban_column, refinement_type,
          worktree_branch, priority, due_date, session_active, locked_at, locked_by, file_path, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.id,
        data.ticket_id,
        data.epic_id,
        data.repo_id,
        data.title,
        data.status,
        data.kanban_column,
        data.refinement_type,
        data.worktree_branch,
        data.priority,
        data.due_date,
        data.session_active,
        data.locked_at,
        data.locked_by,
        data.file_path,
        data.last_synced
      );
  }

  /**
   * Find a stage by id.
   */
  findById(id: string): StageRow | null {
    const row = this.db
      .raw()
      .prepare('SELECT * FROM stages WHERE id = ?')
      .get(id) as StageRow | undefined;
    return row ?? null;
  }

  /**
   * List all stages for a repo.
   */
  listByRepo(repoId: number): StageRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM stages WHERE repo_id = ?')
      .all(repoId) as StageRow[];
  }

  /**
   * List all stages for a ticket.
   */
  listByTicket(ticketId: string): StageRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM stages WHERE ticket_id = ?')
      .all(ticketId) as StageRow[];
  }

  /**
   * List all stages in a given kanban column for a repo.
   */
  listByColumn(repoId: number, column: string): StageRow[] {
    return this.db
      .raw()
      .prepare('SELECT * FROM stages WHERE repo_id = ? AND kanban_column = ?')
      .all(repoId, column) as StageRow[];
  }

  /**
   * List stages that are ready for work: not session_active, and not in Backlog or Done columns.
   */
  listReady(repoId: number): StageRow[] {
    return this.db
      .raw()
      .prepare(
        `SELECT * FROM stages
         WHERE repo_id = ?
           AND session_active = 0
           AND kanban_column != 'Backlog'
           AND kanban_column != 'Done'`
      )
      .all(repoId) as StageRow[];
  }
}
