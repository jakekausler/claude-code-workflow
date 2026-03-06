import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCronScheduler, type CronJob, type CronSchedulerDeps } from '../src/cron.js';

// ---------- Test helpers ----------

function makeLogger(): CronSchedulerDeps['logger'] & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    name: 'test-job',
    enabled: true,
    intervalMs: 1000,
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------- Tests ----------

describe('createCronScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start and stop lifecycle', () => {
    it('starts and stops cleanly', () => {
      const logger = makeLogger();
      const scheduler = createCronScheduler([], { logger });

      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('throws if started while already running', () => {
      const scheduler = createCronScheduler([]);

      scheduler.start();
      expect(() => scheduler.start()).toThrow('Cron scheduler already running');

      scheduler.stop();
    });

    it('stop is idempotent when not running', () => {
      const scheduler = createCronScheduler([]);

      // Should not throw
      scheduler.stop();
      scheduler.stop();
    });

    it('logs start and stop events', () => {
      const logger = makeLogger();
      const scheduler = createCronScheduler([], { logger });

      scheduler.start();
      expect(logger.info).toHaveBeenCalledWith(
        'Cron scheduler started',
        expect.objectContaining({ jobCount: 0 }),
      );

      scheduler.stop();
      expect(logger.info).toHaveBeenCalledWith('Cron scheduler stopped');
    });
  });

  describe('isRunning', () => {
    it('returns false before start', () => {
      const scheduler = createCronScheduler([]);
      expect(scheduler.isRunning()).toBe(false);
    });

    it('returns true after start', () => {
      const scheduler = createCronScheduler([]);
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
      scheduler.stop();
    });

    it('returns false after stop', () => {
      const scheduler = createCronScheduler([]);
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('enabled jobs execute at intervals', () => {
    it('executes a job after its interval', async () => {
      const logger = makeLogger();
      const job = makeJob({ intervalMs: 5000 });
      const scheduler = createCronScheduler([job], { logger });

      scheduler.start();

      // No execution before interval
      expect(job.execute).not.toHaveBeenCalled();

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(5000);
      expect(job.execute).toHaveBeenCalledTimes(1);

      // Advance past a second interval
      await vi.advanceTimersByTimeAsync(5000);
      expect(job.execute).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it('executes multiple enabled jobs independently', async () => {
      const logger = makeLogger();
      const jobA = makeJob({ name: 'job-a', intervalMs: 1000 });
      const jobB = makeJob({ name: 'job-b', intervalMs: 3000 });
      const scheduler = createCronScheduler([jobA, jobB], { logger });

      scheduler.start();

      await vi.advanceTimersByTimeAsync(3000);

      // jobA should have fired 3 times (at 1000, 2000, 3000)
      expect(jobA.execute).toHaveBeenCalledTimes(3);
      // jobB should have fired 1 time (at 3000)
      expect(jobB.execute).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('logs job completion with duration', async () => {
      let time = 0;
      const nowFn = () => time;
      const logger = makeLogger();
      const job = makeJob({
        intervalMs: 1000,
        execute: vi.fn(async () => {
          // Simulate 50ms of work
          time += 50;
        }),
      });
      const scheduler = createCronScheduler([job], { logger, now: nowFn });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(logger.info).toHaveBeenCalledWith(
        'Cron job completed',
        expect.objectContaining({ job: 'test-job', durationMs: 50 }),
      );

      scheduler.stop();
    });
  });

  describe('disabled jobs never execute', () => {
    it('skips disabled jobs', async () => {
      const logger = makeLogger();
      const job = makeJob({ enabled: false });
      const scheduler = createCronScheduler([job], { logger });

      scheduler.start();

      // Advance well past multiple intervals
      await vi.advanceTimersByTimeAsync(10000);

      expect(job.execute).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('logs that disabled jobs are skipped', () => {
      const logger = makeLogger();
      const job = makeJob({ name: 'disabled-job', enabled: false });
      const scheduler = createCronScheduler([job], { logger });

      scheduler.start();

      expect(logger.info).toHaveBeenCalledWith(
        'Cron job disabled, skipping',
        expect.objectContaining({ job: 'disabled-job' }),
      );

      scheduler.stop();
    });

    it('only executes enabled jobs in a mixed set', async () => {
      const logger = makeLogger();
      const enabledJob = makeJob({ name: 'enabled', enabled: true, intervalMs: 1000 });
      const disabledJob = makeJob({ name: 'disabled', enabled: false, intervalMs: 1000 });
      const scheduler = createCronScheduler([enabledJob, disabledJob], { logger });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(3000);

      expect(enabledJob.execute).toHaveBeenCalledTimes(3);
      expect(disabledJob.execute).not.toHaveBeenCalled();

      scheduler.stop();
    });
  });

  describe('error isolation', () => {
    it('logs job errors but does not stop other jobs', async () => {
      const logger = makeLogger();
      const failingJob = makeJob({
        name: 'failing',
        intervalMs: 1000,
        execute: vi.fn().mockRejectedValue(new Error('job crashed')),
      });
      const healthyJob = makeJob({
        name: 'healthy',
        intervalMs: 1000,
      });
      const scheduler = createCronScheduler([failingJob, healthyJob], { logger });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(3000);

      // Failing job should have been called but errored
      expect(failingJob.execute).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledWith(
        'Cron job failed',
        expect.objectContaining({ job: 'failing', error: 'job crashed' }),
      );

      // Healthy job should still be executing normally
      expect(healthyJob.execute).toHaveBeenCalledTimes(3);

      // Scheduler should still be running
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
    });

    it('handles non-Error rejections', async () => {
      const logger = makeLogger();
      const job = makeJob({
        intervalMs: 1000,
        execute: vi.fn().mockRejectedValue('string error'),
      });
      const scheduler = createCronScheduler([job], { logger });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(logger.error).toHaveBeenCalledWith(
        'Cron job failed',
        expect.objectContaining({ error: 'string error' }),
      );

      scheduler.stop();
    });
  });

  describe('overlapping execution prevention', () => {
    it('skips next interval if job is still executing', async () => {
      const logger = makeLogger();
      let resolveExecute: () => void;
      let executeCallCount = 0;

      const job = makeJob({
        name: 'slow-job',
        intervalMs: 1000,
        execute: vi.fn(() => {
          executeCallCount++;
          if (executeCallCount === 1) {
            // First call: return a long-running promise
            return new Promise<void>((resolve) => {
              resolveExecute = resolve;
            });
          }
          // Subsequent calls resolve immediately
          return Promise.resolve();
        }),
      });

      const scheduler = createCronScheduler([job], { logger });

      scheduler.start();

      // First interval fires, job starts executing
      await vi.advanceTimersByTimeAsync(1000);
      expect(job.execute).toHaveBeenCalledTimes(1);

      // Second interval fires while first is still running — should skip
      await vi.advanceTimersByTimeAsync(1000);
      // execute was only called once because the overlap guard prevented re-entry
      expect(job.execute).toHaveBeenCalledTimes(1);

      // Should have logged the skip
      expect(logger.warn).toHaveBeenCalledWith(
        'Cron job still executing, skipping interval',
        expect.objectContaining({ job: 'slow-job' }),
      );

      // Resolve the first execution
      resolveExecute!();
      await vi.advanceTimersByTimeAsync(0);

      // Third interval fires — job should execute again
      await vi.advanceTimersByTimeAsync(1000);
      expect(job.execute).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });

  describe('stop behavior', () => {
    it('stops all timers so no more jobs execute', async () => {
      const job = makeJob({ intervalMs: 1000 });
      const scheduler = createCronScheduler([job]);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(job.execute).toHaveBeenCalledTimes(2);

      scheduler.stop();

      // Advance more time — no additional calls
      await vi.advanceTimersByTimeAsync(5000);
      expect(job.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('default deps', () => {
    it('works with no deps provided', async () => {
      const job = makeJob({ intervalMs: 1000 });
      const scheduler = createCronScheduler([job]);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(job.execute).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });
});
