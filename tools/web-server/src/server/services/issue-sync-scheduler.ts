import type { IssueSyncService, SyncConfig, SyncResult } from './issue-sync-service.js';

/**
 * Injectable dependencies for the sync scheduler.
 */
export interface SyncSchedulerDeps {
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
}

const defaultDeps: SyncSchedulerDeps = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Interval-based scheduler for issue sync jobs.
 *
 * Modeled after the CronScheduler in tools/orchestrator/src/cron.ts:
 * - Overlap guard: skips if previous sync still running
 * - Error isolation: catch errors per job, don't crash scheduler
 * - Start/stop lifecycle
 */
export class IssueSyncScheduler {
  private jobs = new Map<number, {
    config: SyncConfig;
    timer: ReturnType<typeof setInterval>;
    running: boolean;
  }>();
  private syncService: IssueSyncService;
  private logger: SyncSchedulerDeps['logger'];
  private started = false;

  constructor(
    syncService: IssueSyncService,
    deps: Partial<SyncSchedulerDeps> = {},
  ) {
    this.syncService = syncService;
    this.logger = { ...defaultDeps.logger, ...deps.logger };
  }

  /**
   * Load configs and start interval timers for each enabled config.
   */
  async start(): Promise<void> {
    if (this.started) throw new Error('IssueSyncScheduler already running');
    this.started = true;

    const configs = await this.syncService.getConfigs();
    this.logger.info('IssueSyncScheduler started', { configCount: configs.length });

    for (const config of configs) {
      if (!config.enabled) {
        this.logger.info('Sync config disabled, skipping', { configId: config.id });
        continue;
      }
      this.scheduleJob(config);
    }
  }

  /**
   * Stop all timers.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const [, job] of this.jobs) {
      clearInterval(job.timer);
    }
    this.jobs.clear();

    this.logger.info('IssueSyncScheduler stopped');
  }

  isRunning(): boolean {
    return this.started;
  }

  /**
   * Trigger an immediate sync for a specific config.
   */
  async triggerSync(configId: number): Promise<SyncResult> {
    const config = await this.syncService.getConfig(configId);
    if (!config) {
      throw new Error(`Sync config ${configId} not found`);
    }

    this.logger.info('Manual sync triggered', { configId });
    return this.syncService.syncConfig(config);
  }

  /**
   * Add a new config to the scheduler (for dynamic config creation).
   */
  addConfig(config: SyncConfig): void {
    if (!this.started) return;
    if (!config.enabled) return;

    // Remove old timer if it exists
    const existing = this.jobs.get(config.id);
    if (existing) {
      clearInterval(existing.timer);
      this.jobs.delete(config.id);
    }

    this.scheduleJob(config);
  }

  /**
   * Remove a config from the scheduler (for dynamic config deletion).
   */
  removeConfig(configId: number): void {
    const job = this.jobs.get(configId);
    if (job) {
      clearInterval(job.timer);
      this.jobs.delete(configId);
      this.logger.info('Sync job removed', { configId });
    }
  }

  private scheduleJob(config: SyncConfig): void {
    const job = { config, timer: null as unknown as ReturnType<typeof setInterval>, running: false };

    job.timer = setInterval(() => {
      if (!this.started) return;

      // Overlap guard
      if (job.running) {
        this.logger.warn('Sync job still running, skipping interval', { configId: config.id });
        return;
      }

      job.running = true;

      this.syncService.syncConfig(config)
        .then((result) => {
          this.logger.info('Sync job completed', {
            configId: config.id,
            imported: result.imported,
            skipped: result.skipped,
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('Sync job failed', { configId: config.id, error: message });
        })
        .finally(() => {
          job.running = false;
        });
    }, config.interval_ms);

    this.jobs.set(config.id, job);
    this.logger.info('Sync job scheduled', {
      configId: config.id,
      intervalMs: config.interval_ms,
    });
  }
}
