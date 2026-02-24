# Stage 6E: Insights Threshold Cron — Implementation Plan

Design: `docs/plans/2026-02-24-insights-threshold-cron-design.md`

## Task 1: Create insights-threshold module with tests

**Goal**: Build `createInsightsThresholdChecker(deps)` with full unit test coverage.

**Files**:
- `tools/orchestrator/src/insights-threshold.ts` (new)
- `tools/orchestrator/src/__tests__/insights-threshold.test.ts` (new)

**Implementation**:
1. Define types: `LearningsResult`, `InsightsThresholdDeps`, `InsightsThresholdChecker`
2. Implement `createInsightsThresholdChecker(deps)` factory with:
   - Default deps (no-op logger, Date.now, no-op spawnSession, shell-based countLearnings)
   - `check(repoPath)` method with threshold check → cooldown check → spawn
   - In-memory `lastTriggeredAt` cooldown tracking
3. Write unit tests covering:
   - Threshold not exceeded → no spawn
   - Threshold exceeded → spawn called
   - Cooldown active → spawn skipped
   - Cooldown expired → spawn called again
   - countLearnings failure → logged, no crash
   - spawnSession failure → logged, no crash, cooldown still set
   - Logger receives correct messages

**Success criteria**: `npm run verify` passes in orchestrator.

**Status**: Not Started

---

## Task 2: Wire checker into loop.ts cron placeholder

**Goal**: Replace the no-op `insights-threshold` placeholder in `buildCronScheduler()` with the real checker.

**Files**:
- `tools/orchestrator/src/loop.ts`

**Implementation**:
1. Import `createInsightsThresholdChecker`
2. Build `countLearnings` wrapper that shells to `count-unanalyzed.sh` and parses output
3. Build `spawnSession` wrapper that calls `sessionExecutor.spawn()` with meta-insights skill config
4. Create checker instance and replace the no-op execute function
5. Pass through `shared.logger`, `deps.now`, and interval config

**Success criteria**: `npm run verify` passes in orchestrator. Existing 369+ orchestrator tests still pass.

**Status**: Not Started

---

## Task 3: Integration tests

**Goal**: Test the full wiring — cron job creation, checker invocation, session spawning.

**Files**:
- `tools/orchestrator/src/__tests__/insights-threshold-integration.test.ts` (new)

**Implementation**:
1. Test that `buildCronScheduler()` creates an insights-threshold job when config is present
2. Test that the job's execute() calls through to the checker
3. Test end-to-end: config → cron job → learnings check → session spawn
4. Test disabled config → job not enabled
5. Test missing config → no job created

**Success criteria**: `npm run verify` passes in orchestrator.

**Status**: Not Started

---

## Task 4: Final verification and documentation

**Goal**: Full verify across both packages, update stage tracking docs.

**Implementation**:
1. Run `npm run verify` in both `tools/orchestrator` and `tools/kanban-cli`
2. Update `docs/plans/stage-6e-insights-threshold-handoff.md` to mark complete
3. Commit all changes

**Success criteria**: All tests pass, no lint warnings, docs updated.

**Status**: Not Started
