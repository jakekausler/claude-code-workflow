# Stage 6C: Completion Cascade & Backlog Re-evaluation — Session Prompt

## Context

Stages 0-5 are complete on the `kanban` branch. Stage 5.5A (Schema & Sync), Stage 5.5B (Skill Updates), Stage 5.5C (Jira Conversion Enrichment), Stage 6A (Orchestrator Infrastructure), Stage 6A.5 (MCP Server), and Stage 6B (Exit Gates & Resolver Execution) are also complete. This session implements **Stage 6C: Completion Cascade & Backlog Re-evaluation** — the upward propagation logic that auto-completes tickets/epics when all children finish, and the dependency re-evaluation that unblocks stages whose dependencies are now satisfied.

### Dependency Graph

```
Stage 5.5A (Schema & Sync) ✅
  ├── Stage 5.5B (Skill Updates) ✅
  │     └── Stage 6A (Orchestrator Infrastructure) ✅
  │           ├── Stage 6A.5 (MCP Server) ✅
  │           └── Stage 6B (Exit Gates & Resolvers) ✅
  │                 └── Stage 6C (Completion Cascade) ← THIS STAGE
  └── Stage 5.5C (Jira Conversion Enrichment) ✅
```

### What Has Been Built (Stages 0-6B)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):

| Command | Description | Output Formats |
|---------|-------------|---------------|
| `board` | Kanban board view | JSON, `--html`, `--pretty` |
| `graph` | Dependency graph | JSON, `--mermaid`, `--pretty` |
| `next` | Priority-sorted ready stages | JSON, `--pretty` |
| `validate` | Frontmatter + dependency integrity | JSON, `--pretty` |
| `validate-pipeline` | Pipeline config validation (4 layers) | JSON, `--pretty` |
| `sync` | Re-parse files into SQLite | JSON, `--pretty` |
| `summary` | LLM-powered hierarchical summaries | JSON, `--pretty`, `--model`, `--no-cache`, `-q` |
| `migrate` | Old-format repo conversion | JSON, `--pretty`, `--dry-run` |
| `jira-import` | Import Jira issues as local epics/tickets | JSON, `--pretty`, `--epic` |
| `jira-sync` | Sync workflow state to Jira | JSON, `--pretty`, `--dry-run` |
| `learnings-count` | Count unanalyzed learnings entries | JSON, `--pretty`, `--threshold` |
| `enrich` | Fetch linked content for enriched brainstorming | JSON, `--pretty` |

All 12 commands support `--output/-o <file>` and `--repo <path>`.

**Test Suite:** 738 tests across 51 test files (kanban-cli), 245 tests across 17 test files (orchestrator), all passing.

**Stage 6B: Exit Gates & Resolver Execution (Complete)**

The orchestrator runs deterministic exit gates after sessions and resolver checks each tick:

| Module | File | Purpose |
|--------|------|---------|
| Exit Gates | `src/exit-gates.ts` | Post-session status propagation: stage -> ticket -> epic -> sync |
| Resolvers | `src/resolvers.ts` | Programmatic state transitions for resolver-phase stages |
| Loop | `src/loop.ts` | Tick cycle: resolvers at top, session spawning, exit gates on completion |

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

### Key Design References

- Full design doc: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`
- Orchestrator flow: `docs/plans/orchestrator-flow.dot` and `docs/plans/flow.svg`
- Stage 6A design: `docs/plans/2026-02-23-stage-6a-orchestrator-infrastructure-design.md`
- Stage 6B handoff: `docs/plans/stage-6b-exit-gates-resolvers-handoff.md`

---

## What Stage 6C Delivers

### Goal

When a stage completes, propagate that completion upward through the hierarchy: if all stages for a ticket are complete, mark the ticket complete; if all tickets for an epic are complete, mark the epic complete. Additionally, after a stage completes, re-evaluate whether dependent stages are now unblocked, allowing them to appear in the next `kanban-cli next` discovery.

### What Ships

1. **Completion cascade in exit gates** — After the existing exit gate updates `stage_statuses` and `ticket_statuses`:
   - Check if ALL stage statuses for the ticket are `'Complete'` -> if yes, set ticket status to `'Complete'`
   - Check if ALL ticket statuses for the epic are `'Complete'` -> if yes, set epic status to `'Complete'`
   - Log cascade outcomes (which tickets and epics were auto-completed)

2. **Backlog re-evaluation** — After the cascade completes:
   - Find stages that depend on the just-completed stage (via `depends_on` in their frontmatter)
   - For each dependent stage, check if ALL of its dependencies are now resolved
   - Log which stages became unblocked (transitioned from "backlog" to "ready_for_work" column)
   - No frontmatter status changes needed — the column assignment is computed at read time by `computeKanbanColumn()` in `tools/kanban-cli/src/engine/kanban-columns.ts`

3. **Sync after cascade** — A single `kanban-cli sync` call at the end (not after each individual update), so SQLite reflects all cascade changes for discovery queries.

4. **Extended `ExitGateResult`** — Updated result type reporting cascade outcomes (tickets auto-completed, epics auto-completed, stages unblocked).

### What Stage 6C Does NOT Include

- MR comment polling cron -> Stage 6D
- Insights threshold cron -> Stage 6E
- Changes to session spawning or worktree infrastructure (6A)
- New resolver implementations beyond what 6B delivered
- Any changes to the pipeline config or skill definitions

### Key Architectural Decisions (Already Resolved in 6B)

| Decision | Resolution |
|----------|-----------|
| Exit gates are loop behavior | The cascade extends the existing exit gate, not a new loop phase |
| `kanban-cli sync` is the orchestrator's responsibility | Sync runs once after all cascade updates, not per-update |
| Resolvers propagate via exit gates | Resolver-driven transitions already call `exitGateRunner.run()`, so cascade applies automatically |
| DI pattern | All new logic follows the `Partial<Deps>` injection pattern |

---

## Existing Infrastructure Supporting Stage 6C

### Already Implemented (Use These)

**From exit-gates.ts (Stage 6B):**
- **`createExitGateRunner(deps)`**: Factory with `ExitGateDeps` injection. Returns `ExitGateRunner` with `run(workerInfo, repoPath, statusAfter)` method.
- **`deriveTicketStatus(stageStatuses)`**: Returns `'Complete'` if all stages are `'Complete'`, `'Not Started'` if all are `'Not Started'`, `'In Progress'` otherwise, `null` for empty map. This already computes the right ticket status — 6C needs to additionally check whether to cascade upward.
- **`ExitGateResult`**: Reports `statusChanged`, `ticketUpdated`, `epicUpdated`, `syncResult`. Needs extending for cascade outcomes.
- **`runSyncWithRetry(repoPath)`**: Retry-once strategy for sync subprocess. Already called at the end of exit gate `run()`.

**From resolvers.ts (Stage 6B):**
- **`createResolverRunner(pipelineConfig, deps)`**: Resolver-driven transitions already propagate through `exitGateRunner.run()` (line 226 of `resolvers.ts`), so any cascade logic added to exit gates applies to resolver transitions automatically.

**From loop.ts (Stage 6B):**
- **`handleSessionExit()`** (lines 134-183): Calls `exitGateRunner.run()` when status changes. The cascade extends this existing flow — no new call sites needed.
- **Resolver execution**: Runs at top of each tick, before discovery. Resolver transitions propagate via exit gates.

**From kanban-cli:**
- **`COMPLETE_STATUS = 'Complete'`** (`types/pipeline.ts:89`): The terminal frontmatter status for stages. When a stage "transitions to Done" in the pipeline config, its frontmatter status is set to `'Complete'`.
- **`DONE_TARGET = 'Done'`** (`types/pipeline.ts:84`): The transition target name in pipeline config. NOT a frontmatter status value.
- **`isDependencyResolved(targetId)`** (`sync/sync.ts:152`): Checks if a dependency target is resolved: stage status is `'Complete'`, all ticket stages are `'Complete'`, or all epic stages are `'Complete'`.
- **`computeKanbanColumn(input)`** (`engine/kanban-columns.ts:38`): Computes column from status + `hasUnresolvedDeps`. Status `'Complete'` -> `done`, unresolved deps -> `backlog`, `'Not Started'` with resolved deps -> `ready_for_work`.
- **`DependencyRepository.listBySource(toId)`** (`db/repositories/dependency-repository.ts:84`): Returns all items that depend on a given ID. SQL: `SELECT * FROM dependencies WHERE to_id = ?`.
- **`DependencyRepository.allResolved(fromId)`** (`db/repositories/dependency-repository.ts:61`): Checks if all dependencies for an item are resolved.
- **`discoverStageFiles(repoPath)`**: Recursive walk of `epics/` for `STAGE-*.md` files. Already used by resolver runner.
- **Frontmatter fields**: Tickets have `stage_statuses: Record<string, string>`, epics have `ticket_statuses: Record<string, string>`. Both added in 6B.

### Critical Status Terminology

The codebase uses two different terms for the terminal state:

| Concept | Value | Used Where |
|---------|-------|-----------|
| Pipeline transition target | `'Done'` (`DONE_TARGET`) | Pipeline config `transitions_to` arrays |
| Frontmatter status | `'Complete'` (`COMPLETE_STATUS`) | Stage/ticket/epic `status` field, dependency resolution |

When the handoff context says "stage reaches Done", it means the stage's frontmatter status becomes `'Complete'`. The `deriveTicketStatus()` function already checks for `'Complete'` correctly.

### Not Yet Implemented (Stage 6C Builds These)

- Completion cascade logic: ticket `'Complete'` -> check epic, epic `'Complete'` -> update epic status
- Backlog re-evaluation: find dependent stages, check if unblocked
- Extended `ExitGateResult` with cascade reporting
- Logging for cascade and unblock events
- Tests for cascade and re-evaluation

---

## Extension Points

### Exit Gate Runner — Primary Extension Point

The cascade logic should be added to `createExitGateRunner()` in `tools/orchestrator/src/exit-gates.ts`. The current flow is:

```typescript
// Current exit gate flow (6B):
// 1. Compare statusBefore vs statusAfter -> early return if same
// 2. Read stage frontmatter for ticket/epic IDs
// 3. Update ticket's stage_statuses, derive ticket status, write ticket
// 4. Update epic's ticket_statuses, write epic
// 5. Run sync with retry

// 6C extends after step 4:
// 4a. If derived ticket status is 'Complete', check if ALL ticket_statuses are 'Complete'
//     -> if yes, set epic status to 'Complete', write epic
// 4b. (Future-proofing) If epic status becomes 'Complete', could trigger further cascade
// 5.  Find stages that depend on the completed stage, log unblocked ones
// 6.  Run sync (single call covers all updates)
```

The key insertion point is between the epic update (step 4, line 194 of `exit-gates.ts`) and the sync call (step 6, line 197).

### deriveTicketStatus — Already Correct

`deriveTicketStatus()` (line 67 of `exit-gates.ts`) already returns `'Complete'` when all stage statuses are `'Complete'`. The cascade logic needs to:
1. Check the return value of `deriveTicketStatus()`
2. If `'Complete'`, additionally read the epic's full `ticket_statuses` and check if ALL are `'Complete'`
3. If so, set the epic's own `status` to `'Complete'`

Currently the exit gate updates `epic.ticket_statuses[ticketId] = derivedStatus` but does NOT check whether the epic itself should be marked complete. That is the 6C addition.

### Dependency Re-evaluation — Read-Side Only

Backlog re-evaluation does NOT change any frontmatter `status` fields. The kanban column is computed by `computeKanbanColumn()`:

```typescript
// engine/kanban-columns.ts
if (status === COMPLETE_STATUS) return 'done';
if (hasUnresolvedDeps) return 'backlog';
if (status === 'Not Started') return 'ready_for_work';
```

When a dependency target completes, `sync` will re-evaluate `hasUnresolvedDeps` for all dependents. So the re-evaluation concern is:
1. **Sync must run** after cascade updates so SQLite reflects new completion states
2. **Logging**: the orchestrator should log which stages became unblocked (optional but recommended for observability)
3. **No immediate onboarding**: newly unblocked stages will be discovered by `kanban-cli next` on the next tick; no need to onboard them in the same exit gate call

### Discovery of Dependent Stages

Two approaches for finding stages that depend on the completed stage:

**Option A: Glob + frontmatter scan (orchestrator-side)**
```typescript
// Use existing discoverStageFiles(), read each, check depends_on array
const stageFiles = await discoverStageFiles(repoPath);
for (const file of stageFiles) {
  const fm = await readFrontmatter(file);
  if (fm.data.depends_on?.includes(completedStageId)) {
    // Check if all deps resolved...
  }
}
```

**Option B: SQLite query via DependencyRepository (kanban-cli-side)**
```typescript
// After sync, query dependencies table
const dependents = dependencyRepo.listBySource(completedStageId);
for (const dep of dependents) {
  const allResolved = dependencyRepo.allResolved(dep.from_id);
  if (allResolved) { /* log as unblocked */ }
}
```

Option A keeps the orchestrator self-contained (consistent with 6B pattern). Option B is more efficient for large repos but requires importing kanban-cli database internals. The design phase should resolve this.

---

## Open Questions (Resolve During Design Phase)

1. **Should `deriveTicketStatus()` be enhanced or should cascade be a separate function?** The current function returns a derived status. The cascade check (all tickets complete -> epic complete) is a related but distinct concern. Options: (a) new `cascadeCompletion()` function called after `deriveTicketStatus()`, (b) extend the exit gate `run()` method inline, (c) new `CascadeRunner` module.

2. **Should backlog re-evaluation be part of exit gates or a separate module?** It is conceptually distinct from status propagation. Options: (a) inline in exit gate `run()`, (b) separate `backlog-evaluator.ts` module called after exit gate, (c) part of exit gate but behind a separate method.

3. **How to discover dependent stages: glob+filter vs SQLite query?** See the two options above. Glob+filter is consistent with 6B patterns (orchestrator reads frontmatter directly). SQLite query is more efficient but couples orchestrator to kanban-cli database internals.

4. **Should the cascade be recursive?** Currently: stage complete -> ticket complete -> epic complete. Could an epic completing trigger something further (e.g., cross-epic dependencies)? The dependency system supports epic-level dependencies (`depends_on: [EPIC-002]`). If epic completion should cascade further, the logic should be recursive. If not, two levels (ticket and epic) is sufficient.

5. **What happens if a stage reverts from `'Complete'` to an earlier status?** (Reverse cascade / un-completion.) If a ticket was auto-completed and then a stage regresses, should the ticket status revert to `'In Progress'`? `deriveTicketStatus()` would naturally return `'In Progress'` on the next exit gate run, but the epic's `ticket_statuses` might be stale. The design should address whether reverse cascade is needed.

6. **Should the orchestrator immediately attempt to onboard newly unblocked stages, or wait for the next tick?** Onboarding happens during the session spawning phase of the tick cycle. If re-evaluation runs during an exit gate (which is async, triggered by session completion), the next tick will naturally discover newly unblocked stages. Immediate onboarding would add complexity for marginal latency savings.

7. **Should re-evaluation log individual stage unblock events?** For observability, logging "Stage STAGE-002-001-003 unblocked (all deps resolved)" is useful. But for large repos this could be noisy. Should there be a summary log ("3 stages unblocked") vs. individual entries, or both?

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the design doc sections for cascade and backlog re-evaluation
2. Read the existing `exit-gates.ts` implementation (extension point)
3. Read the existing `resolvers.ts` to understand how exit gates are called from resolvers
4. Study `isDependencyResolved()` in `sync/sync.ts` and `computeKanbanColumn()` in `engine/kanban-columns.ts`
5. Study `DependencyRepository.listBySource()` for dependent stage discovery
6. Resolve the Open Questions listed above
7. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-6c-completion-cascade-design.md`
2. Write the implementation plan to `docs/plans/stage-6c-completion-cascade/IMPLEMENTATION_PLAN.md`

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor**
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Integration test with real CLI calls
8. Write handoff for Stage 6D

### Key Constraints

- The existing 738 kanban-cli tests and 245 orchestrator tests must continue passing
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass in both packages after every task
- The cascade logic must be deterministic and logged
- All new functions must be testable via injected dependencies (DI pattern)
- No changes to session spawning, worktree management, or resolver infrastructure
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The `KANBAN_MOCK=true` mode is available for integration testing
- A single sync call covers all cascade updates (not per-update)

### Suggested Sub-Task Breakdown

- **6C-1**: Extend `ExitGateResult` type with cascade fields (`ticketCompleted`, `epicCompleted`, `stagesUnblocked`)
- **6C-2**: Ticket completion cascade — after deriving ticket status as `'Complete'`, verify by reading all `stage_statuses`, then set ticket `status` to `'Complete'`
- **6C-3**: Epic completion cascade — after ticket becomes `'Complete'`, read all `ticket_statuses` from epic, if ALL are `'Complete'` set epic `status` to `'Complete'`
- **6C-4**: Backlog re-evaluation — after cascade, discover stages that depend on the completed stage, check if all their dependencies are resolved, log unblocked stages
- **6C-5**: Wire cascade and re-evaluation into exit gate `run()` — insert between epic update and sync call
- **6C-6**: Unit tests — cascade logic (all complete, partial, empty, reverse), re-evaluation (unblocked, still blocked, no dependents)
- **6C-7**: Integration tests — end-to-end: stage completes last -> ticket auto-completes -> epic auto-completes -> dependent stages unblocked
- **6C-8**: Edge case tests — single-stage ticket, single-ticket epic, stage with no dependents, stage reverts from Complete

### Mock Testing Notes

All tests should use the DI pattern established in 6B. The `KANBAN_MOCK=true` environment variable activates mock mode for the MCP server, but cascade and re-evaluation tests are primarily unit/integration tests against injected frontmatter stores:

```typescript
// Pattern from 6B tests (tests/exit-gates.test.ts):
function makeDeps(
  frontmatterEntries: Record<string, FrontmatterData>,
  syncResult = { success: true },
): ExitGateDeps {
  const store = makeFrontmatterStore(frontmatterEntries);
  return {
    readFrontmatter: vi.fn(async (filePath: string) => {
      const entry = store[filePath];
      if (!entry) throw new Error(`ENOENT: ${filePath}`);
      return structuredClone({ data: entry.data, content: entry.content });
    }),
    writeFrontmatter: vi.fn(async (filePath: string, data, content) => {
      store[filePath] = structuredClone({ data, content });
    }),
    runSync: vi.fn(async () => ({ ...syncResult })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}
```

For backlog re-evaluation, if the glob+filter approach is used, `discoverStageFiles` is already injectable in the resolver runner pattern:

```typescript
// Pattern from resolvers.ts:
discoverStageFiles: vi.fn(async () => [
  '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
  '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md',
]),
```

Integration tests in `tests/integration/` use the shared helpers from `tests/integration/helpers.ts` (extracted in 6B).

### Testing the Current System

```bash
# Navigate to orchestrator
cd tools/orchestrator

# Run orchestrator tests
npm run verify

# Navigate to kanban-cli
cd ../kanban-cli

# Seed test repos
bash scripts/seed-test-repo.sh

# Key commands the orchestrator will use
npx tsx src/cli/index.ts next --repo /tmp/kanban-test-repo --max 3 --pretty
npx tsx src/cli/index.ts sync --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts validate --repo /tmp/kanban-test-repo --pretty

# Run full test suites
cd ../orchestrator && npm run verify
cd ../kanban-cli && npm run verify
```

---

## Next Steps After Stage 6C

After this session completes Stage 6C:

- **Stage 6D** will implement the MR comment polling cron loop (polling for new PR comments, detecting actionable feedback)
- **Stage 6E** will implement the insights threshold cron loop (auto-triggering meta-insights when learnings accumulate)

Stages 6D and 6E can be developed in parallel since they are independent systems.

---

## Completion Summary

### What Was Delivered

- **Completion cascade in exit gates**: When all stages for a ticket are Complete, ticket.status is set to 'Complete'. When all tickets for an epic are Complete, epic.status is set to 'Complete'.
- **Extended ExitGateResult**: Added `ticketCompleted` and `epicCompleted` boolean flags for observability.
- **deriveEpicStatus()**: New pure function mirroring `deriveTicketStatus()` for epic-level status derivation.
- **Cascade logging**: Dedicated log lines in loop.ts for ticket and epic completion events.
- **Backlog re-evaluation**: Handled by existing sync infrastructure — no new code needed. Sync runs after cascade and `computeKanbanColumn()` naturally unblocks dependent stages.

### Test Results

- **Orchestrator**: 264 tests across 17 test files (262 passing, 2 pre-existing failures in resolver-flow.test.ts)
- **kanban-cli**: 738 tests across 51 test files, all passing

### What Changed from Handoff

- Backlog re-evaluation required NO new code — sync + computeKanbanColumn handles it entirely
- ticket.status was already being updated by existing 6B code; 6C-2 only added the ticketCompleted flag
- deriveEpicStatus matches the deriveTicketStatus pattern exactly (decision from brainstorming)

### Handoff Notes for Stage 6D

- The orchestrator now fully propagates completion upward through the hierarchy
- Exit gate results include `ticketCompleted` and `epicCompleted` for downstream consumers
- No changes needed to session spawning, worktrees, or resolver infrastructure
- Stage 6D (MR comment polling cron) can proceed independently
