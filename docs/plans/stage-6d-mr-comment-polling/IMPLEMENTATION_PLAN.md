# Stage 6D: MR Comment Polling — Implementation Plan

## Task Dependency Graph

```
6D-1 (Pipeline Config)
  └── 6D-2 (Cron Scheduler) ──┐
6D-3 (Comment Tracking Schema)│
  └── 6D-4 (MR Comment Poller)├── 6D-9 (Wire into Orchestrator)
6D-5 (PRStatus Extension)─────┤       └── 6D-12 (Integration Tests)
6D-6 (Parent Chain Tracker)────┤
  └── 6D-7 (Rebase Spawning)──┤
    └── 6D-8 (MR Retargeting)─┘
6D-10 (Skill Skeleton)         [independent]
6D-11 (Unit Tests)             [after 6D-2,4,6,7,8]
6D-13 (Race Condition Tests)   [after 6D-9]
6D-14 (Edge Case Tests)        [after 6D-9]
```

## Tasks

### 6D-1: Extend PipelineConfig with `cron` Section

**Goal**: Add `CronConfig` types, Zod schema, and default config.

**Files to modify**:
- `tools/kanban-cli/src/types/pipeline.ts` — Add `CronJobConfig`, `CronConfig`, extend `PipelineConfig`
- `tools/kanban-cli/src/config/schema.ts` — Add Zod schemas for cron section
- `config/default-pipeline.yaml` — Add `cron` section with defaults
- `tools/kanban-cli/src/index.ts` — Export new types if needed

**Acceptance criteria**:
- `CronJobConfig` interface: `{ enabled: boolean; interval_seconds: number }`
- `CronConfig` interface: `{ mr_comment_poll?: CronJobConfig; insights_threshold?: CronJobConfig }`
- `PipelineConfig.cron` is optional
- Zod validates: `enabled` is boolean, `interval_seconds` is integer in [30, 3600]
- Default pipeline YAML has cron section with `mr_comment_poll: { enabled: true, interval_seconds: 300 }` and `insights_threshold: { enabled: true, interval_seconds: 600 }`
- `npm run verify` passes in kanban-cli

**Tests**:
- Existing pipeline validation tests still pass
- New test: cron config with valid values passes Zod
- New test: cron config with `interval_seconds < 30` fails
- New test: cron config with `interval_seconds > 3600` fails
- New test: missing cron section is valid (optional)
- New test: `validate-pipeline` accepts cron section

**Status**: Not Started

---

### 6D-2: Cron Scheduler Infrastructure

**Goal**: Generic timer-based scheduler with start/stop lifecycle.

**Files to create**:
- `tools/orchestrator/src/cron.ts`

**Acceptance criteria**:
- `createCronScheduler(jobs, deps)` factory function following DI pattern
- `CronJob` interface: `{ name, enabled, intervalMs, execute() }`
- `CronScheduler` interface: `{ start(), stop(), isRunning() }`
- Disabled jobs are skipped
- Error isolation: job failures are logged, don't crash scheduler
- Per-job `executing` guard prevents overlapping executions
- Injectable `logger` and `now` deps
- `npm run verify` passes in orchestrator

**Tests**:
- Scheduler starts and stops cleanly
- Enabled jobs execute at intervals (use fake timers)
- Disabled jobs never execute
- Job errors are logged but don't stop other jobs
- Overlapping prevention: slow job skips next interval
- `isRunning()` returns correct state

**Status**: Not Started

---

### 6D-3: Comment Tracking SQLite Schema

**Goal**: Add `mr_comment_tracking` table to kanban.db.

**Files to modify**:
- `tools/kanban-cli/src/db/schema.ts` — Add table creation SQL
- `tools/kanban-cli/src/db/repositories/` — Add repository methods or new file for comment tracking queries

**Acceptance criteria**:
- `mr_comment_tracking` table: `stage_id TEXT PK, last_poll_timestamp TEXT NOT NULL, last_known_unresolved_count INTEGER DEFAULT 0, repo_id INTEGER REFERENCES repos(id)`
- Repository methods: `getCommentTracking(stageId)`, `upsertCommentTracking(stageId, timestamp, count, repoId)`
- Table created during DB initialization alongside existing tables
- `npm run verify` passes in kanban-cli

**Tests**:
- Table is created on DB init
- Upsert creates new row
- Upsert updates existing row
- Get returns null for unknown stage
- Get returns stored data for known stage

**Status**: Not Started

---

### 6D-4: MR Comment Poller

**Goal**: Core polling logic — query stages in PR Created, check PR status, transition on new comments or merge.

**Files to create**:
- `tools/orchestrator/src/mr-comment-poller.ts`

**Dependencies**: 6D-3 (comment tracking schema), 6D-5 (PRStatus extension)

**Acceptance criteria**:
- `createMRCommentPoller(deps)` factory with DI
- `poll(repoPath)` returns `MRPollResult[]`
- Queries stages where `status = 'PR Created'`, `session_active = 0`, `pr_url IS NOT NULL`
- Caps at `maxStagesPerCycle` (default 20)
- On merge detected: calls `exitGateRunner.run()` with status `'Done'`
- On `unresolvedThreadCount` increase: calls `exitGateRunner.run()` with status `'Addressing Comments'`
- Updates `mr_comment_tracking` after each stage check
- Handles null code host adapter gracefully (logs warning, returns empty)
- `npm run verify` passes in orchestrator

**Tests**:
- No stages in PR Created → empty results
- Stage with merged PR → transitions to Done via exit gate
- Stage with increased unresolved count → transitions to Addressing Comments
- Stage with same unresolved count → no_change
- Stage with decreased unresolved count → no_change
- Null code host adapter → logs warning, returns empty
- Max stages cap enforced
- First poll (no tracking row) → creates tracking, no transition on first observation
- Error fetching PR status → logged, continues to next stage

**Status**: Not Started

---

### 6D-5: PRStatus Extension

**Goal**: Add `unresolvedThreadCount` to PRStatus interface and update adapters.

**Files to modify**:
- `tools/kanban-cli/src/resolvers/types.ts` — Add `unresolvedThreadCount` to `PRStatus`
- GitHub adapter implementation — Return count
- GitLab adapter implementation — Return count
- Mock adapter (if exists) — Return count

**Acceptance criteria**:
- `PRStatus.unresolvedThreadCount` is `number`
- GitHub adapter: uses `gh` CLI or API to count unresolved review threads
- GitLab adapter: uses `glab` CLI or API to count unresolved discussions
- Existing `hasUnresolvedComments` still works (derived from count > 0)
- Existing tests pass without modification
- `npm run verify` passes in kanban-cli

**Tests**:
- Existing pr-status resolver tests still pass
- Adapter returns correct count for mock responses
- Count of 0 when no unresolved threads
- Count matches number of unresolved threads

**Status**: Not Started

---

### 6D-6: Parent Chain Tracker

**Goal**: Query and update `parent_branch_tracking` table, detect parent merges and HEAD changes.

**Files to create**:
- `tools/orchestrator/src/mr-chain-manager.ts` (partial — tracking logic only)

**Acceptance criteria**:
- Queries stages with non-empty `pending_merge_parents` in `PR Created` or `Addressing Comments`
- For each parent: calls `getBranchHead()` and `getPRStatus()`
- Detects parent merge (updates `is_merged` in tracking table)
- Detects HEAD change (updates `last_known_head` in tracking table)
- Returns `ChainCheckResult[]`
- `npm run verify` passes in orchestrator

**Tests**:
- No stages with pending parents → empty results
- Parent not merged, HEAD unchanged → no_change
- Parent merged → parent_merged event
- Parent HEAD changed → parent_updated event
- Multiple parents for one child → each checked independently
- Null code host → skips all checks, logs warning

**Status**: Not Started

---

### 6D-7: Rebase Session Spawning

**Goal**: When parent merges or updates, lock and spawn `rebase-child-mr` session.

**Files to modify**:
- `tools/orchestrator/src/mr-chain-manager.ts` — Add spawn logic

**Dependencies**: 6D-6

**Acceptance criteria**:
- Before spawning: checks `rebase_conflict` in frontmatter → skips if true
- Before spawning: checks `session_active` via locker → skips if locked
- Acquires lock via `locker.acquireLock()` before spawn
- Calls `sessionExecutor.spawn()` with `rebase-child-mr` skill
- On spawn failure: releases lock, logs error
- On successful session exit: lock released by normal session exit flow
- `npm run verify` passes in orchestrator

**Tests**:
- Locked stage → skipped_locked result
- Rebase conflict flagged → skipped_conflict result
- Unlocked stage, parent merged → rebase spawned
- Spawn failure → lock released, error logged
- Session executor receives correct skill name and stage context

**Status**: Not Started

---

### 6D-8: MR Retargeting & Draft Promotion

**Goal**: After rebase, evaluate retargeting matrix and promote draft → ready when all parents merged.

**Files to modify**:
- `tools/orchestrator/src/mr-chain-manager.ts` — Add retargeting and promotion logic

**Dependencies**: 6D-7

**Acceptance criteria**:
- Implements retargeting matrix from design doc:
  - Multi-parent, >1 remain → no retarget
  - Multi-parent, all but one merge → retarget to remaining parent branch
  - Single-parent merged → retarget to main
  - Zero unmerged → retarget to main + promote
- Calls `codeHost.editPRBase()` for retargeting
- Calls `codeHost.markPRReady()` for draft promotion
- Updates frontmatter: `is_draft: false`, clears `pending_merge_parents` on full promotion
- `npm run verify` passes in orchestrator

**Tests**:
- Multi-parent, one merges, >1 remain → no retarget, stay draft
- Multi-parent, all but one merge → retarget to remaining parent branch
- Single-parent merged → retarget to main, promote to ready
- All parents merged → retarget to main, promote to ready
- editPRBase called with correct arguments
- markPRReady called only when promoting
- Frontmatter updated correctly after promotion

**Status**: Not Started

---

### 6D-9: Wire Cron into Orchestrator

**Goal**: Integrate cron scheduler start/stop into `createOrchestrator()`.

**Files to modify**:
- `tools/orchestrator/src/loop.ts` — Build and manage cron lifecycle

**Dependencies**: 6D-2, 6D-4, 6D-6, 6D-7, 6D-8

**Acceptance criteria**:
- Cron jobs built from `config.pipelineConfig.cron`
- MR comment poll job wraps `poller.poll()` + `chainManager.checkParentChains()`
- Insights threshold job is no-op placeholder
- `cronScheduler.start()` called in `orchestrator.start()`
- `cronScheduler.stop()` called in `orchestrator.stop()`
- Shared deps: exit gate runner, session executor, locker, logger
- Cron disabled when `config.pipelineConfig.cron` is undefined
- `npm run verify` passes in orchestrator

**Tests**:
- Orchestrator start → cron starts
- Orchestrator stop → cron stops
- No cron config → no cron scheduler created, no errors
- Cron disabled in config → scheduler created but no jobs execute
- MR poll job calls poller and chain manager

**Status**: Not Started

---

### 6D-10: `rebase-child-mr` Skill Skeleton

**Goal**: Create skill definition file for rebase sessions.

**Files to create**:
- `skills/rebase-child-mr/SKILL.md`

**Acceptance criteria**:
- Skill file defines: name, description, trigger conditions
- Workflow steps: fetch, determine rebase target, rebase, resolve conflicts, verify, force-push
- Session context requirements: child stage file, parent stage files, trigger type
- Exit conditions: success (rebased + pushed) or failure (`rebase_conflict: true`)
- Frontmatter updates documented: `pending_merge_parents`, `mr_target_branch`, `rebase_conflict`
- No implementation — just the skill definition

**Tests**: None (documentation only)

**Status**: Not Started

---

### 6D-11: Unit Tests

**Goal**: Comprehensive unit tests for all new modules.

**Files to create**:
- `tools/orchestrator/tests/cron.test.ts`
- `tools/orchestrator/tests/mr-comment-poller.test.ts`
- `tools/orchestrator/tests/mr-chain-manager.test.ts`

**Dependencies**: 6D-2, 6D-4, 6D-6, 6D-7, 6D-8

**Acceptance criteria**:
- Cron scheduler: start/stop/interval, error isolation, overlapping prevention, disabled jobs
- Comment poller: new comments, no comments, merge detected, cap enforcement, first poll behavior, error handling
- Chain manager: parent merged, parent updated, retarget matrix (all 4 cases), draft promotion, conflict skip, lock skip
- All tests use DI pattern with `makeDeps()` factories
- `npm run verify` passes in orchestrator

**Status**: Not Started

---

### 6D-12: Integration Tests

**Goal**: End-to-end flow tests exercising multiple components together.

**Files to create**:
- `tools/orchestrator/tests/integration/mr-cron-flow.test.ts`

**Dependencies**: 6D-9

**Acceptance criteria**:
- Test: PR Created → cron detects unresolved comments → Addressing Comments
- Test: PR Created → cron detects merge → Done → completion cascade
- Test: Parent merged → child rebase spawned → retarget → promote
- Uses real implementations with only I/O layer mocked (frontmatter, sync, code host)
- Integration helpers from `tests/integration/helpers.ts` reused where possible
- `npm run verify` passes in orchestrator

**Status**: Not Started

---

### 6D-13: Race Condition Tests

**Goal**: Verify concurrent cron + main loop behavior.

**Files to create**:
- `tools/orchestrator/tests/race-conditions.test.ts`

**Dependencies**: 6D-9

**Acceptance criteria**:
- Test: session_active prevents cron from spawning rebase
- Test: cron and resolver both detect merge — only one status change propagated
- Test: cron skips stage while main loop has active session
- Test: rebase_conflict flag prevents repeated spawn attempts
- `npm run verify` passes in orchestrator

**Status**: Not Started

---

### 6D-14: Edge Case Tests

**Goal**: Handle unusual and error scenarios gracefully.

**Files to create**:
- `tools/orchestrator/tests/edge-cases.test.ts`

**Dependencies**: 6D-9

**Acceptance criteria**:
- Test: No open PRs → cron cycle completes cleanly
- Test: Code host adapter unavailable (null) → logged, no crash
- Test: Code host API error for one stage → continues to next
- Test: Deep parent chain (A→B→C) → processes bottom-up across cycles
- Test: rebase_conflict flagged stage → skipped by cron
- Test: Stage removed between query and check → handled gracefully
- `npm run verify` passes in orchestrator

**Status**: Not Started
