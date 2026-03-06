/**
 * Generic timer-based cron scheduler with start/stop lifecycle.
 *
 * Runs a set of CronJobs at fixed intervals, with:
 * - Disabled job skipping
 * - Error isolation (job failures don't crash the scheduler)
 * - Per-job executing guard to prevent overlapping executions
 * - Injectable logger and now() deps
 */

/**
 * A single cron job definition.
 */
export interface CronJob {
  name: string;
  enabled: boolean;
  intervalMs: number;
  execute(): Promise<void>;
}

/**
 * Injectable dependencies for the cron scheduler.
 */
export interface CronSchedulerDeps {
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
  now?: () => number;
}

/**
 * Cron scheduler with start/stop lifecycle.
 */
export interface CronScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

const defaultDeps: CronSchedulerDeps = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Create a cron scheduler that runs the given jobs at their configured intervals.
 *
 * Disabled jobs are skipped entirely. Each job has an executing guard that prevents
 * overlapping executions — if a job is still running when its next interval fires,
 * the interval is skipped. Job errors are logged but never crash the scheduler.
 */
export function createCronScheduler(
  jobs: CronJob[],
  deps: Partial<CronSchedulerDeps> = {},
): CronScheduler {
  const { logger, now: nowFn } = { ...defaultDeps, ...deps };
  const _now = nowFn ?? Date.now;

  let running = false;
  const timers: ReturnType<typeof setInterval>[] = [];
  const executing = new Map<string, boolean>();

  return {
    start(): void {
      if (running) throw new Error('Cron scheduler already running');
      running = true;

      logger.info('Cron scheduler started', { jobCount: jobs.length });

      for (const job of jobs) {
        if (!job.enabled) {
          logger.info('Cron job disabled, skipping', { job: job.name });
          continue;
        }

        executing.set(job.name, false);

        const timer = setInterval(() => {
          if (!running) return;

          // Skip if already executing (overlap guard)
          if (executing.get(job.name)) {
            logger.warn('Cron job still executing, skipping interval', { job: job.name });
            return;
          }

          executing.set(job.name, true);
          const startTime = _now();

          job.execute()
            .then(() => {
              const durationMs = _now() - startTime;
              logger.info('Cron job completed', { job: job.name, durationMs });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              logger.error('Cron job failed', { job: job.name, error: message });
            })
            .finally(() => {
              executing.set(job.name, false);
            });
        }, job.intervalMs);

        timers.push(timer);
        logger.info('Cron job scheduled', { job: job.name, intervalMs: job.intervalMs });
      }
    },

    stop(): void {
      if (!running) return;
      running = false;

      for (const timer of timers) {
        clearInterval(timer);
      }
      timers.length = 0;

      logger.info('Cron scheduler stopped');
    },

    isRunning(): boolean {
      return running;
    },
  };
}
