import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { KanbanDatabase } from '../../src/db/database.js';
import { StageSessionRepository } from '../../src/db/repositories/stage-session-repository.js';

describe('StageSessionRepository', () => {
  let db: KanbanDatabase;
  let repo: StageSessionRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stage-sess-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repo = new StageSessionRepository(db);

    // Insert a parent stage so FK constraint is satisfied
    db.raw().prepare(
      `INSERT INTO repos (path, name, registered_at) VALUES ('/test', 'test', '2026-01-01T00:00:00Z')`
    ).run();
    db.raw().prepare(
      `INSERT INTO stages (id, repo_id, file_path, last_synced, session_active, priority)
       VALUES ('STAGE-1', 1, '/test/stage.md', '2026-01-01T00:00:00Z', 0, 0)`
    ).run();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addSession inserts a session', () => {
    repo.addSession('STAGE-1', 'sess-abc', 'Design');
    const sessions = repo.getSessionsByStageId('STAGE-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('sess-abc');
    expect(sessions[0].phase).toBe('Design');
    expect(sessions[0].is_current).toBe(1);
    expect(sessions[0].started_at).toBeTruthy();
  });

  it('getSessionsByStageId returns current first, then by started_at desc', () => {
    repo.addSession('STAGE-1', 'sess-old', 'Design');
    repo.endSession('STAGE-1', 'sess-old');
    repo.addSession('STAGE-1', 'sess-new', 'Build');

    const sessions = repo.getSessionsByStageId('STAGE-1');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].session_id).toBe('sess-new');  // current
    expect(sessions[0].is_current).toBe(1);
    expect(sessions[1].session_id).toBe('sess-old');  // ended
    expect(sessions[1].is_current).toBe(0);
  });

  it('endSession sets ended_at and clears is_current', () => {
    repo.addSession('STAGE-1', 'sess-abc', 'Build');
    repo.endSession('STAGE-1', 'sess-abc');

    const session = repo.getCurrentSession('STAGE-1');
    expect(session).toBeNull();

    const all = repo.getSessionsByStageId('STAGE-1');
    expect(all[0].ended_at).toBeTruthy();
    expect(all[0].is_current).toBe(0);
  });

  it('getCurrentSession returns null when no current session', () => {
    expect(repo.getCurrentSession('STAGE-1')).toBeNull();
  });

  it('getCurrentSession returns the active session', () => {
    repo.addSession('STAGE-1', 'sess-live', 'Build');
    const current = repo.getCurrentSession('STAGE-1');
    expect(current?.session_id).toBe('sess-live');
  });

  it('addSession clears previous current before inserting', () => {
    repo.addSession('STAGE-1', 'sess-1', 'Design');
    repo.addSession('STAGE-1', 'sess-2', 'Build');

    const all = repo.getSessionsByStageId('STAGE-1');
    const currentOnes = all.filter((s) => s.is_current === 1);
    expect(currentOnes).toHaveLength(1);
    expect(currentOnes[0].session_id).toBe('sess-2');
  });

  it('returns empty array for unknown stage', () => {
    expect(repo.getSessionsByStageId('STAGE-UNKNOWN')).toEqual([]);
  });
});
