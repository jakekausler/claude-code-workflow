# Stage 6D: MR Comment Polling Cron & MR Dependency Chain Manager — Session Prompt

## Context

Stages 0-5 are complete on the `kanban` branch. Stage 5.5A (Schema & Sync), Stage 5.5B (Skill Updates), Stage 5.5C (Jira Conversion Enrichment), Stage 6A (Orchestrator Infrastructure), Stage 6A.5 (MCP Server), Stage 6B (Exit Gates & Resolver Execution), and Stage 6C (Completion Cascade & Backlog Re-evaluation) are also complete. This session implements **Stage 6D: MR Comment Polling Cron & MR Dependency Chain Manager** — the cron-based polling system that periodically checks for new MR/PR comments, detects merged PRs, manages parent-child MR dependency chains (rebasing, retargeting, draft promotion), and transitions stages accordingly.

### Dependency Graph

```
Stage 5.5A (Schema & Sync) ✅
  ├── Stage 5.5B (Skill Updates) ✅
  │     └── Stage 6A (Orchestrator Infrastructure) ✅
  │           ├── Stage 6A.5 (MCP Server) ✅
  │           └── Stage 6B (Exit Gates & Resolvers) ✅
  │                 └── Stage 6C (Completion Cascade) ✅
  │                       └── Stage 6D (MR Comment Cron + MR Chain Manager) ← THIS STAGE
  └── Stage 5.5C (Jira Conversion Enrichment) ✅
```

### What Has Been Built (Stages 0-6C)

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

**Test Suite:** 738 tests across 51 test files (kanban-cli), 264 tests across 17 test files (orchestrator).

**Stage 6C: Completion Cascade & Backlog Re-evaluation (Complete)**

The orchestrator now propagates completion upward through the hierarchy:

| Deliverable | Description |
|------------|-------------|
| Completion cascade in exit gates | When all stages for a ticket are Complete, ticket.status is set to 'Complete'. When all tickets for an epic are Complete, epic.status is set to 'Complete'. |
| Extended ExitGateResult | Added `ticketCompleted` and `epicCompleted` boolean flags for observability |
| `deriveEpicStatus()` | Pure function mirroring `deriveTicketStatus()` for epic-level status derivation |
| Cascade logging | Dedicated log lines in loop.ts for ticket and epic completion events |
| Backlog re-evaluation | Handled by existing sync infrastructure — sync + `computeKanbanColumn()` naturally unblocks dependent stages |

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

### Key Design References

- Full design doc: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`
- MR dependency chains design: `docs/plans/2026-02-21-mr-dependency-chains-design.md`
- Orchestrator flow: `docs/plans/orchestrator-flow.dot` and `docs/plans/flow.svg`
- Stage 6A design: `docs/plans/2026-02-23-stage-6a-orchestrator-infrastructure-design.md`
- Stage 6B handoff: `docs/plans/stage-6b-exit-gates-resolvers-handoff.md`
- Stage 6C handoff: `docs/plans/stage-6c-completion-cascade-handoff.md`

---

## What Stage 6D Delivers

### Goal

Implement a cron-based polling system that runs independently from the main orchestrator tick loop. It periodically polls for new MR/PR comments and merge status on stages in the "PR Created" state, manages parent-child MR dependency chains, and transitions stages through the pipeline as needed.

### What Ships

1. **Cron scheduler infrastructure** — A timer-based execution framework at configurable intervals, running concurrently with the main orchestrator loop. This is the reusable cron infrastructure that Stage 6E will also use.

2. **`cron` config section in pipeline YAML** — Schema, loader, and validation for the cron configuration:
   ```yaml
   cron:
     mr_comment_poll:
       enabled: true            # Toggle MR/PR comment polling on/off
       interval_seconds: 300    # Poll every 5 minutes
     insights_threshold:
       enabled: true            # Toggle insights threshold checking on/off
       interval_seconds: 600    # Check every 10 minutes
   ```

3. **MR comment polling** — The core cron job:
   - Query SQLite for all stages where `status = 'PR Created'`
   - Read `pr_url` from SQLite (cached from frontmatter)
   - Fetch comments via MCP tools (`pr_get_comments`) or code-host adapters
   - Track seen comments (store last-seen comment ID or timestamp in SQLite)
   - New actionable comments found -> transition stage to `'Addressing Comments'` (update stage + ticket + epic + sync via exit gate)
   - PR merged -> transition stage to `'Done'` + trigger completion cascade (via exit gate, which already handles 6C cascade)

4. **Parent-child MR relationship tracking** — On each poll cycle:
   - Query SQLite for stages in `PR Created` or `Addressing Comments` that have non-empty `pending_merge_parents`
   - For each parent in `pending_merge_parents`, check if the parent's PR is still open, merged, or updated
   - Track parent branch HEAD commits in `parent_branch_tracking` SQLite table (already exists in schema from 5.5A)

5. **Parent merge detection & rebase session spawning** — When a parent MR is detected as merged:
   - Update the child's `pending_merge_parents` (remove the merged parent entry)
   - Evaluate retargeting rules (see retargeting matrix below)
   - Spawn a `rebase-child-mr` Claude session to rebase child branch
   - After rebase: if zero unmerged parents remain, promote draft -> ready

6. **Parent branch update detection** — When parent branch has new commits:
   - Track HEAD commit SHA of each parent branch in `parent_branch_tracking` SQLite table via `getBranchHead()`
   - On each poll cycle, compare stored HEAD with current remote HEAD
   - If changed: spawn a rebase session for the child

7. **MR retargeting** — After rebase, retarget child MRs:

   | Event | Current Target | New Target | Draft Status |
   |---|---|---|---|
   | Multi-parent -> one parent merges, still >1 unmerged | main | main (no change) | Stay draft |
   | Multi-parent -> all but one parent merge | main | Remaining parent branch | Stay draft |
   | Single-parent -> parent merges | parent branch | main/default | Promote to ready |
   | Zero unmerged parents -> all merged | main or parent | main/default | Promote to ready |

8. **Draft -> ready promotion** — After all parents merged and rebase clean:
   - Call `markPRReady()` on code host adapter
   - Set `is_draft: false` in frontmatter
   - Clear `pending_merge_parents` in frontmatter

9. **`rebase-child-mr` skill** — New skill (skill file only; actual Claude session implementation is out of scope but the orchestrator must be able to spawn it):
   - Rebases child branch onto new base (parent or main after merge)
   - Resolves conflicts using full context
   - Runs verification after rebase, pushes with `--force-with-lease`
   - Flags unresolvable conflicts with `rebase_conflict: true` for human review

10. **Race condition mitigation** — Uses `session_active` locking before spawning rebase sessions. If `session_active` is already true, cron skips and retries next cycle.

### What Stage 6D Does NOT Include

- Insights threshold cron implementation -> Stage 6E (but 6D builds the shared cron infrastructure that 6E will use)
- Changes to session spawning or worktree infrastructure (6A)
- Changes to exit gates or completion cascade (6C) — 6D uses exit gates as-is
- New resolver implementations beyond what 6B delivered
- Changes to the `pr-status` resolver itself — it already handles "PR merged -> Done"
- Web UI for displaying PR comments or cron status -> Stage 9
- The `review-cycle` skill content (already exists at `skills/review-cycle/SKILL.md`)
- The actual `rebase-child-mr` skill implementation (just the skill file skeleton and the orchestrator's ability to spawn it)

### Key Architectural Decisions (Already Resolved)

| Decision | Resolution |
|----------|-----------|
| Cron is independent of main loop | Three concurrent systems: main work loop, MR comment cron, insights threshold cron (design doc Section 6.5) |
| Cron does NOT spawn Claude sessions for comment detection | It makes API calls and updates files/SQLite directly. It DOES spawn Claude sessions for rebasing (rebase-child-mr skill). |
| Cron transitions use exit gates | Status updates from cron propagate through the same exit gate runner used by sessions and resolvers |
| Comment tracking lives in SQLite | Last-seen comment ID/timestamp stored in SQLite, not in frontmatter |
| Cron respects `session_active` locking | Before spawning a rebase session, cron sets `session_active = true`. If already true, skip and retry next cycle. |
| `parent_branch_tracking` table already exists | Schema was added in Stage 5.5A. 6D populates and queries it. |
| Code host adapters already support needed operations | `editPRBase()`, `markPRReady()`, `getBranchHead()` were added in Stage 5.5B |
| Cron config is toggleable but not user-extensible | Cron jobs are hardcoded (mr_comment_poll, insights_threshold) but can be enabled/disabled and interval-configured via the `cron` section |
| PR merged detection is shared | Both the `pr-status` resolver (main loop tick) and the MR comment cron can detect merges. The resolver handles the fast path; the cron handles comment detection and parent chain management. |

---

## Existing Infrastructure Supporting Stage 6D

### Already Implemented (Use These)

**From exit-gates.ts (Stage 6B/6C):**
- **`createExitGateRunner(deps)`**: Factory with `ExitGateDeps` injection. Returns `ExitGateRunner` with `run(workerInfo, repoPath, statusAfter)` method.
- **`deriveTicketStatus(stageStatuses)`**: Returns `'Complete'` when all stages are `'Complete'`, `'Not Started'` when all are `'Not Started'`, `'In Progress'` otherwise.
- **`deriveEpicStatus(ticketStatuses)`**: Same logic at epic level (added in 6C).
- **`ExitGateResult`**: Reports `statusChanged`, `ticketUpdated`, `ticketCompleted`, `epicUpdated`, `epicCompleted`, `syncResult`.
- **`runSyncWithRetry(repoPath)`**: Retry-once strategy for sync subprocess.

**From resolvers.ts (Stage 6B):**
- **`createResolverRunner(pipelineConfig, deps)`**: Resolver transitions already propagate through `exitGateRunner.run()`. The `pr-status` resolver already handles "PR merged -> Done" transitions via the `prStatusResolver` at `tools/kanban-cli/src/resolvers/builtins/pr-status.ts`.

**From loop.ts (Stage 6B):**
- **`handleSessionExit()`** (lines 134-191): Calls `exitGateRunner.run()` when status changes. The cron will need similar propagation logic.
- **`createOrchestrator(config, deps)`**: The main orchestrator factory. The cron should be started/stopped alongside the main loop.

**From kanban-cli types and resolvers:**
- **`CodeHostAdapter`** (`resolvers/types.ts`): Interface with `getPRStatus()`, `editPRBase()`, `markPRReady()`, `getBranchHead()`. Already implemented for GitHub and GitLab.
- **`PRStatus`** (`resolvers/types.ts`): Has `merged`, `hasUnresolvedComments`, `state` fields.
- **`createCodeHostAdapter(platform)`** (`utils/code-host-factory.ts`): Factory that returns GitHub or GitLab adapter based on detected platform.
- **`ResolverStageInput`** (`resolvers/types.ts`): Stage data passed to resolvers, includes `pr_url`, `pr_number`, `worktree_branch`.

**From kanban-cli database (Stage 5.5A):**
- **`stages` table**: Has `pr_url`, `pr_number`, `is_draft`, `pending_merge_parents` columns.
- **`parent_branch_tracking` table**: Schema exists with `child_stage_id`, `parent_stage_id`, `parent_branch`, `parent_pr_url`, `last_known_head`, `is_merged`, `repo_id`, `last_checked` columns. Indexes on `child_stage_id` and `parent_stage_id`.
- **`StageRepository.updatePendingMergeParents(stageId, json)`**: Targeted update method for `pending_merge_parents`.

**From pipeline config:**
- **Default pipeline** (`config/default-pipeline.yaml`): `PR Created` is a resolver state with `resolver: pr-status` and `transitions_to: [Done, Addressing Comments]`. `Addressing Comments` is a skill state with `skill: review-cycle` and `transitions_to: [PR Created]`.

**From locking.ts:**
- **`defaultReadFrontmatter(filePath)`** and **`defaultWriteFrontmatter(filePath, data, content)`**: Standard frontmatter I/O used across the orchestrator. Cron should use the same pattern.

### Critical Terminology

| Concept | Value | Used Where |
|---------|-------|-----------|
| PR Created status | `'PR Created'` | Frontmatter status for stages with open PRs awaiting review |
| Addressing Comments status | `'Addressing Comments'` | Frontmatter status for stages where review-cycle skill is addressing feedback |
| Complete status | `'Complete'` (`COMPLETE_STATUS`) | Terminal frontmatter status |
| `pr-status` resolver | Built-in resolver | Detects PR merged -> transitions to Done |
| `review-cycle` skill | Skill | Addresses MR comments, transitions back to PR Created |

### Not Yet Implemented (Stage 6D Builds These)

- Cron scheduler infrastructure (timer, start/stop lifecycle, config parsing)
- `cron` section in pipeline config schema (Zod validation, loader)
- MR comment polling job (query stages, fetch comments, detect new comments, transition)
- Comment tracking in SQLite (last-seen comment ID/timestamp)
- Parent-child MR chain management (parent merge detection, rebase spawning, retargeting, draft promotion)
- `parent_branch_tracking` table population and querying logic
- `rebase-child-mr` skill skeleton
- Integration of cron lifecycle with orchestrator start/stop
- Tests for all cron, polling, chain management, and race condition logic

---

## Extension Points

### Orchestrator Loop — Cron Lifecycle Integration

The cron system should be started and stopped alongside the main orchestrator loop. The primary integration point is `createOrchestrator()` in `tools/orchestrator/src/loop.ts`:

```typescript
// Current loop.ts start():
async start(): Promise<void> {
  if (running) throw new Error('Orchestrator already running');
  running = true;
  // ... main tick loop ...
}

// 6D extends to also start cron jobs:
async start(): Promise<void> {
  if (running) throw new Error('Orchestrator already running');
  running = true;
  cronScheduler.start();  // Start cron alongside main loop
  // ... main tick loop ...
}

async stop(): Promise<void> {
  running = false;
  cronScheduler.stop();  // Stop cron alongside main loop
  // ...
}
```

### New Module: Cron Scheduler

A new module (e.g., `tools/orchestrator/src/cron.ts`) should implement the timer-based scheduling:

```typescript
// Suggested interface:
export interface CronScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface CronJob {
  name: string;
  enabled: boolean;
  intervalMs: number;
  execute(): Promise<void>;
}

export function createCronScheduler(jobs: CronJob[], deps: Partial<CronDeps>): CronScheduler;
```

### New Module: MR Comment Poller

A new module (e.g., `tools/orchestrator/src/mr-comment-poller.ts`) should implement the comment polling logic:

```typescript
// Suggested interface:
export interface MRCommentPoller {
  poll(repoPath: string): Promise<MRPollResult[]>;
}

export interface MRPollResult {
  stageId: string;
  prUrl: string;
  action: 'new_comments' | 'merged' | 'no_change';
  newCommentCount?: number;
}
```

### New Module: MR Chain Manager

A new module (e.g., `tools/orchestrator/src/mr-chain-manager.ts`) should implement parent-child relationship management:

```typescript
// Suggested interface:
export interface MRChainManager {
  checkParentChains(repoPath: string): Promise<ChainCheckResult[]>;
}

export interface ChainCheckResult {
  childStageId: string;
  parentStageId: string;
  event: 'parent_merged' | 'parent_updated' | 'no_change';
  rebaseSpawned: boolean;
  retargeted: boolean;
  promotedToReady: boolean;
}
```

### Exit Gate Runner — Reuse for Cron Transitions

The cron must propagate status changes through the exit gate runner, just like the main loop and resolvers do. The pattern from `resolvers.ts` (lines 214-235) shows how to construct a `WorkerInfo` for non-session transitions:

```typescript
// Pattern from resolvers.ts for resolver-driven transitions:
const workerInfo: WorkerInfo = {
  stageId,
  stageFilePath,
  worktreePath: '', // no worktree for resolver/cron transitions
  worktreeIndex: -1,
  statusBefore: currentStatus,
  startTime: Date.now(),
};

await exitGateRunner.run(workerInfo, repoPath, newStatus);
```

The cron should follow this exact pattern for its transitions (comment detection -> Addressing Comments, merge detection -> Done).

### Pipeline Config — Cron Section

The pipeline config type in kanban-cli needs extending to include the `cron` section. Currently `PipelineConfig` in `tools/kanban-cli/src/types/pipeline.ts` has `workflow` with `phases`, `entry_phase`, and `defaults`. The `cron` section should be added:

```typescript
// Extension to PipelineConfig:
export interface CronConfig {
  mr_comment_poll?: {
    enabled: boolean;
    interval_seconds: number;
  };
  insights_threshold?: {
    enabled: boolean;
    interval_seconds: number;
  };
}

// PipelineConfig gains:
cron?: CronConfig;
```

### Session Spawning for Rebase

The cron needs to spawn Claude sessions for the `rebase-child-mr` skill. It should reuse the session executor from the main orchestrator:

```typescript
// The cron needs access to:
// 1. SessionExecutor (from loop.ts deps) — to spawn rebase sessions
// 2. WorktreeManager — to create worktrees for rebase sessions
// 3. Locker — to set session_active = true before spawning
```

This means the cron infrastructure needs to be created within `createOrchestrator()` where these dependencies are available, or the deps need to be passed through.

---

## Open Questions (Resolve During Design Phase)

1. **How to track "seen" comments?** Options: (a) last-seen comment ID per stage in a new SQLite table, (b) timestamp-based (last poll time stored per stage), (c) full comment hash. The design doc suggests SQLite. The key concern is that different code hosts have different comment ordering — GitHub sorts by created_at, GitLab by id.

2. **How to distinguish actionable comments from discussion/resolved threads?** Options: (a) heuristic (any unresolved thread = actionable), (b) use the `hasUnresolvedComments` field from `PRStatus` — but this is a single boolean, not per-comment granularity, (c) fetch full comment list and filter by resolved status. The `pr_get_comments` MCP tool returns comment data — what fields are available?

3. **Should the cron query SQLite directly or go through kanban-cli?** The design doc says "query SQLite for all stages where status = 'PR Created'". Options: (a) direct SQLite query in the orchestrator (requires importing kanban-cli database internals), (b) shell out to `kanban-cli board --column pr_created -o json` and parse output, (c) use the MCP server tools. Direct SQLite is most efficient. The orchestrator already imports types from kanban-cli.

4. **How to handle the overlap between `pr-status` resolver and the MR comment cron?** Both can detect PR merges. The resolver runs on every main loop tick; the cron runs on its own interval. Options: (a) let both detect merges independently — the exit gate will see "no status change" on the second detection, (b) have the cron skip merge detection and only handle comments/chains, (c) disable the `pr-status` resolver entirely when the cron is enabled. Option (a) is simplest and safest (idempotent).

5. **Should the cron immediately spawn a rebase session, or queue the rebase?** The design doc assumes cron spawns directly. But this means the cron needs access to session infrastructure. Options: (a) cron spawns sessions directly using shared SessionExecutor, (b) cron sets a flag in frontmatter/SQLite and the main loop picks it up, (c) cron writes a rebase request to a queue file. Option (a) is more direct but couples the cron to session infrastructure.

6. **How deep can parent chains go?** A depends on B depends on C, all in PR. When C merges, B needs rebase, then A needs rebase off rebased B. The cron must process these sequentially. Should depth be limited? Should the cron detect chain depth and process bottom-up?

7. **What if a rebase session fails?** The `rebase_conflict` flag in frontmatter marks it for human review. But what prevents the cron from re-triggering the rebase on the next cycle? Options: (a) cron checks `rebase_conflict` before spawning, (b) `session_active` stays true until human resolves, (c) a separate "rebase_needed" flag that the cron clears after spawning.

8. **Should the cron config be validated by `kanban-cli validate-pipeline`?** The cron section is part of the pipeline YAML. Validation could check: enabled flags are boolean, intervals are positive integers, intervals are within reasonable bounds. This would extend the existing config validation layer.

9. **Where does the comment-tracking SQLite table live?** Options: (a) new table in the existing kanban.db, (b) separate orchestrator-local SQLite file. The `parent_branch_tracking` table is already in kanban.db (added in 5.5A), so comment tracking should probably join it there.

10. **Rate limiting for code host API calls.** When polling many PRs, the cron could hit GitHub/GitLab rate limits. Options: (a) configurable `interval_seconds` (already in config), (b) batch API queries where possible, (c) respect rate limit headers and back off, (d) cap the number of PRs checked per cycle.

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the design doc sections for MR comment cron (Section 6.5, "System 2: MR Comment Cron") and the expanded 6D scope (Section 4.4, "Stage 6D")
2. Read the MR dependency chains design doc (`docs/plans/2026-02-21-mr-dependency-chains-design.md`) — especially Sections 4 (Enhanced MR Cron) and 8 (rebase-child-mr skill)
3. Read the existing `loop.ts` implementation (integration point for cron lifecycle)
4. Read `exit-gates.ts` and `resolvers.ts` to understand how transitions propagate (cron uses the same pattern)
5. Study `CodeHostAdapter` interface in `tools/kanban-cli/src/resolvers/types.ts` — particularly `getPRStatus()`, `editPRBase()`, `markPRReady()`, `getBranchHead()`
6. Study the `parent_branch_tracking` SQLite schema in `tools/kanban-cli/src/db/schema.ts`
7. Study the existing `pr-status` resolver at `tools/kanban-cli/src/resolvers/builtins/pr-status.ts` to understand how it currently handles merge detection (and how the cron complements it)
8. Study the `PipelineConfig` type in `tools/kanban-cli/src/types/pipeline.ts` for extending with the `cron` section
9. Resolve the Open Questions listed above
10. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-6d-mr-comment-polling-design.md`
2. Write the implementation plan to `docs/plans/stage-6d-mr-comment-polling/IMPLEMENTATION_PLAN.md`

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor**
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Integration test with real CLI calls
8. Write handoff for Stage 6E

### Key Constraints

- The existing 738 kanban-cli tests and 264 orchestrator tests must continue passing
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass in both packages after every task
- The cron polling logic must be deterministic and logged
- All new functions must be testable via injected dependencies (DI pattern)
- No changes to session spawning logic, worktree management, resolver infrastructure, or completion cascade
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The `KANBAN_MOCK=true` mode is available for integration testing
- Race conditions between cron and main loop must be mitigated via `session_active` locking
- Cron transitions must propagate through the exit gate runner (same as resolvers)

### Suggested Sub-Task Breakdown

- **6D-1**: Extend `PipelineConfig` type with `cron` section — add Zod schema, types, loader, validation for `mr_comment_poll` and `insights_threshold` config entries
- **6D-2**: Cron scheduler infrastructure — `createCronScheduler(jobs, deps)` with start/stop lifecycle, configurable intervals, error handling per job, logging
- **6D-3**: Comment tracking SQLite table — schema for tracking last-seen comment ID/timestamp per stage, migration, repository methods
- **6D-4**: MR comment poller — query stages in `PR Created`, fetch comments via code host adapter or MCP tools, compare against seen comments, detect new actionable comments
- **6D-5**: MR merge detection in cron — detect PR merged via code host adapter, build `WorkerInfo`, call exit gate runner to transition to `Done` and trigger completion cascade
- **6D-6**: Parent chain tracker — query `parent_branch_tracking` table, call `getBranchHead()` per parent, detect HEAD changes, detect parent merges
- **6D-7**: Rebase session spawning — when parent merges or updates, lock via `session_active`, spawn `rebase-child-mr` session, update `pending_merge_parents` in frontmatter
- **6D-8**: MR retargeting — after rebase, evaluate retargeting matrix, call `editPRBase()` as needed, promote draft -> ready via `markPRReady()` when all parents merged
- **6D-9**: Wire cron into orchestrator — integrate cron scheduler start/stop into `createOrchestrator()`, pass shared deps (exit gate runner, session executor, locker), add to `OrchestratorConfig`
- **6D-10**: `rebase-child-mr` skill skeleton — create `skills/rebase-child-mr/SKILL.md` with the skill definition (session context, workflow steps, exit conditions)
- **6D-11**: Unit tests — cron scheduler (start/stop/interval), comment poller (new comments, no comments, merge detected), chain manager (parent merged, parent updated, retarget, promote)
- **6D-12**: Integration tests — end-to-end: stage in PR Created -> cron detects comments -> transitions to Addressing Comments -> review-cycle addresses -> back to PR Created -> cron detects merge -> Done -> cascade
- **6D-13**: Race condition tests — concurrent cron + main loop transitions, session_active locking, double-detection idempotency
- **6D-14**: Edge case tests — no PRs open, code host unavailable, rate limit handling, deep parent chains, rebase conflict flagging

### Mock Testing Notes

All tests should use the DI pattern established in 6B. The `KANBAN_MOCK=true` environment variable activates mock mode for the MCP server. Cron tests are primarily unit/integration tests with injected dependencies:

```typescript
// Pattern for cron job tests:
function makeCronDeps(overrides: Partial<MRCommentPollerDeps> = {}): MRCommentPollerDeps {
  return {
    queryStagesInPRCreated: vi.fn(async () => []),
    fetchComments: vi.fn(async () => []),
    getLastSeenCommentId: vi.fn(async () => null),
    setLastSeenCommentId: vi.fn(async () => {}),
    exitGateRunner: {
      run: vi.fn(async () => ({
        statusChanged: true,
        statusBefore: 'PR Created',
        statusAfter: 'Addressing Comments',
        ticketUpdated: true,
        ticketCompleted: false,
        epicUpdated: false,
        epicCompleted: false,
        syncResult: { success: true },
      })),
    },
    readFrontmatter: vi.fn(async () => ({ data: {}, content: '' })),
    writeFrontmatter: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}
```

For the cron scheduler itself:

```typescript
// Pattern for cron scheduler tests:
function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    name: 'test-job',
    enabled: true,
    intervalMs: 1000,
    execute: vi.fn(async () => {}),
    ...overrides,
  };
}
```

For parent chain management:

```typescript
// Pattern for chain manager tests:
function makeChainDeps(overrides: Partial<MRChainManagerDeps> = {}): MRChainManagerDeps {
  return {
    queryStagesWithPendingParents: vi.fn(async () => []),
    getParentBranchTracking: vi.fn(async () => []),
    updateParentBranchTracking: vi.fn(async () => {}),
    codeHost: {
      getPRStatus: vi.fn(() => ({ merged: false, hasUnresolvedComments: false, state: 'open' })),
      editPRBase: vi.fn(),
      markPRReady: vi.fn(),
      getBranchHead: vi.fn(() => 'abc123'),
    },
    sessionExecutor: { spawn: vi.fn(async () => ({ exitCode: 0, durationMs: 1000 })) },
    locker: { acquireLock: vi.fn(async () => {}), releaseLock: vi.fn(async () => {}), readStatus: vi.fn(async () => 'PR Created') },
    readFrontmatter: vi.fn(async () => ({ data: {}, content: '' })),
    writeFrontmatter: vi.fn(async () => {}),
    exitGateRunner: { run: vi.fn(async () => ({ statusChanged: true, statusBefore: 'PR Created', statusAfter: 'Done', ticketUpdated: true, ticketCompleted: false, epicUpdated: false, epicCompleted: false, syncResult: { success: true } })) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}
```

Integration tests in `tests/integration/` should use shared helpers from `tests/integration/helpers.ts`.

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

## Next Steps After Stage 6D

After this session completes Stage 6D:

- **Stage 6E** will implement the insights threshold cron loop (auto-triggering meta-insights when learnings accumulate). It reuses the cron scheduler infrastructure built in 6D and adds a second cron job.
- **Stage 7** (Slack Notifications) and **Stage 8** (Global CLI + Multi-Repo) can also proceed, as they have no dependency on 6D/6E.

Stage 6E depends on 6D's cron infrastructure and on 6A's session spawning (already complete). It can begin immediately after 6D.
