import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupShutdownHandlers, type ShutdownDeps, type ShutdownOptions } from '../src/shutdown.js';
import type { Orchestrator } from '../src/loop.js';
import type { WorktreeManager } from '../src/worktree.js';
import type { Locker } from '../src/locking.js';
import type { SessionExecutor } from '../src/session.js';
import type { Logger } from '../src/logger.js';
import type { WorkerInfo } from '../src/types.js';

// ---------- Test helpers ----------

function makeWorkerInfo(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    stageId: 'STAGE-001-001-001',
    stageFilePath: '/repo/epics/epic-001/ticket-001/stage-001.md',
    worktreePath: '/repo/.worktrees/worktree-1',
    worktreeIndex: 1,
    statusBefore: 'In Design',
    startTime: Date.now(),
    ...overrides,
  };
}

function makeMockOrchestrator(activeWorkers: Map<number, WorkerInfo> = new Map()): {
  orchestrator: Orchestrator;
  stopFn: ReturnType<typeof vi.fn>;
  setActiveWorkers: (workers: Map<number, WorkerInfo>) => void;
} {
  let currentWorkers = activeWorkers;
  const stopFn = vi.fn().mockResolvedValue(undefined);

  return {
    orchestrator: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: stopFn,
      isRunning: vi.fn().mockReturnValue(true),
      getActiveWorkers: () => new Map(currentWorkers),
    },
    stopFn,
    setActiveWorkers: (workers: Map<number, WorkerInfo>) => {
      currentWorkers = workers;
    },
  };
}

function makeMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    createSessionLogger: vi.fn(),
  };
}

function makeMockLocker(): Locker & { releaseLock: ReturnType<typeof vi.fn> } {
  return {
    acquireLock: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    isLocked: vi.fn().mockResolvedValue(false),
    readStatus: vi.fn().mockResolvedValue('In Design'),
  };
}

function makeMockWorktreeManager(): WorktreeManager & {
  remove: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    validateIsolationStrategy: vi.fn().mockResolvedValue(true),
    listActive: vi.fn().mockReturnValue([]),
    acquireIndex: vi.fn().mockReturnValue(1),
    releaseIndex: vi.fn(),
    releaseAll: vi.fn(),
  };
}

function makeMockSessionExecutor(): SessionExecutor & { killAll: ReturnType<typeof vi.fn> } {
  return {
    spawn: vi.fn(),
    getActiveSessions: vi.fn().mockReturnValue([]),
    killAll: vi.fn(),
  };
}

interface TestContext {
  orchestratorHelper: ReturnType<typeof makeMockOrchestrator>;
  logger: ReturnType<typeof makeMockLogger>;
  locker: ReturnType<typeof makeMockLocker>;
  worktreeManager: ReturnType<typeof makeMockWorktreeManager>;
  sessionExecutor: ReturnType<typeof makeMockSessionExecutor>;
  signalHandlers: Map<string, () => void>;
  exitFn: ReturnType<typeof vi.fn>;
  deps: ShutdownDeps;
}

function createTestContext(activeWorkers?: Map<number, WorkerInfo>): TestContext {
  const orchestratorHelper = makeMockOrchestrator(activeWorkers);
  const logger = makeMockLogger();
  const locker = makeMockLocker();
  const worktreeManager = makeMockWorktreeManager();
  const sessionExecutor = makeMockSessionExecutor();
  const signalHandlers = new Map<string, () => void>();
  const exitFn = vi.fn();

  const deps: ShutdownDeps = {
    onSignal: (signal: string, handler: () => void) => {
      signalHandlers.set(signal, handler);
    },
    exit: exitFn,
  };

  return {
    orchestratorHelper,
    logger,
    locker,
    worktreeManager,
    sessionExecutor,
    signalHandlers,
    exitFn,
    deps,
  };
}

function makeOptions(ctx: TestContext, overrides: Partial<ShutdownOptions> = {}): ShutdownOptions {
  return {
    orchestrator: ctx.orchestratorHelper.orchestrator,
    worktreeManager: ctx.worktreeManager,
    locker: ctx.locker,
    sessionExecutor: ctx.sessionExecutor,
    logger: ctx.logger,
    ...overrides,
  };
}

// ---------- Tests ----------

describe('setupShutdownHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers handlers for both SIGINT and SIGTERM', () => {
    const ctx = createTestContext();
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    expect(ctx.signalHandlers.has('SIGINT')).toBe(true);
    expect(ctx.signalHandlers.has('SIGTERM')).toBe(true);
  });

  it('calls orchestrator.stop() on signal', async () => {
    const ctx = createTestContext();
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    // Let the async shutdown proceed
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.orchestratorHelper.stopFn).toHaveBeenCalledOnce();
  });

  it('waits for active workers to drain', async () => {
    const workers = new Map<number, WorkerInfo>([
      [1, makeWorkerInfo()],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGTERM')!;
    handler();

    // Let the shutdown start (orchestrator.stop + first poll)
    await vi.advanceTimersByTimeAsync(0);

    // Workers still active — should be polling
    expect(ctx.exitFn).not.toHaveBeenCalled();

    // Simulate workers draining after 1 second
    ctx.orchestratorHelper.setActiveWorkers(new Map());
    await vi.advanceTimersByTimeAsync(500);

    // Should have exited after workers drained
    expect(ctx.exitFn).toHaveBeenCalledWith(0);
    expect(ctx.logger.info).toHaveBeenCalledWith('Shutdown complete');
  });

  it('calls sessionExecutor.killAll after drain timeout', async () => {
    const workers = new Map<number, WorkerInfo>([
      [1, makeWorkerInfo()],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 2000 }),
      ctx.deps,
    );

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    // Advance past drain timeout
    await vi.advanceTimersByTimeAsync(2500);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Drain timeout reached, killing active sessions...',
    );
    expect(ctx.sessionExecutor.killAll).toHaveBeenCalledWith('SIGTERM');
  });

  it('escalates to SIGKILL after graceful kill timeout', async () => {
    const workers = new Map<number, WorkerInfo>([
      [1, makeWorkerInfo()],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 1000 }),
      ctx.deps,
    );

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    // Past drain timeout — triggers SIGTERM killAll
    await vi.advanceTimersByTimeAsync(1500);
    expect(ctx.sessionExecutor.killAll).toHaveBeenCalledWith('SIGTERM');

    // Past graceful kill timeout (5000ms) — triggers SIGKILL
    await vi.advanceTimersByTimeAsync(5500);
    expect(ctx.sessionExecutor.killAll).toHaveBeenCalledWith('SIGKILL');
  });

  it('releases locks for remaining workers on shutdown', async () => {
    const worker1 = makeWorkerInfo({
      worktreeIndex: 1,
      stageFilePath: '/repo/stage-1.md',
      worktreePath: '/repo/.worktrees/worktree-1',
    });
    const worker2 = makeWorkerInfo({
      worktreeIndex: 2,
      stageId: 'STAGE-002-001-001',
      stageFilePath: '/repo/stage-2.md',
      worktreePath: '/repo/.worktrees/worktree-2',
    });
    const workers = new Map<number, WorkerInfo>([
      [1, worker1],
      [2, worker2],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 100 }),
      ctx.deps,
    );

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    // Let everything run through drain + kill + cleanup
    await vi.advanceTimersByTimeAsync(10000);

    expect(ctx.locker.releaseLock).toHaveBeenCalledWith('/repo/stage-1.md');
    expect(ctx.locker.releaseLock).toHaveBeenCalledWith('/repo/stage-2.md');
  });

  it('removes worktrees for remaining workers on shutdown', async () => {
    const worker1 = makeWorkerInfo({
      worktreeIndex: 1,
      worktreePath: '/repo/.worktrees/worktree-1',
    });
    const worker2 = makeWorkerInfo({
      worktreeIndex: 2,
      stageId: 'STAGE-002-001-001',
      worktreePath: '/repo/.worktrees/worktree-2',
    });
    const workers = new Map<number, WorkerInfo>([
      [1, worker1],
      [2, worker2],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 100 }),
      ctx.deps,
    );

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(10000);

    expect(ctx.worktreeManager.remove).toHaveBeenCalledWith('/repo/.worktrees/worktree-1');
    expect(ctx.worktreeManager.remove).toHaveBeenCalledWith('/repo/.worktrees/worktree-2');
  });

  it('calls worktreeManager.releaseAll', async () => {
    const ctx = createTestContext();
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.worktreeManager.releaseAll).toHaveBeenCalledOnce();
  });

  it('logs errors from cleanup without throwing', async () => {
    const worker = makeWorkerInfo();
    const workers = new Map<number, WorkerInfo>([[1, worker]]);
    const ctx = createTestContext(workers);

    // Make cleanup methods throw
    ctx.locker.releaseLock.mockRejectedValue(new Error('lock release failed'));
    ctx.worktreeManager.remove.mockRejectedValue(new Error('worktree remove failed'));

    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 100 }),
      ctx.deps,
    );

    const handler = ctx.signalHandlers.get('SIGTERM')!;
    handler();

    await vi.advanceTimersByTimeAsync(10000);

    // Should log errors but still complete
    expect(ctx.logger.error).toHaveBeenCalledWith(
      'Failed to release lock during shutdown',
      expect.objectContaining({ error: 'lock release failed' }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      'Failed to remove worktree during shutdown',
      expect.objectContaining({ error: 'worktree remove failed' }),
    );

    // Should still exit successfully
    expect(ctx.exitFn).toHaveBeenCalledWith(0);
    expect(ctx.logger.info).toHaveBeenCalledWith('Shutdown complete');
  });

  it('calls exit(0) after cleanup', async () => {
    const ctx = createTestContext();
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.exitFn).toHaveBeenCalledWith(0);
  });

  it('no-op on second signal (re-entrancy guard)', async () => {
    const workers = new Map<number, WorkerInfo>([
      [1, makeWorkerInfo()],
    ]);
    const ctx = createTestContext(workers);
    setupShutdownHandlers(
      makeOptions(ctx, { drainTimeoutMs: 5000 }),
      ctx.deps,
    );

    // Fire first signal
    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.orchestratorHelper.stopFn).toHaveBeenCalledOnce();

    // Fire second signal — should be no-op
    handler();
    await vi.advanceTimersByTimeAsync(0);

    // stop() should still only have been called once
    expect(ctx.orchestratorHelper.stopFn).toHaveBeenCalledOnce();
  });

  it('exits immediately when no active workers', async () => {
    const ctx = createTestContext();
    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGTERM')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.orchestratorHelper.stopFn).toHaveBeenCalledOnce();
    expect(ctx.exitFn).toHaveBeenCalledWith(0);
    expect(ctx.logger.info).toHaveBeenCalledWith('Shutdown complete');
    // killAll should NOT have been called when no workers
    expect(ctx.sessionExecutor.killAll).not.toHaveBeenCalled();
  });

  it('logs error and continues shutdown when orchestrator.stop() throws', async () => {
    const ctx = createTestContext();
    ctx.orchestratorHelper.stopFn.mockRejectedValueOnce(new Error('stop failed'));

    setupShutdownHandlers(makeOptions(ctx), ctx.deps);

    const handler = ctx.signalHandlers.get('SIGINT')!;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      'Error stopping orchestrator',
      { error: 'stop failed' },
    );
    // Should still complete shutdown
    expect(ctx.exitFn).toHaveBeenCalledWith(0);
    expect(ctx.logger.info).toHaveBeenCalledWith('Shutdown complete');
  });
});
