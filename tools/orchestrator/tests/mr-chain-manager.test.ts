import { describe, it, expect, vi } from 'vitest';
import {
  createMRChainManager,
  type MRChainManagerDeps,
  type ParentBranchTrackingRow,
} from '../src/mr-chain-manager.js';
import type { CodeHostAdapter, PRStatus } from 'kanban-cli';

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

/** Build full mock deps. */
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
      // First parent merged
      expect(results[0]).toEqual({
        childStageId: 'STAGE-003',
        parentStageId: 'STAGE-001',
        event: 'parent_merged',
      });
      // Second parent HEAD changed
      expect(results[1]).toEqual({
        childStageId: 'STAGE-003',
        parentStageId: 'STAGE-002',
        event: 'parent_updated',
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
});
