# Stage 6D: MR Comment Polling Cron & MR Dependency Chain Manager — Design

## Overview

Stage 6D adds a cron-based polling system that runs concurrently with the main orchestrator loop. It periodically checks MR/PR status for stages in `PR Created`, detects new review comments and merged PRs, manages parent-child MR dependency chains, and transitions stages through the pipeline via the existing exit gate infrastructure.

## Design Decisions

### Open Question Resolutions

| # | Question | Resolution |
|---|---------|-----------|
| 1 | How to track seen comments? | Timestamp-based: store `last_poll_timestamp` and `last_known_unresolved_count` per stage in `mr_comment_tracking` SQLite table |
| 2 | How to distinguish actionable comments? | Track `unresolvedThreadCount` from `PRStatus`. Transition when count *increases* since last poll. General discussion comments are excluded (not review threads). LLM classification can be layered in later for ambiguous platforms. |
| 3 | Should cron query SQLite directly? | Yes — direct SQLite query. Orchestrator already imports kanban-cli types. |
| 4 | Overlap between pr-status resolver and cron? | Both detect merges independently. Exit gate handles idempotently (second detection sees no status change). |
| 5 | Immediate spawn or queue rebase? | Cron spawns sessions directly via shared `SessionExecutor`. |
| 6 | How deep can parent chains go? | No depth limit. Process bottom-up in topological order. One rebase per child per cycle, serialized by `session_active` lock. Deep chains cascade over multiple cycles. |
| 7 | What prevents re-triggering rebase on conflict? | Check `rebase_conflict` flag in frontmatter before spawning. Cron skips stages with `rebase_conflict: true`. Human must clear flag after resolving. |
| 8 | Should cron config be validated? | Yes — extend Zod schema and `validate-pipeline` 4-layer validation. |
| 9 | Where does comment tracking table live? | In existing `kanban.db` alongside `parent_branch_tracking`. |
| 10 | Rate limiting? | Cap at 20 stages per poll cycle. `interval_seconds` is primary rate control. |

## Architecture

### System Topology

```
┌─────────────────────────────────────────────────┐
│                createOrchestrator()              │
│                                                  │
│  ┌──────────────┐   ┌────────────────────────┐  │
│  │  Main Loop   │   │   Cron Scheduler       │  │
│  │  (System 1)  │   │                        │  │
│  │              │   │  ┌──────────────────┐   │  │
│  │  discovery → │   │  │ MR Comment Poll  │   │  │
│  │  spawn →     │   │  │  (every N sec)   │   │  │
│  │  session →   │   │  │                  │   │  │
│  │  exit gate   │   │  │  comment poller  │   │  │
│  │              │   │  │  + chain manager │   │  │
│  └──────┬───────┘   │  └────────┬─────────┘   │  │
│         │           │           │              │  │
│         │           │  ┌────────┴─────────┐   │  │
│         │           │  │ Insights Thresh. │   │  │
│         │           │  │  (placeholder)   │   │  │
│         │           │  └──────────────────┘   │  │
│         │           └────────────┬────────────┘  │
│         │                        │               │
│         └────────┬───────────────┘               │
│                  ▼                                │
│         ┌────────────────┐                       │
│         │ Exit Gate Runner│                      │
│         │ (shared)        │                      │
│         └────────────────┘                       │
└─────────────────────────────────────────────────┘
```

Three concurrent systems share the exit gate runner, session executor, and locker.

### New Modules

| Module | Path | Responsibility |
|--------|------|---------------|
| Cron Scheduler | `tools/orchestrator/src/cron.ts` | Generic timer-based job scheduler with start/stop lifecycle |
| MR Comment Poller | `tools/orchestrator/src/mr-comment-poller.ts` | Poll PR status, detect new comments and merges, transition via exit gates |
| MR Chain Manager | `tools/orchestrator/src/mr-chain-manager.ts` | Track parent branches, detect merges/updates, spawn rebases, retarget MRs |

### Modified Modules

| Module | Change |
|--------|--------|
| `tools/orchestrator/src/loop.ts` | Start/stop cron scheduler alongside main loop |
| `tools/orchestrator/src/types.ts` | Add cron-related types if needed |
| `tools/kanban-cli/src/types/pipeline.ts` | Add `CronConfig` to `PipelineConfig` |
| `tools/kanban-cli/src/config/schema.ts` | Add Zod schema for `cron` section |
| `tools/kanban-cli/src/resolvers/types.ts` | Add `unresolvedThreadCount` to `PRStatus` |
| `tools/kanban-cli/src/db/schema.ts` | Add `mr_comment_tracking` table |
| `config/default-pipeline.yaml` | Add `cron` section with defaults |

## Detailed Design

### 1. Cron Scheduler (`cron.ts`)

```typescript
export interface CronJob {
  name: string;
  enabled: boolean;
  intervalMs: number;
  execute(): Promise<void>;
}

export interface CronSchedulerDeps {
  logger: { info: LogFn; warn: LogFn; error: LogFn };
  now?: () => number;
}

export interface CronScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createCronScheduler(
  jobs: CronJob[],
  deps: Partial<CronSchedulerDeps> = {}
): CronScheduler;
```

Behavior:
- `start()`: For each enabled job, set up a `setInterval` at `job.intervalMs`
- `stop()`: Clear all intervals
- Error isolation: Each job execution is wrapped in try/catch. Errors are logged but do not stop the scheduler or other jobs.
- Jobs fire independently and are not serialized with each other
- If a job is still executing when the next interval fires, skip (guard with a per-job `executing` flag)

### 2. MR Comment Poller (`mr-comment-poller.ts`)

```typescript
export interface MRCommentPollerDeps {
  db: DatabaseLike;                    // SQLite query access
  codeHost: CodeHostAdapter | null;
  exitGateRunner: ExitGateRunner;
  readFrontmatter: ReadFrontmatterFn;
  writeFrontmatter: WriteFrontmatterFn;
  logger: { info: LogFn; warn: LogFn; error: LogFn };
  now?: () => number;
  maxStagesPerCycle?: number;          // Default: 20
}

export interface MRPollResult {
  stageId: string;
  prUrl: string;
  action: 'new_comments' | 'merged' | 'no_change' | 'error' | 'first_poll';
  newUnresolvedCount?: number;
  previousUnresolvedCount?: number;
}

export function createMRCommentPoller(
  deps: Partial<MRCommentPollerDeps> = {}
): { poll(repoPath: string): Promise<MRPollResult[]> };
```

Poll cycle:
1. Query `stages` table: `SELECT * FROM stages WHERE status = 'PR Created' AND session_active = 0 AND pr_url IS NOT NULL LIMIT ?`
2. For each stage (up to `maxStagesPerCycle`):
   a. Call `codeHost.getPRStatus(pr_url)`
   b. If `merged`: build `WorkerInfo`, call `exitGateRunner.run(workerInfo, repoPath, 'Done')`
   c. If not merged: query `mr_comment_tracking` for `last_known_unresolved_count`
   d. If `unresolvedThreadCount > last_known_unresolved_count`: transition to `'Addressing Comments'` via exit gate
   e. Update `mr_comment_tracking` with current count and timestamp

### 3. MR Chain Manager (`mr-chain-manager.ts`)

```typescript
export interface MRChainManagerDeps {
  db: DatabaseLike;
  codeHost: CodeHostAdapter | null;
  sessionExecutor: SessionExecutor;
  locker: Locker;
  exitGateRunner: ExitGateRunner;
  readFrontmatter: ReadFrontmatterFn;
  writeFrontmatter: WriteFrontmatterFn;
  logger: { info: LogFn; warn: LogFn; error: LogFn };
}

export interface ChainCheckResult {
  childStageId: string;
  parentStageId: string;
  event: 'parent_merged' | 'parent_updated' | 'no_change' | 'skipped_locked' | 'skipped_conflict';
  rebaseSpawned: boolean;
  retargeted: boolean;
  promotedToReady: boolean;
}

export function createMRChainManager(
  deps: Partial<MRChainManagerDeps> = {}
): { checkParentChains(repoPath: string): Promise<ChainCheckResult[]> };
```

Check cycle:
1. Query stages with non-empty `pending_merge_parents` where status in (`PR Created`, `Addressing Comments`)
2. For each child stage:
   a. Check `rebase_conflict` in frontmatter — if true, skip
   b. For each parent in `pending_merge_parents`:
      - Query `parent_branch_tracking` for stored HEAD
      - Call `codeHost.getBranchHead(parent.branch)` for current HEAD
      - Call `codeHost.getPRStatus(parent.pr_url)` for merge status
   c. **Parent merged:**
      - Update `parent_branch_tracking.is_merged = true`
      - Remove from `pending_merge_parents` in frontmatter
      - Evaluate retargeting (see matrix)
      - If not locked: acquire lock, spawn rebase session
   d. **Parent branch updated (HEAD changed):**
      - Update `parent_branch_tracking.last_known_head`
      - If not locked: acquire lock, spawn rebase session
3. **Retargeting & promotion (runs immediately on merge detection, not after rebase completes):**
   Retargeting the PR base branch does not depend on the rebase session completing,
   so it is evaluated as soon as a parent merge is detected. This avoids waiting for
   a potentially long-running rebase before updating the PR target.
   - Call `codeHost.editPRBase(prNumber, newBase)` to retarget (remaining parent or defaultBranch)
   - If all parents merged: call `codeHost.markPRReady(prNumber)` to promote from draft
   - If all parents merged: update frontmatter: `is_draft: false`, clear `pending_merge_parents`

### 4. Retargeting Matrix

| Event | Current Target | New Target | Draft Status |
|---|---|---|---|
| Multi-parent, one merges, >1 remain | main | main (no change) | Stay draft |
| Multi-parent, all but one merge | main | Remaining parent branch | Stay draft |
| Single-parent, parent merges | parent branch | main/default | Promote to ready |
| Zero unmerged parents (all merged) | any | main/default | Promote to ready |

### 5. Pipeline Config Extension

```typescript
// In tools/kanban-cli/src/types/pipeline.ts
export interface CronJobConfig {
  enabled: boolean;
  interval_seconds: number;
}

export interface CronConfig {
  mr_comment_poll?: CronJobConfig;
  insights_threshold?: CronJobConfig;
}

// PipelineConfig gains:
export interface PipelineConfig {
  workflow: { /* existing */ };
  jira?: JiraConfig | null;
  cron?: CronConfig;  // NEW
}
```

Zod validation: `enabled` is boolean, `interval_seconds` is integer in [30, 3600].

### 6. PRStatus Extension

```typescript
// In tools/kanban-cli/src/resolvers/types.ts
export interface PRStatus {
  merged: boolean;
  hasUnresolvedComments: boolean;
  unresolvedThreadCount: number;  // NEW
  state: string;
}
```

Both GitHub and GitLab adapters updated to return actual count.

### 7. SQLite Schema Addition

```sql
CREATE TABLE IF NOT EXISTS mr_comment_tracking (
  stage_id TEXT PRIMARY KEY,
  last_poll_timestamp TEXT NOT NULL,
  last_known_unresolved_count INTEGER DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id)
);
```

Added to `tools/kanban-cli/src/db/schema.ts` alongside existing tables.

### 8. Orchestrator Integration

In `createOrchestrator()` (`loop.ts`):
- Build `MRCommentPoller` and `MRChainManager` with shared deps
- Create cron jobs from `config.pipelineConfig.cron`
- MR comment poll job: runs `poller.poll()` then `chainManager.checkParentChains()`
- Create `CronScheduler` with jobs
- Call `cronScheduler.start()` in `orchestrator.start()`
- Call `cronScheduler.stop()` in `orchestrator.stop()`

### 9. `rebase-child-mr` Skill

Create `skills/rebase-child-mr/SKILL.md` with:
- Session context: child stage file, parent stage files, trigger type
- Workflow: fetch, rebase onto target, resolve conflicts, verify, force-push
- Exit conditions: success (rebased + pushed) or failure (`rebase_conflict: true`)
- Frontmatter updates: `pending_merge_parents`, `mr_target_branch`

### 10. Race Condition Mitigation

- Cron skips stages where `session_active = true`
- Before spawning rebase: `locker.acquireLock(stageFilePath)`
- Both resolver and cron can detect merges — exit gate is idempotent
- `rebase_conflict` flag prevents repeated spawn attempts
- Per-job `executing` flag in cron scheduler prevents overlapping executions of the same job

## Future Enhancements

- LLM-based comment classification for ambiguous platforms (general comment vs actionable feedback)
- Rate limit header parsing and adaptive backoff
- Webhook-based triggers instead of polling (when code host supports it)
