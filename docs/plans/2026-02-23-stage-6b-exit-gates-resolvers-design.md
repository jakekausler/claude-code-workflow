# Stage 6B: Exit Gates & Resolver Execution — Design Document

## Date: 2026-02-23

## Overview

Stage 6B adds two capabilities to the orchestrator:

1. **Exit Gates** — After a Claude session exits, propagate the stage's new status through the ticket → epic file hierarchy and sync SQLite.
2. **Resolver Execution** — On each tick, before spawning sessions, find stages in resolver states and execute their resolver functions programmatically.

Additionally, the orchestrator gains **"Not Started" onboarding** — auto-transitioning stages from the reserved "Not Started" status to the pipeline's entry phase before spawning sessions.

## Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | How to call `kanban-cli sync`? | Direct import of `syncRepo()` | Type-safe, no subprocess overhead. Follows locker pattern. |
| 2 | How to update ticket/epic files? | Frontmatter fields (`stage_statuses`, `ticket_statuses`) | Machine-parseable, atomic, Zod-validated. No markdown table regex. |
| 3 | Where do resolvers live? | Import from kanban-cli registry | Keeps resolver logic centralized. Orchestrator just calls them. |
| 4 | Separate resolver module? | Yes — `resolvers.ts` in orchestrator | Clean separation from exit gates. Different triggers and error semantics. |
| 5 | `testing-router` data access? | Read from `ResolverStageInput` (populated from frontmatter) | Stage data already includes `refinement_type`. |
| 6 | Sync failure handling? | Retry once, then warn | SQLite is a cache; files are source of truth. Stale cache is recoverable. |
| 7 | "Not Started" onboarding? | Auto-transition in orchestrator tick cycle | Update frontmatter to entry phase after lock, before skill lookup. |
| 8 | `testing-router` in default pipeline? | Register as builtin only, not in default pipeline | Users add it to their config if needed. |

## Architecture

### Approach: Minimal Extension (Two New Modules)

Two new modules in `tools/orchestrator/src/`:

- **`exit-gates.ts`** — `createExitGateRunner(deps)` factory. Handles status verification, ticket/epic frontmatter updates, sync with retry.
- **`resolvers.ts`** — `createResolverRunner(deps)` factory. Discovers resolver-state stages, executes resolvers from kanban-cli registry, delegates propagation to exit gate runner.

Both follow the existing DI pattern (`Partial<Deps>` with factory functions).

### Modified Tick Cycle

```
BEFORE (6A):
  1. Check available slots
  2. Discover ready stages
  3. For each stage: lock → lookup skill → worktree → spawn

AFTER (6B):
  1. Run resolver checks: resolverRunner.checkAll(context)
  2. Check available slots
  3. Discover ready stages
  4. For each stage:
     a. Lock stage
     b. Read status
     c. If status === "Not Started": onboard to entry phase
     d. Lookup skill name (skip if null = resolver state)
     e. Create worktree → spawn session

handleSessionExit (after logging, before cleanup):
  If status changed: exitGateRunner.run(workerInfo, statusAfter)
```

## Schema Changes

### Ticket Frontmatter — New `stage_statuses` Field

```yaml
---
id: TICKET-001-001
epic: EPIC-001
title: User Authentication
status: In Progress
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
stage_statuses:
  STAGE-001-001-001: Build
  STAGE-001-001-002: Not Started
depends_on: []
---
```

Type: `Record<string, string>` — maps stage IDs to current status. Optional, defaults to `{}`.

### Epic Frontmatter — New `ticket_statuses` Field

```yaml
---
id: EPIC-001
title: Sentry Explorer
status: In Progress
tickets:
  - TICKET-001-001
  - TICKET-001-002
ticket_statuses:
  TICKET-001-001: In Progress
  TICKET-001-002: Not Started
depends_on: []
---
```

Type: `Record<string, string>` — maps ticket IDs to current status. Optional, defaults to `{}`.

## Exit Gate Module

### Interface

```typescript
interface ExitGateDeps {
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
  syncRepo: (options: SyncOptions) => SyncResult;
  logger: Logger;
}

interface ExitGateResult {
  statusChanged: boolean;
  statusBefore: string;
  statusAfter: string;
  ticketUpdated: boolean;
  epicUpdated: boolean;
  syncResult: { success: boolean; error?: string };
}

interface ExitGateRunner {
  run(workerInfo: WorkerInfo, statusAfter: string): Promise<ExitGateResult>;
}
```

### Sequence

1. Compare `statusBefore` vs `statusAfter` — return early if unchanged
2. Resolve ticket file path: `epics/<epic>/<ticket>/<ticket>.md`
3. Read ticket frontmatter → update `stage_statuses[stageId] = statusAfter` → write
4. Resolve epic file path: `epics/<epic>/<epic>.md`
5. Read epic frontmatter → derive ticket status → update `ticket_statuses[ticketId]` → write
6. Call `syncRepo()` with retry-once-then-warn
7. Return `ExitGateResult`

### Ticket Status Derivation

When updating epic's `ticket_statuses`, derive ticket status from its `stage_statuses`:

- All stages "Complete" → "Complete"
- Any stage in a pipeline phase → "In Progress"
- All stages "Not Started" → "Not Started"

Stage 6C will implement the full completion cascade.

## Resolver Execution Module

### Interface

```typescript
interface ResolverRunnerDeps {
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
  registry: ResolverRegistry;
  exitGateRunner: ExitGateRunner;
  discoverStageFiles: (repoPath: string) => Promise<string[]>;
  logger: Logger;
}

interface ResolverResult {
  stageId: string;
  resolverName: string;
  previousStatus: string;
  newStatus: string | null;
  propagated: boolean;
}

interface ResolverRunner {
  checkAll(context: ResolverContext): Promise<ResolverResult[]>;
}
```

### Sequence

1. Discover all stage files in `epics/` directory
2. For each stage file:
   a. Read frontmatter → get status, session_active
   b. Skip if `session_active === true`
   c. Look up pipeline phase for this status → skip if not a resolver state
   d. Build `ResolverStageInput` from frontmatter
   e. Execute resolver via registry
   f. If result is null → skip
   g. If result is a target status → update stage frontmatter, run exit gate propagation
3. Return array of `ResolverResult`

### ResolverContext

Built by orchestrator with:
- `env`: `process.env`
- `codeHost`: created via `createCodeHostAdapter()` from kanban-cli

## Resolver Implementations

### `pr-status` (Updated)

Simplified to merge-only check. Comment detection deferred to Stage 6D.

```typescript
export const prStatusResolver: ResolverFn = async (stage, context) => {
  if (!context.codeHost || !stage.pr_url) return null;
  const status = await context.codeHost.getPRStatus(stage.pr_url);
  if (status.merged) return 'Done';
  return null;
};
```

### `testing-router` (New)

Routes based on `refinement_type`. Replaces the current no-op stub.

```typescript
export const testingRouterResolver: ResolverFn = (stage, _context) => {
  const types = stage.refinement_type ?? [];
  const needsManualTesting = types.some(t =>
    ['frontend', 'ux', 'accessibility'].includes(t)
  );
  return needsManualTesting ? 'Manual Testing' : 'Finalize';
};
```

## "Not Started" Onboarding

In the tick cycle, after locking a stage and before skill lookup:

```typescript
if (statusBefore === 'Not Started') {
  const entryPhase = pipelineConfig.workflow.entry_phase;
  const entryState = pipelineConfig.workflow.phases.find(p => p.name === entryPhase);
  if (entryState) {
    await writeFrontmatter(stageFilePath, { ...data, status: entryState.status }, content);
    statusBefore = entryState.status;
  }
}
```

## What Stage 6B Does NOT Include

- ❌ Completion cascade (stage Done → ticket Complete → epic Complete) → Stage 6C
- ❌ Backlog re-evaluation → Stage 6C
- ❌ MR comment polling cron → Stage 6D
- ❌ Insights threshold cron → Stage 6E
- ❌ Changes to session spawning or worktree infrastructure (6A)

## Testing Strategy

All tests use injected dependencies — no real file I/O, no real subprocess calls, no real APIs.

### Unit Tests — Orchestrator

- Exit gate: skips on unchanged status, updates ticket/epic frontmatter, retries sync, handles missing files
- Resolver runner: skips locked stages, skips non-resolver states, executes and propagates, handles errors
- Loop: onboards "Not Started", calls exit gate on status change, runs resolvers before discovery

### Unit Tests — kanban-cli

- `pr-status`: merge-only logic (Done on merge, null otherwise)
- `testing-router`: routes by refinement_type
- Schema: `stage_statuses` and `ticket_statuses` parse correctly

### Integration Tests

- End-to-end exit gate flow with mock files
- End-to-end resolver flow with mock code host adapter
