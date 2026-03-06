# Stage 10E: Drawer Session Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed session viewing in stage and ticket detail drawers with tabs, multi-session history dropdown, and a drawer-optimized layout.

**Architecture:** Decomposed Embedding — new `EmbeddedSessionViewer` wraps existing `ChatHistory` + `ContextAccordion` in single-column layout. New `stage_sessions`/`ticket_sessions` junction tables replace single `session_id` field. `DrawerTabs` is a reusable tab strip. Scoped Zustand store prevents state collision with the full-page session viewer.

**Tech Stack:** React 18, Zustand, React Query, Tailwind CSS, Fastify, better-sqlite3, Vitest

**Design Doc:** `docs/plans/2026-02-26-10e-drawer-session-integration-design.md`

---

## Task 1: Database Schema — Junction Tables

**Files:**
- Modify: `tools/kanban-cli/src/db/schema.ts`
- Modify: `tools/kanban-cli/src/db/repositories/types.ts`

**Step 1: Write the failing test**

Create test file `tools/kanban-cli/tests/db/session-tables.test.ts`:

```typescript
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
    db.raw().prepare(
      `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at)
       VALUES ('s1', 'sess-1', 'Build', '2026-01-01T00:00:00Z')`
    ).run();

    expect(() => {
      db.raw().prepare(
        `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at)
         VALUES ('s1', 'sess-1', 'Design', '2026-01-02T00:00:00Z')`
      ).run();
    }).toThrow();
  });

  it('enforces unique (ticket_id, session_id) constraint', () => {
    db.raw().prepare(
      `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
       VALUES ('t1', 'sess-1', 'convert', '2026-01-01T00:00:00Z')`
    ).run();

    expect(() => {
      db.raw().prepare(
        `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
         VALUES ('t1', 'sess-1', 'convert', '2026-01-02T00:00:00Z')`
      ).run();
    }).toThrow();
  });

  it('allows multiple sessions per stage', () => {
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
```

**Step 2: Run test to verify it fails**

Run: `cd tools/kanban-cli && npx vitest run tests/db/session-tables.test.ts`
Expected: FAIL — `stage_sessions` and `ticket_sessions` tables don't exist yet.

**Step 3: Add CREATE TABLE statements to schema.ts**

In `tools/kanban-cli/src/db/schema.ts`, add after `CREATE_MR_COMMENT_TRACKING_TABLE` (after line 110):

```typescript
export const CREATE_STAGE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS stage_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    TEXT NOT NULL REFERENCES stages(id),
  session_id  TEXT NOT NULL,
  phase       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  is_current  INTEGER DEFAULT 0,
  UNIQUE(stage_id, session_id)
)`;

export const CREATE_TICKET_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS ticket_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  session_id  TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'convert',
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  UNIQUE(ticket_id, session_id)
)`;

export const CREATE_STAGE_SESSIONS_STAGE_INDEX = `CREATE INDEX IF NOT EXISTS idx_stage_sessions_stage_id ON stage_sessions(stage_id)`;
export const CREATE_TICKET_SESSIONS_TICKET_INDEX = `CREATE INDEX IF NOT EXISTS idx_ticket_sessions_ticket_id ON ticket_sessions(ticket_id)`;
```

Add to `ALL_CREATE_STATEMENTS` array (before the closing `] as const`):

```typescript
  CREATE_STAGE_SESSIONS_TABLE,
  CREATE_TICKET_SESSIONS_TABLE,
  CREATE_STAGE_SESSIONS_STAGE_INDEX,
  CREATE_TICKET_SESSIONS_TICKET_INDEX,
```

Add row types to `tools/kanban-cli/src/db/repositories/types.ts`:

```typescript
export interface StageSessionRow {
  id: number;
  stage_id: string;
  session_id: string;
  phase: string;
  started_at: string;
  ended_at: string | null;
  is_current: number;
}

export interface TicketSessionRow {
  id: number;
  ticket_id: string;
  session_id: string;
  session_type: string;
  started_at: string;
  ended_at: string | null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd tools/kanban-cli && npx vitest run tests/db/session-tables.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/db/schema.ts tools/kanban-cli/src/db/repositories/types.ts tools/kanban-cli/tests/db/session-tables.test.ts
git commit -m "feat(db): add stage_sessions and ticket_sessions junction tables"
```

---

## Task 2: StageSessionRepository

**Files:**
- Create: `tools/kanban-cli/src/db/repositories/stage-session-repository.ts`
- Modify: `tools/kanban-cli/src/db/repositories/index.ts` (add export)
- Create: `tools/kanban-cli/tests/db/stage-session-repository.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
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
```

**Step 2: Run test to verify it fails**

Run: `cd tools/kanban-cli && npx vitest run tests/db/stage-session-repository.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement StageSessionRepository**

Create `tools/kanban-cli/src/db/repositories/stage-session-repository.ts`:

```typescript
import type { KanbanDatabase } from '../database.js';
import type { StageSessionRow } from './types.js';

export class StageSessionRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

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
```

Add export to `tools/kanban-cli/src/db/repositories/index.ts`:

```typescript
export { StageSessionRepository } from './stage-session-repository.js';
```

**Step 4: Run test to verify it passes**

Run: `cd tools/kanban-cli && npx vitest run tests/db/stage-session-repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/db/repositories/stage-session-repository.ts tools/kanban-cli/src/db/repositories/index.ts tools/kanban-cli/tests/db/stage-session-repository.test.ts
git commit -m "feat(db): add StageSessionRepository with CRUD operations"
```

---

## Task 3: TicketSessionRepository

**Files:**
- Create: `tools/kanban-cli/src/db/repositories/ticket-session-repository.ts`
- Modify: `tools/kanban-cli/src/db/repositories/index.ts` (add export)
- Create: `tools/kanban-cli/tests/db/ticket-session-repository.test.ts`

Follows the exact same pattern as Task 2 but simpler (no `is_current` logic).

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
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
  });

  it('returns empty array for unknown ticket', () => {
    expect(repo.getSessionsByTicketId('TICKET-UNKNOWN')).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/kanban-cli && npx vitest run tests/db/ticket-session-repository.test.ts`

**Step 3: Implement TicketSessionRepository**

Create `tools/kanban-cli/src/db/repositories/ticket-session-repository.ts`:

```typescript
import type { KanbanDatabase } from '../database.js';
import type { TicketSessionRow } from './types.js';

export class TicketSessionRepository {
  private db: KanbanDatabase;

  constructor(db: KanbanDatabase) {
    this.db = db;
  }

  getSessionsByTicketId(ticketId: string): TicketSessionRow[] {
    return this.db
      .raw()
      .prepare(
        'SELECT * FROM ticket_sessions WHERE ticket_id = ? ORDER BY started_at DESC'
      )
      .all(ticketId) as TicketSessionRow[];
  }

  addSession(ticketId: string, sessionId: string, type: string): void {
    const now = new Date().toISOString();
    this.db
      .raw()
      .prepare(
        `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(ticketId, sessionId, type, now);
  }
}
```

Add export to `tools/kanban-cli/src/db/repositories/index.ts`:

```typescript
export { TicketSessionRepository } from './ticket-session-repository.js';
```

**Step 4: Run tests**

Run: `cd tools/kanban-cli && npx vitest run tests/db/ticket-session-repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/db/repositories/ticket-session-repository.ts tools/kanban-cli/src/db/repositories/index.ts tools/kanban-cli/tests/db/ticket-session-repository.test.ts
git commit -m "feat(db): add TicketSessionRepository"
```

---

## Task 4: Wire Repositories into DataService + API Routes

**Files:**
- Modify: `tools/web-server/src/server/services/data-service.ts` (add new repos)
- Modify: `tools/web-server/src/server/routes/sessions.ts` (add new endpoints)
- Create: `tools/web-server/tests/server/session-history.test.ts`

**Step 1: Write the failing test**

Create `tools/web-server/tests/server/session-history.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('session history API', () => {
  let app: FastifyInstance;
  let db: KanbanDatabase;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-sess-hist-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
    seedDatabase(db, '/tmp/test-repo');

    app = await createServer({
      logger: false,
      isDev: true,
      claudeProjectsDir: tmpDir,
      dbPath,
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/stages/:stageId/sessions', () => {
    it('returns empty array when stage has no sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ sessions: [] });
    });

    it('returns sessions for a stage', async () => {
      // Insert a session directly into the junction table
      db.raw().prepare(
        `INSERT INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
         VALUES (?, 'sess-1', 'Build', '2026-01-01T00:00:00Z', 1)`
      ).run(SEED_IDS.STAGE_AUTH_API);

      const res = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe('sess-1');
      expect(body.sessions[0].phase).toBe('Build');
      expect(body.sessions[0].isCurrent).toBe(true);
      expect(body.sessions[0]).toHaveProperty('projectId');
    });

    it('returns 404 for unknown stage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stages/STAGE-NONEXISTENT/sessions',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/tickets/:ticketId/sessions', () => {
    it('returns empty array when ticket has no sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ sessions: [] });
    });

    it('returns sessions for a ticket', async () => {
      db.raw().prepare(
        `INSERT INTO ticket_sessions (ticket_id, session_id, session_type, started_at)
         VALUES (?, 'sess-conv', 'convert', '2026-01-01T00:00:00Z')`
      ).run(SEED_IDS.TICKET_LOGIN);

      const res = await app.inject({
        method: 'GET',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe('sess-conv');
      expect(body.sessions[0].sessionType).toBe('convert');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/server/session-history.test.ts`

**Step 3: Wire DataService and add routes**

Modify `tools/web-server/src/server/services/data-service.ts` — add imports and properties:

```typescript
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
  StageSessionRepository,
  TicketSessionRepository,
} from '../../../../kanban-cli/dist/db/repositories/index.js';

// In DataService class, add:
  readonly stageSessions: StageSessionRepository;
  readonly ticketSessions: TicketSessionRepository;

// In constructor, add:
  this.stageSessions = new StageSessionRepository(options.db);
  this.ticketSessions = new TicketSessionRepository(options.db);
```

Add routes to `tools/web-server/src/server/routes/sessions.ts` — before the `done();` call at line 209, add:

```typescript
  /**
   * GET /api/stages/:stageId/sessions
   *
   * Returns all sessions for a stage from the stage_sessions junction table.
   */
  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/sessions',
    async (request, reply) => {
      const { stageId } = request.params;

      if (!app.dataService) {
        return reply.status(503).send({ error: 'Database not initialized' });
      }

      const stage = app.dataService.stages.findById(stageId);
      if (!stage) {
        return reply.status(404).send({ error: 'Stage not found' });
      }

      const repo = app.dataService.repos.findById(stage.repo_id);
      const projectId = repo ? repo.path.replace(/\//g, '-') : null;

      const rows = app.dataService.stageSessions.getSessionsByStageId(stageId);
      const sessions = rows.map((r) => ({
        sessionId: r.session_id,
        projectId,
        phase: r.phase,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        isCurrent: r.is_current === 1,
      }));

      return { sessions };
    },
  );

  /**
   * GET /api/tickets/:ticketId/sessions
   *
   * Returns all sessions for a ticket from the ticket_sessions junction table.
   */
  app.get<{ Params: { ticketId: string } }>(
    '/api/tickets/:ticketId/sessions',
    async (request, reply) => {
      const { ticketId } = request.params;

      if (!app.dataService) {
        return reply.status(503).send({ error: 'Database not initialized' });
      }

      const ticket = app.dataService.tickets.findById(ticketId);
      if (!ticket) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }

      const rows = app.dataService.ticketSessions.getSessionsByTicketId(ticketId);
      const sessions = rows.map((r) => ({
        sessionId: r.session_id,
        sessionType: r.session_type,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      }));

      return { sessions };
    },
  );
```

**Step 4: Build kanban-cli and run tests**

Run: `cd tools/kanban-cli && npm run build && cd ../web-server && npx vitest run tests/server/session-history.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/web-server/src/server/services/data-service.ts tools/web-server/src/server/routes/sessions.ts tools/web-server/tests/server/session-history.test.ts
git commit -m "feat(api): add GET /stages/:id/sessions and /tickets/:id/sessions endpoints"
```

---

## Task 5: Client API Hooks

**Files:**
- Modify: `tools/web-server/src/client/api/hooks.ts`

**Step 1: Write the failing test**

Create `tools/web-server/tests/client/session-hooks.test.ts` — since hooks require React Query provider, test the type shape and query key:

```typescript
import { describe, it, expect } from 'vitest';

// Verify the hook exports exist (import test)
describe('session history hooks', () => {
  it('exports useStageSessionHistory', async () => {
    const mod = await import('../../src/client/api/hooks.js');
    expect(typeof mod.useStageSessionHistory).toBe('function');
  });

  it('exports useTicketSessions', async () => {
    const mod = await import('../../src/client/api/hooks.js');
    expect(typeof mod.useTicketSessions).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/client/session-hooks.test.ts`
Expected: FAIL — functions don't exist yet.

**Step 3: Add hooks to hooks.ts**

At the end of `tools/web-server/src/client/api/hooks.ts` (after `useStageSession`), add:

```typescript
// Session History (junction table) ----------------------------------------

export interface StageSessionEntry {
  sessionId: string;
  projectId: string | null;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
}

export function useStageSessionHistory(stageId: string) {
  return useQuery({
    queryKey: ['stage', stageId, 'sessions'],
    queryFn: () =>
      apiFetch<{ sessions: StageSessionEntry[] }>(
        `/stages/${stageId}/sessions`,
      ),
    enabled: !!stageId,
  });
}

export interface TicketSessionEntry {
  sessionId: string;
  sessionType: string;
  startedAt: string;
  endedAt: string | null;
}

export function useTicketSessions(ticketId: string) {
  return useQuery({
    queryKey: ['ticket', ticketId, 'sessions'],
    queryFn: () =>
      apiFetch<{ sessions: TicketSessionEntry[] }>(
        `/tickets/${ticketId}/sessions`,
      ),
    enabled: !!ticketId,
  });
}
```

**Step 4: Run test**

Run: `cd tools/web-server && npx vitest run tests/client/session-hooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/web-server/src/client/api/hooks.ts tools/web-server/tests/client/session-hooks.test.ts
git commit -m "feat(client): add useStageSessionHistory and useTicketSessions hooks"
```

---

## Task 6: DrawerTabs Component

**Files:**
- Create: `tools/web-server/src/client/components/detail/DrawerTabs.tsx`
- Create: `tools/web-server/tests/client/drawer-tabs.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';

describe('DrawerTabs', () => {
  it('exports DrawerTabs component', async () => {
    const mod = await import('../../src/client/components/detail/DrawerTabs.js');
    expect(typeof mod.DrawerTabs).toBe('function');
  });

  it('exports TabDef type (interface check via runtime props)', async () => {
    // Type-only check — if this compiles, the interface exists
    const mod = await import('../../src/client/components/detail/DrawerTabs.js');
    expect(mod.DrawerTabs).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/client/drawer-tabs.test.ts`

**Step 3: Implement DrawerTabs**

Create `tools/web-server/src/client/components/detail/DrawerTabs.tsx`:

```tsx
export interface TabDef {
  id: string;
  label: string;
  badge?: string;
  badgeVariant?: 'info' | 'success' | 'warning';
}

interface DrawerTabsProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const BADGE_COLORS = {
  info: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
} as const;

export function DrawerTabs({ tabs, activeTab, onTabChange }: DrawerTabsProps) {
  return (
    <div className="flex border-b border-slate-200 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-2 text-sm font-medium transition-colors relative ${
            activeTab === tab.id
              ? 'text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {tab.badge && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                  BADGE_COLORS[tab.badgeVariant ?? 'info']
                }`}
              >
                {tab.badge}
              </span>
            )}
          </span>
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </button>
      ))}
    </div>
  );
}
```

**Step 4: Run test**

Run: `cd tools/web-server && npx vitest run tests/client/drawer-tabs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/web-server/src/client/components/detail/DrawerTabs.tsx tools/web-server/tests/client/drawer-tabs.test.ts
git commit -m "feat(client): add reusable DrawerTabs component"
```

---

## Task 7: ContextAccordion Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/context/ContextAccordion.tsx`
- Create: `tools/web-server/tests/client/context-accordion.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';

describe('ContextAccordion', () => {
  it('exports ContextAccordion component', async () => {
    const mod = await import('../../src/client/components/chat/context/ContextAccordion.js');
    expect(typeof mod.ContextAccordion).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement ContextAccordion**

Create `tools/web-server/src/client/components/chat/context/ContextAccordion.tsx`:

Extract the section rendering from `SessionContextPanel.tsx` (lines 24-91) into collapsible accordion items. Use the same `SummaryRow`/`TokenRow` patterns but wrap each section in a `<details>` element.

```tsx
import { useState } from 'react';
import {
  Clock,
  DollarSign,
  MessageSquare,
  Wrench,
  Layers,
  Cpu,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { formatTokenCount, formatDuration, formatCost } from '../../../utils/session-formatters.js';
import type { SessionMetrics, Chunk } from '../../../types/session.js';

interface ContextAccordionProps {
  metrics: SessionMetrics;
  chunks: Chunk[];
  model?: string;
}

export function ContextAccordion({ metrics, chunks, model }: ContextAccordionProps) {
  const compactionCount = chunks.filter((c) => c.type === 'compact').length;

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <AccordionSection title="Session Summary" defaultOpen={false}>
        <div className="space-y-1.5">
          {model && <SummaryRow icon={Cpu} label="Model" value={model} />}
          <SummaryRow icon={MessageSquare} label="Turns" value={String(metrics.turnCount)} />
          <SummaryRow icon={Wrench} label="Tool Calls" value={String(metrics.toolCallCount)} />
          <SummaryRow icon={Clock} label="Duration" value={formatDuration(metrics.duration)} />
          <SummaryRow icon={DollarSign} label="Cost" value={formatCost(metrics.totalCost)} />
        </div>
      </AccordionSection>

      <AccordionSection title="Token Usage" defaultOpen={false}>
        <div className="space-y-1.5">
          <TokenRow label="Total" tokens={metrics.totalTokens} isTotal />
          <TokenRow label="Input" tokens={metrics.inputTokens} />
          <TokenRow label="Output" tokens={metrics.outputTokens} />
          {metrics.cacheReadTokens > 0 && (
            <TokenRow label="Cache Read" tokens={metrics.cacheReadTokens} />
          )}
          {metrics.cacheCreationTokens > 0 && (
            <TokenRow label="Cache Write" tokens={metrics.cacheCreationTokens} />
          )}
        </div>
      </AccordionSection>

      {compactionCount > 0 && (
        <AccordionSection title={`Compactions (${compactionCount})`} defaultOpen={false}>
          <div className="flex items-center gap-0.5">
            {chunks.map((chunk, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-sm ${
                  chunk.type === 'compact' ? 'bg-amber-400' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </AccordionSection>
      )}

      <AccordionSection title="Activity" defaultOpen={false}>
        <div className="text-xs text-slate-600 space-y-1">
          <div>{chunks.filter((c) => c.type === 'user').length} user messages</div>
          <div>{chunks.filter((c) => c.type === 'ai').length} AI responses</div>
          <div>{chunks.filter((c) => c.type === 'system').length} system events</div>
        </div>
      </AccordionSection>
    </div>
  );
}

function AccordionSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        {title}
      </button>
      {isOpen && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="w-3 h-3 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 flex-1">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

function TokenRow({
  label,
  tokens,
  isTotal = false,
}: {
  label: string;
  tokens: number;
  isTotal?: boolean;
}) {
  return (
    <div className={`flex justify-between text-xs ${isTotal ? 'font-medium text-slate-700' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTokenCount(tokens)}</span>
    </div>
  );
}
```

**Step 4: Run test**

Expected: PASS

**Step 5: Commit**

```bash
git add tools/web-server/src/client/components/chat/context/ContextAccordion.tsx tools/web-server/tests/client/context-accordion.test.ts
git commit -m "feat(client): add ContextAccordion for drawer-width session context"
```

---

## Task 8: SessionHistoryDropdown Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/SessionHistoryDropdown.tsx`
- Create: `tools/web-server/tests/client/session-history-dropdown.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';

describe('SessionHistoryDropdown', () => {
  it('exports SessionHistoryDropdown component', async () => {
    const mod = await import('../../src/client/components/chat/SessionHistoryDropdown.js');
    expect(typeof mod.SessionHistoryDropdown).toBe('function');
  });
});
```

**Step 2: Implement**

Create `tools/web-server/src/client/components/chat/SessionHistoryDropdown.tsx`:

```tsx
import { ChevronDown } from 'lucide-react';

export interface SessionHistoryEntry {
  sessionId: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
}

interface SessionHistoryDropdownProps {
  sessions: SessionHistoryEntry[];
  selectedSessionId: string;
  onSelect: (sessionId: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionHistoryDropdown({
  sessions,
  selectedSessionId,
  onSelect,
}: SessionHistoryDropdownProps) {
  if (sessions.length <= 1) return null;

  return (
    <div className="relative mb-3">
      <select
        value={selectedSessionId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
      >
        {sessions.map((s) => (
          <option key={s.sessionId} value={s.sessionId}>
            {s.phase} — {formatDate(s.startedAt)}
            {s.isCurrent ? ' (Live)' : ' (Read Only)'}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}
```

**Step 3: Run test, commit**

```bash
git add tools/web-server/src/client/components/chat/SessionHistoryDropdown.tsx tools/web-server/tests/client/session-history-dropdown.test.ts
git commit -m "feat(client): add SessionHistoryDropdown component"
```

---

## Task 9: Drawer Session Store

**Files:**
- Create: `tools/web-server/src/client/store/drawer-session-store.ts`
- Create: `tools/web-server/tests/client/drawer-session-store.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useDrawerSessionStore } from '../../src/client/store/drawer-session-store.js';

describe('drawer-session-store', () => {
  beforeEach(() => {
    useDrawerSessionStore.getState().reset();
  });

  it('defaults to details tab', () => {
    const state = useDrawerSessionStore.getState();
    expect(state.stageActiveTab).toBe('details');
    expect(state.ticketActiveTab).toBe('details');
  });

  it('setStageSession updates active session', () => {
    useDrawerSessionStore.getState().setStageSession('proj-1', 'sess-1');
    const state = useDrawerSessionStore.getState();
    expect(state.activeStageSession).toEqual({ projectId: 'proj-1', sessionId: 'sess-1' });
  });

  it('setStageActiveTab switches tab', () => {
    useDrawerSessionStore.getState().setStageActiveTab('session');
    expect(useDrawerSessionStore.getState().stageActiveTab).toBe('session');
  });

  it('reset clears everything', () => {
    useDrawerSessionStore.getState().setStageSession('p', 's');
    useDrawerSessionStore.getState().setStageActiveTab('session');
    useDrawerSessionStore.getState().reset();

    const state = useDrawerSessionStore.getState();
    expect(state.activeStageSession).toBeNull();
    expect(state.stageActiveTab).toBe('details');
  });
});
```

**Step 2: Implement**

Create `tools/web-server/src/client/store/drawer-session-store.ts`:

```typescript
import { create } from 'zustand';

interface DrawerSessionState {
  activeStageSession: { projectId: string; sessionId: string } | null;
  activeTicketSession: { projectId: string; sessionId: string } | null;
  stageActiveTab: string;
  ticketActiveTab: string;

  setStageSession: (projectId: string, sessionId: string) => void;
  setTicketSession: (projectId: string, sessionId: string) => void;
  setStageActiveTab: (tab: string) => void;
  setTicketActiveTab: (tab: string) => void;
  reset: () => void;
}

export const useDrawerSessionStore = create<DrawerSessionState>((set) => ({
  activeStageSession: null,
  activeTicketSession: null,
  stageActiveTab: 'details',
  ticketActiveTab: 'details',

  setStageSession: (projectId, sessionId) =>
    set({ activeStageSession: { projectId, sessionId } }),
  setTicketSession: (projectId, sessionId) =>
    set({ activeTicketSession: { projectId, sessionId } }),
  setStageActiveTab: (tab) => set({ stageActiveTab: tab }),
  setTicketActiveTab: (tab) => set({ ticketActiveTab: tab }),
  reset: () =>
    set({
      activeStageSession: null,
      activeTicketSession: null,
      stageActiveTab: 'details',
      ticketActiveTab: 'details',
    }),
}));
```

**Step 3: Run test, commit**

```bash
git add tools/web-server/src/client/store/drawer-session-store.ts tools/web-server/tests/client/drawer-session-store.test.ts
git commit -m "feat(client): add drawer-session-store for tab and session state"
```

---

## Task 10: EmbeddedSessionViewer Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/EmbeddedSessionViewer.tsx`
- Create: `tools/web-server/tests/client/embedded-session-viewer.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';

describe('EmbeddedSessionViewer', () => {
  it('exports EmbeddedSessionViewer component', async () => {
    const mod = await import('../../src/client/components/chat/EmbeddedSessionViewer.js');
    expect(typeof mod.EmbeddedSessionViewer).toBe('function');
  });
});
```

**Step 2: Implement**

Create `tools/web-server/src/client/components/chat/EmbeddedSessionViewer.tsx`:

```tsx
import { useMemo } from 'react';
import { Loader2, AlertCircle, Lock } from 'lucide-react';
import { ChatHistory } from './ChatHistory.js';
import { ContextAccordion } from './context/ContextAccordion.js';
import { useSessionDetail } from '../../api/hooks.js';
import { transformChunksToConversation } from '../../utils/group-transformer.js';
import { processSessionContextWithPhases } from '../../utils/context-tracker.js';

interface EmbeddedSessionViewerProps {
  projectId: string;
  sessionId: string;
  isReadOnly?: boolean;
}

export function EmbeddedSessionViewer({
  projectId,
  sessionId,
  isReadOnly = false,
}: EmbeddedSessionViewerProps) {
  const { data: session, isLoading, error } = useSessionDetail(projectId, sessionId);

  const chunks = session?.chunks ?? [];

  const model = useMemo(() => {
    if (chunks.length === 0) return undefined;
    return chunks
      .filter((c): c is Extract<typeof c, { type: 'ai' }> => c.type === 'ai')
      .flatMap((c) => c.messages)
      .find((m) => m.model)?.model;
  }, [chunks]);

  const conversation = useMemo(() => {
    if (!session) return null;
    return transformChunksToConversation(chunks, session.isOngoing, sessionId);
  }, [chunks, session, sessionId]);

  const contextResult = useMemo(() => {
    if (!conversation) return null;
    return processSessionContextWithPhases(conversation.items);
  }, [conversation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-slate-500">Loading session…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load session
      </div>
    );
  }

  const { metrics } = session;

  return (
    <div className="flex flex-col h-full">
      {/* Read-only badge */}
      {isReadOnly && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-xs text-slate-500 border-b border-slate-200">
          <Lock size={12} />
          Read-only — past session
        </div>
      )}

      {/* Context accordion — collapsed by default */}
      <ContextAccordion metrics={metrics} chunks={chunks} model={model} />

      {/* Chat history — fills remaining space */}
      <div className="flex-1 min-h-0">
        <ChatHistory
          items={conversation?.items ?? []}
          contextStats={contextResult?.statsMap}
          totalPhases={conversation?.totalPhases}
        />
      </div>
    </div>
  );
}
```

**Note:** This component currently uses the global `useSessionViewStore` via `ChatHistory`. For store scoping (so drawer and page don't share expand/collapse state), this is a known limitation. A scoped store via React context can be added as a follow-up refinement if the shared state becomes a UX problem in practice. YAGNI for now — the drawer and page are unlikely to be viewing the same session simultaneously.

**Step 3: Run test, commit**

```bash
git add tools/web-server/src/client/components/chat/EmbeddedSessionViewer.tsx tools/web-server/tests/client/embedded-session-viewer.test.ts
git commit -m "feat(client): add EmbeddedSessionViewer for drawer-width sessions"
```

---

## Task 11: Integrate Tabs into StageDetailContent

**Files:**
- Modify: `tools/web-server/src/client/components/detail/StageDetailContent.tsx`

**Step 1: Modify StageDetailContent**

This is the integration task. Replace the current flat layout with a tabbed layout. The "Details" tab contains the existing content. The "Session" tab contains the `SessionHistoryDropdown` + `EmbeddedSessionViewer`.

Changes to `StageDetailContent.tsx`:

1. Add imports for `DrawerTabs`, `EmbeddedSessionViewer`, `SessionHistoryDropdown`, `useStageSessionHistory`, `useDrawerSessionStore`
2. After the `useStage` and `useDrawerStore` calls, add:
   - `const { data: sessionData } = useStageSessionHistory(stageId);`
   - `const { stageActiveTab, setStageActiveTab, activeStageSession, setStageSession } = useDrawerSessionStore();`
3. Compute `hasSessions = (sessionData?.sessions?.length ?? 0) > 0`
4. Build tabs array: always include "Details", conditionally include "Session" with badge
5. Auto-select first session when session data loads and no session is selected yet (via `useEffect`)
6. Wrap existing `<div className="space-y-6">` content inside the "Details" tab conditional
7. Add "Session" tab content: `SessionHistoryDropdown` + `EmbeddedSessionViewer`
8. Remove the old `SessionLink` rendering at line 123-125 (replaced by the tab)
9. Keep the `SessionLink` function definition — but it's now unused, so remove it too

The resulting structure:

```tsx
export function StageDetailContent({ stageId }: StageDetailContentProps) {
  const { data: stage, isLoading, error } = useStage(stageId);
  const { open } = useDrawerStore();
  const { data: sessionData } = useStageSessionHistory(stageId);
  const {
    stageActiveTab,
    setStageActiveTab,
    activeStageSession,
    setStageSession,
  } = useDrawerSessionStore();

  const sessions = sessionData?.sessions ?? [];
  const hasSessions = sessions.length > 0;

  // Auto-select first session when data loads
  useEffect(() => {
    if (sessions.length > 0 && !activeStageSession) {
      const first = sessions[0];
      if (first.projectId) {
        setStageSession(first.projectId, first.sessionId);
      }
    }
  }, [sessions, activeStageSession, setStageSession]);

  // ... loading/error guards unchanged ...

  const tabs: TabDef[] = [{ id: 'details', label: 'Details' }];
  if (hasSessions) {
    const currentSession = sessions.find((s) => s.isCurrent);
    tabs.push({
      id: 'session',
      label: 'Session',
      badge: currentSession ? 'Live' : undefined,
      badgeVariant: 'success',
    });
  }

  return (
    <div className="h-full flex flex-col">
      {hasSessions && (
        <DrawerTabs
          tabs={tabs}
          activeTab={stageActiveTab}
          onTabChange={setStageActiveTab}
        />
      )}

      {stageActiveTab === 'details' && (
        <div className="space-y-6">
          {/* existing content: header metadata, phases, dependencies */}
        </div>
      )}

      {stageActiveTab === 'session' && activeStageSession && (
        <div className="flex-1 flex flex-col min-h-0">
          <SessionHistoryDropdown
            sessions={sessions.map((s) => ({
              sessionId: s.sessionId,
              phase: s.phase,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              isCurrent: s.isCurrent,
            }))}
            selectedSessionId={activeStageSession.sessionId}
            onSelect={(sid) => {
              const s = sessions.find((x) => x.sessionId === sid);
              if (s?.projectId) setStageSession(s.projectId, sid);
            }}
          />
          <EmbeddedSessionViewer
            projectId={activeStageSession.projectId}
            sessionId={activeStageSession.sessionId}
            isReadOnly={!sessions.find((s) => s.sessionId === activeStageSession.sessionId)?.isCurrent}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Run full test suite to verify no regressions**

Run: `cd tools/web-server && npx vitest run`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/StageDetailContent.tsx
git commit -m "feat(client): integrate session tab into StageDetailContent drawer"
```

---

## Task 12: Integrate Tabs into TicketDetailContent

**Files:**
- Modify: `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`

Same pattern as Task 11, but simpler:
- Use `useTicketSessions(ticketId)` instead of `useStageSessionHistory`
- No `SessionHistoryDropdown` needed (tickets typically have a single convert session)
- Session tab shows `EmbeddedSessionViewer` directly, always `isReadOnly={true}`
- Need to derive `projectId` — ticket sessions don't have projectId from the API. Either:
  - Add `projectId` to the ticket sessions endpoint response (preferred)
  - Or use a separate lookup

For the endpoint, modify the `GET /api/tickets/:ticketId/sessions` handler in `sessions.ts` to also derive `projectId` from the ticket's repo:

```typescript
const repo = app.dataService.repos.findById(ticket.repo_id);
const projectId = repo ? repo.path.replace(/\//g, '-') : null;

const sessions = rows.map((r) => ({
  sessionId: r.session_id,
  projectId,
  sessionType: r.session_type,
  startedAt: r.started_at,
  endedAt: r.ended_at,
}));
```

Update the `TicketSessionEntry` type in `hooks.ts` to include `projectId: string | null`.

Then integrate into `TicketDetailContent.tsx` following the same tabbed pattern.

**Commit:**

```bash
git add tools/web-server/src/client/components/detail/TicketDetailContent.tsx tools/web-server/src/server/routes/sessions.ts tools/web-server/src/client/api/hooks.ts
git commit -m "feat(client): integrate session tab into TicketDetailContent drawer"
```

---

## Task 13: Wire Drawer Reset on Close

**Files:**
- Modify: `tools/web-server/src/client/components/detail/DrawerHost.tsx`

The `useDrawerSessionStore` needs to reset when the drawer closes. Wire this up in `DrawerHost`:

```tsx
import { useDrawerSessionStore } from '../../store/drawer-session-store.js';

export function DrawerHost() {
  const { stack } = useDrawerStore();
  const resetDrawerSession = useDrawerSessionStore((s) => s.reset);

  // Reset drawer session state when drawer stack empties
  useEffect(() => {
    if (stack.length === 0) {
      resetDrawerSession();
    }
  }, [stack.length, resetDrawerSession]);

  if (stack.length === 0) return null;
  // ... rest unchanged
}
```

Add `useEffect` import if not already present.

**Commit:**

```bash
git add tools/web-server/src/client/components/detail/DrawerHost.tsx
git commit -m "feat(client): reset drawer session state on drawer close"
```

---

## Task 14: Data Migration — Existing session_id to Junction Table

**Files:**
- Modify: `tools/kanban-cli/src/db/database.ts`

Add a data migration step in `initializeTables()` that copies existing `session_id` values from `stages` into `stage_sessions`. This runs idempotently on every startup (uses `INSERT OR IGNORE`).

In `database.ts`, after the `ALTER_TABLE_MIGRATIONS` loop, add:

```typescript
// Data migration: copy existing stage.session_id into stage_sessions
try {
  this.db.exec(`
    INSERT OR IGNORE INTO stage_sessions (stage_id, session_id, phase, started_at, is_current)
    SELECT id, session_id, COALESCE(kanban_column, 'unknown'), COALESCE(last_synced, datetime('now')), 1
    FROM stages
    WHERE session_id IS NOT NULL
  `);
} catch {
  // Table might not exist yet on first run — safe to ignore
}
```

**Test:** Add a test to `tools/kanban-cli/tests/db/session-tables.test.ts`:

```typescript
it('migrates existing session_id from stages table', () => {
  // Insert a stage with session_id directly
  db.raw().prepare(
    `INSERT INTO repos (path, name, registered_at) VALUES ('/test', 'test', '2026-01-01T00:00:00Z')`
  ).run();
  db.raw().prepare(
    `INSERT INTO stages (id, repo_id, session_id, kanban_column, file_path, last_synced, session_active, priority)
     VALUES ('S1', 1, 'migrated-session', 'build', '/test/s1.md', '2026-01-01T00:00:00Z', 0, 0)`
  ).run();

  // Re-open DB to trigger migration
  db.close();
  db = new KanbanDatabase(path.join(tmpDir, 'test.db'));

  const rows = db.raw().prepare(
    'SELECT * FROM stage_sessions WHERE stage_id = ?'
  ).all('S1') as Array<{ session_id: string; phase: string }>;
  expect(rows).toHaveLength(1);
  expect(rows[0].session_id).toBe('migrated-session');
  expect(rows[0].phase).toBe('build');
});
```

**Commit:**

```bash
git add tools/kanban-cli/src/db/database.ts tools/kanban-cli/tests/db/session-tables.test.ts
git commit -m "feat(db): auto-migrate existing session_id into stage_sessions table"
```

---

## Task 15: Full Verification

**Step 1: Build kanban-cli**

Run: `cd tools/kanban-cli && npm run build`

**Step 2: Run all kanban-cli tests**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: All PASS

**Step 3: Run all web-server tests**

Run: `cd tools/web-server && npx vitest run`
Expected: All PASS

**Step 4: Run npm run verify (if available)**

Run: `npm run verify`
Expected: PASS

**Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: fixups from full verification pass"
```
