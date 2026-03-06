import { describe, it, expect, vi } from 'vitest';
import {
  createInsightsThresholdChecker,
  type InsightsThresholdDeps,
  type LearningsResult,
} from '../src/insights-threshold.js';

const REPO_PATH = '/repo';

// ---------- Test helpers ----------

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeDeps(overrides: Partial<InsightsThresholdDeps> = {}): InsightsThresholdDeps {
  return {
    countLearnings: vi.fn(async () => ({ count: 0, threshold: 10, exceeded: false })),
    spawnSession: vi.fn(async () => {}),
    logger: makeLogger(),
    now: () => 1000000,
    intervalMs: 600_000,
    ...overrides,
  };
}

// ---------- Tests ----------

describe('createInsightsThresholdChecker', () => {
  describe('threshold not exceeded', () => {
    it('does not spawn a session when threshold is not exceeded', async () => {
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 3, threshold: 10, exceeded: false })),
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(deps.countLearnings).toHaveBeenCalledWith(REPO_PATH);
      expect(deps.spawnSession).not.toHaveBeenCalled();
    });

    it('logs that learnings count is below threshold', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 3, threshold: 10, exceeded: false })),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Learnings count below threshold',
        expect.objectContaining({ count: 3, threshold: 10 }),
      );
    });
  });

  describe('threshold exceeded', () => {
    it('spawns a session when threshold is exceeded', async () => {
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(deps.countLearnings).toHaveBeenCalledWith(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);
      expect(deps.spawnSession).toHaveBeenCalledWith(REPO_PATH);
    });

    it('logs that threshold is exceeded and session is being spawned', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Insights threshold exceeded, spawning meta-insights session',
        expect.objectContaining({ count: 15, threshold: 10 }),
      );
    });
  });

  describe('cooldown behavior', () => {
    it('does not spawn again while cooldown is active', async () => {
      let currentTime = 1000000;
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      // First check — should spawn
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);

      // Second check immediately — cooldown active, should NOT spawn
      currentTime += 1000; // only 1 second later
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);
    });

    it('logs cooldown message when threshold exceeded but cooldown active', async () => {
      let currentTime = 1000000;
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        logger,
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      currentTime += 1000;
      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Insights threshold exceeded but cooldown active',
        expect.objectContaining({ count: 15, threshold: 10 }),
      );
    });

    it('spawns again when cooldown has exactly expired', async () => {
      let currentTime = 1000000;
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);

      currentTime += 600_000; // exactly at cooldown boundary
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(2);
    });

    it('spawns again after cooldown expires', async () => {
      let currentTime = 1000000;
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      // First check — should spawn
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);

      // Advance past cooldown
      currentTime += 600_001;
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('countLearnings failure', () => {
    it('logs error and does not crash when countLearnings throws', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => { throw new Error('DB connection failed'); }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      // Should not throw
      await checker.check(REPO_PATH);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to count learnings',
        expect.objectContaining({ repoPath: REPO_PATH, error: 'DB connection failed' }),
      );
      expect(deps.spawnSession).not.toHaveBeenCalled();
    });

    it('handles non-Error throws from countLearnings', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => { throw 'string error'; }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to count learnings',
        expect.objectContaining({ error: 'string error' }),
      );
    });
  });

  describe('spawnSession failure', () => {
    it('logs error and does not crash when spawnSession throws', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        spawnSession: vi.fn(async () => { throw new Error('spawn failed'); }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      // Should not throw
      await checker.check(REPO_PATH);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to spawn meta-insights session',
        expect.objectContaining({ repoPath: REPO_PATH, error: 'spawn failed' }),
      );
    });

    it('handles non-Error throws from spawnSession', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        spawnSession: vi.fn(async () => { throw 42; }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await expect(checker.check(REPO_PATH)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to spawn meta-insights session',
        expect.objectContaining({ repoPath: REPO_PATH, error: '42' }),
      );
    });

    it('updates cooldown even when spawnSession fails', async () => {
      let currentTime = 1000000;
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        spawnSession: vi.fn(async () => { throw new Error('spawn failed'); }),
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      // First check — spawn fails but cooldown should still be set
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);

      // Second check within cooldown — should NOT try to spawn again
      currentTime += 1000;
      await checker.check(REPO_PATH);
      expect(deps.spawnSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('logger receives correct messages', () => {
    it('logs below-threshold with count and threshold', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 5, threshold: 10, exceeded: false })),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Learnings count below threshold',
        { count: 5, threshold: 10 },
      );
    });

    it('logs exceeded with count and threshold before spawning', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 12, threshold: 10, exceeded: true })),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Insights threshold exceeded, spawning meta-insights session',
        { count: 12, threshold: 10 },
      );
    });

    it('logs cooldown active with count and threshold', async () => {
      let currentTime = 1000000;
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 20, threshold: 10, exceeded: true })),
        logger,
        now: () => currentTime,
        intervalMs: 600_000,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);
      currentTime += 1000;
      await checker.check(REPO_PATH);

      expect(logger.info).toHaveBeenCalledWith(
        'Insights threshold exceeded but cooldown active',
        { count: 20, threshold: 10 },
      );
    });

    it('logs countLearnings error with repoPath and error message', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => { throw new Error('timeout'); }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to count learnings',
        { repoPath: REPO_PATH, error: 'timeout' },
      );
    });

    it('logs spawnSession error with repoPath and error message', async () => {
      const logger = makeLogger();
      const deps = makeDeps({
        countLearnings: vi.fn(async () => ({ count: 15, threshold: 10, exceeded: true })),
        spawnSession: vi.fn(async () => { throw new Error('process exited'); }),
        logger,
      });
      const checker = createInsightsThresholdChecker(deps);

      await checker.check(REPO_PATH);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to spawn meta-insights session',
        { repoPath: REPO_PATH, error: 'process exited' },
      );
    });
  });

  describe('default deps', () => {
    it('creates checker with no deps without crashing', async () => {
      const checker = createInsightsThresholdChecker();

      // Should not throw — default countLearnings returns exceeded: false
      await checker.check(REPO_PATH);
    });

    it('default countLearnings returns non-exceeded result', async () => {
      const spawnSession = vi.fn(async () => {});
      const checker = createInsightsThresholdChecker({ spawnSession });

      await checker.check(REPO_PATH);

      // Default countLearnings returns { count: 0, threshold: 10, exceeded: false }
      // so spawnSession should never be called
      expect(spawnSession).not.toHaveBeenCalled();
    });
  });
});
