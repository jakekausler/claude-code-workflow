# Stage 1B: CLI Commands — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the five CLI commands (`board`, `graph`, `next`, `validate`, `sync`) that consume the SQLite database and pipeline config from Sub-Stages 0 and 1A. Each command has a logic module (testable, no CLI concerns) and a thin CLI wrapper.

**Depends on:** Sub-Stage 1A (SQLite & File Parsing) — database, repositories, sync, kanban-columns, work-item types must all exist.

**Architecture:** Each command follows a two-file pattern: `src/cli/logic/<name>.ts` contains the pure business logic (takes typed inputs, returns typed outputs), and `src/cli/commands/<name>.ts` is a thin commander wrapper that parses CLI options, loads config/database, calls the logic function, and writes JSON to stdout. Tests exercise the logic modules directly with mock data — no CLI parsing tested.

**Tech Stack:** TypeScript, vitest, commander, better-sqlite3 (via 1A Database class), gray-matter (via 1A parser)

---

### Task 1: Create Board Command Logic

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/board.ts`
- Create: `tools/kanban-cli/tests/cli/logic/board.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/cli/logic/board.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildBoard, toColumnKey } from '../../../src/cli/logic/board.js';
import type { PipelineConfig } from '../../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
    ],
  },
};

describe('toColumnKey', () => {
  it('converts a display name to a snake_case key', () => {
    expect(toColumnKey('User Design Feedback')).toBe('user_design_feedback');
  });

  it('handles single word', () => {
    expect(toColumnKey('Design')).toBe('design');
  });

  it('handles PR Created', () => {
    expect(toColumnKey('PR Created')).toBe('pr_created');
  });
});

describe('buildBoard', () => {
  it('returns all system columns plus pipeline columns', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    const columnKeys = Object.keys(result.columns);
    // System columns
    expect(columnKeys).toContain('to_convert');
    expect(columnKeys).toContain('backlog');
    expect(columnKeys).toContain('ready_for_work');
    expect(columnKeys).toContain('done');
    // Pipeline columns
    expect(columnKeys).toContain('design');
    expect(columnKeys).toContain('build');
  });

  it('places tickets without stages in to_convert', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Checkout', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md' },
      ],
      stages: [],
      dependencies: [],
    });
    expect(result.columns.to_convert).toHaveLength(1);
    expect(result.columns.to_convert[0].id).toBe('TICKET-001-001');
  });

  it('places stages with unresolved deps in backlog', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Not Started', kanban_column: 'backlog', refinement_type: '["frontend"]', worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-001', to_id: 'STAGE-001-001-002', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.columns.backlog).toHaveLength(1);
    expect(result.columns.backlog[0].id).toBe('STAGE-001-001-001');
    expect((result.columns.backlog[0] as any).blocked_by).toContain('STAGE-001-001-002');
  });

  it('places stages with status Not Started and all deps resolved in ready_for_work', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Not Started', kanban_column: 'ready_for_work', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.ready_for_work).toHaveLength(1);
  });

  it('places stages with pipeline status in the matching pipeline column', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Design', kanban_column: 'design', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.design).toHaveLength(1);
  });

  it('places completed stages in done', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Complete', kanban_column: 'done', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.done).toHaveLength(1);
  });

  it('computes stats correctly', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'T1', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'f.md' },
      ],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', refinement_type: '["frontend"]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '["frontend"]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.stats.total_stages).toBe(2);
    expect(result.stats.total_tickets).toBe(1);
    expect(result.stats.by_column.ready_for_work).toBe(1);
    expect(result.stats.by_column.done).toBe(1);
    expect(result.stats.by_column.to_convert).toBe(1);
  });

  it('filters by epic', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-002-001-001', ticket_id: 'TICKET-002-001', epic_id: 'EPIC-002', title: 'S2', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { epic: 'EPIC-001' },
    });
    expect(result.columns.design).toHaveLength(1);
    expect(result.columns.design[0].id).toBe('STAGE-001-001-001');
  });

  it('filters by ticket', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-002-001', ticket_id: 'TICKET-001-002', epic_id: 'EPIC-001', title: 'S2', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { ticket: 'TICKET-001-001' },
    });
    expect(result.columns.design).toHaveLength(1);
  });

  it('filters by column', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { column: 'design' },
    });
    // Only the design column should have items; other columns empty
    expect(result.columns.design).toHaveLength(1);
    expect(result.columns.done).toHaveLength(0);
  });

  it('excludes done stages when excludeDone is true', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { excludeDone: true },
    });
    expect(result.columns.done).toHaveLength(0);
    expect(result.columns.design).toHaveLength(1);
  });

  it('includes generated_at timestamp and repo path', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    expect(result.generated_at).toBeDefined();
    expect(result.repo).toBe('/tmp/test-repo');
  });

  it('reads column names from pipeline config, not hardcoded', () => {
    const customConfig: PipelineConfig = {
      workflow: {
        entry_phase: 'Spike',
        phases: [
          { name: 'Spike', skill: 'my-spike', status: 'Spike', transitions_to: ['Done'] },
        ],
      },
    };
    const result = buildBoard({
      config: customConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    const columnKeys = Object.keys(result.columns);
    expect(columnKeys).toContain('spike');
    expect(columnKeys).not.toContain('design');
    expect(columnKeys).not.toContain('build');
    // System columns always present
    expect(columnKeys).toContain('to_convert');
    expect(columnKeys).toContain('backlog');
    expect(columnKeys).toContain('ready_for_work');
    expect(columnKeys).toContain('done');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/board.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the board logic module**

Create `tools/kanban-cli/src/cli/logic/board.ts`:

```typescript
import type { PipelineConfig } from '../../types/pipeline.js';
import { isSkillState } from '../../types/pipeline.js';
import { StateMachine } from '../../engine/state-machine.js';

// ---------- Row types for board output ----------

export interface TicketBoardItem {
  type: 'ticket';
  id: string;
  epic: string;
  title: string;
  jira_key: string | null;
  source: string;
}

export interface StageBoardItem {
  type: 'stage';
  id: string;
  ticket: string;
  epic: string;
  title: string;
  blocked_by?: string[];
  blocked_by_resolved?: boolean;
  session_active?: boolean;
  worktree_branch?: string;
}

export type BoardItem = TicketBoardItem | StageBoardItem;

export interface BoardOutput {
  generated_at: string;
  repo: string;
  columns: Record<string, BoardItem[]>;
  stats: {
    total_stages: number;
    total_tickets: number;
    by_column: Record<string, number>;
  };
}

// ---------- Input data shapes (from 1A repositories) ----------

export interface BoardTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: string;
  has_stages: boolean;
  file_path: string;
}

export interface BoardStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  kanban_column: string;
  refinement_type: string;
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
  file_path: string;
}

export interface BoardEpicRow {
  id: string;
  title: string;
  status: string;
  file_path: string;
}

export interface BoardDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

export interface BoardFilters {
  epic?: string;
  ticket?: string;
  column?: string;
  excludeDone?: boolean;
}

export interface BuildBoardInput {
  config: PipelineConfig;
  repoPath: string;
  epics: BoardEpicRow[];
  tickets: BoardTicketRow[];
  stages: BoardStageRow[];
  dependencies: BoardDependencyRow[];
  filters?: BoardFilters;
}

// ---------- Helpers ----------

/**
 * Convert a display name (e.g. "User Design Feedback") to a snake_case column key.
 */
export function toColumnKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

// ---------- Core logic ----------

const SYSTEM_COLUMNS = ['to_convert', 'backlog', 'ready_for_work', 'done'] as const;

export function buildBoard(input: BuildBoardInput): BoardOutput {
  const { config, repoPath, tickets, stages, dependencies, filters } = input;

  // Build column list from pipeline config
  const sm = StateMachine.fromConfig(config);
  const pipelineColumnKeys = sm.getAllStates().map((s) => toColumnKey(s.name));

  // Initialize all columns (system + pipeline)
  const columns: Record<string, BoardItem[]> = {};
  for (const col of SYSTEM_COLUMNS) {
    columns[col] = [];
  }
  for (const col of pipelineColumnKeys) {
    columns[col] = [];
  }

  // Build a dependency lookup: from_id -> list of unresolved to_ids
  const unresolvedDeps = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!dep.resolved) {
      const existing = unresolvedDeps.get(dep.from_id) || [];
      existing.push(dep.to_id);
      unresolvedDeps.set(dep.from_id, existing);
    }
  }

  // Place tickets without stages in to_convert
  let filteredTickets = tickets.filter((t) => !t.has_stages);
  if (filters?.epic) {
    filteredTickets = filteredTickets.filter((t) => t.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredTickets = filteredTickets.filter((t) => t.id === filters.ticket);
  }

  const shouldIncludeToConvert = !filters?.column || filters.column === 'to_convert';
  if (shouldIncludeToConvert) {
    for (const ticket of filteredTickets) {
      columns.to_convert.push({
        type: 'ticket',
        id: ticket.id,
        epic: ticket.epic_id,
        title: ticket.title,
        jira_key: ticket.jira_key,
        source: ticket.source,
      });
    }
  }

  // Place stages
  let filteredStages = [...stages];
  if (filters?.epic) {
    filteredStages = filteredStages.filter((s) => s.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredStages = filteredStages.filter((s) => s.ticket_id === filters.ticket);
  }
  if (filters?.excludeDone) {
    filteredStages = filteredStages.filter((s) => s.kanban_column !== 'done');
  }

  for (const stage of filteredStages) {
    const colKey = stage.kanban_column;
    if (filters?.column && colKey !== filters.column) {
      continue;
    }

    const blockedBy = unresolvedDeps.get(stage.id);

    const item: StageBoardItem = {
      type: 'stage',
      id: stage.id,
      ticket: stage.ticket_id,
      epic: stage.epic_id,
      title: stage.title,
    };

    if (colKey === 'backlog' && blockedBy && blockedBy.length > 0) {
      item.blocked_by = blockedBy;
      item.blocked_by_resolved = false;
    }

    if (stage.session_active) {
      item.session_active = true;
    }

    if (stage.worktree_branch) {
      item.worktree_branch = stage.worktree_branch;
    }

    // Ensure the column exists (it should, but guard against unknown kanban_column values)
    if (columns[colKey] !== undefined) {
      columns[colKey].push(item);
    }
  }

  // Compute stats
  const byColumn: Record<string, number> = {};
  for (const [key, items] of Object.entries(columns)) {
    if (items.length > 0) {
      byColumn[key] = items.length;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    repo: repoPath,
    columns,
    stats: {
      total_stages: filteredStages.length,
      total_tickets: filteredTickets.length,
      by_column: byColumn,
    },
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/board.test.ts`
Expected: All tests PASS.

**Step 5: Verify the project compiles**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 6: Commit**

```bash
git add tools/kanban-cli/src/cli/logic/board.ts tools/kanban-cli/tests/cli/logic/board.test.ts
git commit -m "feat(kanban-cli): add board command logic with config-driven columns and filtering"
```

---

### Task 2: Create Board CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/board.ts`

**Step 1: Write the board CLI command**

Create `tools/kanban-cli/src/cli/commands/board.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { Database } from '../../db/database.js';
import { TicketRepository, StageRepository, EpicRepository, DependencyRepository } from '../../db/repositories.js';
import { syncAll } from '../../sync/sync.js';
import { buildBoard } from '../logic/board.js';

export const boardCommand = new Command('board')
  .description('Output kanban board as JSON')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--epic <id>', 'Filter to a specific epic')
  .option('--ticket <id>', 'Filter to a specific ticket')
  .option('--column <name>', 'Filter to a specific column (snake_case)')
  .option('--exclude-done', 'Omit completed stages', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new Database(repoPath);

      // Ensure data is fresh
      syncAll(db, repoPath, config);

      const epics = new EpicRepository(db).findAll();
      const tickets = new TicketRepository(db).findAll();
      const stages = new StageRepository(db).findAll();
      const dependencies = new DependencyRepository(db).findAll();

      const result = buildBoard({
        config,
        repoPath,
        epics,
        tickets,
        stages,
        dependencies,
        filters: {
          epic: options.epic,
          ticket: options.ticket,
          column: options.column,
          excludeDone: options.excludeDone,
        },
      });

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(result, null, indent) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 2: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors (depends on 1A modules being present).

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/cli/commands/board.ts
git commit -m "feat(kanban-cli): add board CLI command wiring options to board logic"
```

---

### Task 3: Create Graph Command Logic

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/graph.ts`
- Create: `tools/kanban-cli/tests/cli/logic/graph.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/cli/logic/graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../../src/cli/logic/graph.js';
import type { GraphEpicRow, GraphTicketRow, GraphStageRow, GraphDependencyRow } from '../../../src/cli/logic/graph.js';

describe('buildGraph', () => {
  it('creates nodes for all entities', () => {
    const result = buildGraph({
      epics: [
        { id: 'EPIC-001', title: 'Auth', status: 'In Progress' },
      ],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login', status: 'In Progress' },
      ],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Design' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Auth API', status: 'Not Started' },
      ],
      dependencies: [],
    });
    expect(result.nodes).toHaveLength(4);
    const types = result.nodes.map((n) => n.type);
    expect(types).toContain('epic');
    expect(types).toContain('ticket');
    expect(types).toContain('stage');
  });

  it('creates edges from dependencies', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Complete' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe('STAGE-001-001-002');
    expect(result.edges[0].to).toBe('STAGE-001-001-001');
    expect(result.edges[0].type).toBe('depends_on');
    expect(result.edges[0].resolved).toBe(true);
  });

  it('detects cycles', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Not Started' },
        { id: 'STAGE-001-001-002', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
        { id: 'STAGE-001-001-003', ticket_id: 'T', epic_id: 'E', title: 'S3', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-001', to_id: 'STAGE-001-001-002', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 2, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-003', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 3, from_id: 'STAGE-001-001-003', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.cycles.length).toBeGreaterThan(0);
    // The cycle should contain all three IDs
    const cycleIds = result.cycles[0];
    expect(cycleIds).toContain('STAGE-001-001-001');
    expect(cycleIds).toContain('STAGE-001-001-002');
    expect(cycleIds).toContain('STAGE-001-001-003');
  });

  it('reports no cycles when there are none', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Complete' },
        { id: 'STAGE-001-001-002', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-002', to_id: 'STAGE-001-001-001', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.cycles).toHaveLength(0);
  });

  it('computes critical path as the longest chain of unresolved dependencies', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Not Started' },
        { id: 'S2', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Not Started' },
        { id: 'S3', ticket_id: 'T', epic_id: 'E', title: 'S3', status: 'Not Started' },
        { id: 'S4', ticket_id: 'T', epic_id: 'E', title: 'S4', status: 'Not Started' },
      ],
      dependencies: [
        // Chain: S4 -> S3 -> S2 -> S1 (all unresolved)
        { id: 1, from_id: 'S2', to_id: 'S1', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 2, from_id: 'S3', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: false },
        { id: 3, from_id: 'S4', to_id: 'S3', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.critical_path).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('returns empty critical path when all deps are resolved', () => {
    const result = buildGraph({
      epics: [],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T', epic_id: 'E', title: 'S1', status: 'Complete' },
        { id: 'S2', ticket_id: 'T', epic_id: 'E', title: 'S2', status: 'Complete' },
      ],
      dependencies: [
        { id: 1, from_id: 'S2', to_id: 'S1', from_type: 'stage', to_type: 'stage', resolved: true },
      ],
    });
    expect(result.critical_path).toHaveLength(0);
  });

  it('filters by epic', () => {
    const result = buildGraph({
      epics: [
        { id: 'EPIC-001', title: 'Auth', status: 'In Progress' },
        { id: 'EPIC-002', title: 'Pay', status: 'Not Started' },
      ],
      tickets: [],
      stages: [
        { id: 'S1', ticket_id: 'T1', epic_id: 'EPIC-001', title: 'S1', status: 'Design' },
        { id: 'S2', ticket_id: 'T2', epic_id: 'EPIC-002', title: 'S2', status: 'Design' },
      ],
      dependencies: [],
      filters: { epic: 'EPIC-001' },
    });
    expect(result.nodes.some((n) => n.id === 'S1')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'S2')).toBe(false);
    expect(result.nodes.some((n) => n.id === 'EPIC-001')).toBe(true);
    expect(result.nodes.some((n) => n.id === 'EPIC-002')).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/graph.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the graph logic module**

Create `tools/kanban-cli/src/cli/logic/graph.ts`:

```typescript
// ---------- Input data shapes ----------

export interface GraphEpicRow {
  id: string;
  title: string;
  status: string;
}

export interface GraphTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
}

export interface GraphStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
}

export interface GraphDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

// ---------- Output types ----------

export interface GraphNode {
  id: string;
  type: 'epic' | 'ticket' | 'stage';
  status: string;
  title: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'depends_on';
  resolved: boolean;
}

export interface GraphOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  critical_path: string[];
}

export interface GraphFilters {
  epic?: string;
  ticket?: string;
}

export interface BuildGraphInput {
  epics: GraphEpicRow[];
  tickets: GraphTicketRow[];
  stages: GraphStageRow[];
  dependencies: GraphDependencyRow[];
  filters?: GraphFilters;
}

// ---------- Cycle detection (Tarjan's algorithm for SCCs) ----------

function findCycles(adjacency: Map<string, string[]>, nodeIds: Set<string>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const cycles: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adjacency.get(v) || [];
    for (const w of neighbors) {
      if (!nodeIds.has(w)) continue; // skip refs to nodes not in our set
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);

      // Only report components with more than 1 node as cycles
      if (component.length > 1) {
        cycles.push(component.reverse());
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  return cycles;
}

// ---------- Critical path (longest chain of unresolved deps) ----------

function computeCriticalPath(
  adjacency: Map<string, string[]>,
  nodeIds: Set<string>
): string[] {
  // adjacency is from_id -> [to_id] for unresolved deps only.
  // We want the longest path in this DAG.
  // Use DFS with memoization to find longest path from each node.

  const memo = new Map<string, string[]>();

  function longestFrom(node: string): string[] {
    if (memo.has(node)) return memo.get(node)!;

    const neighbors = adjacency.get(node) || [];
    let best: string[] = [];
    for (const next of neighbors) {
      if (!nodeIds.has(next)) continue;
      const sub = longestFrom(next);
      if (sub.length > best.length) {
        best = sub;
      }
    }

    const result = [...best, node];
    memo.set(node, result);
    return result;
  }

  let longest: string[] = [];
  for (const id of nodeIds) {
    const path = longestFrom(id);
    if (path.length > longest.length) {
      longest = path;
    }
  }

  // Only return critical path if there are actual unresolved deps
  return longest.length > 1 ? longest : [];
}

// ---------- Core logic ----------

export function buildGraph(input: BuildGraphInput): GraphOutput {
  const { epics, tickets, stages, dependencies, filters } = input;

  // Apply filters
  let filteredEpics = epics;
  let filteredTickets = tickets;
  let filteredStages = stages;

  if (filters?.epic) {
    filteredEpics = filteredEpics.filter((e) => e.id === filters.epic);
    filteredTickets = filteredTickets.filter((t) => t.epic_id === filters.epic);
    filteredStages = filteredStages.filter((s) => s.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredTickets = filteredTickets.filter((t) => t.id === filters.ticket);
    filteredStages = filteredStages.filter((s) => s.ticket_id === filters.ticket);
  }

  // Build nodes
  const nodes: GraphNode[] = [];
  const nodeIdSet = new Set<string>();

  for (const epic of filteredEpics) {
    nodes.push({ id: epic.id, type: 'epic', status: epic.status, title: epic.title });
    nodeIdSet.add(epic.id);
  }
  for (const ticket of filteredTickets) {
    nodes.push({ id: ticket.id, type: 'ticket', status: ticket.status, title: ticket.title });
    nodeIdSet.add(ticket.id);
  }
  for (const stage of filteredStages) {
    nodes.push({ id: stage.id, type: 'stage', status: stage.status, title: stage.title });
    nodeIdSet.add(stage.id);
  }

  // Build edges (only for deps where both from and to are in our node set)
  const edges: GraphEdge[] = [];
  const unresolvedAdjacency = new Map<string, string[]>();
  const allAdjacency = new Map<string, string[]>();

  for (const dep of dependencies) {
    if (!nodeIdSet.has(dep.from_id) && !nodeIdSet.has(dep.to_id)) continue;

    edges.push({
      from: dep.from_id,
      to: dep.to_id,
      type: 'depends_on',
      resolved: dep.resolved,
    });

    // Build adjacency for all deps (for cycle detection)
    const allNeighbors = allAdjacency.get(dep.from_id) || [];
    allNeighbors.push(dep.to_id);
    allAdjacency.set(dep.from_id, allNeighbors);

    // Build adjacency for unresolved deps only (for critical path)
    if (!dep.resolved) {
      const neighbors = unresolvedAdjacency.get(dep.from_id) || [];
      neighbors.push(dep.to_id);
      unresolvedAdjacency.set(dep.from_id, neighbors);
    }
  }

  // Detect cycles using all dependencies
  const allNodeIds = new Set([...nodeIdSet]);
  // Add dep targets that might not be in our filtered set but are part of cycles
  for (const dep of dependencies) {
    allNodeIds.add(dep.from_id);
    allNodeIds.add(dep.to_id);
  }
  const cycles = findCycles(allAdjacency, allNodeIds);

  // Compute critical path using unresolved deps only
  const criticalPath = computeCriticalPath(unresolvedAdjacency, nodeIdSet);

  return { nodes, edges, cycles, critical_path: criticalPath };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/graph.test.ts`
Expected: All tests PASS.

**Step 5: Verify the project compiles**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 6: Commit**

```bash
git add tools/kanban-cli/src/cli/logic/graph.ts tools/kanban-cli/tests/cli/logic/graph.test.ts
git commit -m "feat(kanban-cli): add graph command logic with cycle detection and critical path"
```

---

### Task 4: Create Graph CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/graph.ts`

**Step 1: Write the graph CLI command**

Create `tools/kanban-cli/src/cli/commands/graph.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { Database } from '../../db/database.js';
import { EpicRepository, TicketRepository, StageRepository, DependencyRepository } from '../../db/repositories.js';
import { syncAll } from '../../sync/sync.js';
import { buildGraph } from '../logic/graph.js';

export const graphCommand = new Command('graph')
  .description('Output dependency graph as JSON')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--epic <id>', 'Filter to a specific epic')
  .option('--ticket <id>', 'Filter to a specific ticket')
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new Database(repoPath);

      syncAll(db, repoPath, config);

      const epics = new EpicRepository(db).findAll();
      const tickets = new TicketRepository(db).findAll();
      const stages = new StageRepository(db).findAll();
      const dependencies = new DependencyRepository(db).findAll();

      const result = buildGraph({
        epics,
        tickets,
        stages,
        dependencies,
        filters: {
          epic: options.epic,
          ticket: options.ticket,
        },
      });

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(result, null, indent) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 2: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/cli/commands/graph.ts
git commit -m "feat(kanban-cli): add graph CLI command wiring options to graph logic"
```

---

### Task 5: Create Next Command Logic

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/next.ts`
- Create: `tools/kanban-cli/tests/cli/logic/next.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/cli/logic/next.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildNext, computePriorityScore } from '../../../src/cli/logic/next.js';
import type { NextStageRow, NextDependencyRow } from '../../../src/cli/logic/next.js';
import type { PipelineConfig } from '../../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Automatic Testing'] },
      { name: 'Automatic Testing', skill: 'automatic-testing', status: 'Automatic Testing', transitions_to: ['Manual Testing'] },
      { name: 'Manual Testing', skill: 'manual-testing', status: 'Manual Testing', transitions_to: ['Finalize'] },
      { name: 'Finalize', skill: 'phase-finalize', status: 'Finalize', transitions_to: ['Done', 'PR Created'] },
      { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
      { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
    ],
  },
};

function makeStage(overrides: Partial<NextStageRow>): NextStageRow {
  return {
    id: 'STAGE-001-001-001',
    ticket_id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Test Stage',
    status: 'Not Started',
    kanban_column: 'ready_for_work',
    refinement_type: '["frontend"]',
    worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
    priority: 0,
    due_date: null,
    session_active: false,
    ...overrides,
  };
}

describe('computePriorityScore', () => {
  it('gives highest score to Addressing Comments', () => {
    const score = computePriorityScore(makeStage({ status: 'Addressing Comments', kanban_column: 'addressing_comments' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(700);
  });

  it('gives second highest score to Manual Testing', () => {
    const score = computePriorityScore(makeStage({ status: 'Manual Testing', kanban_column: 'manual_testing' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(600);
    expect(score).toBeLessThan(700);
  });

  it('gives third highest score to Automatic Testing', () => {
    const score = computePriorityScore(makeStage({ status: 'Automatic Testing', kanban_column: 'automatic_testing' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(500);
    expect(score).toBeLessThan(600);
  });

  it('gives fourth score to Build-ready stages', () => {
    const score = computePriorityScore(makeStage({ status: 'Build', kanban_column: 'build' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(400);
    expect(score).toBeLessThan(500);
  });

  it('gives fifth score to Design-ready stages (Ready for Work)', () => {
    const score = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(300);
    expect(score).toBeLessThan(400);
  });

  it('adds priority field bonus', () => {
    const base = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', priority: 0 }), testConfig);
    const elevated = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', priority: 5 }), testConfig);
    expect(elevated).toBeGreaterThan(base);
  });

  it('adds due date proximity bonus', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const farAway = new Date();
    farAway.setDate(farAway.getDate() + 30);

    const urgent = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', due_date: tomorrow.toISOString().split('T')[0] }), testConfig);
    const notUrgent = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', due_date: farAway.toISOString().split('T')[0] }), testConfig);
    expect(urgent).toBeGreaterThan(notUrgent);
  });
});

describe('buildNext', () => {
  it('returns stages that are ready for work', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(1);
    expect(result.ready_stages[0].id).toBe('S1');
  });

  it('returns stages in pipeline columns (not just ready_for_work)', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Design', kanban_column: 'design' }),
        makeStage({ id: 'S2', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(2);
  });

  it('excludes stages with session_active = true', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Design', kanban_column: 'design', session_active: true }),
        makeStage({ id: 'S2', status: 'Build', kanban_column: 'build', session_active: false }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(1);
    expect(result.ready_stages[0].id).toBe('S2');
    expect(result.in_progress_count).toBe(1);
  });

  it('excludes stages in backlog', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'backlog' }),
      ],
      dependencies: [
        { id: 1, from_id: 'S1', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(0);
    expect(result.blocked_count).toBe(1);
  });

  it('excludes done stages', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Complete', kanban_column: 'done' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(0);
  });

  it('sorts by priority score descending', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
        makeStage({ id: 'S2', status: 'Addressing Comments', kanban_column: 'addressing_comments' }),
        makeStage({ id: 'S3', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].id).toBe('S2'); // Addressing Comments = highest
    expect(result.ready_stages[1].id).toBe('S3'); // Build
    expect(result.ready_stages[2].id).toBe('S1'); // Ready for Work = lowest
  });

  it('respects --max option', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
        makeStage({ id: 'S2', status: 'Design', kanban_column: 'design' }),
        makeStage({ id: 'S3', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
      max: 2,
    });
    expect(result.ready_stages).toHaveLength(2);
  });

  it('marks Manual Testing stages with needs_human = true', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Manual Testing', kanban_column: 'manual_testing' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].needs_human).toBe(true);
  });

  it('marks Design-ready stages with needs_human = false', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].needs_human).toBe(false);
  });

  it('includes to_convert_count from tickets without stages', () => {
    const result = buildNext({
      config: testConfig,
      stages: [],
      dependencies: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', has_stages: false },
        { id: 'TICKET-001-002', epic_id: 'EPIC-001', has_stages: true },
      ],
    });
    expect(result.to_convert_count).toBe(1);
  });

  it('includes priority_reason in output', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Addressing Comments', kanban_column: 'addressing_comments' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].priority_reason).toBe('review_comments_pending');
  });

  it('includes worktree_branch and refinement_type in output', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', worktree_branch: 'my/branch', refinement_type: '["frontend","backend"]' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].worktree_branch).toBe('my/branch');
    expect(result.ready_stages[0].refinement_type).toEqual(['frontend', 'backend']);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/next.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the next logic module**

Create `tools/kanban-cli/src/cli/logic/next.ts`:

```typescript
import type { PipelineConfig } from '../../types/pipeline.js';
import { StateMachine } from '../../engine/state-machine.js';
import { toColumnKey } from './board.js';

// ---------- Input data shapes ----------

export interface NextStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  kanban_column: string;
  refinement_type: string; // JSON array string
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
}

export interface NextDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

export interface NextTicketRow {
  id: string;
  epic_id: string;
  has_stages: boolean;
}

// ---------- Output types ----------

export interface ReadyStage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktree_branch: string;
  refinement_type: string[];
  priority_score: number;
  priority_reason: string;
  needs_human: boolean;
}

export interface NextOutput {
  ready_stages: ReadyStage[];
  blocked_count: number;
  in_progress_count: number;
  to_convert_count: number;
}

export interface BuildNextInput {
  config: PipelineConfig;
  stages: NextStageRow[];
  dependencies: NextDependencyRow[];
  tickets: NextTicketRow[];
  max?: number;
}

// ---------- Priority scoring ----------

/**
 * Statuses that indicate human input is needed.
 * These are identified by checking if the pipeline state name
 * contains "Manual" or "User" or "Feedback".
 */
const HUMAN_KEYWORDS = ['manual', 'user', 'feedback'];

function isHumanRequired(status: string, config: PipelineConfig): boolean {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(status);
  if (!state) return false;
  const lowerName = state.name.toLowerCase();
  return HUMAN_KEYWORDS.some((kw) => lowerName.includes(kw));
}

/**
 * Determine the priority reason from the stage status.
 */
function getPriorityReason(status: string, kanbanColumn: string, config: PipelineConfig): string {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(status);

  if (state && state.name === 'Addressing Comments') return 'review_comments_pending';
  if (state && state.name.toLowerCase().includes('manual')) return 'manual_testing_pending';
  if (state && state.name.toLowerCase().includes('automatic')) return 'automatic_testing_ready';
  if (state && state.name === 'Build') return 'build_ready';

  // Pipeline states that aren't specifically named
  if (state) return `${toColumnKey(state.name)}_ready`;

  // System columns
  if (kanbanColumn === 'ready_for_work') return 'design_ready';

  return 'normal';
}

/**
 * Compute priority score for a stage. Higher = should be worked on sooner.
 *
 * Score ranges:
 * - 700-799: Addressing Comments (review comments to address)
 * - 600-699: Manual Testing (needs user approval)
 * - 500-599: Automatic Testing ready
 * - 400-499: Build ready
 * - 300-399: Design ready (Not Started + deps resolved)
 * - 200-299: Other pipeline states
 *
 * Bonuses:
 * - priority field: +10 per priority level
 * - due_date proximity: +0 to +50 based on days until due
 */
export function computePriorityScore(stage: NextStageRow, config: PipelineConfig): number {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(stage.status);

  let baseScore = 200; // default for pipeline states

  if (state) {
    const name = state.name;
    if (name === 'Addressing Comments') {
      baseScore = 700;
    } else if (name.toLowerCase().includes('manual')) {
      baseScore = 600;
    } else if (name.toLowerCase().includes('automatic') || name.toLowerCase().includes('testing')) {
      // Automatic Testing gets 500, other testing-related gets 500
      if (name.toLowerCase().includes('automatic')) {
        baseScore = 500;
      }
    } else if (name === 'Build') {
      baseScore = 400;
    }
  }

  // Ready for Work (Not Started, deps resolved) = Design ready
  if (stage.kanban_column === 'ready_for_work') {
    baseScore = 300;
  }

  // Priority field bonus
  const priorityBonus = stage.priority * 10;

  // Due date proximity bonus (0-50)
  let dueDateBonus = 0;
  if (stage.due_date) {
    const dueDate = new Date(stage.due_date);
    const now = new Date();
    const daysUntil = Math.max(0, (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    // Closer due date = higher bonus. 0 days = 50, 30+ days = 0
    dueDateBonus = Math.max(0, Math.round(50 - (daysUntil / 30) * 50));
  }

  return baseScore + priorityBonus + dueDateBonus;
}

// ---------- Core logic ----------

export function buildNext(input: BuildNextInput): NextOutput {
  const { config, stages, dependencies, tickets, max } = input;

  // Count blocked stages (in backlog with unresolved deps)
  const blockedStages = stages.filter((s) => s.kanban_column === 'backlog');
  const blockedCount = blockedStages.length;

  // Count in-progress stages (session_active = true)
  const inProgressCount = stages.filter((s) => s.session_active).length;

  // Count to-convert tickets (tickets without stages)
  const toConvertCount = tickets.filter((t) => !t.has_stages).length;

  // Filter to workable stages:
  // - Not in backlog (blocked)
  // - Not in done
  // - Not session_active
  const workableStages = stages.filter((s) => {
    if (s.kanban_column === 'backlog') return false;
    if (s.kanban_column === 'done') return false;
    if (s.session_active) return false;
    return true;
  });

  // Score and sort
  const scored = workableStages.map((stage) => {
    const priorityScore = computePriorityScore(stage, config);
    const priorityReason = getPriorityReason(stage.status, stage.kanban_column, config);
    const needsHuman = isHumanRequired(stage.status, config);

    let refinementType: string[] = [];
    try {
      refinementType = JSON.parse(stage.refinement_type);
    } catch {
      refinementType = [];
    }

    return {
      id: stage.id,
      ticket: stage.ticket_id,
      epic: stage.epic_id,
      title: stage.title,
      worktree_branch: stage.worktree_branch,
      refinement_type: refinementType,
      priority_score: priorityScore,
      priority_reason: priorityReason,
      needs_human: needsHuman,
    } satisfies ReadyStage;
  });

  // Sort by priority score descending
  scored.sort((a, b) => b.priority_score - a.priority_score);

  // Apply max limit
  const limited = max !== undefined ? scored.slice(0, max) : scored;

  return {
    ready_stages: limited,
    blocked_count: blockedCount,
    in_progress_count: inProgressCount,
    to_convert_count: toConvertCount,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/next.test.ts`
Expected: All tests PASS.

**Step 5: Verify the project compiles**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 6: Commit**

```bash
git add tools/kanban-cli/src/cli/logic/next.ts tools/kanban-cli/tests/cli/logic/next.test.ts
git commit -m "feat(kanban-cli): add next command logic with priority scoring and session_active filtering"
```

---

### Task 6: Create Next CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/next.ts`

**Step 1: Write the next CLI command**

Create `tools/kanban-cli/src/cli/commands/next.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { Database } from '../../db/database.js';
import { TicketRepository, StageRepository, DependencyRepository } from '../../db/repositories.js';
import { syncAll } from '../../sync/sync.js';
import { buildNext } from '../logic/next.js';

export const nextCommand = new Command('next')
  .description('Output next workable stages, sorted by priority')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--max <n>', 'Maximum number of stages to return', parseInt)
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new Database(repoPath);

      syncAll(db, repoPath, config);

      const tickets = new TicketRepository(db).findAll();
      const stages = new StageRepository(db).findAll();
      const dependencies = new DependencyRepository(db).findAll();

      const result = buildNext({
        config,
        stages,
        dependencies,
        tickets,
        max: options.max,
      });

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(result, null, indent) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 2: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/cli/commands/next.ts
git commit -m "feat(kanban-cli): add next CLI command wiring options to next logic"
```

---

### Task 7: Create Validate Command Logic

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/validate.ts`
- Create: `tools/kanban-cli/tests/cli/logic/validate.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/cli/logic/validate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateWorkItems } from '../../../src/cli/logic/validate.js';
import type { ValidateEpicRow, ValidateTicketRow, ValidateStageRow, ValidateDependencyRow } from '../../../src/cli/logic/validate.js';

function makeEpic(overrides: Partial<ValidateEpicRow> = {}): ValidateEpicRow {
  return {
    id: 'EPIC-001',
    title: 'Auth',
    status: 'In Progress',
    jira_key: null,
    tickets: ['TICKET-001-001'],
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/EPIC-001.md',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<ValidateTicketRow> = {}): ValidateTicketRow {
  return {
    id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Login',
    status: 'In Progress',
    jira_key: null,
    source: 'local',
    stages: ['STAGE-001-001-001'],
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/TICKET-001-001-login/TICKET-001-001.md',
    ...overrides,
  };
}

function makeStage(overrides: Partial<ValidateStageRow> = {}): ValidateStageRow {
  return {
    id: 'STAGE-001-001-001',
    ticket_id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Login Form',
    status: 'Not Started',
    refinement_type: '["frontend"]',
    worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
    priority: 0,
    due_date: null,
    session_active: false,
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/TICKET-001-001-login/STAGE-001-001-001.md',
    ...overrides,
  };
}

describe('validateWorkItems', () => {
  it('returns valid when everything is consistent', () => {
    const result = validateWorkItems({
      epics: [makeEpic()],
      tickets: [makeTicket()],
      stages: [makeStage()],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete', 'Design', 'Build']),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error for depends_on referencing non-existent ID', () => {
    const result = validateWorkItems({
      epics: [makeEpic()],
      tickets: [makeTicket()],
      stages: [makeStage({ depends_on: ['STAGE-999-999-999'] })],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toContain('STAGE-999-999-999');
    expect(result.errors[0].field).toBe('depends_on');
  });

  it('reports error for circular dependencies', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [
        makeStage({ id: 'S1', depends_on: ['S2'], file_path: 'S1.md' }),
        makeStage({ id: 'S2', depends_on: ['S1'], file_path: 'S2.md' }),
      ],
      dependencies: [
        { from_id: 'S1', to_id: 'S2', resolved: false },
        { from_id: 'S2', to_id: 'S1', resolved: false },
      ],
      allIds: new Set(['S1', 'S2']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.toLowerCase().includes('circular'))).toBe(true);
  });

  it('reports warning for tickets without stages', () => {
    const result = validateWorkItems({
      epics: [makeEpic({ tickets: ['TICKET-001-001'] })],
      tickets: [makeTicket({ stages: [] })],
      stages: [],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].warning).toContain('no stages');
  });

  it('reports error for invalid status values', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [makeStage({ status: 'InvalidStatus' })],
      dependencies: [],
      allIds: new Set(['STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete', 'Design', 'Build']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('InvalidStatus'))).toBe(true);
  });

  it('reports error for duplicate worktree_branch values', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [
        makeStage({ id: 'S1', worktree_branch: 'branch-1', file_path: 'S1.md' }),
        makeStage({ id: 'S2', worktree_branch: 'branch-1', file_path: 'S2.md' }),
      ],
      dependencies: [],
      allIds: new Set(['S1', 'S2']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('worktree_branch'))).toBe(true);
  });

  it('reports error when epic tickets array references non-existent ticket', () => {
    const result = validateWorkItems({
      epics: [makeEpic({ tickets: ['TICKET-999-999'] })],
      tickets: [],
      stages: [],
      dependencies: [],
      allIds: new Set(['EPIC-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('TICKET-999-999'))).toBe(true);
  });

  it('reports error when ticket stages array references non-existent stage', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [makeTicket({ stages: ['STAGE-999-999-999'] })],
      stages: [],
      dependencies: [],
      allIds: new Set(['TICKET-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('STAGE-999-999-999'))).toBe(true);
  });

  it('reports error for invalid cross-entity dependency types', () => {
    // Epics can only depend on epics. Stages can depend on stages/tickets/epics.
    // Tickets can depend on tickets/epics.
    const result = validateWorkItems({
      epics: [makeEpic({ depends_on: ['STAGE-001-001-001'] })],
      tickets: [],
      stages: [makeStage()],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.toLowerCase().includes('invalid dependency type') || e.error.toLowerCase().includes('cannot depend on'))).toBe(true);
  });

  it('reports missing required fields as errors', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [makeStage({ title: '' })],
      dependencies: [],
      allIds: new Set(['STAGE-001-001-001']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'title')).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/validate.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the validate logic module**

Create `tools/kanban-cli/src/cli/logic/validate.ts`:

```typescript
// ---------- Input data shapes ----------

export interface ValidateEpicRow {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  tickets: string[];
  depends_on: string[];
  file_path: string;
}

export interface ValidateTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: string;
  stages: string[];
  depends_on: string[];
  file_path: string;
}

export interface ValidateStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  refinement_type: string;
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
  depends_on: string[];
  file_path: string;
}

export interface ValidateDependencyRow {
  from_id: string;
  to_id: string;
  resolved: boolean;
}

// ---------- Output types ----------

export interface ValidationError {
  file: string;
  field: string;
  error: string;
}

export interface ValidationWarning {
  file: string;
  field: string;
  warning: string;
}

export interface ValidateOutput {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidateInput {
  epics: ValidateEpicRow[];
  tickets: ValidateTicketRow[];
  stages: ValidateStageRow[];
  dependencies: ValidateDependencyRow[];
  allIds: Set<string>;
  validStatuses: Set<string>;
}

// ---------- Helpers ----------

function getEntityType(id: string): 'epic' | 'ticket' | 'stage' | 'unknown' {
  if (id.startsWith('EPIC-')) return 'epic';
  if (id.startsWith('TICKET-')) return 'ticket';
  if (id.startsWith('STAGE-')) return 'stage';
  return 'unknown';
}

/**
 * Check for circular dependencies using DFS cycle detection.
 */
function findCircularDeps(dependencies: ValidateDependencyRow[]): string[][] {
  const adjacency = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const dep of dependencies) {
    const neighbors = adjacency.get(dep.from_id) || [];
    neighbors.push(dep.to_id);
    adjacency.set(dep.from_id, neighbors);
    allNodes.add(dep.from_id);
    allNodes.add(dep.to_id);
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    onStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node) || [];
    for (const next of neighbors) {
      if (onStack.has(next)) {
        // Found a cycle — extract it
        const cycleStart = path.indexOf(next);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
      } else if (!visited.has(next)) {
        dfs(next, path);
      }
    }

    path.pop();
    onStack.delete(node);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

// Valid dependency type rules:
// Epic -> Epic: OK
// Ticket -> Ticket: OK
// Ticket -> Epic: OK
// Stage -> Stage: OK
// Stage -> Ticket: OK
// Stage -> Epic: OK
// Epic -> Ticket: NOT OK
// Epic -> Stage: NOT OK
// Ticket -> Stage: NOT OK
const VALID_DEP_PAIRS: Record<string, Set<string>> = {
  epic: new Set(['epic']),
  ticket: new Set(['ticket', 'epic']),
  stage: new Set(['stage', 'ticket', 'epic']),
};

// ---------- Core logic ----------

export function validateWorkItems(input: ValidateInput): ValidateOutput {
  const { epics, tickets, stages, dependencies, allIds, validStatuses } = input;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const ticketIds = new Set(tickets.map((t) => t.id));
  const stageIds = new Set(stages.map((s) => s.id));

  // --- Validate epics ---
  for (const epic of epics) {
    // Required fields
    if (!epic.title) {
      errors.push({ file: epic.file_path, field: 'title', error: 'Epic title is required' });
    }

    // Validate tickets array references
    for (const ticketId of epic.tickets) {
      if (!ticketIds.has(ticketId) && !allIds.has(ticketId)) {
        errors.push({
          file: epic.file_path,
          field: 'tickets',
          error: `Referenced ticket ${ticketId} does not exist`,
        });
      }
    }

    // Validate depends_on references
    for (const depId of epic.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: epic.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        // Check valid dependency type
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['epic'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: epic.file_path,
            field: 'depends_on',
            error: `Epic cannot depend on ${depType} (${depId}). Epics can only depend on other epics.`,
          });
        }
      }
    }

    // Validate status
    if (!validStatuses.has(epic.status)) {
      errors.push({
        file: epic.file_path,
        field: 'status',
        error: `Invalid status "${epic.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }
  }

  // --- Validate tickets ---
  for (const ticket of tickets) {
    // Required fields
    if (!ticket.title) {
      errors.push({ file: ticket.file_path, field: 'title', error: 'Ticket title is required' });
    }

    // Warning for tickets without stages
    if (ticket.stages.length === 0) {
      warnings.push({
        file: ticket.file_path,
        field: 'stages',
        warning: 'Ticket has no stages — needs conversion',
      });
    }

    // Validate stages array references
    for (const stageId of ticket.stages) {
      if (!stageIds.has(stageId) && !allIds.has(stageId)) {
        errors.push({
          file: ticket.file_path,
          field: 'stages',
          error: `Referenced stage ${stageId} does not exist`,
        });
      }
    }

    // Validate depends_on references
    for (const depId of ticket.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: ticket.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['ticket'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: ticket.file_path,
            field: 'depends_on',
            error: `Ticket cannot depend on ${depType} (${depId}). Tickets can depend on tickets and epics.`,
          });
        }
      }
    }

    // Validate status
    if (!validStatuses.has(ticket.status)) {
      errors.push({
        file: ticket.file_path,
        field: 'status',
        error: `Invalid status "${ticket.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }
  }

  // --- Validate stages ---
  const worktreeBranches = new Map<string, string>(); // branch -> stage file_path

  for (const stage of stages) {
    // Required fields
    if (!stage.title) {
      errors.push({ file: stage.file_path, field: 'title', error: 'Stage title is required' });
    }

    // Validate status
    if (!validStatuses.has(stage.status)) {
      errors.push({
        file: stage.file_path,
        field: 'status',
        error: `Invalid status "${stage.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }

    // Validate depends_on references
    for (const depId of stage.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: stage.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['stage'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: stage.file_path,
            field: 'depends_on',
            error: `Stage cannot depend on ${depType} (${depId}). Invalid dependency type.`,
          });
        }
      }
    }

    // Check unique worktree_branch
    if (stage.worktree_branch) {
      const existingFile = worktreeBranches.get(stage.worktree_branch);
      if (existingFile) {
        errors.push({
          file: stage.file_path,
          field: 'worktree_branch',
          error: `Duplicate worktree_branch "${stage.worktree_branch}" — also used by ${existingFile}`,
        });
      } else {
        worktreeBranches.set(stage.worktree_branch, stage.file_path);
      }
    }
  }

  // --- Check for circular dependencies ---
  const circles = findCircularDeps(dependencies);
  for (const cycle of circles) {
    errors.push({
      file: '',
      field: 'depends_on',
      error: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/cli/logic/validate.test.ts`
Expected: All tests PASS.

**Step 5: Verify the project compiles**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 6: Commit**

```bash
git add tools/kanban-cli/src/cli/logic/validate.ts tools/kanban-cli/tests/cli/logic/validate.test.ts
git commit -m "feat(kanban-cli): add validate command logic with frontmatter and dependency integrity checks"
```

---

### Task 8: Create Validate CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/validate.ts`

**Step 1: Write the validate CLI command**

This command integrates both work-item validation (from Task 7) and pipeline validation (from Stage 0).

Create `tools/kanban-cli/src/cli/commands/validate.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { Database } from '../../db/database.js';
import { EpicRepository, TicketRepository, StageRepository, DependencyRepository } from '../../db/repositories.js';
import { syncAll } from '../../sync/sync.js';
import { validateWorkItems } from '../logic/validate.js';
import type { ValidateOutput } from '../logic/validate.js';
import { validatePipeline } from '../../validators/pipeline-validator.js';
import { ResolverRegistry } from '../../resolvers/registry.js';
import { registerBuiltinResolvers } from '../../resolvers/builtins/index.js';
import { StateMachine } from '../../engine/state-machine.js';
import { RESERVED_STATUSES, COMPLETE_STATUS } from '../../types/pipeline.js';

export const validateCommand = new Command('validate')
  .description('Validate all frontmatter and dependency integrity')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new Database(repoPath);

      // Sync files into database
      syncAll(db, repoPath, config);

      // Load all data from repositories
      const epicRepo = new EpicRepository(db);
      const ticketRepo = new TicketRepository(db);
      const stageRepo = new StageRepository(db);
      const depRepo = new DependencyRepository(db);

      const epics = epicRepo.findAll();
      const tickets = ticketRepo.findAll();
      const stages = stageRepo.findAll();
      const deps = depRepo.findAll();

      // Build the set of all known IDs
      const allIds = new Set<string>();
      for (const e of epics) allIds.add(e.id);
      for (const t of tickets) allIds.add(t.id);
      for (const s of stages) allIds.add(s.id);

      // Build valid status set: reserved + pipeline statuses
      const sm = StateMachine.fromConfig(config);
      const validStatuses = new Set<string>([
        ...RESERVED_STATUSES,
        COMPLETE_STATUS,
        'In Progress',
        'Skipped',
        ...sm.getAllStatuses(),
      ]);

      // Run work-item validation
      const workItemResult = validateWorkItems({
        epics: epics.map((e) => ({
          ...e,
          tickets: e.tickets || [],
          depends_on: e.depends_on || [],
        })),
        tickets: tickets.map((t) => ({
          ...t,
          stages: t.stages || [],
          depends_on: t.depends_on || [],
        })),
        stages: stages.map((s) => ({
          ...s,
          depends_on: s.depends_on || [],
        })),
        dependencies: deps,
        allIds,
        validStatuses,
      });

      // Also run pipeline validation
      const registry = new ResolverRegistry();
      registerBuiltinResolvers(registry);
      const pipelineResult = await validatePipeline(config, { registry });

      // Combine results
      const combined: ValidateOutput & { pipeline_valid: boolean } = {
        valid: workItemResult.valid && pipelineResult.valid,
        errors: [
          ...workItemResult.errors,
          ...pipelineResult.errors.map((e) => ({
            file: '.kanban-workflow.yaml',
            field: 'pipeline',
            error: e,
          })),
        ],
        warnings: [
          ...workItemResult.warnings,
          ...pipelineResult.warnings.map((w) => ({
            file: '.kanban-workflow.yaml',
            field: 'pipeline',
            warning: w,
          })),
        ],
        pipeline_valid: pipelineResult.valid,
      };

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(combined, null, indent) + '\n');
      process.exit(combined.valid ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 2: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/cli/commands/validate.ts
git commit -m "feat(kanban-cli): add validate CLI command integrating work-item and pipeline validation"
```

---

### Task 9: Create Sync CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/sync.ts`

**Step 1: Write the sync CLI command**

This is a thin wrapper around the sync module from 1A. No separate logic file needed — the sync module itself is the logic.

Create `tools/kanban-cli/src/cli/commands/sync.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { Database } from '../../db/database.js';
import { syncAll, syncStage } from '../../sync/sync.js';

export const syncCommand = new Command('sync')
  .description('Force re-parse of files into SQLite')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--stage <id>', 'Sync a single stage by ID (fast)')
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new Database(repoPath);

      const startTime = Date.now();

      if (options.stage) {
        syncStage(db, repoPath, options.stage, config);
      } else {
        syncAll(db, repoPath, config);
      }

      const elapsed = Date.now() - startTime;

      const result = {
        success: true,
        repo: repoPath,
        mode: options.stage ? 'stage' : 'full',
        stage_id: options.stage || null,
        elapsed_ms: elapsed,
      };

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(result, null, indent) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 2: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/cli/commands/sync.ts
git commit -m "feat(kanban-cli): add sync CLI command wrapping 1A sync module"
```

---

### Task 10: Update CLI Entry Point and Index Exports

**Files:**
- Modify: `tools/kanban-cli/src/cli/index.ts`
- Modify: `tools/kanban-cli/src/index.ts`

**Step 1: Update CLI entry point to register all commands**

Update `tools/kanban-cli/src/cli/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { validatePipelineCommand } from './commands/validate-pipeline.js';
import { boardCommand } from './commands/board.js';
import { graphCommand } from './commands/graph.js';
import { nextCommand } from './commands/next.js';
import { validateCommand } from './commands/validate.js';
import { syncCommand } from './commands/sync.js';

const program = new Command();

program
  .name('kanban-cli')
  .description('Config-driven kanban workflow CLI for Claude Code')
  .version('0.1.0');

program.addCommand(validatePipelineCommand);
program.addCommand(boardCommand);
program.addCommand(graphCommand);
program.addCommand(nextCommand);
program.addCommand(validateCommand);
program.addCommand(syncCommand);

program.parse();
```

**Step 2: Update barrel exports**

Update `tools/kanban-cli/src/index.ts` to add the new logic module exports:

```typescript
// Types
export type {
  PipelineConfig,
  PipelineState,
  WorkflowDefaults,
  SkillState,
  ResolverState,
} from './types/pipeline.js';
export {
  RESERVED_STATUSES,
  DONE_TARGET,
  COMPLETE_STATUS,
  isSkillState,
  isResolverState,
} from './types/pipeline.js';

// Config
export { pipelineConfigSchema } from './config/schema.js';
export type { ValidatedPipelineConfig } from './config/schema.js';
export { loadConfig, mergeConfigs, CONFIG_PATHS } from './config/loader.js';
export { defaultPipelineConfig } from './config/defaults.js';

// Engine
export { StateMachine } from './engine/state-machine.js';
export { TransitionValidator } from './engine/transitions.js';
export type { TransitionResult } from './engine/transitions.js';

// Resolvers
export type { ResolverFn, ResolverStageInput, ResolverContext } from './resolvers/types.js';
export { ResolverRegistry } from './resolvers/registry.js';
export { registerBuiltinResolvers } from './resolvers/builtins/index.js';
export { prStatusResolver } from './resolvers/builtins/pr-status.js';
export { stageRouterResolver } from './resolvers/builtins/stage-router.js';

// Validators
export { validateConfig } from './validators/config-validator.js';
export { validateGraph } from './validators/graph-validator.js';
export { validateSkillContent } from './validators/skill-validator.js';
export type { SkillFileReader, SkillContentAnalyzer } from './validators/skill-validator.js';
export { validateResolvers } from './validators/resolver-validator.js';
export { validatePipeline } from './validators/pipeline-validator.js';
export type { PipelineValidationResult, PipelineValidationOptions } from './validators/pipeline-validator.js';

// CLI Logic (usable as library)
export { buildBoard, toColumnKey } from './cli/logic/board.js';
export type { BoardOutput, BoardItem, TicketBoardItem, StageBoardItem, BuildBoardInput, BoardFilters } from './cli/logic/board.js';
export { buildGraph } from './cli/logic/graph.js';
export type { GraphOutput, GraphNode, GraphEdge, BuildGraphInput, GraphFilters } from './cli/logic/graph.js';
export { buildNext, computePriorityScore } from './cli/logic/next.js';
export type { NextOutput, ReadyStage, BuildNextInput } from './cli/logic/next.js';
export { validateWorkItems } from './cli/logic/validate.js';
export type { ValidateOutput, ValidationError, ValidationWarning, ValidateInput } from './cli/logic/validate.js';
```

**Step 3: Run all tests**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all existing tests pass, all new tests pass.

**Step 4: Commit**

```bash
git add tools/kanban-cli/src/cli/index.ts tools/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): wire all CLI commands into entry point and update barrel exports"
```

---

### Completion Checklist

- [ ] Board logic: config-driven columns, system columns, filtering, stats
- [ ] Board CLI: `kanban-cli board` with --epic, --ticket, --column, --exclude-done, --repo, --pretty
- [ ] Graph logic: nodes, edges, cycle detection (Tarjan's SCCs), critical path
- [ ] Graph CLI: `kanban-cli graph` with --epic, --ticket, --repo, --pretty
- [ ] Next logic: priority scoring, session_active filtering, needs_human detection, max limit
- [ ] Next CLI: `kanban-cli next` with --max, --repo, --pretty
- [ ] Validate logic: depends_on refs, circular deps, status values, worktree_branch uniqueness, cross-entity dep types, required fields
- [ ] Validate CLI: `kanban-cli validate` integrating work-item + pipeline validation
- [ ] Sync CLI: `kanban-cli sync` with --stage for partial sync
- [ ] CLI entry point updated with all 5 new commands
- [ ] Barrel exports updated with all logic modules
- [ ] All new tests passing
- [ ] All existing tests still passing
- [ ] `npm run verify` passes after every task
- [ ] Each task committed incrementally
