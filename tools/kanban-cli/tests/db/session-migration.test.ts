import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { KanbanDatabase } from '../../src/db/database.js';
import type { StageSessionRow } from '../../src/db/repositories/types.js';

describe('session_id migration to stage_sessions', () => {
  let db: KanbanDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-migration-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates stages with session_id into stage_sessions', () => {
    // Insert a repo and a stage that has a session_id (simulating pre-migration data)
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced, session_id, kanban_column)
       VALUES ('stage-1', 1, '/tmp/s1.md', '2026-02-01T10:00:00Z', 'sess-abc', 'Build')`
    ).run();

    // Re-run migration (the constructor already ran it once; simulate re-open by executing again)
    db.raw().exec(
      `INSERT OR IGNORE INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
       SELECT id, session_id, COALESCE(kanban_column, 'unknown'), last_synced, 1
       FROM stages
       WHERE session_id IS NOT NULL`
    );

    const rows = db.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ?'
    ).all('stage-1') as StageSessionRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].stage_id).toBe('stage-1');
    expect(rows[0].session_id).toBe('sess-abc');
    expect(rows[0].phase).toBe('Build');
    expect(rows[0].started_at).toBe('2026-02-01T10:00:00Z');
    expect(rows[0].is_current).toBe(1);
  });

  it('uses "unknown" phase when kanban_column is null', () => {
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced, session_id)
       VALUES ('stage-2', 1, '/tmp/s2.md', '2026-02-01T10:00:00Z', 'sess-xyz')`
    ).run();

    // Re-run migration
    db.raw().exec(
      `INSERT OR IGNORE INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
       SELECT id, session_id, COALESCE(kanban_column, 'unknown'), last_synced, 1
       FROM stages
       WHERE session_id IS NOT NULL`
    );

    const rows = db.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ?'
    ).all('stage-2') as StageSessionRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('unknown');
  });

  it('does not migrate stages without session_id', () => {
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced)
       VALUES ('stage-no-sess', 1, '/tmp/s3.md', '2026-02-01T10:00:00Z')`
    ).run();

    const rows = db.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ?'
    ).all('stage-no-sess') as StageSessionRow[];

    expect(rows).toHaveLength(0);
  });

  it('is idempotent — running migration twice does not create duplicates', () => {
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced, session_id, kanban_column)
       VALUES ('stage-idem', 1, '/tmp/s4.md', '2026-02-01T10:00:00Z', 'sess-dup', 'Design')`
    ).run();

    const migrationSql = `INSERT OR IGNORE INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
       SELECT id, session_id, COALESCE(kanban_column, 'unknown'), last_synced, 1
       FROM stages
       WHERE session_id IS NOT NULL`;

    // Run migration twice — should not throw and should not create duplicates
    db.raw().exec(migrationSql);
    db.raw().exec(migrationSql);

    const rows = db.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ?'
    ).all('stage-idem') as StageSessionRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-dup');
    expect(rows[0].phase).toBe('Design');
  });

  it('migration runs during KanbanDatabase construction', () => {
    // Insert data into the fresh database, then re-open it
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/tmp/r', 'r', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced, session_id, kanban_column)
       VALUES ('stage-auto', 1, '/tmp/auto.md', '2026-03-01T08:00:00Z', 'sess-auto', 'Test')`
    ).run();
    // Clear stage_sessions to simulate pre-migration state
    db.raw().exec('DELETE FROM stage_sessions');

    const dbPath = path.join(tmpDir, 'test.db');
    db.close();

    // Re-open — constructor should run migration
    const db2 = new KanbanDatabase(dbPath);
    const rows = db2.raw().prepare(
      'SELECT * FROM stage_sessions WHERE stage_id = ?'
    ).all('stage-auto') as StageSessionRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-auto');
    expect(rows[0].phase).toBe('Test');
    expect(rows[0].is_current).toBe(1);
    db2.close();
  });
});
