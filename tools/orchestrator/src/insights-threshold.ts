/**
 * Insights threshold checker — monitors learnings count and spawns
 * meta-insights sessions when a configurable threshold is exceeded.
 *
 * Uses a cooldown interval to prevent retry storms. Errors from
 * countLearnings or spawnSession are logged but never crash the caller.
 */

/**
 * Result of counting learnings for a repo.
 */
export interface LearningsResult {
  count: number;
  threshold: number;
  exceeded: boolean;
}

/**
 * Injectable dependencies for the insights threshold checker.
 */
export interface InsightsThresholdDeps {
  countLearnings: (repoPath: string) => Promise<LearningsResult>;
  spawnSession: (repoPath: string) => Promise<void>;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
  now: () => number;
  intervalMs: number;
}

/**
 * Insights threshold checker interface.
 */
export interface InsightsThresholdChecker {
  check(repoPath: string): Promise<void>;
}

const defaultDeps: InsightsThresholdDeps = {
  countLearnings: async (_repoPath: string) => ({ count: 0, threshold: 10, exceeded: false }),
  spawnSession: async (_repoPath: string) => {},
  logger: {
    info: (_message: string, _context?: Record<string, unknown>) => {},
    warn: (_message: string, _context?: Record<string, unknown>) => {},
    error: (_message: string, _context?: Record<string, unknown>) => {},
  },
  now: () => Date.now(),
  intervalMs: 600_000,
};

/**
 * Extract a human-readable message from an unknown thrown value.
 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create an insights threshold checker.
 *
 * Calls `countLearnings` to determine whether the learnings threshold has been
 * exceeded. When exceeded and the cooldown interval has elapsed, spawns a
 * meta-insights session via `spawnSession`. Errors are logged but never thrown.
 */
export function createInsightsThresholdChecker(
  deps: Partial<InsightsThresholdDeps> = {},
): InsightsThresholdChecker {
  const resolved: InsightsThresholdDeps = { ...defaultDeps, ...deps };
  let lastTriggeredAt = 0;

  return {
    async check(repoPath: string): Promise<void> {
      let result: LearningsResult;
      try {
        result = await resolved.countLearnings(repoPath);
      } catch (err) {
        resolved.logger.error('Failed to count learnings', { repoPath, error: errMsg(err) });
        return;
      }

      if (!result.exceeded) {
        resolved.logger.info('Learnings count below threshold', {
          count: result.count,
          threshold: result.threshold,
        });
        return;
      }

      if (resolved.now() - lastTriggeredAt < resolved.intervalMs) {
        resolved.logger.info('Insights threshold exceeded but cooldown active', {
          count: result.count,
          threshold: result.threshold,
        });
        return;
      }

      resolved.logger.info('Insights threshold exceeded, spawning meta-insights session', {
        count: result.count,
        threshold: result.threshold,
      });

      try {
        await resolved.spawnSession(repoPath);
      } catch (err) {
        resolved.logger.error('Failed to spawn meta-insights session', { repoPath, error: errMsg(err) });
      }

      // Update cooldown even if spawn failed to prevent retry storm
      lastTriggeredAt = resolved.now();
    },
  };
}
