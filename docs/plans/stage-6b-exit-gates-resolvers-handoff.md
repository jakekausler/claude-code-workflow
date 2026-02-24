# Stage 6B: Exit Gates & Resolver Execution — Session Prompt

## Context

Stages 0-5 are complete on the `kanban` branch. Stage 5.5A (Schema & Sync), Stage 5.5B (Skill Updates), Stage 5.5C (Jira Conversion Enrichment), Stage 6A (Orchestrator Infrastructure), and Stage 6A.5 (MCP Server) are also complete. This session implements **Stage 6B: Exit Gates & Resolver Execution** — the deterministic post-session logic that verifies status changes, propagates updates to ticket/epic files, syncs SQLite, and handles resolver state transitions.

### Dependency Graph

```
Stage 5.5A (Schema & Sync) ✅
  ├── Stage 5.5B (Skill Updates) ✅
  │     └── Stage 6A (Orchestrator Infrastructure) ✅
  │           ├── Stage 6A.5 (MCP Server) ✅
  │           └── Stage 6B (Exit Gates & Resolvers) ← THIS STAGE
  └── Stage 5.5C (Jira Conversion Enrichment) ✅
```

### What Has Been Built (Stages 0-6A)

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

**Test Suite:** 729 tests across 51 test files (kanban-cli), 170 tests across 9 test files (orchestrator), all passing.

**Stage 6A: Orchestrator Infrastructure (Complete)**

The orchestrator (`tools/orchestrator/`) is a separate TypeScript package that manages stage lifecycle:

| Module | File | Lines | Purpose |
|--------|------|-------|---------|
| Config | `src/config.ts` | 99 | Pipeline config loading, env var merging, CLI flags |
| Logger | `src/logger.ts` | 118 | Structured stderr logging, per-session log files |
| Discovery | `src/discovery.ts` | 137 | Wraps `kanban-cli next`, filters `needs_human` stages |
| Locking | `src/locking.ts` | 92 | `session_active` frontmatter read/write |
| Worktree | `src/worktree.ts` | 179 | Git worktree create/remove, index pool, isolation validation |
| Session | `src/session.ts` | 208 | Prompt assembly, `claude -p` child process spawn |
| Loop | `src/loop.ts` | 283 | Tick cycle, worker pool, crash recovery |
| Shutdown | `src/shutdown.ts` | 123 | SIGINT/SIGTERM handling, drain, cleanup |
| CLI | `src/index.ts` | 75 | Commander entry point wiring all modules |
| Types | `src/types.ts` | 22 | WorkerInfo, OrchestratorConfig |

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

**CLI interface:**
```
orchestrator [options]
  --repo <path>          Target repository (default: cwd)
  --once                 Run single tick then exit
  --idle-seconds <n>     Wait time when no stages (default: 30)
  --log-dir <path>       Session log directory (default: <repo>/.kanban-logs/)
  --model <model>        Claude model for sessions (default: sonnet)
  --verbose              Verbose output
```

### Key Design References

- Full design doc: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`
- Orchestrator flow: `docs/plans/orchestrator-flow.dot` and `docs/plans/flow.svg`
- Stage 6A design: `docs/plans/2026-02-23-stage-6a-orchestrator-infrastructure-design.md`
- Stage 6A implementation plan: `docs/plans/stage-6a-orchestrator-infrastructure/IMPLEMENTATION_PLAN.md`

---

## What Stage 6B Delivers

### Goal

When a Claude session exits, the orchestrator runs a deterministic **exit gate** sequence: verify the status change, update ticket and epic files to reflect the new status, and sync to SQLite. Additionally, the orchestrator executes **resolver functions** on each tick for stages in resolver states (like `PR Created`), allowing programmatic state transitions without Claude sessions.

### What Changed Since Initial Handoff (Stage 6A.5 Delivered)

Stage 6A.5 added an **MCP server** (`tools/mcp-server/`) that wraps external service interactions (Jira, PR/MR, Confluence, Slack) as structured MCP tools. This affects 6B in three ways:

1. **Resolvers and exit gates should use MCP tools instead of raw CLI commands.** For example, the `pr-status` resolver should call `mcp__kanban__pr_get_status` (or the equivalent MCP tool) rather than shelling out to `gh pr view` or using the code host adapter directly. The MCP server is auto-discovered via `.mcp.json` and uses stdio transport.

2. **Mock admin tools are available for testing resolver logic.** Three mock-only tools — `mock_set_pr_merged`, `mock_inject_comment`, `mock_set_ticket_status` — allow tests to seed external service state without real API calls. This simplifies test setup for exit gate and resolver integration tests significantly.

3. **`KANBAN_MOCK` propagation is already wired.** The orchestrator propagates `KANBAN_MOCK=true` to child sessions (commit 38f05ea), so mock mode is available throughout the pipeline. The skills (`phase-finalize`, `review-cycle`, `convert-ticket`) have already been updated with MCP tool references as preferred alternatives to CLI commands (commit 77dbee7).

### What Ships

1. **Exit gate sequence in `handleSessionExit`** — After a session completes:
   - Read stage file, confirm status was updated by the session
   - Update the parent ticket file's stage status table
   - Update the parent epic file's ticket status
   - Call `kanban-cli sync` to update SQLite from the modified files
   - Log the complete exit gate result

2. **Resolver execution in the tick cycle** — Before spawning new sessions:
   - Find all stages in resolver states (pipeline phases with `resolver:` field) where `session_active = false`
   - Call the resolver function for each
   - If resolver returns a target status: update stage frontmatter, update ticket, update epic, sync
   - If resolver returns null: skip (stage stays in current state)

3. **`testing-router` resolver (new builtin)** — Reads `refinement_type` from stage frontmatter and config to decide: route to Manual Testing or skip directly to Finalize.

4. **Updated `pr-status` resolver** — Simplified check: is the PR merged? If yes → Done. Comment detection moves to Stage 6D (MR comment cron). Reads `pr_url` from stage frontmatter. Should call `mcp__kanban__pr_get_status` (or the underlying MCP tool) rather than `gh pr view` or raw CLI — the MCP server handles provider abstraction (GitHub/GitLab).

5. **Ticket file update logic** — After a stage status change, find the parent ticket file and update its stage status table (a YAML section listing each stage's current status).

6. **Epic file update logic** — After a ticket's stages change, find the parent epic file and update its ticket status section.

### What Stage 6B Does NOT Include

- ❌ Completion cascade (stage Done → ticket Complete → epic Complete propagation) → Stage 6C
- ❌ Backlog re-evaluation (unblocking dependent stages when a stage reaches Done) → Stage 6C
- ❌ MR comment polling cron loop → Stage 6D
- ❌ Insights threshold cron loop → Stage 6E
- ❌ Any changes to the session spawning infrastructure (that's 6A, already complete)
- ❌ Any changes to worktree management (that's 6A, already complete)

### Key Architectural Decisions (Already Resolved)

| Decision | Resolution |
|----------|-----------|
| Exit gates are loop behavior | After a session exits, the loop runs a deterministic sequence. Not configurable via pipeline config. |
| `kanban-cli sync` is the orchestrator's responsibility | Phase skills do NOT call sync. The orchestrator runs sync after session exit. |
| Resolver states are checked every tick | Before spawning new sessions, the loop checks all resolver-state stages. |
| Resolvers are TypeScript functions | Not Claude sessions. They execute synchronously in the orchestrator process. |
| `pr-status` only checks merge status | Comment detection is deferred to Stage 6D's cron loop. |
| Session skills set their own status | The exit gate verifies this happened but does not drive transitions for skill states. |

---

## Existing Infrastructure Supporting Stage 6B

### Already Implemented (Use These)

**From kanban-cli:**
- **`kanban-cli sync`**: Re-parses all files into SQLite. The orchestrator will call this after modifying frontmatter.
- **`kanban-cli next`**: Returns priority-sorted ready stages. Already respects `session_active` locking.
- **Pipeline config loader**: `loadPipelineConfig()` reads `.kanban-workflow.yaml` with Zod validation.
- **Frontmatter read/write**: `readYamlFrontmatter()` / `writeYamlFrontmatter()` in parser/frontmatter.ts.
- **Stage file discovery**: `discoverStageFiles()` recursively walks `epics/` directory.
- **Resolver registry**: `tools/kanban-cli/src/resolvers/registry.ts` — existing resolver infrastructure.
- **Builtin resolvers**: `tools/kanban-cli/src/resolvers/builtins/` — `pr-status.ts` and `stage-router.ts` already exist.
- **Code host adapters**: `createCodeHostAdapter()` with `getPRStatus()` for GitHub and GitLab. (Note: the MCP server now wraps these — prefer `mcp__kanban__pr_get_status` for new code.)
- **State machine**: `tools/kanban-cli/src/engine/state-machine.ts` — transition validation.

**From MCP server (Stage 6A.5):**
- **PR/MR tools**: `pr_get`, `pr_get_status`, `pr_create`, `pr_get_comments`, `pr_add_comment`, `pr_list`, `pr_get_diff`, `pr_get_checks` — wraps GitHub/GitLab APIs.
- **Jira tools**: `jira_get_issue`, `jira_search`, `jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_sync` — wraps Jira API.
- **Mock admin tools** (available when `KANBAN_MOCK=true`): `mock_inject_comment`, `mock_set_pr_merged`, `mock_set_ticket_status` — seed external state for testing.
- **Mock mode**: Stateful in-memory `MockState` with seed data from fixtures. Auto-discovered via `.mcp.json`, stdio transport.

**From orchestrator (Stage 6A):**
- **`handleSessionExit()`** in `loop.ts` (lines 106-140): The extension point. Currently resets locks, removes worktrees, closes loggers. 6B adds exit gate logic here.
- **`handleSessionError()`** in `loop.ts` (lines 141-153): Error path — 6B may also need to handle partial exit gates.
- **`lookupSkillName()`** in `loop.ts` (line 29): Returns skill name or null for resolver states. Already used to skip resolver states during session spawning.
- **`resolveStageFilePath()`** in `loop.ts` (line 39): Builds `<repo>/epics/<epic>/<ticket>/<stage>.md` path.
- **`Locker`** interface: `acquireLock()`, `releaseLock()`, `readStatus()`, `isLocked()`.
- **`WorkerInfo`** type: `stageId`, `stageFilePath`, `worktreePath`, `worktreeIndex`, `statusBefore`, `startTime`.
- **`OrchestratorConfig`** type: `repoPath`, `pipelineConfig`, `workflowEnv`, `maxParallel`, etc.
- **`OrchestratorDeps`** interface: `discovery`, `locker`, `worktreeManager`, `sessionExecutor`, `logger`.
- **DI pattern**: All modules use `Partial<XxxDeps>` injection. 6B should follow the same pattern.

### Not Yet Implemented (Stage 6B Builds These)

- Exit gate logic in `handleSessionExit`
- Ticket file update after stage status change
- Epic file update after ticket status change
- `kanban-cli sync` call from orchestrator
- Resolver execution loop (checking resolver states each tick)
- `testing-router` resolver
- Updated `pr-status` resolver (merge-only check, using `mcp__kanban__pr_get_status` instead of raw CLI)

---

## Pipeline Config — Resolver States

The default pipeline defines 8 states. States with `skill:` spawn Claude sessions. States with `resolver:` are checked programmatically by the loop.

```yaml
workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build, User Design Feedback]
    - name: User Design Feedback
      skill: user-design-feedback
      status: User Design Feedback
      transitions_to: [Build]
    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Automatic Testing]
    - name: Automatic Testing
      skill: automatic-testing
      status: Automatic Testing
      transitions_to: [Manual Testing]
    - name: Manual Testing
      skill: manual-testing
      status: Manual Testing
      transitions_to: [Finalize]
    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done, PR Created]
    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to: [Done, Addressing Comments]
    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to: [PR Created]
```

**Current resolver states:** Only `PR Created` has a resolver (`pr-status`). Stage 6B may add a `testing-router` resolver (not in the default pipeline above but described in the design doc).

---

## Extension Points in loop.ts

### handleSessionExit (lines 106-140)

This is the primary extension point. Currently:

```typescript
async function handleSessionExit(
  stageId: string,
  workerInfo: WorkerInfo,
  result: { exitCode: number; durationMs: number },
  sessionLogger: SessionLogger,
): Promise<void> {
  const statusAfter = await locker.readStatus(workerInfo.stageFilePath);

  // 3-way logging: crash / no-change / normal completion
  if (workerInfo.statusBefore === statusAfter && result.exitCode !== 0) {
    logger.warn('Session crashed', { stageId, exitCode: result.exitCode, statusBefore: workerInfo.statusBefore });
  } else if (workerInfo.statusBefore === statusAfter && result.exitCode === 0) {
    logger.info('Session completed without status change', { stageId, statusBefore: workerInfo.statusBefore });
  } else {
    logger.info('Session completed', { stageId, exitCode: result.exitCode, statusBefore: workerInfo.statusBefore, statusAfter, durationMs: result.durationMs });
  }

  // Cleanup (6A infrastructure)
  await locker.releaseLock(workerInfo.stageFilePath);
  await worktreeManager.remove(workerInfo.worktreePath);
  await sessionLogger.close();
  activeWorkers.delete(workerInfo.worktreeIndex);
  notifyWorkerExit();
}
```

**6B extends this to add** (between the logging and cleanup blocks):
1. If status changed: update ticket file, update epic file, call `kanban-cli sync`
2. If status unchanged: skip exit gate (already handled by crash/no-change logging)

### Tick Cycle — Resolver Insertion Point

In the tick cycle (lines 168-235), resolvers should be checked BEFORE session spawning:

```
Current flow:
  1. Discover ready stages
  2. For each stage: lock → worktree → spawn session

6B flow:
  1. Check all resolver-state stages (session_active=false) → execute resolver → update if needed
  2. Discover ready stages
  3. For each stage: lock → worktree → spawn session
```

This means resolver execution happens at the TOP of each tick, before discovery.

---

## Open Questions (Resolve During Design Phase)

1. **How should the orchestrator call `kanban-cli sync`?** Options: as a subprocess (`npx tsx ... sync --repo`), or import the sync function directly from kanban-cli. The discovery module uses subprocess calls; the locker uses direct library imports. Which pattern for sync? (Note: for Jira-specific sync, `mcp__kanban__jira_sync` is available as an MCP tool alternative.)

2. **How should ticket and epic files be updated?** The orchestrator needs to modify YAML frontmatter in ticket and epic files. Options: use the existing `readYamlFrontmatter`/`writeYamlFrontmatter` pattern from the locker module, or call kanban-cli commands.

3. **Where do resolver functions live?** Options: in the orchestrator package, in the kanban-cli resolver registry, or importable from kanban-cli. The existing `pr-status` resolver is in `tools/kanban-cli/src/resolvers/builtins/pr-status.ts`.

4. **Should the resolver execution be a separate module?** Options: inline in loop.ts, or a new `resolvers.ts` module in the orchestrator package (following the modular pattern).

5. **How does the `testing-router` resolver access stage data?** It needs `refinement_type` from the stage frontmatter. Options: read frontmatter directly, or query SQLite (after sync).

6. **What happens when `kanban-cli sync` fails?** The exit gate should probably log and continue rather than crashing, but this needs to be decided.

7. **How should "Not Started" stages be onboarded into the pipeline?** The `kanban-cli next` command reports stages with status "Not Started" as `design_ready`. However, the orchestrator's `lookupSkillName` can't find a pipeline phase matching "Not Started" (the entry phase is "Design"), so these stages are silently skipped. Options: (a) the orchestrator automatically sets status to the entry phase ("Design") before processing, (b) a separate CLI command or lifecycle hook transitions stages from "Not Started" to "Design", (c) the seed/setup process should set the initial status to the entry phase.

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the design doc sections for Stage 6B (Section in redesign design doc, end-state vision)
2. Read the orchestrator flow diagram (`docs/plans/orchestrator-flow.dot`)
3. Study the existing `handleSessionExit` function in `tools/orchestrator/src/loop.ts`
4. Study the existing resolver infrastructure in `tools/kanban-cli/src/resolvers/`
5. Study how frontmatter is read/written (locker module pattern)
6. Resolve the Open Questions listed above
7. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-6b-exit-gates-resolvers-design.md`
2. Write the implementation plan to `docs/plans/stage-6b-exit-gates-resolvers/IMPLEMENTATION_PLAN.md`

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor**
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Integration test with real CLI calls
8. Write handoff for Stage 6C

### Key Constraints

- The existing 729 kanban-cli tests and 170 orchestrator tests must continue passing
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass in both packages after every task
- The exit gate sequence must be deterministic and logged
- Resolver functions must be testable without real GitHub/GitLab APIs (injectable deps)
- No changes to the session spawning or worktree infrastructure (that's 6A)
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The orchestrator's `--mock` mode is available for testing exit gates and resolvers. Set `KANBAN_MOCK=true` to mock external services via the MCP server.
- The `needsHuman` filtering in discovery over-requests from `kanban-cli next` (3x or +10, whichever is larger) to compensate for human-needing stages being filtered post-discovery.

### Suggested Sub-Task Breakdown

- **6B-1**: Ticket/epic file update utilities — read/write ticket stage status table, epic ticket status
- **6B-2**: Sync wrapper — callable `kanban-cli sync` from orchestrator (note: `mcp__kanban__jira_sync` also exists as an MCP alternative for Jira sync specifically)
- **6B-3**: Exit gate logic — extend `handleSessionExit` with status verification, file updates, sync
- **6B-4**: Resolver execution framework — find resolver-state stages, call resolver, update on result
- **6B-5**: `testing-router` resolver — route Automatic Testing → Manual Testing or Finalize
- **6B-6**: Updated `pr-status` resolver — merge-only check (comment detection deferred to 6D)
- **6B-7**: Resolver integration into tick cycle — add resolver check before discovery
- **6B-8**: Integration tests — end-to-end exit gate flow, resolver execution. Mock admin tools (`mock_set_pr_merged`, `mock_inject_comment`, `mock_set_ticket_status`) can seed external service state for test setup — no need to mock at the adapter level.

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
bash scripts/seed-old-format-repo.sh

# Key commands the orchestrator will use
npx tsx src/cli/index.ts next --repo /tmp/kanban-test-repo --max 3 --pretty
npx tsx src/cli/index.ts sync --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts validate --repo /tmp/kanban-test-repo --pretty

# Run full test suites
cd ../orchestrator && npm run verify
cd ../kanban-cli && npm run verify
```

---

## Next Steps After Stage 6B

After this session completes Stage 6B:

- **Stage 6C** will implement completion cascade (stage Done → ticket Complete → epic Complete) and backlog re-evaluation (unblocking dependent stages)
- **Stage 6D** will implement the MR comment cron loop (polling for new PR comments, detecting merges)
- **Stage 6E** will implement the insights threshold cron loop (auto-triggering meta-insights)

Stage 6C depends on 6B (needs exit gates to trigger cascade). Stages 6D and 6E can be developed in parallel with 6C since they are independent systems.

---

## Stage 6B Completion Summary

### Status: Complete

Stage 6B has been fully implemented and verified. All tests pass across both packages.

### What Was Delivered

1. **Frontmatter schema changes** (`kanban-cli`):
   - Added `stage_statuses: Record<string, string>` to ticket frontmatter schema (Zod + parser)
   - Added `ticket_statuses: Record<string, string>` to epic frontmatter schema (Zod + parser)
   - Both fields default to `{}` and are optional for backward compatibility
   - Added corresponding fields to `Epic` and `Ticket` TypeScript types in `work-items.ts`

2. **Exit gate module** (`tools/orchestrator/src/exit-gates.ts`):
   - `createExitGateRunner()` factory function with full DI (`ExitGateDeps`)
   - After a session exits with a status change: reads stage frontmatter for ticket/epic IDs, updates ticket's `stage_statuses`, derives ticket status, updates epic's `ticket_statuses`, calls `kanban-cli sync` as a subprocess
   - `deriveTicketStatus()` function: "Complete" if all stages complete, "Not Started" if all not started, "In Progress" otherwise
   - Sync uses retry-once strategy; failures are logged but do not crash the orchestrator
   - `ExitGateResult` type provides structured reporting of each step

3. **Resolver execution module** (`tools/orchestrator/src/resolvers.ts`):
   - `createResolverRunner()` factory function with full DI (`ResolverRunnerDeps`)
   - Discovers all stage files, filters for resolver-state stages (session_active=false), executes matching resolver, writes new status, and propagates via exit gate runner
   - `ResolverResult` type tracks each resolver check outcome

4. **Updated resolver builtins** (`kanban-cli`):
   - `pr-status` resolver: simplified to merge-only check; returns "Done" if PR is merged, null otherwise. Comment detection deferred to Stage 6D.
   - `testing-router` resolver (new): routes based on `refinement_type` from stage frontmatter. If type includes "frontend" or "integration", routes to "Manual Testing"; otherwise routes to "Finalize".
   - Both resolvers registered via `registerBuiltinResolvers()` in `builtins/index.ts`

5. **Loop integration** (`tools/orchestrator/src/loop.ts`):
   - Exit gate runner called in `handleSessionExit` when status changes (between logging and cleanup)
   - Resolver runner called at top of each tick cycle, before discovery
   - "Not Started" onboarding: stages discovered with status "Not Started" are automatically transitioned to the pipeline's `entry_phase` before session spawning
   - Both runners are injectable via `OrchestratorDeps` for testing

6. **Integration tests**:
   - `tests/integration/exit-gate-flow.test.ts` — end-to-end exit gate propagation (ticket + epic updates, sync)
   - `tests/integration/resolver-flow.test.ts` — resolver discovery, execution, and propagation
   - `tests/integration/onboarding-flow.test.ts` — "Not Started" to entry phase onboarding
   - Unit tests in `tests/exit-gates.test.ts` and `tests/resolvers.test.ts`

7. **Seed script updates** (`tools/kanban-cli/scripts/seed-test-repo.sh`):
   - All ticket files now include `stage_statuses` mapping each stage ID to its status
   - All epic files now include `ticket_statuses` mapping each ticket ID to its derived status
   - TICKET-002-003 (no stages) has `stage_statuses: {}` for completeness

### Test Suite Results

- **kanban-cli**: 738 tests across 51 test files, all passing
- **orchestrator**: 245 tests across 17 test files, all passing

### Decisions That Changed from Original Plan

| Original Plan | Actual Implementation | Rationale |
|---------------|----------------------|-----------|
| Sync via direct import or subprocess (open question) | Subprocess (`npx kanban-cli sync --repo`) | Follows the discovery module's existing pattern; avoids coupling to kanban-cli internals (database, pipeline config) |
| `repoPath` on config vs method params (open question) | Method parameter on `run()` and `checkAll()` | Keeps runners stateless; allows the same runner to operate on different repos if needed |
| MCP tools for resolver PR checks (suggested in handoff) | Direct resolver function pattern in registry | Resolvers run in-process as TypeScript functions; MCP tools are for Claude sessions, not orchestrator internals |
| `testing-router` in pipeline config (mentioned in design doc) | Builtin resolver registered in code, not in default pipeline config | Can be added to pipeline config when a project needs it; not forced on all projects |

### Handoff Notes for Stage 6C

Stage 6C implements **completion cascade** and **backlog re-evaluation**:

1. **Completion cascade**: When a stage reaches "Done", check if all stages in the parent ticket are "Complete" -> if so, set ticket to "Complete". When a ticket becomes "Complete", check if all tickets in the parent epic are "Complete" -> if so, set epic to "Complete".

2. **Backlog re-evaluation**: When a stage reaches "Done", check if any dependent stages (stages with `depends_on` referencing this stage/ticket/epic) can now be unblocked. If all dependencies are satisfied, those stages become eligible for the next `kanban-cli next` discovery.

3. **Key infrastructure from 6B to extend**:
   - The `deriveTicketStatus()` function in `exit-gates.ts` already computes ticket status from stage statuses -- this is the starting point for cascade logic
   - The `stage_statuses` and `ticket_statuses` frontmatter fields are now available for cascade tracking
   - The exit gate runner's `run()` method is the natural place to trigger cascade after a status change
   - The `ExitGateResult` type may need extending to report cascade outcomes

4. **Architecture considerations**:
   - Cascade should be triggered from within the exit gate (after ticket/epic updates), not as a separate loop phase
   - Backlog re-evaluation likely needs to query the dependency graph (available via `kanban-cli graph` or direct database query)
   - Consider whether cascade should be recursive (epic completion triggers further cascades) or single-level
