import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from './seed-data.js';

type CountRow = { count: number };

describe('seedDatabase', () => {
  let tmpDir: string;
  let db: KanbanDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-seed-test-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds the database with expected data', () => {
    const result = seedDatabase(db);
    expect(result.repoId).toBeGreaterThan(0);

    // Verify counts
    const epics = db.raw().prepare('SELECT COUNT(*) as count FROM epics').get() as CountRow;
    expect(epics.count).toBe(2);

    const tickets = db.raw().prepare('SELECT COUNT(*) as count FROM tickets').get() as CountRow;
    expect(tickets.count).toBe(3);

    const stages = db.raw().prepare('SELECT COUNT(*) as count FROM stages').get() as CountRow;
    expect(stages.count).toBe(4);

    const deps = db.raw().prepare('SELECT COUNT(*) as count FROM dependencies').get() as CountRow;
    expect(deps.count).toBe(1);
  });

  it('seeds correct data for specific entities', () => {
    seedDatabase(db);

    // Verify EPIC-001 has title "Auth System" and status "In Progress"
    const epic = db.raw().prepare('SELECT title, status FROM epics WHERE id = ?').get(SEED_IDS.EPIC_AUTH) as {
      title: string;
      status: string;
    };
    expect(epic.title).toBe('Auth System');
    expect(epic.status).toBe('In Progress');

    // Verify the dependency link STAGE-001-001-003 -> STAGE-001-001-002
    const dep = db
      .raw()
      .prepare('SELECT from_id, to_id FROM dependencies WHERE from_id = ?')
      .get(SEED_IDS.STAGE_SESSION_MGMT) as { from_id: string; to_id: string };
    expect(dep.from_id).toBe(SEED_IDS.STAGE_SESSION_MGMT);
    expect(dep.to_id).toBe(SEED_IDS.STAGE_AUTH_API);

    // Verify TICKET-002-001 has jira_key "PROJ-5678"
    const ticket = db.raw().prepare('SELECT jira_key FROM tickets WHERE id = ?').get(SEED_IDS.TICKET_CHECKOUT) as {
      jira_key: string;
    };
    expect(ticket.jira_key).toBe('PROJ-5678');
  });

  it('is idempotent when called twice', () => {
    seedDatabase(db);
    seedDatabase(db);

    const stages = db.raw().prepare('SELECT COUNT(*) as count FROM stages').get() as CountRow;
    expect(stages.count).toBe(4);
  });
});
