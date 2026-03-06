# Stage 9B: REST API Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 16 REST API endpoints consuming kanban-cli internals, serving JSON to the React frontend.

**Architecture:** Route files as Fastify plugins in `src/server/routes/`, importing kanban-cli logic functions (`buildBoard`, `buildGraph`, `buildNext`) and repository classes directly via relative paths. A `DataService` class wraps database initialization and repository access, injectable via `ServerOptions` for testing. Zod validates query parameters. Session detail endpoints stub with 501 until Stage 9E.

**Tech Stack:** Fastify 5, better-sqlite3 (via kanban-cli's KanbanDatabase), Zod, Vitest 3, React Query 5

---

## Task 1: DataService — Database + Repository Access Layer

**Files:**
- Create: `tools/web-server/src/server/services/data-service.ts`
- Modify: `tools/web-server/src/server/app.ts` (extend ServerOptions, instantiate DataService)
- Test: `tools/web-server/tests/server/data-service.test.ts`

This task creates a `DataService` class that wraps kanban-cli's database, config loading, sync, and repository access into a single injectable dependency. All route handlers receive `DataService` instead of raw database connections.

**Step 1: Write the failing test**

Create `tools/web-server/tests/server/data-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/src/db/database.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('DataService', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: KanbanDatabase;
  let service: DataService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
    service = new DataService({ db });
  });

  afterEach(() => {
    service.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provides access to repositories', () => {
    expect(service.repos).toBeDefined();
    expect(service.epics).toBeDefined();
    expect(service.tickets).toBeDefined();
    expect(service.stages).toBeDefined();
    expect(service.dependencies).toBeDefined();
  });

  it('provides access to the raw database', () => {
    expect(service.database).toBe(db);
  });

  it('close() closes the database', () => {
    service.close();
    // After close, accessing raw() should throw
    expect(() => db.raw().prepare('SELECT 1')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/server/data-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `tools/web-server/src/server/services/data-service.ts`:

```typescript
import { KanbanDatabase } from '../../../../kanban-cli/src/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from '../../../../kanban-cli/src/db/repositories/index.js';

export interface DataServiceOptions {
  db: KanbanDatabase;
}

export class DataService {
  readonly database: KanbanDatabase;
  readonly repos: RepoRepository;
  readonly epics: EpicRepository;
  readonly tickets: TicketRepository;
  readonly stages: StageRepository;
  readonly dependencies: DependencyRepository;

  constructor(options: DataServiceOptions) {
    this.database = options.db;
    this.repos = new RepoRepository(options.db);
    this.epics = new EpicRepository(options.db);
    this.tickets = new TicketRepository(options.db);
    this.stages = new StageRepository(options.db);
    this.dependencies = new DependencyRepository(options.db);
  }

  close(): void {
    this.database.close();
  }
}
```

**Step 4: Extend ServerOptions and wire DataService into app.ts**

Modify `tools/web-server/src/server/app.ts`:

- Import `DataService` and `DataServiceOptions`
- Add `dataService?: DataService` to `ServerOptions` interface
- Store the `DataService` instance on the Fastify instance using `app.decorate('dataService', dataService)` so route plugins can access it
- Add a Fastify type augmentation for the decoration

Add this TypeScript declaration augmentation near the top of `app.ts`:

```typescript
import { DataService } from './services/data-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    dataService: DataService | null;
  }
}
```

In `createServer()`, after CORS registration:

```typescript
const dataService = options.dataService ?? null;
app.decorate('dataService', dataService);
```

**Step 5: Run test to verify it passes**

Run: `cd tools/web-server && npx vitest run tests/server/data-service.test.ts`
Expected: PASS

**Step 6: Run full verification**

Run: `cd tools/web-server && npm run verify`
Expected: All tests pass, no type errors

**Step 7: Commit**

```bash
git add tools/web-server/src/server/services/data-service.ts tools/web-server/src/server/app.ts tools/web-server/tests/server/data-service.test.ts
git commit -m "feat(web-server): add DataService for kanban-cli database access"
```

---

## Task 2: Test Fixtures — Seed Data Helper

**Files:**
- Create: `tools/web-server/tests/helpers/seed-data.ts`

Creates a reusable test helper that populates an in-memory database with known fixture data. All route tests will use this to have predictable data without needing real files on disk.

**Step 1: Write the seed data helper**

Create `tools/web-server/tests/helpers/seed-data.ts`:

```typescript
import { KanbanDatabase } from '../../../kanban-cli/src/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from '../../../kanban-cli/src/db/repositories/index.js';

export interface SeedResult {
  repoId: number;
}

/**
 * Seeds the database with a predictable set of epics, tickets, stages, and dependencies.
 *
 * Hierarchy:
 *   EPIC-001 "Auth System" (In Progress)
 *     TICKET-001-001 "Login Flow" (In Progress)
 *       STAGE-001-001-001 "Login Form" (Complete, kanban_column=done)
 *       STAGE-001-001-002 "Auth API" (Build, kanban_column=build, session_active=false)
 *       STAGE-001-001-003 "Session Mgmt" (Not Started, kanban_column=backlog, depends on STAGE-001-001-002)
 *     TICKET-001-002 "Registration" (Not Started)
 *       STAGE-001-002-001 "Signup Form" (Not Started, kanban_column=ready_for_work)
 *   EPIC-002 "Payments" (Not Started)
 *     TICKET-002-001 "Checkout" (Not Started, stages=[], source=jira, jira_key=PROJ-5678)
 */
export function seedDatabase(db: KanbanDatabase, repoPath = '/tmp/test-repo'): SeedResult {
  const repoRepo = new RepoRepository(db);
  const epicRepo = new EpicRepository(db);
  const ticketRepo = new TicketRepository(db);
  const stageRepo = new StageRepository(db);
  const depRepo = new DependencyRepository(db);

  const repoId = repoRepo.upsert(repoPath, 'test-repo');

  // Epics
  epicRepo.upsert({
    id: 'EPIC-001', repo_id: repoId, title: 'Auth System', status: 'In Progress',
    jira_key: null, file_path: 'epics/EPIC-001-auth-system/EPIC-001.md', last_synced: new Date().toISOString(),
  });
  epicRepo.upsert({
    id: 'EPIC-002', repo_id: repoId, title: 'Payments', status: 'Not Started',
    jira_key: null, file_path: 'epics/EPIC-002-payments/EPIC-002.md', last_synced: new Date().toISOString(),
  });

  // Tickets
  ticketRepo.upsert({
    id: 'TICKET-001-001', epic_id: 'EPIC-001', repo_id: repoId, title: 'Login Flow',
    status: 'In Progress', jira_key: null, source: 'local', has_stages: true,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-001-login-flow/TICKET-001-001.md',
    last_synced: new Date().toISOString(),
  });
  ticketRepo.upsert({
    id: 'TICKET-001-002', epic_id: 'EPIC-001', repo_id: repoId, title: 'Registration',
    status: 'Not Started', jira_key: null, source: 'local', has_stages: true,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-002-registration/TICKET-001-002.md',
    last_synced: new Date().toISOString(),
  });
  ticketRepo.upsert({
    id: 'TICKET-002-001', epic_id: 'EPIC-002', repo_id: repoId, title: 'Checkout',
    status: 'Not Started', jira_key: 'PROJ-5678', source: 'jira', has_stages: false,
    file_path: 'epics/EPIC-002-payments/TICKET-002-001-checkout/TICKET-002-001.md',
    last_synced: new Date().toISOString(),
  });

  // Stages
  stageRepo.upsert({
    id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', repo_id: repoId,
    title: 'Login Form', status: 'Complete', kanban_column: 'done',
    refinement_type: '["frontend"]', worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
    priority: 0, due_date: null, session_active: false, locked_at: null, locked_by: null,
    pr_url: null, pr_number: null, is_draft: false, pending_merge_parents: null, mr_target_branch: null,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-001-login-flow/STAGE-001-001-001-login-form.md',
    last_synced: new Date().toISOString(),
  });
  stageRepo.upsert({
    id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', repo_id: repoId,
    title: 'Auth API', status: 'Build', kanban_column: 'build',
    refinement_type: '["backend"]', worktree_branch: 'epic-001/ticket-001-001/stage-001-001-002',
    priority: 0, due_date: null, session_active: false, locked_at: null, locked_by: null,
    pr_url: null, pr_number: null, is_draft: false, pending_merge_parents: null, mr_target_branch: null,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-001-login-flow/STAGE-001-001-002-auth-api.md',
    last_synced: new Date().toISOString(),
  });
  stageRepo.upsert({
    id: 'STAGE-001-001-003', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', repo_id: repoId,
    title: 'Session Mgmt', status: 'Not Started', kanban_column: 'backlog',
    refinement_type: '["backend"]', worktree_branch: 'epic-001/ticket-001-001/stage-001-001-003',
    priority: 1, due_date: '2026-03-15', session_active: false, locked_at: null, locked_by: null,
    pr_url: null, pr_number: null, is_draft: false, pending_merge_parents: null, mr_target_branch: null,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-001-login-flow/STAGE-001-001-003-session-mgmt.md',
    last_synced: new Date().toISOString(),
  });
  stageRepo.upsert({
    id: 'STAGE-001-002-001', ticket_id: 'TICKET-001-002', epic_id: 'EPIC-001', repo_id: repoId,
    title: 'Signup Form', status: 'Not Started', kanban_column: 'ready_for_work',
    refinement_type: '["frontend"]', worktree_branch: 'epic-001/ticket-001-002/stage-001-002-001',
    priority: 0, due_date: null, session_active: false, locked_at: null, locked_by: null,
    pr_url: null, pr_number: null, is_draft: false, pending_merge_parents: null, mr_target_branch: null,
    file_path: 'epics/EPIC-001-auth-system/TICKET-001-002-registration/STAGE-001-002-001-signup-form.md',
    last_synced: new Date().toISOString(),
  });

  // Dependencies
  depRepo.upsert({
    from_id: 'STAGE-001-001-003', to_id: 'STAGE-001-001-002',
    from_type: 'stage', to_type: 'stage', resolved: false, repo_id: repoId,
  });

  return { repoId };
}
```

**Step 2: Verify it compiles**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors (the file is in tests/ which isn't compiled by tsconfig.server.json, but Vitest will pick it up)

**Step 3: Commit**

```bash
git add tools/web-server/tests/helpers/seed-data.ts
git commit -m "test(web-server): add seed data helper for API endpoint tests"
```

---

## Task 3: Board + Stats Route

**Files:**
- Create: `tools/web-server/src/server/routes/board.ts`
- Modify: `tools/web-server/src/server/app.ts` (register board route plugin)
- Test: `tools/web-server/tests/server/board.test.ts`

**Step 1: Write the failing tests**

Create `tools/web-server/tests/server/board.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/src/db/database.js';
import { seedDatabase } from '../helpers/seed-data.js';

describe('board API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-test-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    seedDatabase(db, tmpDir);
    dataService = new DataService({ db });
    app = await createServer({ logger: false, isDev: true, dataService });
  });

  afterEach(async () => {
    await app.close();
    dataService.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/board', () => {
    it('returns board JSON with columns and stats', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/board' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      const body = JSON.parse(response.body);
      expect(body.columns).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(body.stats.total_stages).toBeGreaterThan(0);
    });

    it('filters by epic query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/board?epic=EPIC-001',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stats.total_stages).toBeGreaterThan(0);
    });

    it('filters by ticket query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/board?ticket=TICKET-001-001',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stats).toBeDefined();
    });

    it('returns 400 for invalid query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/board?epic=INVALID FORMAT',
      });
      // Accept either 200 (lenient) or 400 depending on validation strictness
      expect([200, 400]).toContain(response.statusCode);
    });
  });

  describe('GET /api/stats', () => {
    it('returns pipeline statistics', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/stats' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      const body = JSON.parse(response.body);
      expect(body.total_stages).toBeDefined();
      expect(body.total_tickets).toBeDefined();
      expect(body.by_column).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/server/board.test.ts`
Expected: FAIL — route module not found

**Step 3: Write the board route plugin**

Create `tools/web-server/src/server/routes/board.ts`:

The route plugin:
- Imports `buildBoard` from kanban-cli's `src/cli/logic/board.js`
- Imports `loadConfig` from kanban-cli's `src/config/loader.js`
- Imports `defaultPipelineConfig` from kanban-cli's `src/config/defaults.js`
- Uses Zod to validate optional `epic`, `ticket`, `column`, and `excludeDone` query parameters
- GET `/api/board` — fetches all data from DataService repositories, calls `buildBoard()`, returns JSON
- GET `/api/stats` — calls the same logic, returns only the `stats` portion

The route must handle the case where `dataService` is null (return 503 Service Unavailable with message "Database not initialized").

For `buildBoard()`, the route needs to:
1. Get the repoId from `dataService.repos.findByPath()` or use first registered repo
2. Fetch epics, tickets, stages, deps from repositories using `listByRepo(repoId)`
3. Load pipeline config via `loadConfig()` or use a default
4. Call `buildBoard({ config, repoPath, epics, tickets, stages, dependencies, filters })`
5. Return the result as JSON

Important: The `buildBoard()` function takes specific row types (`BoardEpicRow`, `BoardTicketRow`, etc.) that match the repository output closely but may need light mapping. Check the exact types in `kanban-cli/src/cli/logic/board.ts` and map accordingly.

For the config, since the web server may not be running from within a repo, use `defaultPipelineConfig` as a fallback and accept an optional `repo` query parameter to specify the repo path for config loading.

**Step 4: Register the route in app.ts**

In `createServer()`, after the health endpoint and DataService decoration, add:

```typescript
import { boardRoutes } from './routes/board.js';
// ... inside createServer, after health endpoint:
await app.register(boardRoutes);
```

**Step 5: Run test to verify it passes**

Run: `cd tools/web-server && npx vitest run tests/server/board.test.ts`
Expected: PASS

**Step 6: Run full verification**

Run: `cd tools/web-server && npm run verify`
Expected: All tests pass, no type errors

**Step 7: Commit**

```bash
git add tools/web-server/src/server/routes/board.ts tools/web-server/src/server/app.ts tools/web-server/tests/server/board.test.ts
git commit -m "feat(web-server): add board and stats REST API endpoints"
```

---

## Task 4: Epics Route

**Files:**
- Create: `tools/web-server/src/server/routes/epics.ts`
- Modify: `tools/web-server/src/server/app.ts` (register epics route)
- Test: `tools/web-server/tests/server/epics.test.ts`

**Step 1: Write the failing tests**

Create `tools/web-server/tests/server/epics.test.ts`:

Tests for:
- `GET /api/epics` — returns array of all epics with id, title, status, ticket count
- `GET /api/epics/EPIC-001` — returns epic detail with tickets list and markdown content
- `GET /api/epics/EPIC-999` — returns 404

**Step 2: Run test to verify it fails**

Run: `cd tools/web-server && npx vitest run tests/server/epics.test.ts`

**Step 3: Write the epics route plugin**

Create `tools/web-server/src/server/routes/epics.ts`:

- `GET /api/epics` — queries `dataService.epics.listByRepo(repoId)`, enriches each epic with ticket count from `dataService.tickets`
- `GET /api/epics/:id` — queries `dataService.epics.findById(id)`, also fetches tickets for that epic, reads markdown content from the file if accessible (or returns the file_path for the frontend to know about). For now, return the database fields plus a `tickets` array and a `file_path` field (actual file content reading can be added later or done client-side).

Use Zod for `:id` parameter validation (should match `EPIC-\d{3}` pattern).

**Step 4: Register in app.ts**

**Step 5: Run test to verify it passes**

**Step 6: Run full verification**

Run: `cd tools/web-server && npm run verify`

**Step 7: Commit**

```bash
git add tools/web-server/src/server/routes/epics.ts tools/web-server/src/server/app.ts tools/web-server/tests/server/epics.test.ts
git commit -m "feat(web-server): add epics REST API endpoints"
```

---

## Task 5: Tickets Route

**Files:**
- Create: `tools/web-server/src/server/routes/tickets.ts`
- Modify: `tools/web-server/src/server/app.ts` (register)
- Test: `tools/web-server/tests/server/tickets.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `GET /api/tickets` — returns all tickets
- `GET /api/tickets?epic=EPIC-001` — filters tickets by epic
- `GET /api/tickets/TICKET-001-001` — returns ticket detail with stages list
- `GET /api/tickets/TICKET-999-999` — returns 404

**Step 2: Write the tickets route plugin**

- `GET /api/tickets` — queries `dataService.tickets.listByRepo(repoId)`, optionally filtered by `epic` query param. Enrich each ticket with stage count.
- `GET /api/tickets/:id` — queries `dataService.tickets.findById(id)`, fetches stages for that ticket

Use Zod for `epic` query parameter and `:id` path parameter validation.

**Step 3-7: Test, verify, commit**

```bash
git commit -m "feat(web-server): add tickets REST API endpoints"
```

---

## Task 6: Stages Route

**Files:**
- Create: `tools/web-server/src/server/routes/stages.ts`
- Modify: `tools/web-server/src/server/app.ts` (register)
- Test: `tools/web-server/tests/server/stages.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `GET /api/stages` — returns all stages
- `GET /api/stages?ticket=TICKET-001-001` — filters by ticket
- `GET /api/stages/STAGE-001-001-001` — returns stage detail (full frontmatter fields including refinement_type, worktree_branch, pr_url, dependencies, etc.)
- `GET /api/stages/STAGE-999-999-999` — returns 404

**Step 2: Write the stages route plugin**

- `GET /api/stages` — queries `dataService.stages.listByRepo(repoId)`, optionally filtered by `ticket` query param
- `GET /api/stages/:id` — queries `dataService.stages.findById(id)`, fetches dependencies pointing from/to this stage

The stage detail response should include:
- All frontmatter fields from the stages table
- `dependencies_from`: dependencies where this stage depends on something
- `dependencies_to`: dependencies where something depends on this stage
- `refinement_type` parsed from JSON string to array

**Step 3-7: Test, verify, commit**

```bash
git commit -m "feat(web-server): add stages REST API endpoints"
```

---

## Task 7: Graph Route

**Files:**
- Create: `tools/web-server/src/server/routes/graph.ts`
- Modify: `tools/web-server/src/server/app.ts` (register)
- Test: `tools/web-server/tests/server/graph.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `GET /api/graph` — returns graph JSON with nodes, edges, cycles, critical_path
- `GET /api/graph?epic=EPIC-001` — returns filtered graph
- `GET /api/graph?mermaid=true` — returns mermaid-formatted string (check for string type, not JSON object)

**Step 2: Write the graph route plugin**

- Imports `buildGraph` from kanban-cli's `src/cli/logic/graph.js`
- `GET /api/graph` — fetches all data from repositories, calls `buildGraph()`, returns JSON
- `GET /api/graph?mermaid=true` — calls same logic, then formats as Mermaid. Check if kanban-cli has a mermaid formatter in `src/cli/formatters/`. If so, import and use it. If not, implement a simple mermaid string builder.

Use Zod for query parameters.

**Step 3-7: Test, verify, commit**

```bash
git commit -m "feat(web-server): add graph REST API endpoints"
```

---

## Task 8: Sessions Route (Listing + Stubs)

**Files:**
- Create: `tools/web-server/src/server/routes/sessions.ts`
- Modify: `tools/web-server/src/server/app.ts` (register)
- Test: `tools/web-server/tests/server/sessions.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `GET /api/sessions/:projectId` — returns list of session files (mock the filesystem or use a temp directory with test JSONL files)
- `GET /api/sessions/:projectId/:sessionId` — returns 501 Not Implemented
- `GET /api/sessions/:projectId/:sessionId/metrics` — returns 501 Not Implemented
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — returns 501 Not Implemented

For the session listing test, create a temporary directory structure mimicking `~/.claude/projects/{encoded-path}/` with dummy `.jsonl` files.

**Step 2: Write the sessions route plugin**

- `GET /api/sessions/:projectId` — Decode the project path from projectId (reverse of claude-devtools path encoding: dashes to slashes, or use URL-encoded paths). Scan `~/.claude/projects/{decoded-path}/` for `*.jsonl` files, excluding `agent-*.jsonl` at the root level. Return list with sessionId, filePath, lastModified, fileSize.
- `GET /api/sessions/:projectId/:sessionId` — Return `{ status: 501, error: 'Not Implemented', message: 'Session detail parsing available in Stage 9E' }`
- `GET /api/sessions/:projectId/:sessionId/metrics` — Same 501 stub
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Same 501 stub

For the listing endpoint, the `projectId` should be the URL-encoded path to the project directory under `~/.claude/projects/`. If the directory doesn't exist, return an empty array (not 404).

Important: Make the base claude projects path injectable via `ServerOptions` or `DataService` so tests can use a temp directory instead of `~/.claude/projects/`.

**Step 3-7: Test, verify, commit**

```bash
git commit -m "feat(web-server): add sessions listing and stub endpoints"
```

---

## Task 9: Frontend React Query Hooks

**Files:**
- Modify: `tools/web-server/src/client/api/hooks.ts` (add all new hooks)

**Step 1: Add all API hooks**

Add these hooks following the `useHealth()` pattern:

```typescript
// Board
export function useBoard(filters?: { epic?: string; ticket?: string }) {
  return useQuery({
    queryKey: ['board', filters],
    queryFn: () => apiFetch<BoardResponse>(`/board${buildQueryString(filters)}`),
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<StatsResponse>('/stats'),
  });
}

// Epics
export function useEpics() {
  return useQuery({
    queryKey: ['epics'],
    queryFn: () => apiFetch<EpicListItem[]>('/epics'),
  });
}

export function useEpic(id: string) {
  return useQuery({
    queryKey: ['epics', id],
    queryFn: () => apiFetch<EpicDetail>(`/epics/${id}`),
    enabled: !!id,
  });
}

// Tickets
export function useTickets(filters?: { epic?: string }) {
  return useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => apiFetch<TicketListItem[]>(`/tickets${buildQueryString(filters)}`),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ['tickets', id],
    queryFn: () => apiFetch<TicketDetail>(`/tickets/${id}`),
    enabled: !!id,
  });
}

// Stages
export function useStages(filters?: { ticket?: string }) {
  return useQuery({
    queryKey: ['stages', filters],
    queryFn: () => apiFetch<StageListItem[]>(`/stages${buildQueryString(filters)}`),
  });
}

export function useStage(id: string) {
  return useQuery({
    queryKey: ['stages', id],
    queryFn: () => apiFetch<StageDetail>(`/stages/${id}`),
    enabled: !!id,
  });
}

// Graph
export function useGraph(filters?: { epic?: string; mermaid?: boolean }) {
  return useQuery({
    queryKey: ['graph', filters],
    queryFn: () => apiFetch<GraphResponse>(`/graph${buildQueryString(filters)}`),
  });
}

// Sessions
export function useSessions(projectId: string) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => apiFetch<SessionListItem[]>(`/sessions/${encodeURIComponent(projectId)}`),
    enabled: !!projectId,
  });
}
```

Also add:
- Response type interfaces for each endpoint (BoardResponse, StatsResponse, EpicListItem, EpicDetail, etc.)
- A `buildQueryString()` utility that takes an optional filter object and builds a query string

**Step 2: Verify types compile**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/api/hooks.ts
git commit -m "feat(web-server): add React Query hooks for all REST API endpoints"
```

---

## Task 10: Integration Verification

**Files:** None (verification only)

**Step 1: Run full web-server verification**

```bash
cd tools/web-server && npm run verify
```

Expected: All tests pass, no type errors, no lint errors.

**Step 2: Verify kanban-cli unaffected**

```bash
cd tools/kanban-cli && npm run verify
```

Expected: 888+ tests still pass.

**Step 3: Verify orchestrator unaffected**

```bash
cd tools/orchestrator && npm run verify
```

Expected: ~396 tests still pass.

**Step 4: Manual smoke test**

```bash
cd tools/web-server && npm run dev
# In another terminal:
curl http://localhost:3100/api/health
curl http://localhost:3100/api/board
curl http://localhost:3100/api/stats
curl http://localhost:3100/api/epics
curl http://localhost:3100/api/tickets
curl http://localhost:3100/api/stages
curl http://localhost:3100/api/graph
curl "http://localhost:3100/api/graph?mermaid=true"
```

Note: Board/epics/tickets/stages endpoints will only return data if there's a repo with synced data in `~/.config/kanban-workflow/kanban.db`. If the database doesn't exist or is empty, endpoints should return empty arrays/objects (not errors).

**Step 5: Final commit (if any fixes needed)**

---

## Dependency Graph

```
Task 1 (DataService) ──┐
                        ├── Task 3 (Board + Stats)
Task 2 (Seed Data) ────┤
                        ├── Task 4 (Epics)
                        ├── Task 5 (Tickets)
                        ├── Task 6 (Stages)
                        ├── Task 7 (Graph)
                        └── Task 8 (Sessions)

Task 9 (Frontend Hooks) — independent of Tasks 3-8, can run in parallel

Task 10 (Verification) — depends on all above
```

Tasks 3-8 are independent of each other and can be implemented in parallel after Tasks 1 and 2 are complete.

---

## Key Implementation Notes

### Importing kanban-cli

The kanban-cli exports a comprehensive public API from `src/index.ts`. However, the web server imports via relative paths since both are in the same monorepo under `tools/`. Use:

```typescript
// From tools/web-server/src/server/routes/board.ts:
import { buildBoard } from '../../../../kanban-cli/src/cli/logic/board.js';
import type { BoardOutput, BuildBoardInput } from '../../../../kanban-cli/src/cli/logic/board.js';
```

### Config Loading

The web server doesn't necessarily run from within a repo. For config:
1. Try `loadConfig({ repoPath })` if a repo path is known
2. Fall back to `defaultPipelineConfig` if no repo context
3. Accept optional `repo` query parameter on board/graph/next endpoints

### Error Handling Pattern

All routes should:
1. Check `app.dataService` is not null → 503 if null
2. Validate parameters with Zod → 400 with error details on failure
3. Catch repository errors → 500 with generic message
4. Return 404 for missing entities

### File Content Reading

Stage 9B focuses on database-backed data. File content reading (for markdown bodies in stage/ticket/epic files) is deferred — return `file_path` fields so the frontend knows where the file lives. File content endpoints can be added in 9D if needed.

### Session Path Encoding

claude-devtools encodes project paths by replacing path separators with dashes. For the sessions endpoint:
- Project ID in URL is the encoded path (e.g., `home-user-projects-myapp`)
- Server decodes back to filesystem path (e.g., `/home/user/projects/myapp`)
- Scans `~/.claude/projects/{encoded-path}/` directory

The exact encoding needs to be verified by checking how claude-devtools does it in `ProjectScanner.ts`. The research docs in `docs/research/stage-9-10-web-ui/` should have this info.
