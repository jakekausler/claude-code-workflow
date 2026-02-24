# Stage 6E: Insights Threshold Cron — Design

## Problem

The orchestrator has a cron scheduler with an `insights-threshold` job configured as a no-op placeholder (`loop.ts:170-181`). This job needs to periodically check whether unanalyzed learnings exceed a threshold and spawn a meta-insights Claude session when triggered.

## Design

### New Module: `insights-threshold.ts`

Factory function following existing DI pattern:

```typescript
createInsightsThresholdChecker(deps: Partial<InsightsThresholdDeps>): InsightsThresholdChecker
```

**Interface:**

```typescript
interface InsightsThresholdChecker {
  check(repoPath: string): Promise<void>;
}
```

**Dependencies:**

| Dep | Type | Default | Purpose |
|-----|------|---------|---------|
| `countLearnings` | `(repoPath: string) => Promise<LearningsResult>` | Shells to `count-unanalyzed.sh` | Query unanalyzed count |
| `spawnSession` | `(repoPath: string) => Promise<void>` | No-op with log | Spawn meta-insights session |
| `logger` | `Logger` | No-op logger | Logging |
| `now` | `() => number` | `Date.now` | Injectable time |
| `intervalMs` | `number` | `600000` | Cooldown period (matches cron interval) |

**LearningsResult type:**

```typescript
interface LearningsResult {
  count: number;
  threshold: number;
  exceeded: boolean;
}
```

### check() Logic

1. Call `countLearnings(repoPath)`
2. If `!exceeded` → log info, return
3. If `now() - lastTriggeredAt < intervalMs` → log cooldown skip, return
4. Log threshold exceeded, spawning session
5. Call `spawnSession(repoPath)` (fire-and-forget, catch errors)
6. Set `lastTriggeredAt = now()`

### Cooldown

- In-memory `lastTriggeredAt` timestamp in closure (resets on process restart)
- Cooldown period matches the cron interval
- After triggering, next tick is skipped; following tick can re-trigger if threshold still exceeded

### Counting Learnings

The `countLearnings` default implementation executes `skills/meta-insights/scripts/count-unanalyzed.sh` via `child_process.execFile`, parses line count, and compares against threshold from pipeline config (`workflow.defaults.WORKFLOW_LEARNINGS_THRESHOLD` or default 10).

The `execFile` call is itself injectable within the default implementation for testability.

### Session Spawning

In loop.ts integration, `spawnSession` wraps `sessionExecutor.spawn()`:
- `skillName: 'meta-insights'`
- `worktreePath`: repo path (meta-insights reads from `~/docs/`, not repo files)
- `worktreeIndex: -1` (no worktree slot consumed)
- Fire-and-forget — errors logged but don't crash the cron job

### Integration in loop.ts

Replace the no-op placeholder in `buildCronScheduler()` with:

```typescript
const checker = createInsightsThresholdChecker({
  countLearnings: /* shell wrapper */,
  spawnSession: /* sessionExecutor.spawn wrapper */,
  logger: shared.logger,
  now: deps.now,
  intervalMs: insightsConfig.interval_seconds * 1000,
});

jobs.push({
  name: 'insights-threshold',
  enabled: insightsConfig.enabled,
  intervalMs: insightsConfig.interval_seconds * 1000,
  execute: () => checker.check(config.repoPath),
});
```

### Files

| File | Change |
|------|--------|
| `tools/orchestrator/src/insights-threshold.ts` | New — checker factory + types |
| `tools/orchestrator/src/loop.ts` | Wire checker into cron placeholder |
| `tools/orchestrator/src/__tests__/insights-threshold.test.ts` | New — unit tests |
| `tools/orchestrator/src/__tests__/insights-threshold-integration.test.ts` | New — integration tests |

No config schema changes. No kanban-cli changes. No new DB tables.
