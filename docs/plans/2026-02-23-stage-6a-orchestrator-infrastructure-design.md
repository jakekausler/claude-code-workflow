# Stage 6A: Orchestrator Infrastructure & Session Management — Design Document

**Date:** 2026-02-23
**Status:** Approved
**Branch:** kanban

---

## 1. Goal

Build the foundational orchestrator infrastructure: stage discovery, session spawning, worktree isolation, locking, crash recovery, and graceful shutdown. This is the plumbing that all subsequent Stage 6 substages (6B–6E) build on.

Stage 6A is **infrastructure only** — no exit gate logic, no completion cascade, no resolvers, no crons.

## 2. Architecture Overview

### Event-Driven Worker Pool

The orchestrator is a long-running TypeScript process that maintains a worker pool of size `WORKFLOW_MAX_PARALLEL`. Each tick:

1. **Discover** — call `kanban-cli next --max N` (N = available worker slots)
2. **Filter** — skip `needs_human: true` stages
3. **Lock** — set `session_active: true` in stage frontmatter
4. **Worktree** — create isolated git worktree, assign `WORKTREE_INDEX`
5. **Spawn** — launch Claude Code session as child process
6. **Monitor** — on child exit: crash recovery check → reset lock → cleanup worktree
7. **Idle** — if no work available, wait N seconds → re-discover

### Three-System Architecture (Future Context)

The full Stage 6 orchestrator has three concurrent systems. Stage 6A builds the infrastructure layer shared by all three:

```
Stage 6A (Infrastructure & Sessions)       ← THIS STAGE
  ├── Stage 6B (Exit Gates & Resolvers)
  │     └── Stage 6C (Completion Cascade & Backlog)
  │           └── Stage 6D (MR Comment Cron)
  └── Stage 6E (Insights Cron)
```

Stage 6A implements only System 1 (main work loop) at the infrastructure level. Systems 2 and 3 (crons) come in 6D and 6E.

## 3. Resolved Design Decisions

| Question | Resolution | Rationale |
|----------|-----------|-----------|
| Claude CLI invocation | `claude -p` via async `spawn`, prompt on stdin | Already proven in `claude-executor.ts`. Async spawn needed for parallelism. |
| Package location | `tools/orchestrator/` separate package, imports kanban-cli as local dep | Different runtime model (long-running vs one-shot). Clean separation. |
| session_active read/write | Direct frontmatter read/write using existing `readYamlFrontmatter()`/`writeYamlFrontmatter()` | No new CLI command needed. Simple and direct. |
| locked_at / locked_by | DB-only fields (no frontmatter changes) | Simpler. Crash diagnostics via logs instead. |
| Run mode | Both continuous (default) and `--once` (single tick) | `--once` essential for testing and cron-based deployments. |
| Crash recovery | Exit code + status check (no heartbeats, no timeouts) | Simple and reliable. Read frontmatter after exit, compare status before/after. |
| Session prompt | Instruct Claude to invoke skills (not embed skill contents) | Simpler. Leverages Claude Code's native skill system. |
| Session logging | Per-session log files + real-time console streaming | Debuggable. Log files in configurable directory. |
| Worktree ownership | Orchestrator creates worktrees (not skills) | Skills receive worktree path. `phase-build` worktree creation to be removed (noted for handoff). |

## 4. Package Structure

```
tools/orchestrator/
├── package.json              # Deps: kanban-cli (file:../kanban-cli), commander
├── tsconfig.json             # ES2022, NodeNext (matches kanban-cli)
├── vitest.config.ts
├── src/
│   ├── index.ts              # CLI entry point (commander)
│   ├── config.ts             # Pipeline config + env vars + CLI flags
│   ├── discovery.ts          # Stage discovery (wraps kanban-cli next)
│   ├── locking.ts            # session_active frontmatter read/write
│   ├── worktree.ts           # git worktree lifecycle + isolation validation
│   ├── session.ts            # Prompt assembly + child process spawn
│   ├── loop.ts               # Tick cycle, worker pool, idle behavior
│   ├── shutdown.ts           # Signal handling, drain, cleanup
│   ├── logger.ts             # Structured console + file logging
│   └── types.ts              # Shared types
└── tests/
    ├── config.test.ts
    ├── discovery.test.ts
    ├── locking.test.ts
    ├── worktree.test.ts
    ├── session.test.ts
    ├── loop.test.ts
    ├── shutdown.test.ts
    └── integration.test.ts
```

### CLI Interface

```
orchestrator [options]

Options:
  --repo <path>          Target repository (default: cwd)
  --once                 Run single tick then exit
  --idle-seconds <n>     Wait time when no stages available (default: 30)
  --log-dir <path>       Session log directory (default: <repo>/.kanban-logs/)
  --model <model>        Claude model for sessions (default: sonnet)
  --verbose              Verbose output
  --help                 Show help
```

### kanban-cli Dependency

The orchestrator imports kanban-cli as a local file dependency:

```json
{
  "dependencies": {
    "kanban-cli": "file:../kanban-cli"
  }
}
```

**Imported modules:**
- `loadPipelineConfig()` from config/loader
- `readYamlFrontmatter()`, `writeYamlFrontmatter()` from parser/frontmatter (or utils/yaml)
- Pipeline types (`PipelineConfig`, `PipelineState`, `WorkflowDefaults`)
- Stage types (`Stage`)
- Frontmatter schema types

**NOT imported:** CLI command handlers, database layer, sync engine.

## 5. Module Designs

### 5.1 Config (`config.ts`)

Loads and merges configuration from three sources:

1. **Pipeline config** — `loadPipelineConfig(repoPath)` from kanban-cli
2. **Environment variables** — `WORKFLOW_MAX_PARALLEL`, `WORKFLOW_AUTO_DESIGN`, `WORKFLOW_REMOTE_MODE`, etc.
3. **CLI flags** — `--repo`, `--once`, `--idle-seconds`, `--log-dir`, `--model`, `--verbose`

Env vars override pipeline config defaults. CLI flags override everything.

```typescript
interface OrchestratorConfig {
  repoPath: string;
  once: boolean;
  idleSeconds: number;
  logDir: string;
  model: string;
  verbose: boolean;
  maxParallel: number;
  pipelineConfig: PipelineConfig;
  workflowEnv: Record<string, string>;  // WORKFLOW_* env vars to pass to sessions
}
```

### 5.2 Discovery (`discovery.ts`)

Wraps `kanban-cli next` as a subprocess call:

```typescript
interface DiscoveryResult {
  readyStages: ReadyStage[];
  blockedCount: number;
  inProgressCount: number;
}

interface ReadyStage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktreeBranch: string;
  priorityScore: number;
  priorityReason: string;
  needsHuman: boolean;
  filePath: string;   // Resolved from stage ID
}

function createDiscovery(options?: { execFn?: ExecFn }): {
  discover(repoPath: string, max: number): Promise<DiscoveryResult>;
}
```

**Implementation:**
- Spawns `npx tsx <kanban-cli-path>/src/cli/index.ts next --repo <path> --max <N>`
- Parses JSON stdout
- Filters out `needs_human: true` stages
- Returns structured result

**Injectable** for testing (mock exec returns predefined JSON).

### 5.3 Locking (`locking.ts`)

Reads and writes `session_active` in stage frontmatter:

```typescript
interface Locker {
  acquireLock(stageFilePath: string): Promise<void>;
  releaseLock(stageFilePath: string): Promise<void>;
  isLocked(stageFilePath: string): Promise<boolean>;
  readStatus(stageFilePath: string): Promise<string>;
}

function createLocker(options?: { readFn?: ReadFn; writeFn?: WriteFn }): Locker;
```

**acquireLock:**
1. Read frontmatter
2. If `session_active` already true → throw (double-lock prevention)
3. Set `session_active: true`
4. Write frontmatter

**releaseLock:**
1. Read frontmatter
2. Set `session_active: false`
3. Write frontmatter

**readStatus:**
1. Read frontmatter
2. Return `status` field value

Injectable read/write functions for testing.

### 5.4 Worktree Management (`worktree.ts`)

```typescript
interface WorktreeManager {
  create(branch: string, repoPath: string): Promise<WorktreeInfo>;
  remove(worktreePath: string): Promise<void>;
  validateIsolationStrategy(repoPath: string): Promise<boolean>;
  listActive(): WorktreeInfo[];
  acquireIndex(): number;
  releaseIndex(index: number): void;
}

interface WorktreeInfo {
  path: string;
  branch: string;
  index: number;
}

function createWorktreeManager(maxParallel: number, options?: { execFn?: ExecFn }): WorktreeManager;
```

**Index assignment:**
- Maintain `Set<number>` of in-use indices
- `acquireIndex()` returns lowest available from 1 to maxParallel
- `releaseIndex()` returns index to pool

**Worktree path:** `<repoPath>/.worktrees/worktree-<index>/`

**create():**
1. `acquireIndex()`
2. Check branch doesn't already exist as worktree (`git worktree list --porcelain`)
3. `git worktree add <path> <branch>` (if branch exists) or `git worktree add -b <branch> <path>` (if new)
4. Return `WorktreeInfo`

**remove():**
1. `git worktree remove <path> --force`
2. `releaseIndex()`
3. On failure: log warning, try `rm -rf` as fallback

**validateIsolationStrategy():**
1. Read `<repoPath>/CLAUDE.md`
2. Search for `## Worktree Isolation Strategy` heading
3. Verify subsections exist for: ports/services, database, environment, verification
4. Return true/false

Injectable exec function for testing.

### 5.5 Session Spawning (`session.ts`)

```typescript
interface SessionExecutor {
  spawn(options: SpawnOptions): Promise<SessionResult>;
}

interface SpawnOptions {
  stageId: string;
  stageFilePath: string;
  skillName: string;
  worktreePath: string;
  worktreeIndex: number;
  model: string;
  workflowEnv: Record<string, string>;
  logFilePath: string;
}

interface SessionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function createSessionExecutor(options?: { spawnFn?: SpawnFn }): SessionExecutor;
```

**Prompt assembly:**

```
You are working on stage <stageId>.

Stage file: <absolute-path-to-stage-file>
Worktree path: <absolute-worktree-path>
Worktree index: <N>

Invoke the `ticket-stage-workflow` skill to load shared context.
Then invoke the `<skill-name>` skill to begin work.

Environment:
- WORKFLOW_AUTO_DESIGN=<value>
- WORKFLOW_REMOTE_MODE=<value>
- WORKFLOW_GIT_PLATFORM=<value>
```

**Child process:**
```typescript
const child = spawn('claude', ['-p', '--model', model], {
  cwd: worktreePath,
  env: { ...process.env, WORKTREE_INDEX: String(index), ...workflowEnv },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

**Output handling:**
- stdout and stderr piped to log file (via `fs.createWriteStream`)
- Optionally tee'd to console with `[STAGE-XXX]` prefix (verbose mode)
- Accumulated in memory for `SessionResult`

Injectable spawn function for testing.

### 5.6 Main Loop (`loop.ts`)

```typescript
interface Orchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function createOrchestrator(config: OrchestratorConfig, deps: {
  discovery: Discovery;
  locker: Locker;
  worktreeManager: WorktreeManager;
  sessionExecutor: SessionExecutor;
  logger: Logger;
}): Orchestrator;
```

**Tick cycle:**

```
1. If shutting_down → return
2. availableSlots = maxParallel - activeWorkers.size
3. If availableSlots <= 0 → wait for a worker exit event → TICK
4. result = discovery.discover(repoPath, availableSlots)
5. For each stage in result.readyStages:
   a. Resolve stage file path (from stage ID + repo structure)
   b. Look up skill name from pipeline config (status → phase → skill)
   c. locker.acquireLock(stageFilePath)
   d. worktreeManager.validateIsolationStrategy(repoPath) [first time only, cache result]
   e. worktreeInfo = worktreeManager.create(worktreeBranch, repoPath)
   f. logFilePath = <logDir>/<stageId>-<timestamp>.log
   g. sessionPromise = sessionExecutor.spawn({ ... })
   h. Track worker in activeWorkers map
   i. sessionPromise.then(result => handleSessionExit(stageId, result))
6. If no stages found and activeWorkers.size === 0:
   a. If --once → exit(0)
   b. Else → sleep(idleSeconds) → TICK
7. If --once and stages were spawned → wait for all workers → exit
```

**handleSessionExit(stageId, result):**
```
1. statusBefore = recorded status from before spawn
2. statusAfter = locker.readStatus(stageFilePath)
3. If statusBefore === statusAfter && result.exitCode !== 0:
   → Log crash: "Session for <stageId> exited with code <N> without updating status"
4. locker.releaseLock(stageFilePath)
5. worktreeManager.remove(worktreePath)
6. Remove from activeWorkers
7. Log completion summary
8. Trigger next tick
```

### 5.7 Graceful Shutdown (`shutdown.ts`)

```typescript
function setupShutdownHandlers(orchestrator: Orchestrator, worktreeManager: WorktreeManager): void;
```

**On SIGINT/SIGTERM:**
1. Log "Shutting down..."
2. Call `orchestrator.stop()` — sets `shutting_down = true`, stops new work
3. Wait for active workers to complete (hard timeout: 60 seconds)
4. If workers still running after timeout: send SIGTERM to child processes
5. Cleanup all worktrees via `worktreeManager`
6. Release all locks (set `session_active: false` for all tracked stages)
7. Exit 0

### 5.8 Logger (`logger.ts`)

```typescript
interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  createSessionLogger(stageId: string, logDir: string): SessionLogger;
}

interface SessionLogger {
  logFilePath: string;
  stream: WritableStream;
  close(): void;
}

function createLogger(verbose: boolean): Logger;
```

Console output format: `[2026-02-23T10:30:00Z] [INFO] message { context }`
Session log files: `<logDir>/<stageId>-<ISO-timestamp>.log`

## 6. Testing Strategy

All modules use dependency injection for testability. No real Claude sessions or git operations in unit tests.

| Module | Test Approach |
|--------|--------------|
| config | Mock `loadPipelineConfig`, verify merging logic |
| discovery | Mock exec function, verify JSON parsing and filtering |
| locking | Mock read/write functions, verify lock/unlock/double-lock |
| worktree | Mock exec function, verify git commands, index assignment |
| session | Mock spawn function, verify prompt assembly, exit handling |
| loop | Mock all dependencies, verify tick cycle, idle behavior, --once mode |
| shutdown | Mock orchestrator + worktree manager, verify signal handling |
| integration | End-to-end with mock session executor, verify full flow |

## 7. What Is NOT In Scope

- ❌ Exit gate logic (verifying status, updating ticket/epic, syncing SQLite) → Stage 6B
- ❌ Resolver execution (pr-status, testing-router) → Stage 6B
- ❌ Completion cascade (stage → ticket → epic propagation) → Stage 6C
- ❌ Backlog re-evaluation (unblocking dependent stages) → Stage 6C
- ❌ MR comment cron loop → Stage 6D
- ❌ Insights threshold cron loop → Stage 6E
- ❌ Any changes to existing phase skills (phase-build worktree removal is a handoff note)
- ❌ SQLite writes (the orchestrator reads frontmatter and calls `kanban-cli next`, never writes to SQLite directly)

## 8. Handoff Notes for Stage 6B

- The `handleSessionExit` function in `loop.ts` is the extension point for exit gates. 6B adds: verify status change, update ticket file, update epic file, call `kanban-cli sync`.
- The `loop.ts` tick cycle is the extension point for resolver execution. 6B adds: before spawning sessions, check for stages in resolver states and call resolver functions.
- The `phase-build` skill currently creates its own worktrees. This should be removed since the orchestrator now handles worktree creation. All phase skills should be updated to know they're already running inside a worktree.

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| kanban-cli local dependency breaks on version mismatch | Pin to same branch. Run kanban-cli tests as part of orchestrator verify. |
| Worktree cleanup fails (dirty state) | Force cleanup with `rm -rf` fallback. Log for manual inspection. |
| Claude session hangs indefinitely | Not addressed in 6A (no timeout). 6B can add session timeouts. |
| Race condition: two ticks discover same stage | Prevented by locking: first tick sets `session_active=true`, second tick's `kanban-cli next` filters it out. |
| Worktree isolation strategy missing from CLAUDE.md | Validation check prevents worktree creation. Stage skipped with log warning. |
