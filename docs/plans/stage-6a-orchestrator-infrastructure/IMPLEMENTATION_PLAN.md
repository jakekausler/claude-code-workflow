# Stage 6A: Orchestrator Infrastructure — Implementation Plan

**Design Doc:** `docs/plans/2026-02-23-stage-6a-orchestrator-infrastructure-design.md`
**Branch:** kanban

---

## Dependency Graph

```
Task 1 (Scaffolding)
  ├── Task 2 (Config)
  │     ├── Task 3 (Logger)
  │     ├── Task 4 (Discovery)
  │     ├── Task 5 (Locking)
  │     └── Task 6 (Worktree)
  │           └── Task 7 (Session)
  │                 └── Task 8 (Loop)
  │                       └── Task 9 (Shutdown + Entry Point)
  │                             └── Task 10 (Integration Tests)
```

---

## Task 1: Project Scaffolding

**Goal:** Set up `tools/orchestrator/` package with TypeScript, Vitest, and kanban-cli dependency.

**Files to create:**
- `tools/orchestrator/package.json`
- `tools/orchestrator/tsconfig.json`
- `tools/orchestrator/vitest.config.ts`
- `tools/orchestrator/src/types.ts` (shared types)

**Details:**

`package.json`:
- name: `orchestrator`
- type: `module`
- dependencies: `kanban-cli` via `file:../kanban-cli`, `commander`
- devDependencies: `typescript`, `tsx`, `vitest`, `@types/node`
- scripts: `build`, `dev`, `test`, `lint`, `verify`

`tsconfig.json`:
- Match kanban-cli: target ES2022, module NodeNext, moduleResolution NodeNext
- rootDir: `src/`, outDir: `dist/`
- strict: true

`vitest.config.ts`:
- Match kanban-cli pattern: globals true, include `tests/**/*.test.ts`

`src/types.ts` — shared interfaces:
```typescript
export interface WorkerInfo {
  pid: number;
  stageId: string;
  stageFilePath: string;
  worktreePath: string;
  worktreeIndex: number;
  statusBefore: string;
  startTime: number;
}

export interface OrchestratorConfig {
  repoPath: string;
  once: boolean;
  idleSeconds: number;
  logDir: string;
  model: string;
  verbose: boolean;
  maxParallel: number;
  pipelineConfig: PipelineConfig;
  workflowEnv: Record<string, string>;
}
```

**Tests:** Verify `npm run lint` passes (TypeScript compiles). Verify `npm run test` runs (no tests yet, but vitest configured).

**Success criteria:** `cd tools/orchestrator && npm install && npm run lint` passes.

**Status:** Not Started

---

## Task 2: Config Module

**Goal:** Load orchestrator configuration from pipeline config, environment variables, and CLI flags.

**Files to create:**
- `tools/orchestrator/src/config.ts`
- `tools/orchestrator/tests/config.test.ts`

**Details:**

`config.ts` exports:
```typescript
export function loadOrchestratorConfig(cliOptions: CliOptions): Promise<OrchestratorConfig>;
```

**Behavior:**
1. Call `loadPipelineConfig(cliOptions.repo)` from kanban-cli
2. Extract `WORKFLOW_MAX_PARALLEL` from config defaults (default: 1)
3. Override with `WORKFLOW_MAX_PARALLEL` env var if set
4. Build `workflowEnv` map from all `WORKFLOW_*` env vars
5. Merge CLI flags: `--repo`, `--once`, `--idle-seconds`, `--log-dir`, `--model`, `--verbose`
6. Resolve `logDir` to absolute path, create directory if it doesn't exist
7. Return `OrchestratorConfig`

**Tests:**
- Default config values when no overrides
- Env var overrides pipeline config defaults
- CLI flags override env vars
- Log directory created if missing
- Resolves relative repo path to absolute

**Status:** Not Started

---

## Task 3: Logger Module

**Goal:** Structured logging for console and per-session log files.

**Files to create:**
- `tools/orchestrator/src/logger.ts`
- `tools/orchestrator/tests/logger.test.ts`

**Details:**

`logger.ts` exports:
```typescript
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  createSessionLogger(stageId: string, logDir: string): SessionLogger;
}

export interface SessionLogger {
  logFilePath: string;
  write(data: string): void;
  close(): void;
}

export function createLogger(verbose: boolean): Logger;
```

**Console format:** `[ISO-timestamp] [LEVEL] message { context }`
- debug messages only shown in verbose mode

**Session log files:**
- Path: `<logDir>/<stageId>-<ISO-date>T<time>.log`
- Writable stream opened on create, closed on `close()`

**Tests:**
- Console output format verification (capture stderr)
- Session logger creates file at correct path
- Session logger writes data
- Verbose mode enables debug messages
- Non-verbose mode suppresses debug

**Status:** Not Started

---

## Task 4: Discovery Module

**Goal:** Discover workable stages by calling `kanban-cli next` as a subprocess.

**Files to create:**
- `tools/orchestrator/src/discovery.ts`
- `tools/orchestrator/tests/discovery.test.ts`

**Details:**

`discovery.ts` exports:
```typescript
export interface DiscoveryResult {
  readyStages: ReadyStage[];
  blockedCount: number;
  inProgressCount: number;
  toConvertCount: number;
}

export interface ReadyStage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktreeBranch: string;
  priorityScore: number;
  priorityReason: string;
  needsHuman: boolean;
}

export interface Discovery {
  discover(repoPath: string, max: number): Promise<DiscoveryResult>;
}

export function createDiscovery(options?: { execFn?: ExecFn }): Discovery;
```

**Implementation:**
1. Build command: `npx tsx <resolved-kanban-cli-path>/src/cli/index.ts next --repo <repoPath> --max <max>`
2. Spawn as child process, capture stdout
3. Parse JSON output into `DiscoveryResult`
4. Filter out stages where `needsHuman === true`
5. Return result

**Injectable `execFn`** for testing — takes command + args, returns stdout string.

**Tests:**
- Parses valid kanban-cli next output
- Filters out needs_human stages
- Handles empty ready_stages (no work available)
- Handles exec errors (non-zero exit code)
- Passes correct --max and --repo arguments

**Status:** Not Started

---

## Task 5: Locking Module

**Goal:** Acquire and release `session_active` locks via stage frontmatter.

**Files to create:**
- `tools/orchestrator/src/locking.ts`
- `tools/orchestrator/tests/locking.test.ts`

**Details:**

`locking.ts` exports:
```typescript
export interface Locker {
  acquireLock(stageFilePath: string): Promise<void>;
  releaseLock(stageFilePath: string): Promise<void>;
  isLocked(stageFilePath: string): Promise<boolean>;
  readStatus(stageFilePath: string): Promise<string>;
}

export function createLocker(options?: {
  readFn?: (filePath: string) => Promise<{ data: Record<string, unknown>; content: string }>;
  writeFn?: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
}): Locker;
```

**acquireLock:**
1. Read frontmatter from stage file
2. If `session_active` already true → throw Error("Stage already locked")
3. Set `session_active: true` in frontmatter data
4. Write updated frontmatter back to file

**releaseLock:**
1. Read frontmatter
2. Set `session_active: false`
3. Write updated frontmatter

**isLocked:**
1. Read frontmatter
2. Return `session_active === true`

**readStatus:**
1. Read frontmatter
2. Return `status` field

Default read/write functions use kanban-cli's `readYamlFrontmatter()` / `writeYamlFrontmatter()` (or gray-matter directly if those functions aren't easily importable).

**Tests:**
- acquireLock sets session_active to true
- releaseLock sets session_active to false
- acquireLock on already-locked stage throws
- isLocked returns correct boolean
- readStatus returns status field
- Preserves all other frontmatter fields

**Status:** Not Started

---

## Task 6: Worktree Management Module

**Goal:** Create/remove git worktrees, assign WORKTREE_INDEX, validate isolation strategy.

**Files to create:**
- `tools/orchestrator/src/worktree.ts`
- `tools/orchestrator/tests/worktree.test.ts`

**Details:**

`worktree.ts` exports:
```typescript
export interface WorktreeInfo {
  path: string;
  branch: string;
  index: number;
}

export interface WorktreeManager {
  create(branch: string, repoPath: string): Promise<WorktreeInfo>;
  remove(worktreePath: string): Promise<void>;
  validateIsolationStrategy(repoPath: string): Promise<boolean>;
  listActive(): WorktreeInfo[];
  acquireIndex(): number;
  releaseIndex(index: number): void;
  releaseAll(): void;
}

export function createWorktreeManager(maxParallel: number, options?: {
  execFn?: (command: string, args: string[], cwd?: string) => Promise<string>;
  readFileFn?: (filePath: string) => Promise<string>;
}): WorktreeManager;
```

**Index pool:**
- `usedIndices: Set<number>`
- `acquireIndex()`: iterate 1..maxParallel, return first not in set, throw if full
- `releaseIndex(n)`: remove from set

**Worktree path:** `<repoPath>/.worktrees/worktree-<index>/`

**create(branch, repoPath):**
1. `acquireIndex()`
2. Compute path: `<repoPath>/.worktrees/worktree-<index>/`
3. Ensure `.worktrees/` directory exists
4. Check if branch already exists: `git branch --list <branch>`
   - Exists: `git worktree add <path> <branch>`
   - New: `git worktree add -b <branch> <path>`
5. Execute from `cwd: repoPath`
6. Return `WorktreeInfo`

**remove(worktreePath):**
1. Determine index from path
2. `git worktree remove <path> --force` (from main repo)
3. On failure: try `rm -rf <path>` then `git worktree prune`
4. `releaseIndex(index)`

**validateIsolationStrategy(repoPath):**
1. Read `<repoPath>/CLAUDE.md`
2. Search for heading matching `/##\s+Worktree Isolation Strategy/i`
3. Check for subsection content (at least 3 subsections present)
4. Return true if valid, false if not

**releaseAll():**
- Clear all indices (used during shutdown)

**Tests:**
- acquireIndex returns sequential indices starting at 1
- acquireIndex throws when pool exhausted
- releaseIndex makes index available again
- create runs correct git commands for new branch
- create runs correct git commands for existing branch
- remove runs git worktree remove
- remove fallback to rm -rf on failure
- validateIsolationStrategy returns true for valid CLAUDE.md
- validateIsolationStrategy returns false for missing section
- listActive returns tracked worktrees

**Status:** Not Started

---

## Task 7: Session Spawning Module

**Goal:** Assemble prompts and spawn Claude Code sessions as child processes.

**Files to create:**
- `tools/orchestrator/src/session.ts`
- `tools/orchestrator/tests/session.test.ts`

**Details:**

`session.ts` exports:
```typescript
export interface SpawnOptions {
  stageId: string;
  stageFilePath: string;
  skillName: string;
  worktreePath: string;
  worktreeIndex: number;
  model: string;
  workflowEnv: Record<string, string>;
  logFilePath: string;
}

export interface SessionResult {
  exitCode: number;
  durationMs: number;
}

export interface ActiveSession {
  pid: number;
  kill(signal?: string): void;
}

export interface SessionExecutor {
  spawn(options: SpawnOptions, logger: SessionLogger): Promise<SessionResult>;
  getActiveSession(): ActiveSession | null;
}

export function createSessionExecutor(options?: {
  spawnFn?: (command: string, args: string[], spawnOptions: SpawnOptions) => ChildProcess;
}): SessionExecutor;
```

**assemblePrompt(options: SpawnOptions): string**
```
You are working on stage <stageId>.

Stage file: <stageFilePath>
Worktree path: <worktreePath>
Worktree index: <worktreeIndex>

Invoke the `ticket-stage-workflow` skill to load shared context.
Then invoke the `<skillName>` skill to begin work on this stage.

Environment configuration:
- WORKFLOW_AUTO_DESIGN=<value>
- WORKFLOW_REMOTE_MODE=<value>
[... other WORKFLOW_* vars ...]
```

**spawn(options, logger):**
1. Assemble prompt string
2. Spawn `claude -p --model <model>` with:
   - `cwd: worktreePath`
   - `env: { ...process.env, WORKTREE_INDEX: String(index), ...workflowEnv }`
   - `stdio: ['pipe', 'pipe', 'pipe']`
3. Write prompt to child stdin, end stdin
4. Pipe child stdout/stderr to `logger.write()`
5. Return promise that resolves on `close` event with `SessionResult`

**Tests:**
- Prompt assembly includes all required fields
- spawn passes correct args to claude CLI
- spawn sets cwd to worktree path
- spawn sets WORKTREE_INDEX in env
- spawn pipes stdout/stderr to logger
- Resolves with exit code on completion
- Reports duration in milliseconds
- Injectable spawnFn is called with correct arguments

**Status:** Not Started

---

## Task 8: Main Loop

**Goal:** Orchestrate the tick cycle: discover → lock → worktree → spawn → monitor.

**Files to create:**
- `tools/orchestrator/src/loop.ts`
- `tools/orchestrator/tests/loop.test.ts`

**Details:**

`loop.ts` exports:
```typescript
export interface Orchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getActiveWorkers(): Map<number, WorkerInfo>;
}

export function createOrchestrator(config: OrchestratorConfig, deps: {
  discovery: Discovery;
  locker: Locker;
  worktreeManager: WorktreeManager;
  sessionExecutor: SessionExecutor;
  logger: Logger;
}): Orchestrator;
```

**start():**
1. Set `running = true`
2. Enter tick loop:
   a. If `!running` → break
   b. `availableSlots = config.maxParallel - activeWorkers.size`
   c. If `availableSlots <= 0` → wait for any worker to exit → continue
   d. `result = discovery.discover(config.repoPath, availableSlots)`
   e. For each stage in `result.readyStages`:
      - Look up `skillName` from `pipelineConfig` using stage status
      - Resolve `stageFilePath` from stage data
      - `statusBefore = locker.readStatus(stageFilePath)`
      - `locker.acquireLock(stageFilePath)`
      - If first time: `worktreeManager.validateIsolationStrategy(config.repoPath)` (cache result)
      - `worktreeInfo = worktreeManager.create(stage.worktreeBranch, config.repoPath)`
      - `sessionLogger = logger.createSessionLogger(stage.id, config.logDir)`
      - `sessionPromise = sessionExecutor.spawn({ ... }, sessionLogger)`
      - Track in `activeWorkers` map
      - `sessionPromise.then(result => handleSessionExit(...))`
   f. If no stages and no active workers:
      - If `config.once` → break (exit)
      - Else → sleep `config.idleSeconds` → continue
   g. If `config.once` and stages were spawned → wait for all workers → break

**handleSessionExit(stageId, workerInfo, result):**
1. `statusAfter = locker.readStatus(workerInfo.stageFilePath)`
2. If `workerInfo.statusBefore === statusAfter && result.exitCode !== 0`:
   → `logger.warn("Session crashed", { stageId, exitCode, statusBefore })`
3. `locker.releaseLock(workerInfo.stageFilePath)`
4. `worktreeManager.remove(workerInfo.worktreePath)`
5. Remove from `activeWorkers`
6. Close session logger
7. `logger.info("Session completed", { stageId, exitCode, duration, statusBefore, statusAfter })`
8. If `running` → trigger next tick

**stop():**
1. Set `running = false`
2. Resolve any pending sleep/wait

**Skill name lookup:**
- Read `pipelineConfig.workflow.phases` array
- Find phase where `phase.status === stage.status` (from `kanban-cli next` output, which returns current status)
- Return `phase.skill`
- If phase has `resolver` instead of `skill` → skip (resolvers are Stage 6B)

**Stage file path resolution:**
- The `kanban-cli next` output doesn't include `file_path` directly
- Derive from stage ID and repo path: `<repoPath>/epics/<epicId>/<ticketId>/<stageId>.md`
- Or run `kanban-cli sync` and query DB (heavier — avoid)
- Best approach: have discovery module also capture file_path if available, or compute from convention

**Tests:**
- Single tick discovers and spawns one session
- Respects maxParallel (doesn't over-spawn)
- Handles no stages available (idle → sleep)
- --once mode exits after single tick
- --once mode waits for active workers before exit
- Crash recovery: logs warning when status unchanged and exit code non-zero
- Always releases lock after session exit (normal or crash)
- Always removes worktree after session exit
- Skips resolver states (no skill field)
- Multiple workers can run concurrently

**Status:** Not Started

---

## Task 9: Shutdown + CLI Entry Point

**Goal:** Handle SIGINT/SIGTERM gracefully and wire up the CLI entry point.

**Files to create:**
- `tools/orchestrator/src/shutdown.ts`
- `tools/orchestrator/src/index.ts`
- `tools/orchestrator/tests/shutdown.test.ts`

**Details:**

**shutdown.ts:**
```typescript
export function setupShutdownHandlers(
  orchestrator: Orchestrator,
  worktreeManager: WorktreeManager,
  locker: Locker,
  activeWorkers: () => Map<number, WorkerInfo>,
  logger: Logger,
  options?: { drainTimeoutMs?: number }
): void;
```

**On SIGINT/SIGTERM:**
1. `logger.info("Received shutdown signal, draining...")`
2. `orchestrator.stop()` — stops accepting new work
3. Wait up to `drainTimeoutMs` (default: 60000) for active workers to complete
4. If workers still active after timeout:
   - Log warning
   - Kill child processes (SIGTERM)
5. For each tracked worker:
   - `locker.releaseLock(workerInfo.stageFilePath)`
   - `worktreeManager.remove(workerInfo.worktreePath)`
6. `worktreeManager.releaseAll()`
7. `process.exit(0)`

**index.ts (CLI entry point):**
```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command()
  .name('orchestrator')
  .description('Kanban workflow orchestrator — manages stage lifecycle and Claude sessions')
  .option('--repo <path>', 'Target repository', process.cwd())
  .option('--once', 'Run single tick then exit', false)
  .option('--idle-seconds <n>', 'Wait time when no stages available', '30')
  .option('--log-dir <path>', 'Session log directory')
  .option('--model <model>', 'Claude model for sessions', 'sonnet')
  .option('--verbose', 'Verbose output', false)
  .action(async (options) => {
    // 1. Load config
    // 2. Create all dependencies (discovery, locker, worktreeManager, sessionExecutor, logger)
    // 3. Create orchestrator
    // 4. Setup shutdown handlers
    // 5. Start orchestrator
  });

program.parse();
```

**Tests (shutdown.test.ts):**
- Calls orchestrator.stop() on signal
- Waits for active workers before exit
- Kills child processes after timeout
- Releases all locks on shutdown
- Removes all worktrees on shutdown

**Status:** Not Started

---

## Task 10: Integration Tests

**Goal:** End-to-end tests with mock session executor verifying the complete flow.

**Files to create:**
- `tools/orchestrator/tests/integration.test.ts`

**Details:**

**Test scenarios:**

1. **Happy path: single stage**
   - Mock discovery returns 1 ready stage
   - Mock session executor completes with exit code 0 and status change
   - Verify: lock acquired → worktree created → session spawned → lock released → worktree removed

2. **No stages available → idle**
   - Mock discovery returns empty
   - Verify: sleep called, no spawn

3. **--once mode**
   - Mock discovery returns 1 stage
   - Verify: processes stage, then exits (doesn't loop)

4. **Crash recovery**
   - Mock session executor exits with code 1, status unchanged
   - Verify: lock released, worktree removed, crash logged

5. **Max parallel respected**
   - config.maxParallel = 2
   - Mock discovery returns 3 stages
   - Verify: only 2 spawned, 3rd waits

6. **Isolation strategy validation fails**
   - Mock CLAUDE.md has no isolation section
   - Verify: stage skipped, lock released, log warning

7. **needs_human stages filtered**
   - Mock discovery returns stages with needs_human=true
   - Verify: those stages are not processed

**Test infrastructure:**
- All dependencies are mocked (discovery, locker, worktreeManager, sessionExecutor, logger)
- Use vitest fake timers for idle sleep testing
- Verify correct call sequences across modules

**Status:** Not Started

---

## Verification

After all tasks complete:

1. `cd tools/orchestrator && npm run verify` — passes (lint + tests)
2. `cd tools/kanban-cli && npm run verify` — still passes (729 existing tests)
3. No changes to existing kanban-cli source files
4. All new code follows existing patterns (injectable dependencies, factory functions)
