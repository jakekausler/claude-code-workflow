import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { KanbanDatabase } from '../../src/db/database.js';
import { TicketSessionRepository } from '../../src/db/repositories/ticket-session-repository.js';

describe('TicketSessionRepository', () => {
  let db: KanbanDatabase;
  let repo: TicketSessionRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ticket-sess-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repo = new TicketSessionRepository(db);

    // Insert parent rows for FK constraints
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/test', 'test', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO tickets (id, repo_id, file_path, last_synced)
       VALUES ('TICKET-1', 1, '/test/ticket.md', '2026-01-01T00:00:00Z')`
    ).run();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addSession inserts a session', () => {
    repo.addSession('TICKET-1', 'sess-abc', 'convert');
    const sessions = repo.getSessionsByTicketId('TICKET-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('sess-abc');
    expect(sessions[0].session_type).toBe('convert');
    expect(sessions[0].started_at).toBeTruthy();
  });

  it('returns empty array for unknown ticket', () => {
    expect(repo.getSessionsByTicketId('TICKET-UNKNOWN')).toEqual([]);
  });

  it('getSessionsByTicketId returns sessions ordered by started_at desc', () => {
    db.raw().prepare(
      `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
       VALUES ('TICKET-1', 'sess-old', 'convert', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
       VALUES ('TICKET-1', 'sess-new', 'convert', '2026-01-02T00:00:00Z')`
    ).run();

    const sessions = repo.getSessionsByTicketId('TICKET-1');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].session_id).toBe('sess-new');
    expect(sessions[1].session_id).toBe('sess-old');
  });

  it('enforces unique (ticket_id, session_id) constraint', () => {
    repo.addSession('TICKET-1', 'sess-dup', 'convert');
    expect(() => {
      repo.addSession('TICKET-1', 'sess-dup', 'convert');
    }).toThrow(/UNIQUE constraint failed/);
  });
});
