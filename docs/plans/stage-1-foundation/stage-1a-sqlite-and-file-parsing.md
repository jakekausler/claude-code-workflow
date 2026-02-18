# Stage 1A: SQLite Database & File Parsing

**Goal**: Add SQLite persistence and YAML frontmatter parsing so the CLI can discover, parse, and cache work items (epics, tickets, stages) from the filesystem.

**Status**: Not Started

**Prerequisites**: Stage 0 complete (pipeline config, state machine, validators — 84 tests passing)

**New Dependencies**: `better-sqlite3`, `gray-matter`, `@types/better-sqlite3`

---

## Task 1: Add Dependencies

**Goal**: Install `better-sqlite3`, `gray-matter`, and `@types/better-sqlite3` without breaking existing tests.

### 1.1 Install packages

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm install better-sqlite3 gray-matter
npm install -D @types/better-sqlite3
```

### 1.2 Verify existing tests still pass

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

All 84 tests must pass. No code changes in this task — only `package.json` and `package-lock.json` change.

### 1.3 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 and gray-matter dependencies for Stage 1A"
```

---

## Task 2: Define Work Item Types

**Goal**: Create TypeScript interfaces for Epic, Ticket, Stage, and Dependency — the data structures parsed from YAML frontmatter and stored in SQLite.

### 2.1 Write failing test

**File**: `tests/types/work-items.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type {
  Epic,
  Ticket,
  Stage,
  Dependency,
  WorkItemType,
  RepoRecord,
} from '../../src/types/work-items.js';
import {
  SYSTEM_COLUMNS,
  type KanbanColumn,
} from '../../src/types/work-items.js';

describe('Work Item Types', () => {
  it('SYSTEM_COLUMNS contains the four fixed columns', () => {
    expect(SYSTEM_COLUMNS).toEqual([
      'To Convert',
      'Backlog',
      'Ready for Work',
      'Done',
    ]);
  });

  it('Epic interface has required fields', () => {
    const epic: Epic = {
      id: 'EPIC-001',
      title: 'User Authentication',
      status: 'In Progress',
      jira_key: null,
      tickets: ['TICKET-001-001'],
      depends_on: [],
      file_path: '/repo/epics/EPIC-001.md',
    };
    expect(epic.id).toBe('EPIC-001');
    expect(epic.tickets).toHaveLength(1);
  });

  it('Ticket interface has required fields', () => {
    const ticket: Ticket = {
      id: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Flow',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      stages: ['STAGE-001-001-001'],
      depends_on: [],
      file_path: '/repo/epics/TICKET-001-001.md',
    };
    expect(ticket.id).toBe('TICKET-001-001');
    expect(ticket.source).toBe('local');
  });

  it('Stage interface has required fields including session_active', () => {
    const stage: Stage = {
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form',
      status: 'Design',
      session_active: false,
      refinement_type: ['frontend'],
      depends_on: ['STAGE-001-001-002'],
      worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
      priority: 0,
      due_date: null,
      file_path: '/repo/epics/STAGE-001-001-001.md',
    };
    expect(stage.session_active).toBe(false);
    expect(stage.refinement_type).toContain('frontend');
  });

  it('Dependency interface has required fields', () => {
    const dep: Dependency = {
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
    };
    expect(dep.from_type).toBe('stage');
  });

  it('WorkItemType is a union of epic, ticket, stage', () => {
    const types: WorkItemType[] = ['epic', 'ticket', 'stage'];
    expect(types).toHaveLength(3);
  });

  it('KanbanColumn accepts system columns and string pipeline columns', () => {
    const col1: KanbanColumn = 'Backlog';
    const col2: KanbanColumn = 'Design';
    expect(col1).toBe('Backlog');
    expect(col2).toBe('Design');
  });

  it('RepoRecord interface has required fields', () => {
    const repo: RepoRecord = {
      id: 1,
      path: '/home/user/project',
      name: 'project',
      registered_at: '2026-01-01T00:00:00.000Z',
    };
    expect(repo.id).toBe(1);
    expect(repo.path).toBe('/home/user/project');
  });
});
```

### 2.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/types/work-items.test.ts
```

Should fail because `src/types/work-items.ts` does not exist.

### 2.3 Implement

**File**: `src/types/work-items.ts`

```typescript
/**
 * System kanban columns — structural columns that always exist.
 * Pipeline columns (from config) appear between Ready for Work and Done.
 */
export const SYSTEM_COLUMNS = [
  'To Convert',
  'Backlog',
  'Ready for Work',
  'Done',
] as const;

export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

/**
 * A kanban column is either a system column or a pipeline-defined column (string).
 */
export type KanbanColumn = SystemColumn | (string & {});

/**
 * Discriminator for work item types.
 */
export type WorkItemType = 'epic' | 'ticket' | 'stage';

/**
 * A registered repository.
 */
export interface RepoRecord {
  id: number;
  path: string;
  name: string;
  registered_at: string;
}

/**
 * An epic parsed from YAML frontmatter.
 */
export interface Epic {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  tickets: string[];
  depends_on: string[];
  file_path: string;
}

/**
 * A ticket parsed from YAML frontmatter.
 */
export interface Ticket {
  id: string;
  epic: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: 'local' | 'jira';
  stages: string[];
  depends_on: string[];
  file_path: string;
}

/**
 * A stage parsed from YAML frontmatter.
 */
export interface Stage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  status: string;
  session_active: boolean;
  refinement_type: string[];
  depends_on: string[];
  worktree_branch: string | null;
  priority: number;
  due_date: string | null;
  file_path: string;
}

/**
 * A dependency edge between work items.
 */
export interface Dependency {
  from_id: string;
  to_id: string;
  from_type: WorkItemType;
  to_type: WorkItemType;
}
```

### 2.4 Update index exports

**File**: `src/index.ts` — append these lines at the end:

```typescript
// Work Item Types
export type {
  Epic,
  Ticket,
  Stage,
  Dependency,
  WorkItemType,
  RepoRecord,
  SystemColumn,
  KanbanColumn,
} from './types/work-items.js';
export { SYSTEM_COLUMNS } from './types/work-items.js';
```

### 2.5 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

All tests (84 existing + new) must pass.

### 2.6 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/types/work-items.ts src/index.ts tests/types/work-items.test.ts
git commit -m "feat: add work item types for epic, ticket, stage, dependency"
```

---

## Task 3: Create Database Module

**Goal**: Create the SQLite database module that opens/creates the database and initializes tables.

### 3.1 Write failing test

**File**: `tests/db/database.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';

describe('KanbanDatabase', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-db-test-' + Date.now());
  let dbPath: string;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new database file at the specified path', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates the repos table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repos'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the epics table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='epics'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the tickets table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the stages table with session_active, locked_at, locked_by columns', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const columns = db.raw()
        .prepare("PRAGMA table_info(stages)")
        .all() as Array<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('session_active');
      expect(colNames).toContain('locked_at');
      expect(colNames).toContain('locked_by');
    } finally {
      db.close();
    }
  });

  it('creates the dependencies table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dependencies'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates parent directories if they do not exist', () => {
    const nestedPath = path.join(tmpDir, 'a', 'b', 'c', 'test.db');
    const db = new KanbanDatabase(nestedPath);
    try {
      expect(fs.existsSync(nestedPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('opens an existing database without re-creating tables', () => {
    const db1 = new KanbanDatabase(dbPath);
    db1.raw().prepare("INSERT INTO repos (path, name, registered_at) VALUES (?, ?, ?)").run(
      '/test', 'test', new Date().toISOString()
    );
    db1.close();

    const db2 = new KanbanDatabase(dbPath);
    try {
      const rows = db2.raw().prepare("SELECT * FROM repos").all();
      expect(rows).toHaveLength(1);
    } finally {
      db2.close();
    }
  });

  it('enables WAL mode for concurrency', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const result = db.raw().pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(result[0].journal_mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('enables foreign keys', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const result = db.raw().pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(result[0].foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });
});
```

### 3.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/db/database.test.ts
```

Should fail because `src/db/database.ts` does not exist.

### 3.3 Implement schema

**File**: `src/db/schema.ts`

```typescript
/**
 * SQL statements to create the kanban workflow tables.
 * Uses IF NOT EXISTS so it is safe to run on every open.
 */

export const CREATE_REPOS_TABLE = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL
)`;

export const CREATE_EPICS_TABLE = `
CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  jira_key TEXT,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_TICKETS_TABLE = `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  epic_id TEXT REFERENCES epics(id),
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  jira_key TEXT,
  source TEXT,
  has_stages BOOLEAN,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_STAGES_TABLE = `
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES tickets(id),
  epic_id TEXT REFERENCES epics(id),
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  kanban_column TEXT,
  refinement_type TEXT,
  worktree_branch TEXT,
  priority INTEGER DEFAULT 0,
  due_date TEXT,
  session_active BOOLEAN DEFAULT 0,
  locked_at TEXT,
  locked_by TEXT,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_DEPENDENCIES_TABLE = `
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  to_type TEXT NOT NULL,
  resolved BOOLEAN DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id)
)`;

export const ALL_CREATE_STATEMENTS = [
  CREATE_REPOS_TABLE,
  CREATE_EPICS_TABLE,
  CREATE_TICKETS_TABLE,
  CREATE_STAGES_TABLE,
  CREATE_DEPENDENCIES_TABLE,
] as const;
```

### 3.4 Implement database

**File**: `src/db/database.ts`

```typescript
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ALL_CREATE_STATEMENTS } from './schema.js';

/**
 * Default database path: ~/.config/kanban-workflow/kanban.db
 */
export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  '.config',
  'kanban-workflow',
  'kanban.db'
);

/**
 * Thin wrapper around better-sqlite3 that creates tables on open.
 */
export class KanbanDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Enable foreign key enforcement
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.initializeTables();
  }

  /**
   * Returns the raw better-sqlite3 Database instance for direct queries.
   */
  raw(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  private initializeTables(): void {
    const migrate = this.db.transaction(() => {
      for (const sql of ALL_CREATE_STATEMENTS) {
        this.db.exec(sql);
      }
    });
    migrate();
  }
}
```

### 3.5 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 3.6 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/db/schema.ts src/db/database.ts tests/db/database.test.ts
git commit -m "feat: add SQLite database module with schema initialization"
```

---

## Task 4: Create Database Repository Layer

**Goal**: CRUD operations for repos, epics, tickets, stages, and dependencies.

### 4.1 Write failing test

**File**: `tests/db/repositories.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { EpicRepository } from '../../src/db/repositories/epic-repository.js';
import { TicketRepository } from '../../src/db/repositories/ticket-repository.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';

describe('RepoRepository', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-repo-test-' + Date.now());
  let db: KanbanDatabase;
  let repos: RepoRepository;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repos = new RepoRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers a new repo and returns its id', () => {
    const id = repos.upsert('/home/user/project', 'project');
    expect(id).toBeGreaterThan(0);
  });

  it('returns the same id when upserting an existing path', () => {
    const id1 = repos.upsert('/home/user/project', 'project');
    const id2 = repos.upsert('/home/user/project', 'project');
    expect(id1).toBe(id2);
  });

  it('finds a repo by path', () => {
    repos.upsert('/home/user/project', 'project');
    const repo = repos.findByPath('/home/user/project');
    expect(repo).not.toBeNull();
    expect(repo!.name).toBe('project');
  });

  it('returns null for unknown path', () => {
    const repo = repos.findByPath('/nonexistent');
    expect(repo).toBeNull();
  });

  it('lists all repos', () => {
    repos.upsert('/home/user/project1', 'project1');
    repos.upsert('/home/user/project2', 'project2');
    const all = repos.listAll();
    expect(all).toHaveLength(2);
  });

  it('deletes a repo by id', () => {
    const id = repos.upsert('/home/user/project', 'project');
    repos.deleteById(id);
    expect(repos.findByPath('/home/user/project')).toBeNull();
  });
});

describe('EpicRepository', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-epic-test-' + Date.now());
  let db: KanbanDatabase;
  let repos: RepoRepository;
  let epics: EpicRepository;
  let repoId: number;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repos = new RepoRepository(db);
    epics = new EpicRepository(db);
    repoId = repos.upsert('/test/repo', 'repo');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts an epic', () => {
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: new Date().toISOString(),
    });
    const epic = epics.findById('EPIC-001');
    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('Auth');
  });

  it('updates an existing epic on upsert', () => {
    const now = new Date().toISOString();
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth v1',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: now,
    });
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth v2',
      status: 'Complete',
      jira_key: 'AUTH-1',
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: now,
    });
    const epic = epics.findById('EPIC-001');
    expect(epic!.title).toBe('Auth v2');
    expect(epic!.status).toBe('Complete');
    expect(epic!.jira_key).toBe('AUTH-1');
  });

  it('lists epics by repo', () => {
    const now = new Date().toISOString();
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: now,
    });
    epics.upsert({
      id: 'EPIC-002',
      repo_id: repoId,
      title: 'Billing',
      status: 'Not Started',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-002.md',
      last_synced: now,
    });
    const all = epics.listByRepo(repoId);
    expect(all).toHaveLength(2);
  });

  it('deletes an epic by id', () => {
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: new Date().toISOString(),
    });
    epics.deleteById('EPIC-001');
    expect(epics.findById('EPIC-001')).toBeNull();
  });
});

describe('TicketRepository', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-ticket-test-' + Date.now());
  let db: KanbanDatabase;
  let repos: RepoRepository;
  let epics: EpicRepository;
  let tickets: TicketRepository;
  let repoId: number;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repos = new RepoRepository(db);
    epics = new EpicRepository(db);
    tickets = new TicketRepository(db);
    repoId = repos.upsert('/test/repo', 'repo');
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: new Date().toISOString(),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts a ticket', () => {
    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Flow',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: true,
      file_path: '/test/repo/epics/TICKET-001-001.md',
      last_synced: new Date().toISOString(),
    });
    const ticket = tickets.findById('TICKET-001-001');
    expect(ticket).not.toBeNull();
    expect(ticket!.title).toBe('Login Flow');
  });

  it('lists tickets by epic', () => {
    const now = new Date().toISOString();
    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: true,
      file_path: '/test/repo/epics/TICKET-001-001.md',
      last_synced: now,
    });
    tickets.upsert({
      id: 'TICKET-001-002',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Logout',
      status: 'Not Started',
      jira_key: null,
      source: 'local',
      has_stages: false,
      file_path: '/test/repo/epics/TICKET-001-002.md',
      last_synced: now,
    });
    const all = tickets.listByEpic('EPIC-001');
    expect(all).toHaveLength(2);
  });

  it('lists tickets by repo', () => {
    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: true,
      file_path: '/test/repo/epics/TICKET-001-001.md',
      last_synced: new Date().toISOString(),
    });
    const all = tickets.listByRepo(repoId);
    expect(all).toHaveLength(1);
  });
});

describe('StageRepository', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-stage-test-' + Date.now());
  let db: KanbanDatabase;
  let repos: RepoRepository;
  let epics: EpicRepository;
  let tickets: TicketRepository;
  let stages: StageRepository;
  let repoId: number;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repos = new RepoRepository(db);
    epics = new EpicRepository(db);
    tickets = new TicketRepository(db);
    stages = new StageRepository(db);
    repoId = repos.upsert('/test/repo', 'repo');
    const now = new Date().toISOString();
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: now,
    });
    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: true,
      file_path: '/test/repo/epics/TICKET-001-001.md',
      last_synced: now,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts a stage', () => {
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: new Date().toISOString(),
    });
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage).not.toBeNull();
    expect(stage!.title).toBe('Login Form');
    expect(stage!.session_active).toBe(0);
  });

  it('lists stages by ticket', () => {
    const now = new Date().toISOString();
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    stages.upsert({
      id: 'STAGE-001-001-002',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login API',
      status: 'Not Started',
      kanban_column: 'Ready for Work',
      refinement_type: JSON.stringify(['backend']),
      worktree_branch: null,
      priority: 1,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-002.md',
      last_synced: now,
    });
    const all = stages.listByTicket('TICKET-001-001');
    expect(all).toHaveLength(2);
  });

  it('lists stages by kanban column', () => {
    const now = new Date().toISOString();
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    const designStages = stages.listByKanbanColumn(repoId, 'Design');
    expect(designStages).toHaveLength(1);
    expect(designStages[0].id).toBe('STAGE-001-001-001');
  });

  it('lists available stages (not session_active, in pipeline columns)', () => {
    const now = new Date().toISOString();
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    stages.upsert({
      id: 'STAGE-001-001-002',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login API',
      status: 'Build',
      kanban_column: 'Build',
      refinement_type: JSON.stringify(['backend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: true,
      locked_at: now,
      locked_by: 'session-1',
      file_path: '/test/repo/epics/STAGE-001-001-002.md',
      last_synced: now,
    });
    const available = stages.listAvailable(repoId, ['Design', 'Build']);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe('STAGE-001-001-001');
  });

  it('updates session_active and lock fields', () => {
    const now = new Date().toISOString();
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    stages.setSessionActive('STAGE-001-001-001', true, 'session-42');
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.session_active).toBe(1);
    expect(stage!.locked_by).toBe('session-42');
    expect(stage!.locked_at).not.toBeNull();
  });

  it('clears session_active and lock fields', () => {
    const now = new Date().toISOString();
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: true,
      locked_at: now,
      locked_by: 'session-42',
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    stages.setSessionActive('STAGE-001-001-001', false);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.session_active).toBe(0);
    expect(stage!.locked_by).toBeNull();
    expect(stage!.locked_at).toBeNull();
  });
});

describe('DependencyRepository', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-dep-test-' + Date.now());
  let db: KanbanDatabase;
  let repos: RepoRepository;
  let epics: EpicRepository;
  let tickets: TicketRepository;
  let stages: StageRepository;
  let deps: DependencyRepository;
  let repoId: number;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    repos = new RepoRepository(db);
    epics = new EpicRepository(db);
    tickets = new TicketRepository(db);
    stages = new StageRepository(db);
    deps = new DependencyRepository(db);
    repoId = repos.upsert('/test/repo', 'repo');
    const now = new Date().toISOString();
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth',
      status: 'In Progress',
      jira_key: null,
      file_path: '/test/repo/epics/EPIC-001.md',
      last_synced: now,
    });
    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: true,
      file_path: '/test/repo/epics/TICKET-001-001.md',
      last_synced: now,
    });
    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form',
      status: 'Design',
      kanban_column: 'Design',
      refinement_type: JSON.stringify(['frontend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-001.md',
      last_synced: now,
    });
    stages.upsert({
      id: 'STAGE-001-001-002',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login API',
      status: 'Complete',
      kanban_column: 'Done',
      refinement_type: JSON.stringify(['backend']),
      worktree_branch: null,
      priority: 0,
      due_date: null,
      session_active: false,
      locked_at: null,
      locked_by: null,
      file_path: '/test/repo/epics/STAGE-001-001-002.md',
      last_synced: now,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts a dependency', () => {
    deps.upsert({
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
      repo_id: repoId,
    });
    const all = deps.listByTarget('STAGE-001-001-001');
    expect(all).toHaveLength(1);
    expect(all[0].to_id).toBe('STAGE-001-001-002');
  });

  it('resolves a dependency', () => {
    deps.upsert({
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
      repo_id: repoId,
    });
    deps.resolve('STAGE-001-001-001', 'STAGE-001-001-002');
    const all = deps.listByTarget('STAGE-001-001-001');
    expect(all[0].resolved).toBe(1);
  });

  it('checks if all dependencies are resolved', () => {
    deps.upsert({
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
      repo_id: repoId,
    });
    expect(deps.allResolved('STAGE-001-001-001')).toBe(false);
    deps.resolve('STAGE-001-001-001', 'STAGE-001-001-002');
    expect(deps.allResolved('STAGE-001-001-001')).toBe(true);
  });

  it('returns true for allResolved when item has no dependencies', () => {
    expect(deps.allResolved('STAGE-001-001-002')).toBe(true);
  });

  it('deletes dependencies for a given entity', () => {
    deps.upsert({
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
      repo_id: repoId,
    });
    deps.deleteForEntity('STAGE-001-001-001');
    const all = deps.listByTarget('STAGE-001-001-001');
    expect(all).toHaveLength(0);
  });

  it('deletes all dependencies for a repo', () => {
    deps.upsert({
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
      repo_id: repoId,
    });
    deps.deleteByRepo(repoId);
    const all = deps.listByTarget('STAGE-001-001-001');
    expect(all).toHaveLength(0);
  });
});
```

### 4.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/db/repositories.test.ts
```

Should fail because the repository modules do not exist.

### 4.3 Implement

**File**: `src/db/repositories/repo-repository.ts`

```typescript
import type { KanbanDatabase } from '../database.js';
import type { RepoRecord } from '../../types/work-items.js';

export class RepoRepository {
  constructor(private db: KanbanDatabase) {}

  upsert(repoPath: string, name: string): number {
    const existing = this.findByPath(repoPath);
    if (existing) return existing.id;

    const stmt = this.db.raw().prepare(
      'INSERT INTO repos (path, name, registered_at) VALUES (?, ?, ?)'
    );
    const result = stmt.run(repoPath, name, new Date().toISOString());
    return result.lastInsertRowid as number;
  }

  findByPath(repoPath: string): RepoRecord | null {
    const row = this.db.raw()
      .prepare('SELECT * FROM repos WHERE path = ?')
      .get(repoPath) as RepoRecord | undefined;
    return row ?? null;
  }

  listAll(): RepoRecord[] {
    return this.db.raw()
      .prepare('SELECT * FROM repos ORDER BY name')
      .all() as RepoRecord[];
  }

  deleteById(id: number): void {
    this.db.raw().prepare('DELETE FROM repos WHERE id = ?').run(id);
  }
}
```

**File**: `src/db/repositories/epic-repository.ts`

```typescript
import type { KanbanDatabase } from '../database.js';

export interface EpicRow {
  id: string;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  file_path: string;
  last_synced: string;
}

export class EpicRepository {
  constructor(private db: KanbanDatabase) {}

  upsert(epic: EpicRow): void {
    this.db.raw().prepare(`
      INSERT INTO epics (id, repo_id, title, status, jira_key, file_path, last_synced)
      VALUES (@id, @repo_id, @title, @status, @jira_key, @file_path, @last_synced)
      ON CONFLICT(id) DO UPDATE SET
        repo_id = excluded.repo_id,
        title = excluded.title,
        status = excluded.status,
        jira_key = excluded.jira_key,
        file_path = excluded.file_path,
        last_synced = excluded.last_synced
    `).run(epic);
  }

  findById(id: string): EpicRow | null {
    const row = this.db.raw()
      .prepare('SELECT * FROM epics WHERE id = ?')
      .get(id) as EpicRow | undefined;
    return row ?? null;
  }

  listByRepo(repoId: number): EpicRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM epics WHERE repo_id = ? ORDER BY id')
      .all(repoId) as EpicRow[];
  }

  deleteById(id: string): void {
    this.db.raw().prepare('DELETE FROM epics WHERE id = ?').run(id);
  }

  deleteByRepo(repoId: number): void {
    this.db.raw().prepare('DELETE FROM epics WHERE repo_id = ?').run(repoId);
  }
}
```

**File**: `src/db/repositories/ticket-repository.ts`

```typescript
import type { KanbanDatabase } from '../database.js';

export interface TicketRow {
  id: string;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  source: string | null;
  has_stages: boolean | number;
  file_path: string;
  last_synced: string;
}

export class TicketRepository {
  constructor(private db: KanbanDatabase) {}

  upsert(ticket: TicketRow): void {
    this.db.raw().prepare(`
      INSERT INTO tickets (id, epic_id, repo_id, title, status, jira_key, source, has_stages, file_path, last_synced)
      VALUES (@id, @epic_id, @repo_id, @title, @status, @jira_key, @source, @has_stages, @file_path, @last_synced)
      ON CONFLICT(id) DO UPDATE SET
        epic_id = excluded.epic_id,
        repo_id = excluded.repo_id,
        title = excluded.title,
        status = excluded.status,
        jira_key = excluded.jira_key,
        source = excluded.source,
        has_stages = excluded.has_stages,
        file_path = excluded.file_path,
        last_synced = excluded.last_synced
    `).run(ticket);
  }

  findById(id: string): TicketRow | null {
    const row = this.db.raw()
      .prepare('SELECT * FROM tickets WHERE id = ?')
      .get(id) as TicketRow | undefined;
    return row ?? null;
  }

  listByEpic(epicId: string): TicketRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM tickets WHERE epic_id = ? ORDER BY id')
      .all(epicId) as TicketRow[];
  }

  listByRepo(repoId: number): TicketRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM tickets WHERE repo_id = ? ORDER BY id')
      .all(repoId) as TicketRow[];
  }

  deleteById(id: string): void {
    this.db.raw().prepare('DELETE FROM tickets WHERE id = ?').run(id);
  }

  deleteByRepo(repoId: number): void {
    this.db.raw().prepare('DELETE FROM tickets WHERE repo_id = ?').run(repoId);
  }
}
```

**File**: `src/db/repositories/stage-repository.ts`

```typescript
import type { KanbanDatabase } from '../database.js';

export interface StageRow {
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
  session_active: boolean | number;
  locked_at: string | null;
  locked_by: string | null;
  file_path: string;
  last_synced: string;
}

export class StageRepository {
  constructor(private db: KanbanDatabase) {}

  upsert(stage: StageRow): void {
    this.db.raw().prepare(`
      INSERT INTO stages (id, ticket_id, epic_id, repo_id, title, status, kanban_column,
        refinement_type, worktree_branch, priority, due_date, session_active, locked_at,
        locked_by, file_path, last_synced)
      VALUES (@id, @ticket_id, @epic_id, @repo_id, @title, @status, @kanban_column,
        @refinement_type, @worktree_branch, @priority, @due_date, @session_active, @locked_at,
        @locked_by, @file_path, @last_synced)
      ON CONFLICT(id) DO UPDATE SET
        ticket_id = excluded.ticket_id,
        epic_id = excluded.epic_id,
        repo_id = excluded.repo_id,
        title = excluded.title,
        status = excluded.status,
        kanban_column = excluded.kanban_column,
        refinement_type = excluded.refinement_type,
        worktree_branch = excluded.worktree_branch,
        priority = excluded.priority,
        due_date = excluded.due_date,
        session_active = excluded.session_active,
        locked_at = excluded.locked_at,
        locked_by = excluded.locked_by,
        file_path = excluded.file_path,
        last_synced = excluded.last_synced
    `).run(stage);
  }

  findById(id: string): StageRow | null {
    const row = this.db.raw()
      .prepare('SELECT * FROM stages WHERE id = ?')
      .get(id) as StageRow | undefined;
    return row ?? null;
  }

  listByTicket(ticketId: string): StageRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM stages WHERE ticket_id = ? ORDER BY id')
      .all(ticketId) as StageRow[];
  }

  listByEpic(epicId: string): StageRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM stages WHERE epic_id = ? ORDER BY id')
      .all(epicId) as StageRow[];
  }

  listByRepo(repoId: number): StageRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM stages WHERE repo_id = ? ORDER BY id')
      .all(repoId) as StageRow[];
  }

  listByKanbanColumn(repoId: number, column: string): StageRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM stages WHERE repo_id = ? AND kanban_column = ? ORDER BY priority DESC, id')
      .all(repoId, column) as StageRow[];
  }

  /**
   * List stages available for pickup: not session_active and in one of the given pipeline columns.
   * Excludes system columns like Backlog and Done.
   */
  listAvailable(repoId: number, pipelineColumns: string[]): StageRow[] {
    if (pipelineColumns.length === 0) return [];
    const placeholders = pipelineColumns.map(() => '?').join(', ');
    return this.db.raw()
      .prepare(
        `SELECT * FROM stages
         WHERE repo_id = ?
         AND session_active = 0
         AND kanban_column IN (${placeholders})
         ORDER BY priority DESC, id`
      )
      .all(repoId, ...pipelineColumns) as StageRow[];
  }

  /**
   * Set or clear session_active and lock fields.
   */
  setSessionActive(id: string, active: boolean, lockedBy?: string): void {
    if (active) {
      this.db.raw().prepare(`
        UPDATE stages SET session_active = 1, locked_at = ?, locked_by = ? WHERE id = ?
      `).run(new Date().toISOString(), lockedBy ?? null, id);
    } else {
      this.db.raw().prepare(`
        UPDATE stages SET session_active = 0, locked_at = NULL, locked_by = NULL WHERE id = ?
      `).run(id);
    }
  }

  deleteById(id: string): void {
    this.db.raw().prepare('DELETE FROM stages WHERE id = ?').run(id);
  }

  deleteByRepo(repoId: number): void {
    this.db.raw().prepare('DELETE FROM stages WHERE repo_id = ?').run(repoId);
  }
}
```

**File**: `src/db/repositories/dependency-repository.ts`

```typescript
import type { KanbanDatabase } from '../database.js';

export interface DependencyRow {
  id?: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved?: boolean | number;
  repo_id: number;
}

export class DependencyRepository {
  constructor(private db: KanbanDatabase) {}

  /**
   * Insert a dependency. Skips if an identical (from_id, to_id) pair already exists.
   */
  upsert(dep: Omit<DependencyRow, 'id' | 'resolved'>): void {
    const existing = this.db.raw()
      .prepare('SELECT id FROM dependencies WHERE from_id = ? AND to_id = ?')
      .get(dep.from_id, dep.to_id);
    if (existing) return;

    this.db.raw().prepare(`
      INSERT INTO dependencies (from_id, to_id, from_type, to_type, resolved, repo_id)
      VALUES (@from_id, @to_id, @from_type, @to_type, 0, @repo_id)
    `).run(dep);
  }

  /**
   * List all dependencies where from_id matches (i.e., "what does this item depend on?").
   */
  listByTarget(fromId: string): DependencyRow[] {
    return this.db.raw()
      .prepare('SELECT * FROM dependencies WHERE from_id = ?')
      .all(fromId) as DependencyRow[];
  }

  /**
   * Mark a specific dependency as resolved.
   */
  resolve(fromId: string, toId: string): void {
    this.db.raw()
      .prepare('UPDATE dependencies SET resolved = 1 WHERE from_id = ? AND to_id = ?')
      .run(fromId, toId);
  }

  /**
   * Check if all dependencies for a given entity are resolved.
   * Returns true if the entity has no dependencies.
   */
  allResolved(fromId: string): boolean {
    const unresolved = this.db.raw()
      .prepare('SELECT COUNT(*) as count FROM dependencies WHERE from_id = ? AND resolved = 0')
      .get(fromId) as { count: number };
    return unresolved.count === 0;
  }

  /**
   * Delete all dependencies for a given entity (both as source and target).
   */
  deleteForEntity(entityId: string): void {
    this.db.raw()
      .prepare('DELETE FROM dependencies WHERE from_id = ? OR to_id = ?')
      .run(entityId, entityId);
  }

  /**
   * Delete all dependencies for a given repo.
   */
  deleteByRepo(repoId: number): void {
    this.db.raw()
      .prepare('DELETE FROM dependencies WHERE repo_id = ?')
      .run(repoId);
  }
}
```

**File**: `src/db/repositories/index.ts`

```typescript
export { RepoRepository } from './repo-repository.js';
export { EpicRepository } from './epic-repository.js';
export type { EpicRow } from './epic-repository.js';
export { TicketRepository } from './ticket-repository.js';
export type { TicketRow } from './ticket-repository.js';
export { StageRepository } from './stage-repository.js';
export type { StageRow } from './stage-repository.js';
export { DependencyRepository } from './dependency-repository.js';
export type { DependencyRow } from './dependency-repository.js';
```

### 4.4 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 4.5 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/db/repositories/ tests/db/repositories.test.ts
git commit -m "feat: add repository layer for CRUD operations on all work item tables"
```

---

## Task 5: Create Frontmatter Parser

**Goal**: Parse YAML frontmatter from markdown files using `gray-matter` and return typed work item data.

### 5.1 Write failing test

**File**: `tests/parser/frontmatter.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
  parseFrontmatter,
} from '../../src/parser/frontmatter.js';
import type { Epic, Ticket, Stage } from '../../src/types/work-items.js';

describe('parseEpicFrontmatter', () => {
  it('parses a valid epic markdown file', () => {
    const content = `---
id: EPIC-001
title: User Authentication
status: In Progress
jira_key: null
tickets:
  - TICKET-001-001
  - TICKET-001-002
depends_on: []
---

# User Authentication

Epic description here.
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.id).toBe('EPIC-001');
    expect(result.title).toBe('User Authentication');
    expect(result.status).toBe('In Progress');
    expect(result.jira_key).toBeNull();
    expect(result.tickets).toEqual(['TICKET-001-001', 'TICKET-001-002']);
    expect(result.depends_on).toEqual([]);
    expect(result.file_path).toBe('/repo/epics/EPIC-001.md');
  });

  it('throws on missing id field', () => {
    const content = `---
title: No ID Epic
status: In Progress
tickets: []
depends_on: []
---
`;
    expect(() => parseEpicFrontmatter(content, '/repo/epics/bad.md')).toThrow(/id/i);
  });

  it('throws on missing title field', () => {
    const content = `---
id: EPIC-001
status: In Progress
tickets: []
depends_on: []
---
`;
    expect(() => parseEpicFrontmatter(content, '/repo/epics/bad.md')).toThrow(/title/i);
  });

  it('defaults tickets to empty array when missing', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
depends_on: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.tickets).toEqual([]);
  });

  it('defaults depends_on to empty array when missing', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.depends_on).toEqual([]);
  });
});

describe('parseTicketFrontmatter', () => {
  it('parses a valid ticket markdown file', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login Flow
status: In Progress
jira_key: null
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
depends_on: []
---

# Login Flow

Ticket description here.
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.id).toBe('TICKET-001-001');
    expect(result.epic).toBe('EPIC-001');
    expect(result.title).toBe('Login Flow');
    expect(result.source).toBe('local');
    expect(result.stages).toEqual(['STAGE-001-001-001', 'STAGE-001-001-002']);
  });

  it('throws on missing epic field', () => {
    const content = `---
id: TICKET-001-001
title: Login
status: In Progress
source: local
stages: []
depends_on: []
---
`;
    expect(() => parseTicketFrontmatter(content, '/repo/epics/bad.md')).toThrow(/epic/i);
  });

  it('defaults source to local when missing', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
stages: []
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.source).toBe('local');
  });

  it('defaults stages to empty array when missing', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
source: local
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.stages).toEqual([]);
  });
});

describe('parseStageFrontmatter', () => {
  it('parses a valid stage markdown file', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-001-001-002
worktree_branch: epic-001/ticket-001-001/stage-001-001-001
priority: 0
due_date: null
---

# Login Form

Stage description here.
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.id).toBe('STAGE-001-001-001');
    expect(result.ticket).toBe('TICKET-001-001');
    expect(result.epic).toBe('EPIC-001');
    expect(result.title).toBe('Login Form');
    expect(result.status).toBe('Design');
    expect(result.session_active).toBe(false);
    expect(result.refinement_type).toEqual(['frontend']);
    expect(result.depends_on).toEqual(['STAGE-001-001-002']);
    expect(result.worktree_branch).toBe('epic-001/ticket-001-001/stage-001-001-001');
    expect(result.priority).toBe(0);
    expect(result.due_date).toBeNull();
  });

  it('throws on missing ticket field', () => {
    const content = `---
id: STAGE-001-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    expect(() => parseStageFrontmatter(content, '/repo/epics/bad.md')).toThrow(/ticket/i);
  });

  it('defaults session_active to false when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.session_active).toBe(false);
  });

  it('defaults priority to 0 when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.priority).toBe(0);
  });

  it('defaults refinement_type to empty array when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.refinement_type).toEqual([]);
  });
});

describe('parseFrontmatter (generic dispatcher)', () => {
  it('parses an epic when type is epic', () => {
    const content = `---
id: EPIC-001
title: Test
status: In Progress
tickets: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/EPIC-001.md', 'epic');
    expect(result.id).toBe('EPIC-001');
  });

  it('parses a ticket when type is ticket', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Test
status: In Progress
source: local
stages: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/TICKET-001-001.md', 'ticket');
    expect(result.id).toBe('TICKET-001-001');
  });

  it('parses a stage when type is stage', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Test
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/STAGE-001-001-001.md', 'stage');
    expect(result.id).toBe('STAGE-001-001-001');
  });

  it('throws on content with no frontmatter', () => {
    const content = `# Just a heading\n\nNo frontmatter here.`;
    expect(() => parseFrontmatter(content, '/repo/epics/bad.md', 'epic')).toThrow(/frontmatter/i);
  });

  it('throws on empty frontmatter', () => {
    const content = `---\n---\n\nEmpty frontmatter.`;
    expect(() => parseFrontmatter(content, '/repo/epics/bad.md', 'epic')).toThrow();
  });
});
```

### 5.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/parser/frontmatter.test.ts
```

### 5.3 Implement

**File**: `src/parser/frontmatter.ts`

```typescript
import matter from 'gray-matter';
import type { Epic, Ticket, Stage, WorkItemType } from '../types/work-items.js';

/**
 * Extract and validate frontmatter data from markdown content.
 * Throws if frontmatter is missing or if required fields are absent.
 */
function extractData(content: string, filePath: string): Record<string, unknown> {
  const { data } = matter(content);

  if (!data || Object.keys(data).length === 0) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }

  return data;
}

/**
 * Require a field to exist in the frontmatter data.
 * Throws a descriptive error if missing.
 */
function requireField<T>(
  data: Record<string, unknown>,
  field: string,
  filePath: string
): T {
  if (data[field] === undefined || data[field] === null) {
    throw new Error(`Missing required field "${field}" in frontmatter of ${filePath}`);
  }
  return data[field] as T;
}

/**
 * Parse an epic from markdown file content.
 */
export function parseEpicFrontmatter(content: string, filePath: string): Epic {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    jira_key: (data.jira_key as string) ?? null,
    tickets: Array.isArray(data.tickets) ? data.tickets : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    file_path: filePath,
  };
}

/**
 * Parse a ticket from markdown file content.
 */
export function parseTicketFrontmatter(content: string, filePath: string): Ticket {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    epic: requireField<string>(data, 'epic', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    jira_key: (data.jira_key as string) ?? null,
    source: (data.source as 'local' | 'jira') ?? 'local',
    stages: Array.isArray(data.stages) ? data.stages : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    file_path: filePath,
  };
}

/**
 * Parse a stage from markdown file content.
 */
export function parseStageFrontmatter(content: string, filePath: string): Stage {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    ticket: requireField<string>(data, 'ticket', filePath),
    epic: requireField<string>(data, 'epic', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    session_active: data.session_active === true ? true : false,
    refinement_type: Array.isArray(data.refinement_type) ? data.refinement_type : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    worktree_branch: (data.worktree_branch as string) ?? null,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    due_date: (data.due_date as string) ?? null,
    file_path: filePath,
  };
}

/**
 * Generic dispatcher: parse frontmatter based on work item type.
 */
export function parseFrontmatter(
  content: string,
  filePath: string,
  type: WorkItemType
): Epic | Ticket | Stage {
  switch (type) {
    case 'epic':
      return parseEpicFrontmatter(content, filePath);
    case 'ticket':
      return parseTicketFrontmatter(content, filePath);
    case 'stage':
      return parseStageFrontmatter(content, filePath);
  }
}
```

### 5.4 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 5.5 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/parser/frontmatter.ts tests/parser/frontmatter.test.ts
git commit -m "feat: add YAML frontmatter parser for epics, tickets, and stages"
```

---

## Task 6: Create File Discovery Module

**Goal**: Find all epic, ticket, and stage markdown files in the `epics/` directory using glob patterns.

### 6.1 Write failing test

**File**: `tests/parser/discovery.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { discoverWorkItems, type DiscoveredFile } from '../../src/parser/discovery.js';

describe('discoverWorkItems', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-discovery-test-' + Date.now());
  const epicsDir = path.join(tmpDir, 'epics');

  beforeEach(() => {
    fs.mkdirSync(epicsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers epic files matching EPIC-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const epics = result.filter((f) => f.type === 'epic');
    expect(epics).toHaveLength(1);
    expect(epics[0].filePath).toContain('EPIC-001.md');
  });

  it('discovers ticket files matching TICKET-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'TICKET-001-001.md'), '---\nid: TICKET-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const tickets = result.filter((f) => f.type === 'ticket');
    expect(tickets).toHaveLength(1);
  });

  it('discovers stage files matching STAGE-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const stages = result.filter((f) => f.type === 'stage');
    expect(stages).toHaveLength(1);
  });

  it('discovers files in nested subdirectories', () => {
    const nestedDir = path.join(epicsDir, 'auth', 'login');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(1);
  });

  it('ignores non-matching markdown files', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(epicDir, 'notes.md'), '# Notes');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when epics directory does not exist', () => {
    const emptyDir = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = discoverWorkItems(emptyDir);
    expect(result).toEqual([]);
  });

  it('discovers all types in a mixed directory', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'TICKET-001-001.md'), '---\nid: TICKET-001-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-002.md'), '---\nid: STAGE-001-001-002\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(4);
    expect(result.filter((f) => f.type === 'epic')).toHaveLength(1);
    expect(result.filter((f) => f.type === 'ticket')).toHaveLength(1);
    expect(result.filter((f) => f.type === 'stage')).toHaveLength(2);
  });

  it('returns absolute file paths', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(path.isAbsolute(result[0].filePath)).toBe(true);
  });
});
```

### 6.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/parser/discovery.test.ts
```

### 6.3 Implement

**File**: `src/parser/discovery.ts`

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkItemType } from '../types/work-items.js';

/**
 * A discovered file with its absolute path and inferred work item type.
 */
export interface DiscoveredFile {
  filePath: string;
  type: WorkItemType;
}

/**
 * File name patterns for each work item type.
 */
const FILE_PATTERNS: Array<{ prefix: string; type: WorkItemType }> = [
  { prefix: 'EPIC-', type: 'epic' },
  { prefix: 'TICKET-', type: 'ticket' },
  { prefix: 'STAGE-', type: 'stage' },
];

/**
 * Recursively walk a directory and collect all files.
 */
function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Discover all epic, ticket, and stage markdown files in the repo's `epics/` directory.
 *
 * File naming convention:
 * - Epics: `EPIC-*.md`
 * - Tickets: `TICKET-*.md`
 * - Stages: `STAGE-*.md`
 *
 * @param repoPath - Root path of the repository
 * @returns Array of discovered files with their types
 */
export function discoverWorkItems(repoPath: string): DiscoveredFile[] {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) return [];

  const allFiles = walkDir(epicsDir);
  const discovered: DiscoveredFile[] = [];

  for (const filePath of allFiles) {
    const basename = path.basename(filePath);
    if (!basename.endsWith('.md')) continue;

    for (const pattern of FILE_PATTERNS) {
      if (basename.startsWith(pattern.prefix)) {
        discovered.push({
          filePath,
          type: pattern.type,
        });
        break;
      }
    }
  }

  return discovered;
}
```

### 6.4 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 6.5 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/parser/discovery.ts tests/parser/discovery.test.ts
git commit -m "feat: add file discovery module for epics, tickets, and stages"
```

---

## Task 7: Create Kanban Column Calculator

**Goal**: Compute the kanban column for a stage based on its status and dependency resolution. System columns (To Convert, Backlog, Ready for Work, Done) are structural; pipeline columns come from config.

### 7.1 Write failing test

**File**: `tests/engine/kanban-columns.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { computeKanbanColumn } from '../../src/engine/kanban-columns.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import { StateMachine } from '../../src/engine/state-machine.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      {
        name: 'Design',
        skill: 'phase-design',
        status: 'Design',
        transitions_to: ['Build'],
      },
      {
        name: 'Build',
        skill: 'phase-build',
        status: 'Build',
        transitions_to: ['Done'],
      },
    ],
  },
};

describe('computeKanbanColumn', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const pipelineStatuses = sm.getAllStatuses();

  it('returns Done for status Complete', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Done');
  });

  it('returns Backlog for a pipeline status with unresolved dependencies', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('returns the pipeline column name for a resolved pipeline status', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Design');
  });

  it('returns Ready for Work for status Not Started with resolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Ready for Work');
  });

  it('returns Backlog for status Not Started with unresolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('returns the pipeline column for Build status', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Build');
  });

  it('returns Backlog for an unknown status (not pipeline, not system)', () => {
    const column = computeKanbanColumn({
      status: 'SomeUnknownStatus',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Backlog');
  });
});

describe('computeKanbanColumn edge cases', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const pipelineStatuses = sm.getAllStatuses();

  it('pipeline status with unresolved deps goes to Backlog even if in pipeline', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('Complete status ignores dependency resolution', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Done');
  });
});
```

### 7.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/engine/kanban-columns.test.ts
```

### 7.3 Implement

**File**: `src/engine/kanban-columns.ts`

```typescript
import { COMPLETE_STATUS } from '../types/pipeline.js';
import type { KanbanColumn } from '../types/work-items.js';

/**
 * Input needed to compute a stage's kanban column.
 */
export interface KanbanColumnInput {
  /** The stage's current status from frontmatter */
  status: string;
  /** All status values defined in the pipeline config */
  pipelineStatuses: string[];
  /** Whether this stage has unresolved dependencies */
  hasUnresolvedDeps: boolean;
}

/**
 * Compute the kanban board column for a stage.
 *
 * Column assignment rules (in priority order):
 * 1. Status is "Complete" → Done
 * 2. Has unresolved dependencies → Backlog
 * 3. Status is "Not Started" → Ready for Work
 * 4. Status matches a pipeline state → that pipeline column name
 * 5. Otherwise → Backlog (unknown/unmapped status)
 *
 * Note: "To Convert" is for tickets with no stages — that is handled
 * at the ticket level, not the stage level, so it does not appear here.
 */
export function computeKanbanColumn(input: KanbanColumnInput): KanbanColumn {
  const { status, pipelineStatuses, hasUnresolvedDeps } = input;

  // 1. Complete → Done (regardless of deps)
  if (status === COMPLETE_STATUS) {
    return 'Done';
  }

  // 2. Unresolved deps → Backlog
  if (hasUnresolvedDeps) {
    return 'Backlog';
  }

  // 3. Not Started with resolved deps → Ready for Work
  if (status === 'Not Started') {
    return 'Ready for Work';
  }

  // 4. Pipeline status → pipeline column (status = column name by convention)
  if (pipelineStatuses.includes(status)) {
    return status;
  }

  // 5. Unknown → Backlog
  return 'Backlog';
}
```

### 7.4 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 7.5 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/engine/kanban-columns.ts tests/engine/kanban-columns.test.ts
git commit -m "feat: add kanban column calculator using pipeline config and dependency state"
```

---

## Task 8: Create Sync Module

**Goal**: Orchestrate file discovery, frontmatter parsing, kanban column computation, and database writes into a single sync operation.

### 8.1 Write failing test

**File**: `tests/sync/sync.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import { syncRepo, type SyncResult } from '../../src/sync/sync.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { EpicRepository } from '../../src/db/repositories/epic-repository.js';
import { TicketRepository } from '../../src/db/repositories/ticket-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
    ],
  },
};

describe('syncRepo', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-sync-test-' + Date.now());
  const repoDir = path.join(tmpDir, 'repo');
  const epicsDir = path.join(repoDir, 'epics', 'auth');
  let db: KanbanDatabase;
  let dbPath: string;

  beforeEach(() => {
    fs.mkdirSync(epicsDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEpic(id: string, title: string): void {
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
title: ${title}
status: In Progress
jira_key: null
tickets:
  - TICKET-001-001
depends_on: []
---

# ${title}
`
    );
  }

  function writeTicket(id: string, epicId: string, title: string): void {
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
epic: ${epicId}
title: ${title}
status: In Progress
jira_key: null
source: local
stages:
  - STAGE-001-001-001
depends_on: []
---

# ${title}
`
    );
  }

  function writeStage(
    id: string,
    ticketId: string,
    epicId: string,
    title: string,
    status: string,
    deps: string[] = []
  ): void {
    const depsYaml = deps.length > 0
      ? deps.map((d) => `  - ${d}`).join('\n')
      : '[]';
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
ticket: ${ticketId}
epic: ${epicId}
title: ${title}
status: ${status}
session_active: false
refinement_type:
  - frontend
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
worktree_branch: null
priority: 0
due_date: null
---

# ${title}
`
    );
  }

  it('syncs epics, tickets, and stages to the database', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    const result = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result.epics).toBe(1);
    expect(result.tickets).toBe(1);
    expect(result.stages).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('populates the repos table', () => {
    writeEpic('EPIC-001', 'Auth');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const repos = new RepoRepository(db);
    const repo = repos.findByPath(repoDir);
    expect(repo).not.toBeNull();
    expect(repo!.name).toBe('repo');
  });

  it('populates epic data correctly', () => {
    writeEpic('EPIC-001', 'Auth');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const epics = new EpicRepository(db);
    const epic = epics.findById('EPIC-001');
    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('Auth');
    expect(epic!.status).toBe('In Progress');
  });

  it('populates ticket data correctly', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const tickets = new TicketRepository(db);
    const ticket = tickets.findById('TICKET-001-001');
    expect(ticket).not.toBeNull();
    expect(ticket!.title).toBe('Login');
    expect(ticket!.source).toBe('local');
  });

  it('computes kanban_column for stages in pipeline statuses', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('Design');
  });

  it('computes kanban_column as Ready for Work for Not Started status', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Not Started');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('Ready for Work');
  });

  it('computes kanban_column as Done for Complete status', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Complete');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('Done');
  });

  it('computes kanban_column as Backlog for stages with unresolved deps', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Build'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const blocked = stages.findById('STAGE-001-001-001');
    // STAGE-001-001-002 is not Complete, so the dependency is unresolved
    expect(blocked!.kanban_column).toBe('Backlog');
  });

  it('resolves deps when dependency stage is Complete', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Complete'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const resolved = stages.findById('STAGE-001-001-001');
    expect(resolved!.kanban_column).toBe('Design');

    const deps = new DependencyRepository(db);
    expect(deps.allResolved('STAGE-001-001-001')).toBe(true);
  });

  it('creates dependency records', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Build'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const deps = new DependencyRepository(db);
    const depList = deps.listByTarget('STAGE-001-001-001');
    expect(depList).toHaveLength(1);
    expect(depList[0].to_id).toBe('STAGE-001-001-002');
  });

  it('collects errors for malformed files without stopping sync', () => {
    writeEpic('EPIC-001', 'Auth');
    // Write a bad stage file (missing required fields)
    fs.writeFileSync(
      path.join(epicsDir, 'STAGE-BAD-001.md'),
      `---
id: STAGE-BAD-001
---

# Bad stage
`
    );

    const result = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result.epics).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('STAGE-BAD-001');
  });

  it('is idempotent — running sync twice produces the same data', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    syncRepo({ repoPath: repoDir, db, config: testConfig });
    const result2 = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result2.epics).toBe(1);
    expect(result2.tickets).toBe(1);
    expect(result2.stages).toBe(1);

    const stages = new StageRepository(db);
    const allStages = stages.listByRepo(
      new RepoRepository(db).findByPath(repoDir)!.id
    );
    expect(allStages).toHaveLength(1);
  });

  it('returns empty counts when no files exist', () => {
    const emptyRepo = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(emptyRepo, { recursive: true });

    const result = syncRepo({ repoPath: emptyRepo, db, config: testConfig });

    expect(result.epics).toBe(0);
    expect(result.tickets).toBe(0);
    expect(result.stages).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
```

### 8.2 Verify test fails

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npx vitest run tests/sync/sync.test.ts
```

### 8.3 Implement

**File**: `src/sync/sync.ts`

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KanbanDatabase } from '../db/database.js';
import type { PipelineConfig } from '../types/pipeline.js';
import type { Epic, Ticket, Stage } from '../types/work-items.js';
import { COMPLETE_STATUS } from '../types/pipeline.js';
import { StateMachine } from '../engine/state-machine.js';
import { computeKanbanColumn } from '../engine/kanban-columns.js';
import { discoverWorkItems } from '../parser/discovery.js';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
} from '../parser/frontmatter.js';
import { RepoRepository } from '../db/repositories/repo-repository.js';
import { EpicRepository } from '../db/repositories/epic-repository.js';
import { TicketRepository } from '../db/repositories/ticket-repository.js';
import { StageRepository } from '../db/repositories/stage-repository.js';
import { DependencyRepository } from '../db/repositories/dependency-repository.js';

export interface SyncOptions {
  repoPath: string;
  db: KanbanDatabase;
  config: PipelineConfig;
}

export interface SyncResult {
  epics: number;
  tickets: number;
  stages: number;
  dependencies: number;
  errors: string[];
}

/**
 * Sync all work items from the filesystem into the SQLite database.
 *
 * Process:
 * 1. Discover files in the `epics/` directory
 * 2. Parse frontmatter from each file
 * 3. Register/upsert the repo
 * 4. Upsert epics, tickets, stages into the database
 * 5. Create dependency records
 * 6. Compute kanban columns for stages (based on status + dependency resolution)
 * 7. Update stage rows with computed columns
 */
export function syncRepo(options: SyncOptions): SyncResult {
  const { repoPath, db, config } = options;
  const sm = StateMachine.fromConfig(config);
  const pipelineStatuses = sm.getAllStatuses();

  const repoRepo = new RepoRepository(db);
  const epicRepo = new EpicRepository(db);
  const ticketRepo = new TicketRepository(db);
  const stageRepo = new StageRepository(db);
  const depRepo = new DependencyRepository(db);

  const result: SyncResult = {
    epics: 0,
    tickets: 0,
    stages: 0,
    dependencies: 0,
    errors: [],
  };

  // 1. Discover files
  const files = discoverWorkItems(repoPath);
  if (files.length === 0) return result;

  // 2. Register repo
  const repoName = path.basename(repoPath);
  const repoId = repoRepo.upsert(repoPath, repoName);
  const now = new Date().toISOString();

  // 3. Parse all files, collecting data
  const parsedEpics: Epic[] = [];
  const parsedTickets: Ticket[] = [];
  const parsedStages: Stage[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.filePath, 'utf-8');
      switch (file.type) {
        case 'epic': {
          const epic = parseEpicFrontmatter(content, file.filePath);
          parsedEpics.push(epic);
          break;
        }
        case 'ticket': {
          const ticket = parseTicketFrontmatter(content, file.filePath);
          parsedTickets.push(ticket);
          break;
        }
        case 'stage': {
          const stage = parseStageFrontmatter(content, file.filePath);
          parsedStages.push(stage);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${file.filePath}: ${msg}`);
    }
  }

  // 4. Build a map of stage statuses for dependency resolution
  const stageStatusMap = new Map<string, string>();
  for (const stage of parsedStages) {
    stageStatusMap.set(stage.id, stage.status);
  }

  // 5. Upsert all data into the database within a transaction
  const syncTransaction = db.raw().transaction(() => {
    // Upsert epics
    for (const epic of parsedEpics) {
      epicRepo.upsert({
        id: epic.id,
        repo_id: repoId,
        title: epic.title,
        status: epic.status,
        jira_key: epic.jira_key,
        file_path: epic.file_path,
        last_synced: now,
      });
    }
    result.epics = parsedEpics.length;

    // Upsert tickets
    for (const ticket of parsedTickets) {
      ticketRepo.upsert({
        id: ticket.id,
        epic_id: ticket.epic,
        repo_id: repoId,
        title: ticket.title,
        status: ticket.status,
        jira_key: ticket.jira_key,
        source: ticket.source,
        has_stages: ticket.stages.length > 0,
        file_path: ticket.file_path,
        last_synced: now,
      });
    }
    result.tickets = parsedTickets.length;

    // Clear old dependencies for this repo and rebuild
    depRepo.deleteByRepo(repoId);

    // Upsert stages and create dependencies
    for (const stage of parsedStages) {
      // Create dependency records
      for (const depId of stage.depends_on) {
        depRepo.upsert({
          from_id: stage.id,
          to_id: depId,
          from_type: 'stage',
          to_type: 'stage',
          repo_id: repoId,
        });
        result.dependencies++;

        // Resolve dependency if the target is Complete
        const depStatus = stageStatusMap.get(depId);
        if (depStatus === COMPLETE_STATUS) {
          depRepo.resolve(stage.id, depId);
        }
      }

      // Compute kanban column
      const hasUnresolvedDeps = !depRepo.allResolved(stage.id);
      const kanbanColumn = computeKanbanColumn({
        status: stage.status,
        pipelineStatuses,
        hasUnresolvedDeps,
      });

      // Upsert stage
      stageRepo.upsert({
        id: stage.id,
        ticket_id: stage.ticket,
        epic_id: stage.epic,
        repo_id: repoId,
        title: stage.title,
        status: stage.status,
        kanban_column: kanbanColumn,
        refinement_type: JSON.stringify(stage.refinement_type),
        worktree_branch: stage.worktree_branch,
        priority: stage.priority,
        due_date: stage.due_date,
        session_active: stage.session_active,
        locked_at: null,
        locked_by: null,
        file_path: stage.file_path,
        last_synced: now,
      });
    }
    result.stages = parsedStages.length;
  });

  syncTransaction();

  return result;
}
```

### 8.4 Verify test passes

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

### 8.5 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/sync/sync.ts tests/sync/sync.test.ts
git commit -m "feat: add sync module to populate SQLite from filesystem work items"
```

---

## Task 9: Update Index Exports

**Goal**: Export all new modules from the package entry point. Verify everything compiles and all tests pass.

### 9.1 Update `src/index.ts`

Append these exports to the end of `src/index.ts` (after the work item type exports added in Task 2):

```typescript
// Database
export { KanbanDatabase, DEFAULT_DB_PATH } from './db/database.js';
export { ALL_CREATE_STATEMENTS } from './db/schema.js';
export {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from './db/repositories/index.js';
export type {
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
} from './db/repositories/index.js';

// Parser
export {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
  parseFrontmatter,
} from './parser/frontmatter.js';
export { discoverWorkItems } from './parser/discovery.js';
export type { DiscoveredFile } from './parser/discovery.js';

// Kanban Columns
export { computeKanbanColumn } from './engine/kanban-columns.js';
export type { KanbanColumnInput } from './engine/kanban-columns.js';

// Sync
export { syncRepo } from './sync/sync.js';
export type { SyncOptions, SyncResult } from './sync/sync.js';
```

### 9.2 Verify everything compiles and all tests pass

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

All original 84 tests plus all new tests must pass.

### 9.3 Commit

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/index.ts
git commit -m "feat: export all Stage 1A modules from package entry point"
```

---

## Summary

| Task | Module | New Files | Tests |
|------|--------|-----------|-------|
| 1 | Dependencies | — | 0 (verify existing) |
| 2 | Work Item Types | `src/types/work-items.ts` | ~8 |
| 3 | Database Module | `src/db/database.ts`, `src/db/schema.ts` | ~10 |
| 4 | Repository Layer | `src/db/repositories/*.ts` | ~20 |
| 5 | Frontmatter Parser | `src/parser/frontmatter.ts` | ~15 |
| 6 | File Discovery | `src/parser/discovery.ts` | ~8 |
| 7 | Kanban Columns | `src/engine/kanban-columns.ts` | ~8 |
| 8 | Sync Module | `src/sync/sync.ts` | ~10 |
| 9 | Index Exports | `src/index.ts` (update) | 0 (verify all) |

**Estimated new tests**: ~79
**Total after Stage 1A**: ~163 tests (84 existing + ~79 new)

**New dependencies**: `better-sqlite3`, `gray-matter`, `@types/better-sqlite3`

**New source files**: 11 files across `src/types/`, `src/db/`, `src/parser/`, `src/engine/`, `src/sync/`

**New test files**: 6 files across `tests/types/`, `tests/db/`, `tests/parser/`, `tests/engine/`, `tests/sync/`
