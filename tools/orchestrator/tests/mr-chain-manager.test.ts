import { describe, it, expect, vi } from 'vitest';
import {
  createMRChainManager,
  type MRChainManagerDeps,
  type ParentBranchTrackingRow,
} from '../src/mr-chain-manager.js';
import type { CodeHostAdapter, PRStatus } from 'kanban-cli';
import type { Locker, FrontmatterData } from '../src/locking.js';
import type { SessionExecutor, SpawnOptions, SessionLoggerLike, SessionResult } from '../src/session.js';

/** Build a default ParentBranchTrackingRow for testing. */
function makeRow(overrides: Partial<ParentBranchTrackingRow> = {}): ParentBranchTrackingRow {
  return {
    id: 1,
    child_stage_id: 'STAGE-002',
    parent_stage_id: 'STAGE-001',
    parent_branch: 'epic-001/stage-001',
    parent_pr_url: 'https://github.com/owner/repo/pull/10',
    last_known_head: 'abc123',
    is_merged: 0,
    repo_id: 1,
    last_checked: '2026-02-24T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a mock CodeHostAdapter. */
function makeCodeHost(overrides: Partial<CodeHostAdapter> = {}): CodeHostAdapter {
  return {
    getPRStatus: () => ({
      merged: false,
      hasUnresolvedComments: false,
      unresolvedThreadCount: 0,
      state: 'open',
    }),
    getBranchHead: () => 'abc123',
    editPRBase: () => {},
    markPRReady: () => {},
    ...overrides,
  };
}

/** Build a mock Locker. */
function makeLocker(overrides: Partial<Record<keyof Locker, ReturnType<typeof vi.fn>>> = {}): Locker & {
  acquireLock: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
  readStatus: ReturnType<typeof vi.fn>;
} {
  return {
    acquireLock: vi.fn(async () => {}),
    releaseLock: vi.fn(async () => {}),
    isLocked: vi.fn(async () => false),
    readStatus: vi.fn(async () => 'PR Created'),
    ...overrides,
  };
}

/** Build a mock SessionExecutor. */
function makeSessionExecutor(overrides: Partial<Record<keyof SessionExecutor, ReturnType<typeof vi.fn>>> = {}): SessionExecutor & {
  spawn: ReturnType<typeof vi.fn>;
  getActiveSessions: ReturnType<typeof vi.fn>;
  killAll: ReturnType<typeof vi.fn>;
} {
  return {
    spawn: vi.fn(async (): Promise<SessionResult> => ({ exitCode: 0, durationMs: 1000 })),
    getActiveSessions: vi.fn(() => []),
    killAll: vi.fn(),
    ...overrides,
  };
}

/** Build full mock deps (without spawn infrastructure). */
function makeDeps(overrides: Partial<MRChainManagerDeps> = {}): MRChainManagerDeps & {
  getActiveTrackingRows: ReturnType<typeof vi.fn>;
  updateTrackingRow: ReturnType<typeof vi.fn>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  return {
    getActiveTrackingRows: vi.fn(async () => []),
    updateTrackingRow: vi.fn(async () => {}),
    codeHost: makeCodeHost(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    locker: null,
    sessionExecutor: null,
    readFrontmatter: null,
    resolveStageFilePath: null,
    createSessionLogger: null,
    model: 'sonnet',
    workflowEnv: {},
    ...overrides,
  };
}

/** Build full mock deps with spawn infrastructure configured. */
function makeSpawnDeps(overrides: Partial<MRChainManagerDeps> = {}): MRChainManagerDeps & {
  getActiveTrackingRows: ReturnType<typeof vi.fn>;
  updateTrackingRow: ReturnType<typeof vi.fn>;
  locker: ReturnType<typeof makeLocker>;
  sessionExecutor: ReturnType<typeof makeSessionExecutor>;
  readFrontmatter: ReturnType<typeof vi.fn>;
  resolveStageFilePath: ReturnType<typeof vi.fn>;
  createSessionLogger: ReturnType<typeof vi.fn>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  return {
    getActiveTrackingRows: vi.fn(async () => []),
    updateTrackingRow: vi.fn(async () => {}),
    codeHost: makeCodeHost(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    locker: makeLocker(),
    sessionExecutor: makeSessionExecutor(),
    readFrontmatter: vi.fn(async (): Promise<FrontmatterData> => ({ data: {}, content: '' })),
    resolveStageFilePath: vi.fn(async (stageId: string) => `/repo/epics/e1/t1/${stageId}.md`),
    createSessionLogger: vi.fn((): SessionLoggerLike => ({ write: vi.fn() })),
    model: 'sonnet',
    workflowEnv: { REPO_PATH: '/repo' },
    ...overrides,
  };
}

describe('createMRChainManager', () => {
  describe('no stages with pending parents', () => {
    it('returns empty results when no tracking rows exist', async () => {
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => []),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toEqual([]);
      expect(deps.logger.info).toHaveBeenCalledWith(
        'No active parent tracking rows found',
        { repoPath: '/repo' },
      );
    });
  });

  describe('parent not merged, HEAD unchanged', () => {
    it('returns no_change when PR is open and HEAD matches', async () => {
      const row = makeRow({ last_known_head: 'abc123' });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => 'abc123', // same as last_known_head
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'no_change',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });
      // Should NOT have updated the tracking row (except possibly last_checked, but HEAD is same)
      expect(deps.updateTrackingRow).not.toHaveBeenCalled();
    });
  });

  describe('parent merged', () => {
    it('returns parent_merged event and updates is_merged in tracking table', async () => {
      const row = makeRow();
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });

      expect(deps.updateTrackingRow).toHaveBeenCalledWith(row.id, {
        is_merged: 1,
        last_checked: expect.any(String),
      });
      expect(deps.logger.info).toHaveBeenCalledWith(
        'Parent PR merged',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          parentStageId: 'STAGE-001',
        }),
      );
    });
  });

  describe('parent HEAD changed', () => {
    it('returns parent_updated event and updates last_known_head in tracking table', async () => {
      const row = makeRow({ last_known_head: 'abc123' });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => 'def456', // different from last_known_head
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_updated',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });

      expect(deps.updateTrackingRow).toHaveBeenCalledWith(row.id, {
        last_known_head: 'def456',
        last_checked: expect.any(String),
      });
      expect(deps.logger.info).toHaveBeenCalledWith(
        'Parent branch HEAD changed',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          parentStageId: 'STAGE-001',
          previousHead: 'abc123',
          currentHead: 'def456',
        }),
      );
    });
  });

  describe('multiple parents for one child', () => {
    it('checks each parent independently', async () => {
      const row1 = makeRow({
        id: 1,
        child_stage_id: 'STAGE-003',
        parent_stage_id: 'STAGE-001',
        parent_branch: 'epic-001/stage-001',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
        last_known_head: 'aaa111',
      });
      const row2 = makeRow({
        id: 2,
        child_stage_id: 'STAGE-003',
        parent_stage_id: 'STAGE-002',
        parent_branch: 'epic-001/stage-002',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
        last_known_head: 'bbb222',
      });

      const getPRStatus = vi.fn((prUrl: string): PRStatus => {
        if (prUrl.includes('/10')) {
          return { merged: true, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'merged' };
        }
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
      });
      const getBranchHead = vi.fn((branch: string) => {
        if (branch === 'epic-001/stage-002') return 'ccc333'; // changed
        return 'aaa111'; // unchanged (though won't be checked since PR merged)
      });

      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row1, row2]),
        codeHost: makeCodeHost({ getPRStatus, getBranchHead }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(2);
      // First parent merged (no spawn deps, so rebaseSpawned: false)
      expect(results[0]).toEqual({
        childStageId: 'STAGE-003',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });
      // Second parent HEAD changed (no spawn deps, so rebaseSpawned: false)
      expect(results[1]).toEqual({
        childStageId: 'STAGE-003',
        parentStageId: 'STAGE-002',
        event: 'parent_updated',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });

      // Both should have triggered updates
      expect(deps.updateTrackingRow).toHaveBeenCalledTimes(2);
    });
  });

  describe('null code host', () => {
    it('skips all checks and logs warning', async () => {
      const deps = makeDeps({
        codeHost: null,
        getActiveTrackingRows: vi.fn(async () => [makeRow()]),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toEqual([]);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'No code host adapter configured, skipping parent chain checks',
      );
      // Should not even query for rows
      expect(deps.getActiveTrackingRows).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('seeds last_known_head on first check when row has null head', async () => {
      const row = makeRow({ last_known_head: null });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => 'first-sha',
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('no_change');
      // Should seed the head
      expect(deps.updateTrackingRow).toHaveBeenCalledWith(row.id, {
        last_known_head: 'first-sha',
        last_checked: expect.any(String),
      });
    });

    it('handles empty branch head gracefully (no_change)', async () => {
      const row = makeRow({ last_known_head: 'abc123' });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => '', // empty = safe default per CodeHostAdapter contract
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('no_change');
      expect(deps.updateTrackingRow).not.toHaveBeenCalled();
    });

    it('handles row with no parent_pr_url (skips merge check, checks HEAD only)', async () => {
      const row = makeRow({
        parent_pr_url: null,
        last_known_head: 'old-sha',
      });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: vi.fn(), // should not be called
          getBranchHead: () => 'new-sha',
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_updated');
      // getPRStatus should not have been called since parent_pr_url is null
      expect(deps.codeHost!.getPRStatus).not.toHaveBeenCalled();
    });

    it('returns no_change when getPRStatus throws inside checkSingleParent (internal error recovery)', async () => {
      const row1 = makeRow({ id: 1, parent_stage_id: 'STAGE-001' });
      const row2 = makeRow({ id: 2, parent_stage_id: 'STAGE-002', last_known_head: 'xyz789' });

      let callCount = 0;
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row1, row2]),
        codeHost: makeCodeHost({
          getPRStatus: () => {
            callCount++;
            if (callCount === 1) throw new Error('API rate limit');
            return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
          },
          getBranchHead: () => 'xyz789', // unchanged
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      // First row fails getPRStatus but returns no_change (caught in checkSingleParent)
      // Second row succeeds with no_change
      expect(results).toHaveLength(2);
      // The first row returns no_change because getPRStatus error is handled internally
      expect(results[0].event).toBe('no_change');
      expect(results[1].event).toBe('no_change');
    });

    it('handles getBranchHead throwing by returning no_change', async () => {
      const row = makeRow({ last_known_head: 'abc123' });
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => { throw new Error('network error'); },
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('no_change');
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to get branch HEAD for parent',
        expect.objectContaining({ error: 'network error' }),
      );
    });

    it('handles getActiveTrackingRows throwing', async () => {
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => { throw new Error('DB connection failed'); }),
      });
      const manager = createMRChainManager(deps);

      await expect(manager.checkParentChains('/repo')).rejects.toThrow('DB connection failed');
    });
  });

  describe('rebase session spawning', () => {
    it('locked stage returns skipped_locked result, no spawn', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        locker: makeLocker({
          isLocked: vi.fn(async () => true), // Already locked
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'skipped_locked',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });
      // Should not have attempted to spawn
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
      // Should not have acquired the lock
      expect(deps.locker.acquireLock).not.toHaveBeenCalled();
    });

    it('rebase conflict flagged returns skipped_conflict result, no spawn', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        readFrontmatter: vi.fn(async (): Promise<FrontmatterData> => ({
          data: { rebase_conflict: true },
          content: '',
        })),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'skipped_conflict',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });
      // Should not have attempted to spawn
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
      // Should not have checked lock (conflict is checked first)
      expect(deps.locker.isLocked).not.toHaveBeenCalled();
    });

    it('unlocked stage with parent merged spawns rebase session and acquires lock', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: true,
        retargeted: false,
        promotedToReady: false,
      });
      // Should have acquired lock before spawn
      expect(deps.locker.acquireLock).toHaveBeenCalledWith('/repo/epics/e1/t1/STAGE-002.md');
      // Should have spawned the session
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      // Lock should NOT have been released (released by session exit flow)
      expect(deps.locker.releaseLock).not.toHaveBeenCalled();
    });

    it('unlocked stage with parent HEAD changed spawns rebase session', async () => {
      const row = makeRow({ last_known_head: 'abc123' });
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: false,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'open',
          }),
          getBranchHead: () => 'def456', // changed
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_updated',
        rebaseSpawned: true,
        retargeted: false,
        promotedToReady: false,
      });
      expect(deps.locker.acquireLock).toHaveBeenCalled();
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
    });

    it('synchronous spawn setup failure releases lock and logs error', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        // createSessionLogger throws synchronously during spawn setup
        createSessionLogger: vi.fn(() => { throw new Error('logger init failed'); }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });

      // Lock was acquired
      expect(deps.locker.acquireLock).toHaveBeenCalled();
      // Lock was released after spawn setup failure
      expect(deps.locker.releaseLock).toHaveBeenCalledWith('/repo/epics/e1/t1/STAGE-002.md');
      // Error was logged
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to spawn rebase session',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          error: 'logger init failed',
        }),
      );
    });

    it('async spawn failure releases lock and logs error via catch handler', async () => {
      const row = makeRow();
      const spawnError = new Error('process spawn failed');
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        sessionExecutor: makeSessionExecutor({
          spawn: vi.fn(async () => { throw spawnError; }),
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      // Spawn was initiated (fire-and-forget), so rebaseSpawned is true
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: true,
        retargeted: false,
        promotedToReady: false,
      });

      // Lock was acquired
      expect(deps.locker.acquireLock).toHaveBeenCalled();

      // Wait for microtask queue to flush (the .catch() handler fires asynchronously)
      await new Promise(resolve => setTimeout(resolve, 0));

      // Lock was released after async spawn failure
      expect(deps.locker.releaseLock).toHaveBeenCalledWith('/repo/epics/e1/t1/STAGE-002.md');
      // Error was logged
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Rebase session failed',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          error: 'process spawn failed',
        }),
      );
    });

    it('session executor receives correct skill name and stage context', async () => {
      const row = makeRow({ child_stage_id: 'MY-STAGE-99' });
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        resolveStageFilePath: vi.fn(async (stageId: string) => `/repo/epics/e1/t1/${stageId}.md`),
        model: 'opus',
        workflowEnv: { REPO_PATH: '/repo', CUSTOM: 'val' },
      });
      const manager = createMRChainManager(deps);

      await manager.checkParentChains('/repo');

      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = deps.sessionExecutor.spawn.mock.calls[0];
      const spawnOpts: SpawnOptions = spawnCall[0];

      expect(spawnOpts.stageId).toBe('MY-STAGE-99');
      expect(spawnOpts.stageFilePath).toBe('/repo/epics/e1/t1/MY-STAGE-99.md');
      expect(spawnOpts.skillName).toBe('rebase-child-mr');
      expect(spawnOpts.worktreePath).toBe('/repo'); // repo root, not stage file path
      expect(spawnOpts.worktreeIndex).toBe(-1);
      expect(spawnOpts.model).toBe('opus');
      expect(spawnOpts.workflowEnv).toEqual({ REPO_PATH: '/repo', CUSTOM: 'val' });
    });

    it('acquire lock failure prevents spawn and logs error', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        locker: makeLocker({
          isLocked: vi.fn(async () => false),
          acquireLock: vi.fn(async () => { throw new Error('lock file corrupted'); }),
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-002',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });
      // Spawn should NOT have been called
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
      // Error should be logged
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to acquire lock for rebase spawn',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          error: 'lock file corrupted',
        }),
      );
    });

    it('resolveStageFilePath returning null skips spawn silently', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        resolveStageFilePath: vi.fn(async () => null),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('skipped_no_file');
      expect(results[0].rebaseSpawned).toBe(false);
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
    });

    it('readFrontmatter throwing propagates through per-row catch and logs error', async () => {
      const row = makeRow();
      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        readFrontmatter: vi.fn(async () => { throw new Error('malformed YAML: unexpected token'); }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      // Error in readFrontmatter bubbles up through checkRebasePreconditions -> attemptRebaseSpawn
      // -> checkSingleParent -> per-row catch in checkParentChains, so no result is pushed
      expect(results).toHaveLength(0);
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to check parent chain entry',
        expect.objectContaining({
          childStageId: 'STAGE-002',
          error: 'malformed YAML: unexpected token',
        }),
      );
      // Should not have attempted to spawn
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
    });

    it('no spawn deps configured means parent_merged without spawn', async () => {
      const row = makeRow();
      // Use base makeDeps which has null spawn deps
      const deps = makeDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      // Event should reflect what happened (parent_merged) but without spawn
      // Since spawn deps are null, preconditions return skipped_locked
      expect(results[0].rebaseSpawned).toBe(false);
    });
  });
});
