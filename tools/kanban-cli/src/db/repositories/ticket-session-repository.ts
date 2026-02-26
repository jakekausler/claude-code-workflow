import type { KanbanDatabase } from '../database.js';
import type { TicketSessionRow } from './types.js';

export class TicketSessionRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  /** Return all sessions for a ticket, ordered by started_at desc. */
  getSessionsByTicketId(ticketId: string): TicketSessionRow[] {
    return this.db
      .raw()
      .prepare(
        'SELECT * FROM ticket_sessions WHERE ticket_id = ? ORDER BY started_at DESC'
      )
      .all(ticketId) as TicketSessionRow[];
  }

  /** Add a new session for a ticket. */
  addSession(ticketId: string, sessionId: string, sessionType: string): void {
    const now = new Date().toISOString();
    this.db
      .raw()
      .prepare(
        `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(ticketId, sessionId, sessionType, now);
  }
}
