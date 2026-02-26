import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanDatabase } from '../../src/db/database.js';

describe('session junction tables', () => {
  let db: KanbanDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-session-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Insert the minimum parent rows so FK constraints are satisfied. */
  function seedParents(): void {
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced) VALUES ('s1', 1, '/tmp/s1.md', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO tickets (id, repo_id, file_path, last_synced) VALUES ('t1', 1, '/tmp/t1.md', '2026-01-01T00:00:00Z')`
    ).run();
  }

  it('creates stage_sessions table', () => {
    const info = db.raw().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='stage_sessions'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('stage_sessions');
  });

  it('creates ticket_sessions table', () => {
    const info = db.raw().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_sessions'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('ticket_sessions');
  });

  it('enforces unique (stage_id, session_id) constraint', () => {
    seedParents();
    db.raw().prepare(
      `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at)
       VALUES ('s1', 'sess-1', 'Build', '2026-01-01T00:00:00Z')`
    ).run();

    expect(() => {
      db.raw().prepare(
        `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at)
         VALUES ('s1', 'sess-1', 'Design', '2026-01-02T00:00:00Z')`
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces unique (ticket_id, session_id) constraint', () => {
    seedParents();
    db.raw().prepare(
      `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
       VALUES ('t1', 'sess-1', 'convert', '2026-01-01T00:00:00Z')`
    ).run();

    expect(() => {
      db.raw().prepare(
        `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
         VALUES ('t1', 'sess-1', 'convert', '2026-01-02T00:00:00Z')`
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('allows multiple sessions per stage', () => {
    seedParents();
    db.raw().prepare(
      `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at)
       VALUES ('s1', 'sess-1', 'Design', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
       VALUES ('s1', 'sess-2', 'Build', '2026-01-02T00:00:00Z', 1)`
    ).run();

    const rows = db.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ? ORDER BY started_at'
    ).all('s1') as Array<{ session_id: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].session_id).toBe('sess-1');
    expect(rows[1].session_id).toBe('sess-2');
  });
});
