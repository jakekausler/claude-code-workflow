import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { IssueSyncService, type FetchFn, type SyncConfig } from '../../../src/server/services/issue-sync-service.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

let testDir: string;
let testCounter = 0;

const SETTINGS_DIR = join(homedir(), '.config', 'kanban-workflow');
const SYNC_CONFIGS_PATH = join(SETTINGS_DIR, 'sync-configs.json');
const SYNC_STATUS_PATH = join(SETTINGS_DIR, 'sync-status.json');

function makeGitHubResponse(issues: Array<{ number: number; title: string }>) {
  return issues.map((i) => ({
    id: i.number * 100,
    number: i.number,
    title: i.title,
    body: `Body for ${i.title}`,
    state: 'open',
    labels: [{ name: 'bug' }],
    html_url: `https://github.com/owner/repo/issues/${i.number}`,
  }));
}

function makeGitLabResponse(issues: Array<{ iid: number; title: string }>) {
  return issues.map((i) => ({
    id: i.iid * 100,
    iid: i.iid,
    title: i.title,
    description: `Description for ${i.title}`,
    state: 'opened',
    labels: ['enhancement'],
    web_url: `https://gitlab.com/owner/repo/-/issues/${i.iid}`,
  }));
}

function makeMockFetch(responseBody: unknown, ok = true): FetchFn {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    text: () => Promise.resolve(JSON.stringify(responseBody)),
    json: () => Promise.resolve(responseBody),
  });
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
    interval_ms: 3600000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('IssueSyncService', () => {
  beforeEach(() => {
    testCounter++;
    testDir = join(tmpdir(), `issue-sync-test-${Date.now()}-${testCounter}`);
    mkdirSync(testDir, { recursive: true });
    // Reset shared local config/status files to avoid cross-test contamination
    if (existsSync(SETTINGS_DIR)) {
      writeFileSync(SYNC_CONFIGS_PATH, '[]', 'utf-8');
      writeFileSync(SYNC_STATUS_PATH, '[]', 'utf-8');
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('syncConfig - GitHub fetch behavior', () => {
    it('calls GitHub API with correct URL and headers', async () => {
      const ghIssues = makeGitHubResponse([
        { number: 1, title: 'Fix bug' },
        { number: 2, title: 'Add feature' },
      ]);
      const mockFetch = makeMockFetch(ghIssues);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      const config = makeConfig();
      const result = await service.syncConfig(config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('api.github.com/repos/owner/repo/issues');
      expect(fetchUrl).toContain('state=open');
      expect(fetchUrl).toContain('per_page=50');
      expect(result.error).toBeNull();
    });

    it('includes authorization header when token is provided', async () => {
      const mockFetch = makeMockFetch([]);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      await service.syncConfig(makeConfig({ token: 'ghp_test123' }));

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe('Bearer ghp_test123');
    });

    it('does not include auth header when no token', async () => {
      const mockFetch = makeMockFetch([]);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      await service.syncConfig(makeConfig({ token: null }));

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBeUndefined();
    });
  });

  describe('syncConfig - GitLab fetch behavior', () => {
    it('calls GitLab API with correct URL', async () => {
      const glIssues = makeGitLabResponse([
        { iid: 1, title: 'GitLab issue 1' },
      ]);
      const mockFetch = makeMockFetch(glIssues);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      const config = makeConfig({
        provider: 'gitlab',
        instance_url: 'https://gitlab.example.com',
      });
      await service.syncConfig(config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('gitlab.example.com/api/v4/projects');
      expect(fetchUrl).toContain('state=opened');
    });

    it('uses PRIVATE-TOKEN header for GitLab', async () => {
      const mockFetch = makeMockFetch([]);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      await service.syncConfig(
        makeConfig({ provider: 'gitlab', token: 'glpat-test' }),
      );

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers['PRIVATE-TOKEN']).toBe('glpat-test');
    });

    it('defaults to gitlab.com when no instance_url', async () => {
      const mockFetch = makeMockFetch([]);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      await service.syncConfig(
        makeConfig({ provider: 'gitlab', instance_url: null }),
      );

      const fetchUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(fetchUrl).toContain('gitlab.com/api/v4');
    });
  });

  describe('syncConfig - error handling', () => {
    it('captures API errors and returns them in result', async () => {
      const mockFetch = makeMockFetch('Server Error', false);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      const result = await service.syncConfig(makeConfig());

      expect(result.error).toBeTruthy();
      expect(result.imported).toBe(0);
    });

    it('returns zero imports for configs with no owner/repo', async () => {
      const mockFetch = makeMockFetch([]);
      const service = new IssueSyncService({ fetchFn: mockFetch });

      const result = await service.syncConfig(
        makeConfig({ remote_owner: null, remote_repo: null }),
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.imported).toBe(0);
    });
  });

  describe('syncConfig - PR filtering', () => {
    it('filters out pull requests from GitHub response', async () => {
      const ghIssues = [
        {
          id: 100,
          number: 1,
          title: 'Issue',
          body: null,
          state: 'open',
          labels: [],
          html_url: 'https://github.com/owner/repo/issues/1',
        },
        {
          id: 200,
          number: 2,
          title: 'PR',
          body: null,
          state: 'open',
          labels: [],
          html_url: 'https://github.com/owner/repo/pull/2',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/2' },
        },
      ];
      const mockFetch = makeMockFetch(ghIssues);
      // Use a mock dataService with empty ticket list to avoid filesystem interaction
      const mockDataService = {
        repos: { findAll: vi.fn().mockResolvedValue([{ id: 1, path: testDir, name: 'test' }]) },
        tickets: { listByRepo: vi.fn().mockResolvedValue([]) },
      };
      const service = new IssueSyncService({
        fetchFn: mockFetch,
        dataService: mockDataService as any,
      });

      const result = await service.syncConfig(makeConfig());

      // Only the real issue (not the PR) should be imported
      expect(result.imported).toBe(1);
    });
  });

  describe('syncConfig - label filtering', () => {
    it('filters issues by configured labels', async () => {
      const ghIssues = [
        {
          id: 100,
          number: 10,
          title: 'Bug with label',
          body: null,
          state: 'open',
          labels: [{ name: 'bug' }],
          html_url: 'https://github.com/owner/repo/issues/10',
        },
        {
          id: 200,
          number: 20,
          title: 'Feature no matching label',
          body: null,
          state: 'open',
          labels: [{ name: 'feature' }],
          html_url: 'https://github.com/owner/repo/issues/20',
        },
      ];
      const mockFetch = makeMockFetch(ghIssues);
      const mockDataService = {
        repos: { findAll: vi.fn().mockResolvedValue([{ id: 1, path: testDir, name: 'test' }]) },
        tickets: { listByRepo: vi.fn().mockResolvedValue([]) },
      };
      const service = new IssueSyncService({
        fetchFn: mockFetch,
        dataService: mockDataService as any,
      });

      const result = await service.syncConfig(
        makeConfig({ labels: ['bug'] }),
      );

      // Only the issue with 'bug' label should be imported
      expect(result.imported).toBe(1);
    });
  });

  describe('syncConfig - duplicate detection', () => {
    it('skips issues that already exist as tickets', async () => {
      const ghIssues = makeGitHubResponse([
        { number: 42, title: 'Already imported' },
        { number: 43, title: 'New issue' },
      ]);
      const mockFetch = makeMockFetch(ghIssues);
      // Simulate existing ticket with source_id matching issue 42
      const mockDataService = {
        repos: { findAll: vi.fn().mockResolvedValue([{ id: 1, path: testDir, name: 'test' }]) },
        tickets: { listByRepo: vi.fn().mockResolvedValue([]) },
      };
      const service = new IssueSyncService({
        fetchFn: mockFetch,
        dataService: mockDataService as any,
      });

      // First sync: both should be imported
      const result1 = await service.syncConfig(makeConfig());
      expect(result1.imported).toBe(2);

      // Second sync: both should be skipped (files now exist)
      const result2 = await service.syncConfig(makeConfig());
      expect(result2.imported).toBe(0);
      expect(result2.skipped).toBe(2);
    });
  });

  describe('syncAll', () => {
    it('skips disabled configs', async () => {
      const ghIssues = makeGitHubResponse([{ number: 100, title: 'Test' }]);
      const mockFetch = makeMockFetch(ghIssues);

      // Create a fresh service isolated from other tests
      const service = new IssueSyncService({ fetchFn: mockFetch });

      // Manually create configs: one enabled, one disabled
      const enabled = await service.createConfig({
        repo_id: 1,
        provider: 'github',
        remote_owner: 'a',
        remote_repo: 'b',
        instance_url: null,
        token: null,
        labels: [],
        milestones: [],
        assignees: [],
        enabled: true,
        interval_ms: 3600000,
      });
      await service.createConfig({
        repo_id: 1,
        provider: 'github',
        remote_owner: 'c',
        remote_repo: 'd',
        instance_url: null,
        token: null,
        labels: [],
        milestones: [],
        assignees: [],
        enabled: false,
        interval_ms: 3600000,
      });

      const results = await service.syncAll();

      // Only the enabled config should have produced a result
      expect(results).toHaveLength(1);
      expect(results[0].configId).toBe(enabled.id);
    });
  });

  describe('local config CRUD', () => {
    it('creates and retrieves a config', async () => {
      const service = new IssueSyncService({ fetchFn: makeMockFetch([]) });

      const created = await service.createConfig({
        repo_id: 1,
        provider: 'github',
        remote_owner: 'test',
        remote_repo: 'repo',
        instance_url: null,
        token: null,
        labels: [],
        milestones: [],
        assignees: [],
        enabled: true,
        interval_ms: 3600000,
      });

      expect(created.id).toBeGreaterThan(0);
      expect(created.provider).toBe('github');

      const found = await service.getConfig(created.id);
      expect(found).toBeTruthy();
      expect(found!.remote_owner).toBe('test');
    });

    it('returns null for non-existent config', async () => {
      const service = new IssueSyncService({ fetchFn: makeMockFetch([]) });
      const found = await service.getConfig(9999);
      expect(found).toBeNull();
    });

    it('deletes a config', async () => {
      const service = new IssueSyncService({ fetchFn: makeMockFetch([]) });

      const created = await service.createConfig({
        repo_id: 1,
        provider: 'github',
        remote_owner: 'x',
        remote_repo: 'y',
        instance_url: null,
        token: null,
        labels: [],
        milestones: [],
        assignees: [],
        enabled: true,
        interval_ms: 3600000,
      });

      const deleted = await service.deleteConfig(created.id);
      expect(deleted).toBe(true);

      const found = await service.getConfig(created.id);
      expect(found).toBeNull();
    });
  });
});
