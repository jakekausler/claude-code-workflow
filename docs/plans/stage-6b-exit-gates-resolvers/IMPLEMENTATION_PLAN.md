# Stage 6B: Exit Gates & Resolver Execution — Implementation Plan

**Design doc:** `docs/plans/2026-02-23-stage-6b-exit-gates-resolvers-design.md`

---

## Task 6B-1: Frontmatter Schema Changes

**Goal:** Add `stage_statuses` to ticket schema and `ticket_statuses` to epic schema in kanban-cli.

**Files to modify:**
- `tools/kanban-cli/src/parser/frontmatter-schemas.ts` — Add optional fields with `z.record(z.string(), z.string()).default({})`
- `tools/kanban-cli/src/parser/frontmatter.ts` — Parse new fields in `parseTicketFrontmatter()` and `parseEpicFrontmatter()`
- `tools/kanban-cli/src/types/work-items.ts` — Add `stage_statuses: Record<string, string>` to Ticket, `ticket_statuses: Record<string, string>` to Epic
- `tools/kanban-cli/tests/parser/frontmatter.test.ts` — Test new fields parse, default to `{}`

**Success criteria:**
- `parseTicketFrontmatter()` returns `stage_statuses` (defaults to `{}`)
- `parseEpicFrontmatter()` returns `ticket_statuses` (defaults to `{}`)
- All existing 729 kanban-cli tests pass
- `npm run verify` passes in kanban-cli

**Status:** Not Started

---

## Task 6B-2: Update Resolver Builtins

**Goal:** Update `pr-status` to merge-only and implement `testing-router`.

**Dependencies:** None (independent of 6B-1)

**Files to modify:**
- `tools/kanban-cli/src/resolvers/builtins/pr-status.ts` — Remove `hasUnresolvedComments` transition, make async
- `tools/kanban-cli/src/resolvers/builtins/stage-router.ts` — Replace no-op with `testing-router` logic (route by `refinement_type`)
- `tools/kanban-cli/src/resolvers/builtins/index.ts` — Register `testing-router` name (rename from `stage-router` if needed)
- `tools/kanban-cli/tests/resolvers/builtins.test.ts` — Update pr-status tests, add testing-router tests

**Success criteria:**
- `pr-status`: returns "Done" when merged, null otherwise (no comment check)
- `testing-router`: returns "Manual Testing" for frontend/ux/accessibility, "Finalize" otherwise
- All kanban-cli tests pass
- `npm run verify` passes

**Status:** Not Started

---

## Task 6B-3: Exit Gate Module

**Goal:** Create `tools/orchestrator/src/exit-gates.ts` with `createExitGateRunner()`.

**Dependencies:** 6B-1 (needs `stage_statuses`/`ticket_statuses` schema)

**Files to create:**
- `tools/orchestrator/src/exit-gates.ts` — Factory function with DI
- `tools/orchestrator/tests/exit-gates.test.ts` — Unit tests

**Implementation details:**
- `createExitGateRunner(repoPath, deps)` factory following DI pattern
- `run(workerInfo, statusAfter)` method:
  1. Return early if status unchanged
  2. Resolve ticket path from workerInfo (epic, ticket IDs from stage file)
  3. Read ticket frontmatter → update `stage_statuses[stageId]` → write
  4. Derive ticket status from stage_statuses map
  5. Resolve epic path → read epic frontmatter → update `ticket_statuses[ticketId]` → write
  6. Call `syncRepo()` with retry-once-then-warn
- Injectable deps: `readFrontmatter`, `writeFrontmatter`, `syncRepo`, `logger`
- Need to read the stage file frontmatter to get `ticket` and `epic` IDs for path resolution

**Success criteria:**
- Unit tests cover: status unchanged skip, ticket update, epic update, sync retry, missing file handling
- `npm run verify` passes in orchestrator

**Status:** Not Started

---

## Task 6B-4: Resolver Execution Module

**Goal:** Create `tools/orchestrator/src/resolvers.ts` with `createResolverRunner()`.

**Dependencies:** 6B-2 (needs updated resolvers), 6B-3 (delegates to exit gate runner)

**Files to create:**
- `tools/orchestrator/src/resolvers.ts` — Factory function with DI
- `tools/orchestrator/tests/resolvers.test.ts` — Unit tests

**Implementation details:**
- `createResolverRunner(repoPath, pipelineConfig, deps)` factory
- `checkAll(context)` method:
  1. Discover all stage files via glob `epics/**/*.md` filtered to stage files
  2. For each: read frontmatter, check session_active, match to resolver state
  3. Execute resolver from registry
  4. On transition: update stage frontmatter, delegate to exitGateRunner.run()
- Injectable deps: `readFrontmatter`, `writeFrontmatter`, `registry`, `exitGateRunner`, `discoverStageFiles`, `logger`
- Stage file discovery: glob for `STAGE-*.md` pattern in epics directory, or use kanban-cli's `discoverStageFiles()`

**Success criteria:**
- Unit tests cover: skip locked, skip non-resolver, execute and propagate, null result, error handling
- `npm run verify` passes in orchestrator

**Status:** Not Started

---

## Task 6B-5: Loop Integration

**Goal:** Wire exit gates, resolver execution, and "Not Started" onboarding into `loop.ts`.

**Dependencies:** 6B-3, 6B-4

**Files to modify:**
- `tools/orchestrator/src/loop.ts` — Add resolver check at top of tick, exit gate in handleSessionExit, "Not Started" onboarding in stage processing
- `tools/orchestrator/src/types.ts` — Add optional `exitGateRunner` and `resolverRunner` to OrchestratorDeps (if not already typed)
- `tools/orchestrator/tests/loop.test.ts` — Add tests for new behavior

**Implementation details:**

1. **Resolver check at top of tick:**
   ```typescript
   // Before discovery
   if (resolverRunner) {
     const resolverResults = await resolverRunner.checkAll(resolverContext);
     for (const r of resolverResults) {
       if (r.newStatus) logger.info('Resolver transition', r);
     }
   }
   ```

2. **"Not Started" onboarding after lock:**
   ```typescript
   if (statusBefore === 'Not Started') {
     const entryState = config.pipelineConfig.workflow.phases.find(
       p => p.name === config.pipelineConfig.workflow.entry_phase
     );
     if (entryState) {
       const { data, content } = await readFrontmatter(stageFilePath);
       data.status = entryState.status;
       await writeFrontmatter(stageFilePath, data, content);
       statusBefore = entryState.status;
       logger.info('Onboarded stage', { stageId, status: entryState.status });
     }
   }
   ```

3. **Exit gate in handleSessionExit:**
   ```typescript
   if (workerInfo.statusBefore !== statusAfter && exitGateRunner) {
     const gateResult = await exitGateRunner.run(workerInfo, statusAfter);
     logger.info('Exit gate completed', { stageId, ...gateResult });
   }
   ```

4. **Build ResolverContext** in orchestrator start/tick with `createCodeHostAdapter()` and `process.env`.

**Success criteria:**
- Existing 170 orchestrator tests still pass
- New tests: onboarding, exit gate call, resolver execution in tick
- `npm run verify` passes in orchestrator

**Status:** Not Started

---

## Task 6B-6: Integration Tests

**Goal:** End-to-end tests exercising the full exit gate and resolver flows.

**Dependencies:** 6B-5

**Files to create:**
- `tools/orchestrator/tests/integration/exit-gate-flow.test.ts` — Full exit gate with mock files
- `tools/orchestrator/tests/integration/resolver-flow.test.ts` — Full resolver execution with mock code host

**Implementation details:**
- Use injected deps (mock readFrontmatter/writeFrontmatter) to simulate file hierarchy
- Test exit gate: stage status change → ticket updated → epic updated → sync called
- Test resolver: PR Created stage with mock merged PR → status transitions to Done → propagation
- Test resolver: testing-router routes based on refinement_type
- Test "Not Started" onboarding: stage onboarded to Design before session spawn

**Success criteria:**
- Integration tests pass
- `npm run verify` passes in both packages

**Status:** Not Started

---

## Task 6B-7: Seed Script & Handoff Updates

**Goal:** Update seed script to include `stage_statuses`/`ticket_statuses` fields, update handoff doc.

**Dependencies:** 6B-6

**Files to modify:**
- `tools/kanban-cli/scripts/seed-test-repo.sh` — Add `stage_statuses` to ticket files, `ticket_statuses` to epic files
- `docs/plans/stage-6b-exit-gates-resolvers-handoff.md` — Mark complete, add handoff notes for 6C

**Success criteria:**
- Seed script generates files with new frontmatter fields
- Existing kanban-cli tests still pass with updated seed data
- `npm run verify` passes in both packages

**Status:** Not Started

---

## Dependency Graph

```
6B-1 (Schema) ────────────────┐
                               ├──→ 6B-3 (Exit Gates) ──┐
6B-2 (Resolver Builtins) ─────┤                          ├──→ 6B-5 (Loop) ──→ 6B-6 (Integration) ──→ 6B-7 (Seed/Handoff)
                               └──→ 6B-4 (Resolvers) ───┘
```

Tasks 6B-1 and 6B-2 are independent and can run in parallel.
Tasks 6B-3 and 6B-4 can run in parallel after their dependencies.
Tasks 6B-5, 6B-6, 6B-7 are sequential.

## Verification

After each task: `npm run verify` in the affected package(s).
After all tasks: `npm run verify` in both `tools/kanban-cli` and `tools/orchestrator`.
