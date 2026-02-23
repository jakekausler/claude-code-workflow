/**
 * Integration tests for the orchestrator.
 *
 * These tests wire together the REAL orchestrator modules (config, discovery,
 * locking, worktree, loop, shutdown) but with MOCK subprocess execution (no
 * real Claude sessions or git worktrees). The goal is to verify the end-to-end
 * flow from discovery through session completion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from 'kanban-cli';

import { createDiscovery, type ExecFn } from '../src/discovery.js';
import { createLocker, type FrontmatterData } from '../src/locking.js';
import { createWorktreeManager } from '../src/worktree.js';
import { createSessionExecutor, type ChildProcessLike, type SpawnProcessOptions } from '../src/session.js';
import { createLogger, type LoggerDeps } from '../src/logger.js';
import { createOrchestrator } from '../src/loop.js';
import type { OrchestratorConfig } from '../src/types.js';

// ---------- Pipeline config for tests ----------

const PIPELINE_CONFIG: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', status: 'Design', skill: 'phase-design', transitions_to: ['Build'] },
      { name: 'Build', status: 'Build', skill: 'phase-build', transitions_to: ['PR Created'] },
      { name: 'PR Created', status: 'PR Created', resolver: 'pr-status', transitions_to: ['Done'] },
    ],
    defaults: { WORKFLOW_MAX_PARALLEL: 2 },
  },
};

// ---------- Mock child process ----------

type CloseListener = (code: number | null) => void;
type ErrorListener = (err: Error) => void;
type DataListener = (chunk: Buffer) => void;

interface MockChild {
  child: ChildProcessLike;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
}

let nextPid = 10000;

function makeMockChild(): MockChild {
  const pid = nextPid++;
  const closeListeners: CloseListener[] = [];
  const errorListeners: ErrorListener[] = [];

  const child: ChildProcessLike = {
    pid,
    stdin: { write: vi.fn(() => true), end: vi.fn() },
    stdout: { on(_event: 'data', _listener: DataListener) {} },
    stderr: { on(_event: 'data', _listener: DataListener) {} },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'close') closeListeners.push(listener as CloseListener);
      if (event === 'error') errorListeners.push(listener as ErrorListener);
    },
    kill: vi.fn(() => true),
  };

  return {
    child,
    emitClose: (code) => closeListeners.forEach((l) => l(code)),
    emitError: (err) => errorListeners.forEach((l) => l(err)),
  };
}

// ---------- Staged discovery output ----------

function makeDiscoveryJson(stages: Array<{
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktree_branch: string;
  needs_human?: boolean;
}>): string {
  return JSON.stringify({
    ready_stages: stages.map((s) => ({
      id: s.id,
      ticket: s.ticket,
      epic: s.epic,
      title: s.title,
      worktree_branch: s.worktree_branch,
      refinement_type: [],
      priority_score: 500,
      priority_reason: 'normal',
      needs_human: s.needs_human ?? false,
    })),
    blocked_count: 0,
    in_progress_count: 0,
    to_convert_count: 0,
  });
}

// ---------- Frontmatter store ----------

/**
 * In-memory frontmatter store keyed by file path.
 * Simulates stage file I/O so the real locker module works correctly.
 */
function createFrontmatterStore(initial: Record<string, { status: string; session_active?: boolean }> = {}) {
  const store = new Map<string, { data: Record<string, unknown>; content: string }>();

  for (const [path, { status, session_active }] of Object.entries(initial)) {
    store.set(path, {
      data: { status, session_active: session_active ?? false },
      content: '',
    });
  }

  const readFrontmatter = vi.fn(async (filePath: string): Promise<FrontmatterData> => {
    const entry = store.get(filePath);
    if (!entry) {
      return { data: { status: 'Design', session_active: false }, content: '' };
    }
    // Return a copy so mutations go through writeFrontmatter
    return { data: { ...entry.data }, content: entry.content };
  });

  const writeFrontmatter = vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
    store.set(filePath, { data: { ...data }, content });
  });

  return {
    readFrontmatter,
    writeFrontmatter,
    /** Update the status directly (simulate an external status change during a session). */
    setStatus(filePath: string, status: string) {
      const entry = store.get(filePath);
      if (entry) {
        entry.data.status = status;
      }
    },
    /** Read the current state (for assertions). */
    getEntry(filePath: string) {
      return store.get(filePath);
    },
    store,
  };
}

// ---------- CLAUDE.md content ----------

const VALID_CLAUDE_MD = `# Project CLAUDE.md

## Worktree Isolation Strategy

### File paths
All paths are relative to the worktree root.

### Environment variables
Set WORKTREE_INDEX to the worktree slot number.

### Branch naming
Follow the convention epic/ticket/stage.
`;

const INVALID_CLAUDE_MD = `# Project CLAUDE.md

## Some Other Section

No isolation strategy here.
`;

// ---------- Config helper ----------

function makeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    repoPath: '/repo',
    once: true,
    idleSeconds: 1,
    logDir: '/logs',
    model: 'opus',
    verbose: false,
    maxParallel: 2,
    pipelineConfig: PIPELINE_CONFIG,
    workflowEnv: { WORKFLOW_AUTO_DESIGN: 'true' },
    mockMode: 'none',
    mockServices: [],
    ...overrides,
  };
}

// ---------- Integration tests ----------

describe('integration', () => {
  let mockChildren: MockChild[];
  let spawnIndex: number;
  let stderrOutput: string[];
  let logStreams: Array<{ data: string[]; closed: boolean }>;

  beforeEach(() => {
    nextPid = 10000;
    mockChildren = [];
    spawnIndex = 0;
    stderrOutput = [];
    logStreams = [];
  });

  /**
   * Build a mock spawnProcess that creates controllable mock children.
   * Pre-populate mockChildren before calling start() so you can resolve them.
   */
  function mockSpawnProcess(_command: string, _args: string[], _options: SpawnProcessOptions): ChildProcessLike {
    const mc = mockChildren[spawnIndex];
    if (!mc) {
      throw new Error(`No mock child prepared for spawn index ${spawnIndex}`);
    }
    spawnIndex++;
    return mc.child;
  }

  /**
   * Build mock git exec that handles worktree commands.
   */
  function makeMockExecGit() {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const fn = vi.fn(async (args: string[], cwd?: string): Promise<string> => {
      calls.push({ args, cwd });
      // `git branch --list <branch>` — simulate branch exists
      if (args[0] === 'branch' && args[1] === '--list') {
        return `  ${args[2]}\n`;
      }
      // `git worktree add` — success
      if (args[0] === 'worktree' && args[1] === 'add') {
        return '';
      }
      // `git worktree remove` — success
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return '';
      }
      // `git worktree prune` — success
      if (args[0] === 'worktree' && args[1] === 'prune') {
        return '';
      }
      return '';
    });
    return { fn, calls };
  }

  /** Build mock logger deps (suppress stderr, capture log streams). */
  function makeMockLoggerDeps(): LoggerDeps {
    return {
      writeStderr: (data: string) => stderrOutput.push(data),
      now: () => new Date('2026-02-23T12:00:00.000Z'),
      createWriteStream: (_filePath: string) => {
        const stream = { data: [] as string[], closed: false };
        logStreams.push(stream);
        // Return a minimal WriteStream-like object
        return {
          write: (chunk: string) => { stream.data.push(chunk); return true; },
          end: (cb?: () => void) => { stream.closed = true; if (cb) cb(); },
          on: () => {},
        } as unknown as import('node:fs').WriteStream;
      },
    };
  }

  /**
   * Wire all real modules together with mock I/O.
   */
  function wireUp(opts: {
    discoveryJson: string;
    frontmatterStore: ReturnType<typeof createFrontmatterStore>;
    claudeMdContent?: string;
    maxParallel?: number;
    config?: Partial<OrchestratorConfig>;
  }) {
    const { discoveryJson, frontmatterStore, claudeMdContent = VALID_CLAUDE_MD } = opts;
    const maxParallel = opts.maxParallel ?? 2;

    // Discovery: mock execFn returns staged JSON
    const mockExecFn: ExecFn = vi.fn(async () => discoveryJson);
    const discovery = createDiscovery({ execFn: mockExecFn, cliPath: '/fake/cli.ts' });

    // Locker: real logic, mock frontmatter I/O
    const locker = createLocker({
      readFrontmatter: frontmatterStore.readFrontmatter,
      writeFrontmatter: frontmatterStore.writeFrontmatter,
    });

    // Worktree manager: real logic, mock git/fs
    const execGit = makeMockExecGit();
    const mockReadFile = vi.fn(async (_filePath: string) => claudeMdContent);
    const mockMkdir = vi.fn(async () => {});
    const mockRmrf = vi.fn(async () => {});
    const worktreeManager = createWorktreeManager(maxParallel, {
      execGit: execGit.fn,
      readFile: mockReadFile,
      mkdir: mockMkdir,
      rmrf: mockRmrf,
    });

    // Session executor: real logic, mock child process
    const sessionExecutor = createSessionExecutor({
      spawnProcess: mockSpawnProcess,
      now: () => Date.now(),
    });

    // Logger: real logic, mock stderr + file streams
    const logger = createLogger(false, makeMockLoggerDeps());

    const config = makeConfig({
      maxParallel,
      ...opts.config,
    });

    const orchestrator = createOrchestrator(config, {
      discovery,
      locker,
      worktreeManager,
      sessionExecutor,
      logger,
    });

    return {
      orchestrator,
      discovery,
      locker,
      worktreeManager,
      sessionExecutor,
      logger,
      config,
      mockExecFn,
      execGit,
      mockReadFile,
      mockMkdir,
      mockRmrf,
      frontmatterStore,
    };
  }

  // -------- Test 1: Happy path: single stage, --once mode --------

  it('happy path: single stage discovery → session → cleanup', async () => {
    const stageFile = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md';
    const fmStore = createFrontmatterStore({
      [stageFile]: { status: 'Design' },
    });

    const mc = makeMockChild();
    mockChildren.push(mc);

    const { orchestrator, execGit, frontmatterStore } = wireUp({
      discoveryJson: makeDiscoveryJson([{
        id: 'STAGE-001-001-001',
        ticket: 'TICKET-001-001',
        epic: 'EPIC-001',
        title: 'Design the widget',
        worktree_branch: 'epic-001/ticket-001/stage-001',
      }]),
      frontmatterStore: fmStore,
    });

    const startPromise = orchestrator.start();

    // Wait for session to be spawned (stdin write is the indicator)
    await vi.waitFor(() => {
      expect((mc.child.stdin.write as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    // Verify lock was acquired
    const entryDuringSession = frontmatterStore.getEntry(stageFile);
    expect(entryDuringSession?.data.session_active).toBe(true);

    // Simulate session completing with a status change
    frontmatterStore.setStatus(stageFile, 'Build');
    mc.emitClose(0);

    await startPromise;

    // Verify: lock released
    const entryAfter = frontmatterStore.getEntry(stageFile);
    expect(entryAfter?.data.session_active).toBe(false);

    // Verify: worktree created and removed
    const addCalls = execGit.calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'add');
    expect(addCalls.length).toBe(1);
    const removeCalls = execGit.calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    expect(removeCalls.length).toBe(1);

    // Verify: start() resolved (orchestrator loop exited in --once mode)
    // Note: isRunning() remains true because start() does not set running=false on exit.
    // Only stop() clears the running flag. This matches the loop.test.ts patterns.
  });

  // -------- Test 2: No stages available → idle → exit (--once) --------

  it('no stages available: exits immediately in --once mode', async () => {
    const fmStore = createFrontmatterStore();

    const { orchestrator, execGit } = wireUp({
      discoveryJson: makeDiscoveryJson([]),
      frontmatterStore: fmStore,
    });

    await orchestrator.start();

    // Verify: no spawn, no lock, no worktree
    expect(spawnIndex).toBe(0);
    expect(execGit.calls.filter((c) => c.args[0] === 'worktree').length).toBe(0);
    expect(fmStore.writeFrontmatter).not.toHaveBeenCalled();
  });

  // -------- Test 3: Crash recovery --------

  it('crash recovery: non-zero exit with unchanged status releases lock and cleans up', async () => {
    const stageFile = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md';
    const fmStore = createFrontmatterStore({
      [stageFile]: { status: 'Design' },
    });

    const mc = makeMockChild();
    mockChildren.push(mc);

    const { orchestrator, frontmatterStore, execGit } = wireUp({
      discoveryJson: makeDiscoveryJson([{
        id: 'STAGE-001-001-001',
        ticket: 'TICKET-001-001',
        epic: 'EPIC-001',
        title: 'Design the widget',
        worktree_branch: 'epic-001/ticket-001/stage-001',
      }]),
      frontmatterStore: fmStore,
    });

    const startPromise = orchestrator.start();

    await vi.waitFor(() => {
      expect((mc.child.stdin.write as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    // Status stays unchanged (no transition happened) and session crashes
    mc.emitClose(1);

    await startPromise;

    // Verify: lock released
    const entryAfter = frontmatterStore.getEntry(stageFile);
    expect(entryAfter?.data.session_active).toBe(false);

    // Verify: worktree removed during cleanup
    const removeCalls = execGit.calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    expect(removeCalls.length).toBe(1);

    // Verify: crash logged (check stderr output)
    const crashLog = stderrOutput.find((line) => line.includes('Session crashed'));
    expect(crashLog).toBeDefined();
  });

  // -------- Test 4: Max parallel respected --------

  it('max parallel: only 2 sessions spawned when 3 stages available', async () => {
    const stageFile1 = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md';
    const stageFile2 = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md';
    const stageFile3 = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md';

    const fmStore = createFrontmatterStore({
      [stageFile1]: { status: 'Design' },
      [stageFile2]: { status: 'Design' },
      [stageFile3]: { status: 'Design' },
    });

    const mc1 = makeMockChild();
    const mc2 = makeMockChild();
    mockChildren.push(mc1, mc2);

    const { orchestrator, frontmatterStore } = wireUp({
      discoveryJson: makeDiscoveryJson([
        { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', title: 'Stage 1', worktree_branch: 'branch-1' },
        { id: 'STAGE-001-001-002', ticket: 'TICKET-001-001', epic: 'EPIC-001', title: 'Stage 2', worktree_branch: 'branch-2' },
        { id: 'STAGE-001-001-003', ticket: 'TICKET-001-001', epic: 'EPIC-001', title: 'Stage 3', worktree_branch: 'branch-3' },
      ]),
      frontmatterStore: fmStore,
      maxParallel: 2,
    });

    const startPromise = orchestrator.start();

    // Wait for both sessions to spawn
    await vi.waitFor(() => {
      expect(spawnIndex).toBe(2);
    });

    // Only 2 children were spawned (not 3)
    expect(spawnIndex).toBe(2);

    // Simulate both completing
    frontmatterStore.setStatus(stageFile1, 'Build');
    frontmatterStore.setStatus(stageFile2, 'Build');
    mc1.emitClose(0);
    mc2.emitClose(0);

    await startPromise;

    // Both locks released
    const entry1 = frontmatterStore.getEntry(stageFile1);
    const entry2 = frontmatterStore.getEntry(stageFile2);
    expect(entry1?.data.session_active).toBe(false);
    expect(entry2?.data.session_active).toBe(false);

    // Stage 3 was not processed (max parallel = 2)
    const entry3 = frontmatterStore.getEntry(stageFile3);
    expect(entry3?.data.session_active).toBe(false);
  });

  // -------- Test 5: Isolation strategy validation fails --------

  it('isolation strategy validation fails: stage skipped, lock released', async () => {
    const stageFile = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md';
    const fmStore = createFrontmatterStore({
      [stageFile]: { status: 'Design' },
    });

    const { orchestrator, frontmatterStore, execGit } = wireUp({
      discoveryJson: makeDiscoveryJson([{
        id: 'STAGE-001-001-001',
        ticket: 'TICKET-001-001',
        epic: 'EPIC-001',
        title: 'Design the widget',
        worktree_branch: 'epic-001/ticket-001/stage-001',
      }]),
      frontmatterStore: fmStore,
      claudeMdContent: INVALID_CLAUDE_MD,
    });

    await orchestrator.start();

    // Verify: no session spawned
    expect(spawnIndex).toBe(0);

    // Verify: lock released
    const entryAfter = frontmatterStore.getEntry(stageFile);
    expect(entryAfter?.data.session_active).toBe(false);

    // Verify: no worktree created
    const addCalls = execGit.calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'add');
    expect(addCalls.length).toBe(0);

    // Verify: warning logged
    const warningLog = stderrOutput.find((line) => line.includes('Isolation strategy validation failed'));
    expect(warningLog).toBeDefined();
  });

  // -------- Test 6: needs_human stages filtered --------

  it('needs_human stages are filtered out by discovery', async () => {
    const fmStore = createFrontmatterStore();

    const { orchestrator } = wireUp({
      discoveryJson: makeDiscoveryJson([
        {
          id: 'STAGE-001-001-001',
          ticket: 'TICKET-001-001',
          epic: 'EPIC-001',
          title: 'Human-only stage',
          worktree_branch: 'branch-1',
          needs_human: true,
        },
      ]),
      frontmatterStore: fmStore,
    });

    await orchestrator.start();

    // The real discovery module filters needs_human=true stages internally.
    // No sessions should be spawned.
    expect(spawnIndex).toBe(0);
  });

  // -------- Test 7: Resolver state skipped --------

  it('resolver state: lock acquired then released, no worktree, no session', async () => {
    // Stage has status 'PR Created' which maps to a resolver, not a skill
    const stageFile = '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md';
    const fmStore = createFrontmatterStore({
      [stageFile]: { status: 'PR Created' },
    });

    const { orchestrator, frontmatterStore, execGit } = wireUp({
      discoveryJson: makeDiscoveryJson([{
        id: 'STAGE-001-001-001',
        ticket: 'TICKET-001-001',
        epic: 'EPIC-001',
        title: 'PR stage',
        worktree_branch: 'branch-1',
      }]),
      frontmatterStore: fmStore,
    });

    await orchestrator.start();

    // Verify: readFrontmatter was called with the specific stage file path
    expect(fmStore.readFrontmatter).toHaveBeenCalledWith(stageFile);
    // Verify: writeFrontmatter called at least 2 times (acquire lock + release lock)
    expect(fmStore.writeFrontmatter.mock.calls.length).toBeGreaterThanOrEqual(2);
    const entryAfter = frontmatterStore.getEntry(stageFile);
    expect(entryAfter?.data.session_active).toBe(false);

    // Verify: no worktree created
    const addCalls = execGit.calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'add');
    expect(addCalls.length).toBe(0);

    // Verify: no session spawned
    expect(spawnIndex).toBe(0);
  });
});
