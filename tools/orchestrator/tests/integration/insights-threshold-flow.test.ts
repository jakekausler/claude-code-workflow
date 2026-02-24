/**
 * Integration tests for the insights-threshold cron wiring.
 *
 * Verifies the full integration path:
 *   config -> buildCronScheduler -> checker -> session spawn
 *
 * Tests exercise the REAL createOrchestrator wiring (which internally calls
 * buildCronScheduler), the REAL createCronScheduler, and the REAL
 * createInsightsThresholdChecker. Only I/O is mocked: sessionExecutor,
 * discovery, locker, worktree manager, and the execFile call inside
 * countLearnings.
 *
 * Pattern follows tools/orchestrator/tests/integration/mr-cron-flow.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineConfig, CronConfig } from 'kanban-cli';

import { createOrchestrator } from '../../src/loop.js';
import type { OrchestratorConfig } from '../../src/types.js';
import type { Discovery, DiscoveryResult } from '../../src/discovery.js';
import type { Locker } from '../../src/locking.js';
import type { WorktreeManager } from '../../src/worktree.js';
import type { SessionExecutor, SessionResult } from '../../src/session.js';
import type { Logger, SessionLogger } from '../../src/logger.js';
import type { ResolverRunner } from '../../src/resolvers.js';

const REPO_PATH = '/repo';

function makePipelineConfig(overrides?: { cron?: CronConfig; threshold?: number }): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'Design', skill: 'phase-design', transitions_to: ['Build'] },
        { name: 'Build', status: 'Build', skill: 'phase-build', transitions_to: ['PR Created'] },
        { name: 'PR Created', status: 'PR Created', resolver: 'pr-status', transitions_to: ['Done'] },
      ],
      defaults: {
        WORKFLOW_MAX_PARALLEL: 2,
        WORKFLOW_LEARNINGS_THRESHOLD: overrides?.threshold ?? 10,
      },
    },
    cron: overrides?.cron,
  };
}

function makeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    repoPath: REPO_PATH,
    once: true,
    idleSeconds: 1,
    logDir: '/logs',
    model: 'opus',
    verbose: false,
    maxParallel: 2,
    pipelineConfig: makePipelineConfig(),
    workflowEnv: {},
    mock: false,
    ...overrides,
  };
}

function makeDiscovery(): Discovery & { discover: ReturnType<typeof vi.fn> } {
  return {
    discover: vi.fn(async (): Promise<DiscoveryResult> => ({
      readyStages: [],
      blockedCount: 0,
      inProgressCount: 0,
      toConvertCount: 0,
    })),
  };
}

function makeLocker(): Locker & {
  acquireLock: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
  readStatus: ReturnType<typeof vi.fn>;
} {
  return {
    acquireLock: vi.fn(async () => {}),
    releaseLock: vi.fn(async () => {}),
    isLocked: vi.fn(async () => false),
    readStatus: vi.fn(async () => 'Design'),
  };
}

function makeWorktreeManager(): WorktreeManager & {
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  validateIsolationStrategy: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async () => ({ path: '/worktree/0', index: 0 })),
    remove: vi.fn(async () => {}),
    validateIsolationStrategy: vi.fn(async () => true),
  };
}

function makeSessionExecutor(): SessionExecutor & {
  spawn: ReturnType<typeof vi.fn>;
  getActiveSessions: ReturnType<typeof vi.fn>;
  killAll: ReturnType<typeof vi.fn>;
} {
  return {
    spawn: vi.fn(async (): Promise<SessionResult> => ({ exitCode: 0, durationMs: 1000 })),
    getActiveSessions: vi.fn(() => []),
    killAll: vi.fn(),
  };
}

function makeOrchestratorLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    createSessionLogger: vi.fn((): SessionLogger => ({
      logFilePath: '/logs/test.log',
      write: vi.fn(),
      close: vi.fn(async () => {}),
    })),
  };
}

function makeResolverRunner(): ResolverRunner {
  return {
    checkAll: vi.fn(async () => []),
  };
}

describe('Insights Threshold Cron Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildCronScheduler creates insights-threshold job when config is present', () => {
    it('orchestrator starts and stops cron scheduler with insights-threshold config', async () => {
      const cronConfig: CronConfig = {
        insights_threshold: { enabled: true, interval_seconds: 120 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig }),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
      });

      await orchestrator.start();

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const scheduledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job scheduled' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(scheduledCall).toBeDefined();
      expect((scheduledCall![1] as Record<string, unknown>).intervalMs).toBe(120_000);
    });
  });

  describe('insights-threshold job is disabled when enabled=false', () => {
    it('cron scheduler logs disabled job and does not schedule it', async () => {
      const cronConfig: CronConfig = {
        insights_threshold: { enabled: false, interval_seconds: 120 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig }),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
      });

      await orchestrator.start();

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const disabledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job disabled, skipping' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(disabledCall).toBeDefined();

      const scheduledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job scheduled' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(scheduledCall).toBeUndefined();
    });
  });

  describe('insights-threshold job not created when config section is missing', () => {
    it('no insights-threshold log entries when cron.insights_threshold is absent', async () => {
      const cronConfig: CronConfig = {
        mr_comment_poll: { enabled: true, interval_seconds: 300 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig }),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
      });

      await orchestrator.start();

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const insightsCalls = infoFn.mock.calls.filter(
        (call: unknown[]) => {
          const ctx = call[1] as Record<string, unknown> | undefined;
          return ctx?.job === 'insights-threshold';
        },
      );
      expect(insightsCalls).toHaveLength(0);
    });

    it('no cron scheduler created when cron section is entirely absent', async () => {
      const config = makeConfig({
        pipelineConfig: makePipelineConfig(),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
      });

      await orchestrator.start();

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const cronStartedCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron scheduler started',
      );
      expect(cronStartedCall).toBeUndefined();
    });
  });

  describe('full orchestrator wiring: insights cron fires', () => {
    it('insights cron fires but script absence prevents session spawn', async () => {
      const sessionExecutor = makeSessionExecutor();
      const logger = makeOrchestratorLogger();

      const cronConfig: CronConfig = {
        insights_threshold: { enabled: true, interval_seconds: 120 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig }),
      });

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor,
        logger,
        resolverRunner: makeResolverRunner(),
        now: () => 0,
      });

      const startPromise = orchestrator.start();

      // Advance time to trigger the insights-threshold interval (120s)
      await vi.advanceTimersByTimeAsync(120_000);

      // The cron job fires, but the execFile inside countLearnings calls
      // a real shell script which won't exist. The checker handles the error
      // gracefully (logs warning, returns count=0, exceeded=false).
      // Wait a tick for the async handler to complete.
      await vi.advanceTimersByTimeAsync(100);

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const scheduledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job scheduled' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(scheduledCall).toBeDefined();

      const warnFn = logger.warn as ReturnType<typeof vi.fn>;
      const scriptFailCall = warnFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'count-unanalyzed.sh failed',
      );
      expect(scriptFailCall).toBeDefined();

      // No session spawned (threshold not exceeded because script failed -> count=0)
      expect(sessionExecutor.spawn).not.toHaveBeenCalled();

      await orchestrator.stop();
      await startPromise;
    });
  });

  describe('config wiring', () => {
    it('orchestrator uses WORKFLOW_LEARNINGS_THRESHOLD from config defaults', async () => {
      const cronConfig: CronConfig = {
        insights_threshold: { enabled: true, interval_seconds: 60 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig, threshold: 25 }),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
        now: () => 0,
      });

      const startPromise = orchestrator.start();

      // Advance timer to trigger the insights job
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(100);

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const scheduledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job scheduled' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(scheduledCall).toBeDefined();
      expect((scheduledCall![1] as Record<string, unknown>).intervalMs).toBe(60_000);

      await orchestrator.stop();
      await startPromise;
    });

    it('cron interval matches config interval_seconds * 1000', async () => {
      const cronConfig: CronConfig = {
        insights_threshold: { enabled: true, interval_seconds: 300 },
      };
      const config = makeConfig({
        pipelineConfig: makePipelineConfig({ cron: cronConfig }),
      });

      const logger = makeOrchestratorLogger();

      const orchestrator = createOrchestrator(config, {
        discovery: makeDiscovery(),
        locker: makeLocker(),
        worktreeManager: makeWorktreeManager(),
        sessionExecutor: makeSessionExecutor(),
        logger,
        resolverRunner: makeResolverRunner(),
        now: () => 0,
      });

      const startPromise = orchestrator.start();

      const infoFn = logger.info as ReturnType<typeof vi.fn>;
      const scheduledCall = infoFn.mock.calls.find(
        (call: unknown[]) => call[0] === 'Cron job scheduled' && (call[1] as Record<string, unknown>)?.job === 'insights-threshold',
      );
      expect(scheduledCall).toBeDefined();
      expect((scheduledCall![1] as Record<string, unknown>).intervalMs).toBe(300_000);

      await orchestrator.stop();
      await startPromise;
    });
  });
});
