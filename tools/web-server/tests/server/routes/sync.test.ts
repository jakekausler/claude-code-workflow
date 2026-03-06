import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncRoutes } from '../../../src/server/routes/sync.js';
import type { IssueSyncService, SyncConfig, SyncStatus, SyncResult } from '../../../src/server/services/issue-sync-service.js';
import type { IssueSyncScheduler } from '../../../src/server/services/issue-sync-scheduler.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

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
    interval_ms: 3600000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    id: 1,
    config_id: 1,
    last_sync_at: new Date().toISOString(),
    items_synced: 5,
    last_error: null,
    next_sync_at: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  };
}

function makeMockSyncService(
  configs: SyncConfig[] = [makeConfig()],
  statuses: SyncStatus[] = [makeStatus()],
): IssueSyncService {
  return {
    getConfigs: vi.fn().mockResolvedValue(configs),
    getConfig: vi.fn().mockImplementation(async (id: number) =>
      configs.find((c) => c.id === id) ?? null,
    ),
    createConfig: vi.fn().mockImplementation(async (data: unknown) => ({
      ...makeConfig(),
      ...(data as Partial<SyncConfig>),
    })),
    updateConfig: vi.fn().mockImplementation(async (id: number, data: unknown) => {
      const config = configs.find((c) => c.id === id);
      if (!config) return null;
      return { ...config, ...(data as Partial<SyncConfig>) };
    }),
    deleteConfig: vi.fn().mockImplementation(async (id: number) =>
      configs.some((c) => c.id === id),
    ),
    getAllStatuses: vi.fn().mockResolvedValue(statuses),
    getStatus: vi.fn().mockImplementation(async (configId: number) =>
      statuses.find((s) => s.config_id === configId) ?? null,
    ),
    syncConfig: vi.fn().mockResolvedValue({ configId: 1, imported: 2, skipped: 0, error: null }),
    syncAll: vi.fn().mockResolvedValue([]),
  } as unknown as IssueSyncService;
}

function makeMockScheduler(): IssueSyncScheduler {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    triggerSync: vi.fn().mockResolvedValue({
      configId: 1,
      imported: 3,
      skipped: 1,
      error: null,
    } as SyncResult),
    addConfig: vi.fn(),
    removeConfig: vi.fn(),
  } as unknown as IssueSyncScheduler;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('sync routes', () => {
  let app: FastifyInstance;
  let syncService: IssueSyncService;
  let syncScheduler: IssueSyncScheduler;

  beforeEach(async () => {
    syncService = makeMockSyncService();
    syncScheduler = makeMockScheduler();

    app = Fastify({ logger: false });
    await app.register(syncRoutes, { syncService, syncScheduler });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/sync/configs', () => {
    it('returns all configs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sync/configs',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.configs).toHaveLength(1);
      expect(body.configs[0].provider).toBe('github');
    });
  });

  describe('POST /api/sync/configs', () => {
    it('creates a new config', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/configs',
        payload: {
          repo_id: 1,
          provider: 'github',
          remote_owner: 'test',
          remote_repo: 'repo',
          enabled: true,
          interval_ms: 7200000,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.config).toBeTruthy();
      expect(syncService.createConfig).toHaveBeenCalled();
      expect(syncScheduler.addConfig).toHaveBeenCalled();
    });

    it('rejects invalid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/configs',
        payload: {
          // Missing required fields
          provider: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/sync/configs/:id', () => {
    it('updates an existing config', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/sync/configs/1',
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      expect(syncService.updateConfig).toHaveBeenCalledWith(1, { enabled: false });
      expect(syncScheduler.removeConfig).toHaveBeenCalledWith(1);
      expect(syncScheduler.addConfig).toHaveBeenCalled();
    });

    it('returns 404 for non-existent config', async () => {
      (syncService.updateConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/sync/configs/9999',
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/sync/configs/:id', () => {
    it('deletes an existing config', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sync/configs/1',
      });

      expect(res.statusCode).toBe(200);
      expect(syncScheduler.removeConfig).toHaveBeenCalledWith(1);
      expect(syncService.deleteConfig).toHaveBeenCalledWith(1);
    });

    it('returns 404 for non-existent config', async () => {
      (syncService.deleteConfig as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sync/configs/9999',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/sync/configs/:id/trigger', () => {
    it('triggers immediate sync', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/configs/1/trigger',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.result.imported).toBe(3);
      expect(syncScheduler.triggerSync).toHaveBeenCalledWith(1);
    });

    it('returns 404 for non-existent config', async () => {
      (syncScheduler.triggerSync as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Sync config 9999 not found'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/configs/9999/trigger',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/sync/status', () => {
    it('returns all statuses', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sync/status',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.statuses).toHaveLength(1);
      expect(body.statuses[0].items_synced).toBe(5);
    });
  });

  describe('GET /api/sync/status/:id', () => {
    it('returns status for a specific config', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sync/status/1',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBeTruthy();
      expect(body.status.config_id).toBe(1);
    });

    it('returns null status for config with no sync history', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sync/status/9999',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBeNull();
    });
  });
});
