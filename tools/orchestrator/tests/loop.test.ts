import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from 'kanban-cli';
import {
  createOrchestrator,
  lookupSkillName,
  resolveStageFilePath,
  type OrchestratorDeps,
} from '../src/loop.js';
import type { OrchestratorConfig, WorkerInfo } from '../src/types.js';
import type { Discovery, DiscoveryResult, ReadyStage } from '../src/discovery.js';
import type { Locker } from '../src/locking.js';
import type { WorktreeManager, WorktreeInfo } from '../src/worktree.js';
import type { SessionExecutor, SessionResult } from '../src/session.js';
import type { Logger, SessionLogger } from '../src/logger.js';

// ---------- Test helpers ----------

function makePipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'In Design', skill: 'design', transitions_to: ['Build'] },
        { name: 'Build', status: 'In Build', skill: 'implement', transitions_to: ['Review'] },
        { name: 'Review', status: 'In Review', resolver: 'pr-status', transitions_to: ['Done'] },
        { name: 'Comments', status: 'Addressing Comments', skill: 'address-comments', transitions_to: ['Review'] },
      ],
      ...overrides?.workflow,
    },
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    repoPath: '/repo',
    once: false,
    idleSeconds: 1,
    logDir: '/logs',
    model: 'opus',
    verbose: false,
    maxParallel: 3,
    pipelineConfig: makePipelineConfig(),
    workflowEnv: { WORKFLOW_AUTO_DESIGN: 'true' },
    mock: false,
    ...overrides,
  };
}

function makeReadyStage(overrides?: Partial<ReadyStage>): ReadyStage {
  return {
    id: 'STAGE-001-001-001',
    ticket: 'TICKET-001-001',
    epic: 'EPIC-001',
    title: 'Test stage',
    worktreeBranch: 'epic-001/ticket-001/stage-001',
    priorityScore: 500,
    priorityReason: 'normal',
    needsHuman: false,
    ...overrides,
  };
}

function makeDiscoveryResult(stages: ReadyStage[] = []): DiscoveryResult {
  return {
    readyStages: stages,
    blockedCount: 0,
    inProgressCount: 0,
    toConvertCount: 0,
  };
}

interface MockSessionLogger extends SessionLogger {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeMockSessionLogger(): MockSessionLogger {
  return {
    logFilePath: '/logs/test.log',
    write: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

interface DeferredSession {
  resolve: (result: SessionResult) => void;
  reject: (error: Error) => void;
}

function makeMockDeps(): {
  deps: OrchestratorDeps;
  discovery: { discover: ReturnType<typeof vi.fn> };
  locker: {
    acquireLock: ReturnType<typeof vi.fn>;
    releaseLock: ReturnType<typeof vi.fn>;
    isLocked: ReturnType<typeof vi.fn>;
    readStatus: ReturnType<typeof vi.fn>;
  };
  worktreeManager: {
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    validateIsolationStrategy: ReturnType<typeof vi.fn>;
    listActive: ReturnType<typeof vi.fn>;
    acquireIndex: ReturnType<typeof vi.fn>;
    releaseIndex: ReturnType<typeof vi.fn>;
    releaseAll: ReturnType<typeof vi.fn>;
  };
  sessionExecutor: {
    spawn: ReturnType<typeof vi.fn>;
    getActiveSessions: ReturnType<typeof vi.fn>;
    killAll: ReturnType<typeof vi.fn>;
  };
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    createSessionLogger: ReturnType<typeof vi.fn>;
  };
  sessionLoggers: MockSessionLogger[];
  /** Create a deferred session promise that can be resolved later. */
  deferSession(): DeferredSession;
} {
  const sessionLoggers: MockSessionLogger[] = [];
  const deferredSessions: DeferredSession[] = [];

  const discovery = {
    discover: vi.fn(async (): Promise<DiscoveryResult> => makeDiscoveryResult()),
  };

  const locker = {
    acquireLock: vi.fn(async () => {}),
    releaseLock: vi.fn(async () => {}),
    isLocked: vi.fn(async () => false),
    readStatus: vi.fn(async () => 'In Design'),
  };

  const worktreeManager = {
    create: vi.fn(async (_branch: string, _repoPath: string): Promise<WorktreeInfo> => ({
      path: '/repo/.worktrees/worktree-1',
      branch: 'test-branch',
      index: 1,
    })),
    remove: vi.fn(async () => {}),
    validateIsolationStrategy: vi.fn(async () => true),
    listActive: vi.fn(() => []),
    acquireIndex: vi.fn(() => 1),
    releaseIndex: vi.fn(),
    releaseAll: vi.fn(),
  };

  const sessionExecutor = {
    spawn: vi.fn(async (): Promise<SessionResult> => ({ exitCode: 0, durationMs: 1000 })),
    getActiveSessions: vi.fn(() => []),
    killAll: vi.fn(),
  };

  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    createSessionLogger: vi.fn((): SessionLogger => {
      const sl = makeMockSessionLogger();
      sessionLoggers.push(sl);
      return sl;
    }),
  };

  function deferSession(): DeferredSession {
    const d: DeferredSession = {} as DeferredSession;
    const promise = new Promise<SessionResult>((resolve, reject) => {
      d.resolve = resolve;
      d.reject = reject;
    });
    deferredSessions.push(d);

    // Queue this deferred as the next spawn result
    sessionExecutor.spawn.mockReturnValueOnce(promise);
    return d;
  }

  return {
    deps: {
      discovery,
      locker,
      worktreeManager,
      sessionExecutor,
      logger: loggerMock,
    },
    discovery,
    locker,
    worktreeManager,
    sessionExecutor,
    logger: loggerMock,
    sessionLoggers,
    deferSession,
  };
}

// ---------- lookupSkillName ----------

describe('lookupSkillName', () => {
  it('returns correct skill for a known status', () => {
    const config = makePipelineConfig();
    expect(lookupSkillName(config, 'In Design')).toBe('design');
  });

  it('returns correct skill for another status', () => {
    const config = makePipelineConfig();
    expect(lookupSkillName(config, 'In Build')).toBe('implement');
  });

  it('returns null for resolver states', () => {
    const config = makePipelineConfig();
    expect(lookupSkillName(config, 'In Review')).toBeNull();
  });

  it('returns null for unknown status', () => {
    const config = makePipelineConfig();
    expect(lookupSkillName(config, 'Unknown Status')).toBeNull();
  });
});

// ---------- resolveStageFilePath ----------

describe('resolveStageFilePath', () => {
  it('builds correct path from stage data', () => {
    const stage = makeReadyStage({
      id: 'STAGE-001-002-003',
      epic: 'EPIC-001',
      ticket: 'TICKET-001-002',
    });
    const result = resolveStageFilePath('/repo', stage);
    expect(result).toBe('/repo/epics/EPIC-001/TICKET-001-002/STAGE-001-002-003.md');
  });

  it('handles different repo paths', () => {
    const stage = makeReadyStage({
      id: 'STAGE-005-010-001',
      epic: 'EPIC-005',
      ticket: 'TICKET-005-010',
    });
    const result = resolveStageFilePath('/my/custom/repo', stage);
    expect(result).toBe('/my/custom/repo/epics/EPIC-005/TICKET-005-010/STAGE-005-010-001.md');
  });
});

// ---------- createOrchestrator ----------

describe('createOrchestrator', () => {
  describe('single tick with --once', () => {
    it('discovers and spawns one session', async () => {
      const { deps, discovery, locker, worktreeManager, sessionExecutor, logger: loggerMock, deferSession } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design') // statusBefore in tick
        .mockResolvedValueOnce('In Build');  // statusAfter in handleSessionExit

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      // Wait for the spawn to be called
      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      // Resolve the session
      deferred.resolve({ exitCode: 0, durationMs: 5000 });

      await startPromise;

      expect(discovery.discover).toHaveBeenCalledWith('/repo', 3);
      expect(locker.acquireLock).toHaveBeenCalledTimes(1);
      expect(worktreeManager.create).toHaveBeenCalledWith(stage.worktreeBranch, '/repo');
      expect(worktreeManager.validateIsolationStrategy).toHaveBeenCalledWith('/repo');
      expect(loggerMock.createSessionLogger).toHaveBeenCalledWith(stage.id, '/logs');
    });

    it('passes correct spawn options to session executor', async () => {
      const { deps, discovery, locker, deferSession, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true, model: 'sonnet' });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      const spawnCall = sessionExecutor.spawn.mock.calls[0][0];
      expect(spawnCall.stageId).toBe('STAGE-001-001-001');
      expect(spawnCall.skillName).toBe('design');
      expect(spawnCall.model).toBe('sonnet');
      expect(spawnCall.workflowEnv).toEqual({ WORKFLOW_AUTO_DESIGN: 'true' });

      deferred.resolve({ exitCode: 0, durationMs: 1000 });
      await startPromise;
    });
  });

  describe('maxParallel enforcement', () => {
    it('does not over-spawn beyond maxParallel', async () => {
      const { deps, discovery, locker, worktreeManager, sessionExecutor, deferSession } = makeMockDeps();

      let worktreeIndex = 0;
      worktreeManager.create.mockImplementation(async (): Promise<WorktreeInfo> => {
        worktreeIndex++;
        return { path: `/repo/.worktrees/worktree-${worktreeIndex}`, branch: 'b', index: worktreeIndex };
      });

      const stage1 = makeReadyStage({ id: 'STAGE-001-001-001' });
      const stage2 = makeReadyStage({ id: 'STAGE-001-001-002' });
      const stage3 = makeReadyStage({ id: 'STAGE-001-001-003' });

      const d1 = deferSession();
      const d2 = deferSession();
      // Third session should not be spawned since maxParallel=2

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage1, stage2, stage3]));
      locker.readStatus.mockResolvedValue('In Design');

      const config = makeConfig({ once: true, maxParallel: 2 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(2);
      });

      // Only 2 of 3 stages should be spawned due to maxParallel=2
      expect(sessionExecutor.spawn).toHaveBeenCalledTimes(2);
      expect(discovery.discover).toHaveBeenCalledWith('/repo', 2);

      d1.resolve({ exitCode: 0, durationMs: 1000 });
      d2.resolve({ exitCode: 0, durationMs: 1000 });
      await startPromise;
    });
  });

  describe('idle behavior', () => {
    it('sleeps when no stages and no active workers (non-once mode)', async () => {
      const { deps, discovery } = makeMockDeps();

      let discoverCallCount = 0;
      discovery.discover.mockImplementation(async () => {
        discoverCallCount++;
        return makeDiscoveryResult();
      });

      const config = makeConfig({ once: false, idleSeconds: 0 }); // 0 seconds to prevent actual wait
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      // Wait for at least 2 discover calls (proves it looped through idle sleep)
      await vi.waitFor(() => {
        expect(discoverCallCount).toBeGreaterThanOrEqual(2);
      });

      await orchestrator.stop();
      await startPromise;
    });

    it('exits immediately in --once mode when no stages found', async () => {
      const { deps, discovery, sessionExecutor } = makeMockDeps();
      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult());

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      await orchestrator.start();

      expect(sessionExecutor.spawn).not.toHaveBeenCalled();
      expect(discovery.discover).toHaveBeenCalledTimes(1);
    });
  });

  describe('--once mode', () => {
    it('processes stages then exits', async () => {
      const { deps, discovery, locker, sessionExecutor, deferSession } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 2000 });
      await startPromise;

      // Should have exited — discover only called once
      expect(discovery.discover).toHaveBeenCalledTimes(1);
    });

    it('waits for active workers before exit', async () => {
      const { deps, discovery, locker, worktreeManager, sessionExecutor, deferSession } = makeMockDeps();

      let worktreeIndex = 0;
      worktreeManager.create.mockImplementation(async (): Promise<WorktreeInfo> => {
        worktreeIndex++;
        return { path: `/repo/.worktrees/worktree-${worktreeIndex}`, branch: 'b', index: worktreeIndex };
      });

      const stage1 = makeReadyStage({ id: 'STAGE-001-001-001' });
      const stage2 = makeReadyStage({ id: 'STAGE-001-001-002' });

      const d1 = deferSession();
      const d2 = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage1, stage2]));
      locker.readStatus
        .mockResolvedValueOnce('In Design') // stage1 statusBefore
        .mockResolvedValueOnce('In Design') // stage2 statusBefore
        .mockResolvedValueOnce('In Build')  // stage1 statusAfter
        .mockResolvedValueOnce('In Build'); // stage2 statusAfter

      const config = makeConfig({ once: true, maxParallel: 3 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(2);
      });

      // Resolve first session
      d1.resolve({ exitCode: 0, durationMs: 1000 });

      // start() should not resolve yet — stage2 is still active
      await new Promise((r) => setTimeout(r, 50));
      expect(orchestrator.getActiveWorkers().size).toBeGreaterThanOrEqual(1);

      // Now resolve second
      d2.resolve({ exitCode: 0, durationMs: 2000 });
      await startPromise;

      expect(orchestrator.getActiveWorkers().size).toBe(0);
    });
  });

  describe('session exit handling', () => {
    it('logs warning when status unchanged and exit code non-zero (crash)', async () => {
      const { deps, discovery, locker, deferSession, logger: loggerMock, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')  // statusBefore
        .mockResolvedValueOnce('In Design'); // statusAfter — unchanged

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 1, durationMs: 500 });
      await startPromise;

      expect(loggerMock.warn).toHaveBeenCalledWith('Session crashed', {
        stageId: 'STAGE-001-001-001',
        exitCode: 1,
        statusBefore: 'In Design',
      });
    });

    it('logs info when status unchanged and exit code 0', async () => {
      const { deps, discovery, locker, deferSession, logger: loggerMock, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')  // statusBefore
        .mockResolvedValueOnce('In Design'); // statusAfter — unchanged

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 800 });
      await startPromise;

      expect(loggerMock.info).toHaveBeenCalledWith('Session completed without status change', {
        stageId: 'STAGE-001-001-001',
        statusBefore: 'In Design',
      });
    });

    it('logs info with status change on normal completion', async () => {
      const { deps, discovery, locker, deferSession, logger: loggerMock, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')  // statusBefore
        .mockResolvedValueOnce('In Build');   // statusAfter — changed

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 5000 });
      await startPromise;

      expect(loggerMock.info).toHaveBeenCalledWith('Session completed', {
        stageId: 'STAGE-001-001-001',
        exitCode: 0,
        statusBefore: 'In Design',
        statusAfter: 'In Build',
        durationMs: 5000,
      });
    });

    it('always releases lock after session exit', async () => {
      const { deps, discovery, locker, deferSession, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 100 });
      await startPromise;

      expect(locker.releaseLock).toHaveBeenCalledWith(
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
      );
    });

    it('always removes worktree after session exit', async () => {
      const { deps, discovery, locker, worktreeManager, deferSession, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 100 });
      await startPromise;

      expect(worktreeManager.remove).toHaveBeenCalledWith('/repo/.worktrees/worktree-1');
    });

    it('always closes session logger after session exit', async () => {
      const { deps, discovery, locker, deferSession, sessionExecutor, sessionLoggers } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.resolve({ exitCode: 0, durationMs: 100 });
      await startPromise;

      expect(sessionLoggers).toHaveLength(1);
      expect(sessionLoggers[0].close).toHaveBeenCalled();
    });
  });

  describe('session error handling', () => {
    it('releases lock and cleans up on session error', async () => {
      const { deps, discovery, locker, worktreeManager, deferSession, sessionExecutor, logger: loggerMock, sessionLoggers } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus.mockResolvedValueOnce('In Design');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      deferred.reject(new Error('process crashed'));
      await startPromise;

      expect(loggerMock.error).toHaveBeenCalledWith('Session error', {
        stageId: 'STAGE-001-001-001',
        error: 'process crashed',
      });
      expect(locker.releaseLock).toHaveBeenCalled();
      expect(worktreeManager.remove).toHaveBeenCalled();
      expect(sessionLoggers[0].close).toHaveBeenCalled();
    });
  });

  describe('resolver state skipping', () => {
    it('skips stages in resolver states (no skill field)', async () => {
      const { deps, discovery, locker, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      // readStatus returns a resolver state
      locker.readStatus.mockResolvedValueOnce('In Review');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      await orchestrator.start();

      expect(sessionExecutor.spawn).not.toHaveBeenCalled();
      // Lock is acquired before readStatus, then released when resolver state detected
      expect(locker.acquireLock).toHaveBeenCalledTimes(1);
      expect(locker.releaseLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('isolation strategy validation', () => {
    it('caches validation result (called once per run)', async () => {
      const { deps, discovery, locker, worktreeManager, deferSession, sessionExecutor } = makeMockDeps();

      let worktreeIndex = 0;
      worktreeManager.create.mockImplementation(async (): Promise<WorktreeInfo> => {
        worktreeIndex++;
        return { path: `/repo/.worktrees/worktree-${worktreeIndex}`, branch: 'b', index: worktreeIndex };
      });

      const stage1 = makeReadyStage({ id: 'STAGE-001-001-001' });
      const stage2 = makeReadyStage({ id: 'STAGE-001-001-002' });

      const d1 = deferSession();
      const d2 = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage1, stage2]));
      locker.readStatus
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Design')
        .mockResolvedValueOnce('In Build')
        .mockResolvedValueOnce('In Build');

      const config = makeConfig({ once: true, maxParallel: 3 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(2);
      });

      d1.resolve({ exitCode: 0, durationMs: 1000 });
      d2.resolve({ exitCode: 0, durationMs: 1000 });
      await startPromise;

      // validateIsolationStrategy should have been called exactly once
      expect(worktreeManager.validateIsolationStrategy).toHaveBeenCalledTimes(1);
    });

    it('skips stage and releases lock when validation fails', async () => {
      const { deps, discovery, locker, worktreeManager, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus.mockResolvedValueOnce('In Design');
      worktreeManager.validateIsolationStrategy.mockResolvedValueOnce(false);

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      await orchestrator.start();

      expect(sessionExecutor.spawn).not.toHaveBeenCalled();
      expect(locker.releaseLock).toHaveBeenCalledWith(
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
      );
      expect(worktreeManager.create).not.toHaveBeenCalled();
    });
  });

  describe('re-entrancy guard', () => {
    it('throws if start() is called while already running', async () => {
      const { deps, discovery } = makeMockDeps();
      discovery.discover.mockResolvedValue(makeDiscoveryResult());

      const config = makeConfig({ once: false, idleSeconds: 0 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      // Wait for the loop to be running
      await vi.waitFor(() => {
        expect(orchestrator.isRunning()).toBe(true);
      });

      // Calling start() again should throw
      await expect(orchestrator.start()).rejects.toThrow('Orchestrator already running');

      await orchestrator.stop();
      await startPromise;
    });
  });

  describe('stop', () => {
    it('sets running to false', async () => {
      const { deps, discovery } = makeMockDeps();
      discovery.discover.mockResolvedValue(makeDiscoveryResult());

      const config = makeConfig({ once: false, idleSeconds: 0 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();
      expect(orchestrator.isRunning()).toBe(true);

      await orchestrator.stop();
      await startPromise;

      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe('getActiveWorkers', () => {
    it('returns active workers map', async () => {
      const { deps, discovery, locker, deferSession, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      discovery.discover.mockResolvedValueOnce(makeDiscoveryResult([stage]));
      locker.readStatus.mockResolvedValueOnce('In Design');

      const config = makeConfig({ once: true });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      const workers = orchestrator.getActiveWorkers();
      expect(workers.size).toBe(1);

      const worker = workers.get(1)!;
      expect(worker.stageId).toBe('STAGE-001-001-001');
      expect(worker.statusBefore).toBe('In Design');
      expect(worker.worktreePath).toBe('/repo/.worktrees/worktree-1');

      locker.readStatus.mockResolvedValueOnce('In Build');
      deferred.resolve({ exitCode: 0, durationMs: 100 });
      await startPromise;
    });
  });

  describe('non-once mode worker wait', () => {
    it('waits for worker exit when no new stages but workers active', async () => {
      const { deps, discovery, locker, deferSession, sessionExecutor } = makeMockDeps();
      const stage = makeReadyStage();
      const deferred = deferSession();

      let discoverCalls = 0;
      discovery.discover.mockImplementation(async () => {
        discoverCalls++;
        if (discoverCalls === 1) {
          return makeDiscoveryResult([stage]);
        }
        // On subsequent calls, return no stages
        return makeDiscoveryResult();
      });

      locker.readStatus
        .mockResolvedValueOnce('In Design')  // statusBefore
        .mockResolvedValueOnce('In Build');   // statusAfter

      const config = makeConfig({ once: false, maxParallel: 3 });
      const orchestrator = createOrchestrator(config, deps);

      const startPromise = orchestrator.start();

      // Wait for session to be spawned
      await vi.waitFor(() => {
        expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      });

      // Wait for second discover call (no new stages, but worker active → wait for worker)
      await vi.waitFor(() => {
        expect(discoverCalls).toBeGreaterThanOrEqual(2);
      });

      // Resolve the session to unblock
      deferred.resolve({ exitCode: 0, durationMs: 1000 });

      // Give time for the handler to run then stop
      await new Promise((r) => setTimeout(r, 50));
      await orchestrator.stop();
      await startPromise;
    });
  });
});
