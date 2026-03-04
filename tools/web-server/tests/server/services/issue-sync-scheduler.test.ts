import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueSyncScheduler, type SyncSchedulerDeps } from '../../../src/server/services/issue-sync-scheduler.js';
import type { IssueSyncService, SyncConfig, SyncResult } from '../../../src/server/services/issue-sync-service.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeLogger(): SyncSchedulerDeps['logger'] & {
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

function makeConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    id: 1,
    repo_id: 1,
    provider: 'github',
    remote_owner: 'owner',
    remote_repo: 'repo',
    instance_url: null,
    token: null,
    labels: [],
    milestones: [],
    assignees: [],
    enabled: true,
    interval_ms: 5000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    configId: 1,
    imported: 2,
    skipped: 0,
    error: null,
    ...overrides,
  };
}

function makeMockSyncService(
  configs: SyncConfig[] = [],
  syncResult: SyncResult = makeResult(),
): IssueSyncService {
  return {
    getConfigs: vi.fn().mockResolvedValue(configs),
    getConfig: vi.fn().mockImplementation(async (id: number) =>
      configs.find((c) => c.id === id) ?? null,
    ),
    syncConfig: vi.fn().mockResolvedValue(syncResult),
    createConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    getAllStatuses: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(null),
    syncAll: vi.fn().mockResolvedValue([]),
  } as unknown as IssueSyncService;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('IssueSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start and stop lifecycle', () => {
    it('starts and stops cleanly', async () => {
      const logger = makeLogger();
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service, { logger });

      expect(scheduler.isRunning()).toBe(false);

      await scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('throws if started while already running', async () => {
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service);

      await scheduler.start();
      await expect(scheduler.start()).rejects.toThrow('IssueSyncScheduler already running');

      scheduler.stop();
    });

    it('stop is idempotent when not running', () => {
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service);

      scheduler.stop();
      scheduler.stop();
    });

    it('logs start and stop events', async () => {
      const logger = makeLogger();
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service, { logger });

      await scheduler.start();
      expect(logger.info).toHaveBeenCalledWith(
        'IssueSyncScheduler started',
        expect.objectContaining({ configCount: 0 }),
      );

      scheduler.stop();
      expect(logger.info).toHaveBeenCalledWith('IssueSyncScheduler stopped');
    });
  });

  describe('scheduled execution', () => {
    it('executes sync after interval', async () => {
      const logger = makeLogger();
      const config = makeConfig({ intervalMs: 5000 });
      const service = makeMockSyncService([config]);
      const scheduler = new IssueSyncScheduler(service, { logger });

      await scheduler.start();

      // No execution before interval
      expect(service.syncConfig).not.toHaveBeenCalled();

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(5000);
      expect(service.syncConfig).toHaveBeenCalledTimes(1);

      // Advance past second interval
      await vi.advanceTimersByTimeAsync(5000);
      expect(service.syncConfig).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it('skips disabled configs', async () => {
      const logger = makeLogger();
      const config = makeConfig({ enabled: false });
      const service = makeMockSyncService([config]);
      const scheduler = new IssueSyncScheduler(service, { logger });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(service.syncConfig).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Sync config disabled, skipping',
        expect.objectContaining({ configId: config.id }),
      );

      scheduler.stop();
    });
  });

  describe('overlap guard', () => {
    it('skips next interval if sync is still running', async () => {
      const logger = makeLogger();
      const config = makeConfig({ interval_ms: 1000 });

      let resolveSync: (value: SyncResult) => void;
      let syncCallCount = 0;

      const service = makeMockSyncService([config]);
      (service.syncConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
        syncCallCount++;
        if (syncCallCount === 1) {
          return new Promise<SyncResult>((resolve) => {
            resolveSync = resolve;
          });
        }
        return Promise.resolve(makeResult());
      });

      const scheduler = new IssueSyncScheduler(service, { logger });
      await scheduler.start();

      // First interval fires, sync starts
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.syncConfig).toHaveBeenCalledTimes(1);

      // Second interval fires while first is still running
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.syncConfig).toHaveBeenCalledTimes(1);

      expect(logger.warn).toHaveBeenCalledWith(
        'Sync job still running, skipping interval',
        expect.objectContaining({ configId: config.id }),
      );

      // Resolve first sync
      resolveSync!(makeResult());
      await vi.advanceTimersByTimeAsync(0);

      // Third interval should execute
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.syncConfig).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });

  describe('error isolation', () => {
    it('logs sync errors but scheduler keeps running', async () => {
      const logger = makeLogger();
      const config = makeConfig({ interval_ms: 1000 });
      const service = makeMockSyncService([config]);
      (service.syncConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API down'),
      );

      const scheduler = new IssueSyncScheduler(service, { logger });
      await scheduler.start();

      await vi.advanceTimersByTimeAsync(3000);

      expect(service.syncConfig).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledWith(
        'Sync job failed',
        expect.objectContaining({ configId: config.id, error: 'API down' }),
      );
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
    });
  });

  describe('triggerSync', () => {
    it('triggers immediate sync for a config', async () => {
      const logger = makeLogger();
      const config = makeConfig();
      const service = makeMockSyncService([config]);
      const scheduler = new IssueSyncScheduler(service, { logger });

      const result = await scheduler.triggerSync(config.id);

      expect(service.syncConfig).toHaveBeenCalledWith(config);
      expect(result.imported).toBe(2);
      expect(logger.info).toHaveBeenCalledWith(
        'Manual sync triggered',
        expect.objectContaining({ configId: config.id }),
      );
    });

    it('throws for non-existent config', async () => {
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service);

      await expect(scheduler.triggerSync(9999)).rejects.toThrow(
        'Sync config 9999 not found',
      );
    });
  });

  describe('dynamic config management', () => {
    it('addConfig schedules a new job', async () => {
      const logger = makeLogger();
      const service = makeMockSyncService();
      const scheduler = new IssueSyncScheduler(service, { logger });

      await scheduler.start();

      const config = makeConfig({ id: 5, interval_ms: 2000 });
      scheduler.addConfig(config);

      expect(logger.info).toHaveBeenCalledWith(
        'Sync job scheduled',
        expect.objectContaining({ configId: 5 }),
      );

      await vi.advanceTimersByTimeAsync(2000);
      expect(service.syncConfig).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('removeConfig stops the job', async () => {
      const logger = makeLogger();
      const config = makeConfig({ interval_ms: 1000 });
      const service = makeMockSyncService([config]);
      const scheduler = new IssueSyncScheduler(service, { logger });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.syncConfig).toHaveBeenCalledTimes(1);

      scheduler.removeConfig(config.id);

      await vi.advanceTimersByTimeAsync(5000);
      // No additional calls after removal
      expect(service.syncConfig).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Sync job removed',
        expect.objectContaining({ configId: config.id }),
      );

      scheduler.stop();
    });
  });

  describe('stop behavior', () => {
    it('stops all timers so no more syncs execute', async () => {
      const config = makeConfig({ interval_ms: 1000 });
      const service = makeMockSyncService([config]);
      const scheduler = new IssueSyncScheduler(service);

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(2000);
      expect(service.syncConfig).toHaveBeenCalledTimes(2);

      scheduler.stop();

      await vi.advanceTimersByTimeAsync(5000);
      expect(service.syncConfig).toHaveBeenCalledTimes(2);
    });
  });
});
