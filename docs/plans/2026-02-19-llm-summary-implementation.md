# LLM Summary Command — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the regex-based markdown body parser in `kanban-cli summary` with LLM-based summarization using `claude -p`, with SQLite caching and hierarchical summarization (stages -> tickets -> epics).

**Architecture:** The summary logic module is rewritten to use a `SummaryEngine` that shells out to `claude -p` via an injectable executor function (for testability). A new `summaries` SQLite table caches results keyed by content hash. The CLI command gains `--model` and `--no-cache` flags. The old `parseStageBody()` and related code is removed.

**Tech Stack:** TypeScript, node:child_process (execFileSync), node:crypto (SHA-256), better-sqlite3, Commander.js, Vitest

---

### Task 1: Add summaries table to DB schema

**Files:**
- Modify: `tools/kanban-cli/src/db/schema.ts`
- Create: `tools/kanban-cli/src/db/repositories/summary-repository.ts`
- Create: `tools/kanban-cli/tests/db/summary-repository.test.ts`

**Step 1: Write the failing tests**

Create `tests/db/summary-repository.test.ts` with tests for:
- `upsert()` inserts a new summary
- `upsert()` updates an existing summary (same id, different hash)
- `findById()` returns the summary or null
- `findByIdAndHash()` returns summary only when hash matches
- `deleteByRepo()` removes all summaries for a repo

**Step 2: Add the table to schema.ts**

Add to the `ALL_CREATE_STATEMENTS` array:

```sql
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  PRIMARY KEY (id, repo_id)
);
```

**Step 3: Implement SummaryRepository**

Create `src/db/repositories/summary-repository.ts`:

```typescript
export interface SummaryRow {
  id: string;
  type: string;
  content_hash: string;
  model: string;
  summary: string;
  created_at: string;
  repo_id: number;
}

export interface SummaryUpsertData {
  id: string;
  type: string;
  content_hash: string;
  model: string;
  summary: string;
  repo_id: number;
}

export class SummaryRepository {
  constructor(private db: KanbanDatabase) {}

  upsert(data: SummaryUpsertData): void { ... }
  findById(id: string, repoId: number): SummaryRow | null { ... }
  findByIdAndHash(id: string, contentHash: string, repoId: number): SummaryRow | null { ... }
  deleteByRepo(repoId: number): void { ... }
}
```

Use `INSERT OR REPLACE` for upsert.

**Step 4: Run tests, verify pass**

**Step 5: Commit**
```
feat(kanban-cli): add summaries cache table and repository
```

---

### Task 2: Create the Claude executor utility

**Files:**
- Create: `tools/kanban-cli/src/utils/claude-executor.ts`
- Create: `tools/kanban-cli/tests/utils/claude-executor.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `executeClaudePrompt()` calls `claude` with correct args (`-p`, `--model`)
- Returns stdout as the summary text
- Throws descriptive error when claude is not installed (ENOENT)
- Throws descriptive error when claude exits with non-zero code
- Trims whitespace from output

**Step 2: Implement**

```typescript
export type ClaudeExecutorFn = (prompt: string, model: string) => string;

export function createClaudeExecutor(
  execFn?: (cmd: string, args: string[], input: string) => string
): ClaudeExecutorFn {
  const exec = execFn ?? defaultExec;
  return (prompt: string, model: string): string => {
    return exec('claude', ['-p', '--model', model], prompt).trim();
  };
}

function defaultExec(cmd: string, args: string[], input: string): string {
  return execFileSync(cmd, args, {
    input,
    encoding: 'utf-8',
    timeout: 60000,
  });
}
```

Injectable `execFn` allows tests to mock without touching the real CLI.

**Step 3: Run tests, verify pass**

**Step 4: Commit**
```
feat(kanban-cli): add claude executor utility for LLM summarization
```

---

### Task 3: Create the summary engine

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/summary-engine.ts`
- Create: `tools/kanban-cli/tests/cli/logic/summary-engine.test.ts`

**Step 1: Write the failing tests**

Tests for:
- `computeHash()` returns consistent SHA-256 hex for same input
- `summarizeStage()` calls executor with stage prompt + file content
- `summarizeStage()` returns cached summary on cache hit (same hash)
- `summarizeStage()` re-summarizes on cache miss (different hash)
- `summarizeStage()` re-summarizes when model differs and --model specified
- `summarizeStage()` returns cached summary when model differs but --model NOT specified
- `summarizeTicket()` concatenates stage summaries sorted by ID, calls executor
- `summarizeTicket()` uses cached ticket summary when stage summaries unchanged
- `summarizeEpic()` concatenates ticket summaries sorted by ID, calls executor
- `summarizeEpic()` uses cached epic summary when ticket summaries unchanged
- `--no-cache` flag bypasses cache lookup
- Partial failure: stage summary fails, ticket summary notes the gap

**Step 2: Implement**

```typescript
import { createHash } from 'node:crypto';

export interface SummaryEngineOptions {
  executor: ClaudeExecutorFn;
  summaryRepo: SummaryRepository;
  repoId: number;
  model?: string;       // explicit model from --model flag
  noCache?: boolean;     // --no-cache flag
}

export interface StageSummaryInput {
  id: string;
  title: string;
  fileContent: string;
}

export interface TicketSummaryInput {
  id: string;
  title: string;
  stageIds: string[];
}

export interface EpicSummaryInput {
  id: string;
  title: string;
  ticketIds: string[];
}

export interface SummaryResult {
  id: string;
  title: string;
  type: 'stage' | 'ticket' | 'epic';
  summary: string;
  model: string;
  cached: boolean;
}

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class SummaryEngine {
  private stageSummaries = new Map<string, string>();

  constructor(private options: SummaryEngineOptions) {}

  summarizeStage(input: StageSummaryInput): SummaryResult { ... }
  summarizeTicket(input: TicketSummaryInput): SummaryResult { ... }
  summarizeEpic(input: EpicSummaryInput): SummaryResult { ... }

  private resolveModel(cachedModel?: string): string { ... }
  private shouldUseCached(cached: SummaryRow | null, contentHash: string): boolean { ... }
}
```

The engine stores intermediate stage summaries in-memory so ticket summarization can access them without re-querying the DB.

**Prompt templates** as constants:

```typescript
const STAGE_PROMPT = `Summarize what was accomplished in this development stage. Focus on: what was designed or decided, what was built, any issues encountered, and current status. Be concise (2-4 sentences).

---
`;

const TICKET_PROMPT = `Summarize this development ticket based on its stage summaries. Focus on: overall goal, what's been completed, what remains, and any notable decisions or issues. Be concise (2-4 sentences).

---
`;

const EPIC_PROMPT = `Summarize this epic based on its ticket summaries. Focus on: the epic's overall objective, progress across tickets, and high-level status. Be concise (2-4 sentences).

---
`;
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**
```
feat(kanban-cli): add summary engine with hierarchical LLM summarization and caching
```

---

### Task 4: Rewrite the summary command

**Files:**
- Rewrite: `tools/kanban-cli/src/cli/logic/summary.ts`
- Rewrite: `tools/kanban-cli/src/cli/commands/summary.ts`
- Rewrite: `tools/kanban-cli/tests/cli/logic/summary.test.ts`
- Rewrite: `tools/kanban-cli/tests/cli/logic/summary-integration.test.ts`

**Step 1: Rewrite the logic module**

Replace `summary.ts` with a thin orchestrator that:
1. Resolves IDs to stages/tickets/epics (same as current)
2. Creates a `SummaryEngine` with the executor and repo
3. For stage IDs: calls `engine.summarizeStage()`
4. For ticket IDs: calls `engine.summarizeStage()` for each child, then `engine.summarizeTicket()`
5. For epic IDs: summarizes all stages, then tickets, then epic
6. Returns `SummaryOutput` with the new format

Remove `parseStageBody()`, `splitSections()`, `extractField()`, `extractBuildSummary()` and related types (`ParsedStageBody`, etc.).

**Step 2: Update the command**

Add `--model` and `--no-cache` options:
```typescript
.option('--model <model>', 'Claude model for summarization')
.option('--no-cache', 'Force re-summarization, ignore cache', false)
```

Pass these to the engine options.

**Step 3: Rewrite unit tests**

Replace body-parser tests with engine integration tests using a mock executor.

**Step 4: Rewrite integration tests**

Use a mock executor (not real `claude -p`) that returns canned summaries. Verify:
- Single stage summary
- Ticket expansion with stage summaries
- Epic expansion with hierarchical summarization
- `--model` flag causes re-summarization
- `--no-cache` flag bypasses cache
- `--pretty` and `-o` still work

**Step 5: Run full test suite**

**Step 6: Commit**
```
feat(kanban-cli): rewrite summary command with LLM-based summarization

Replace regex-based markdown body parser with claude -p invocation.
Summaries are cached in SQLite with content hash invalidation.
Supports --model and --no-cache flags.
```

---

### Task 5: Update exports and verify

**Files:**
- Modify: `tools/kanban-cli/src/index.ts`

**Step 1: Export new modules**

Add exports for:
- `SummaryRepository` and types from `src/db/repositories/summary-repository.ts`
- `createClaudeExecutor` and `ClaudeExecutorFn` from `src/utils/claude-executor.ts`
- `SummaryEngine`, `computeHash`, and types from `src/cli/logic/summary-engine.ts`

Remove exports for old types (`ParsedStageBody`, `SummaryStageInput` if changed, etc.)

**Step 2: Run `npm run verify`**

Confirm: lint clean, type-check clean, all tests pass.

**Step 3: Commit**
```
feat(kanban-cli): export LLM summary modules and clean up old types
```

---

### Summary Table

| Task | Module | New Files | Tests |
|------|--------|-----------|-------|
| 1 | DB schema + repository | 2 | ~5 |
| 2 | Claude executor | 2 | ~5 |
| 3 | Summary engine | 2 | ~12 |
| 4 | Command rewrite | 0 (rewrites 4) | ~10 |
| 5 | Exports + verify | 0 (modify 1) | 0 |
| **Total** | | **6 new, 5 modified** | **~32** |
