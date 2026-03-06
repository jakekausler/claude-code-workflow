/**
 * Edge case tests for the MR Comment Polling Cron system.
 *
 * Covers unusual and error scenarios:
 * - No open PRs -> cron cycle completes cleanly
 * - Code host adapter unavailable (null) -> logged, no crash
 * - Code host API error for one stage -> continues to next
 * - Deep parent chain (A->B->C) -> processes bottom-up across cycles
 * - rebase_conflict flagged stage -> skipped by cron
 * - Stage removed between query and check -> handled gracefully
 */
import { describe, it, expect, vi } from 'vitest';
import { createMRCommentPoller, type MRCommentPollerDeps, type MrCommentTrackingRow } from '../src/mr-comment-poller.js';
import { createMRChainManager, type MRChainManagerDeps, type ParentBranchTrackingRow } from '../src/mr-chain-manager.js';
import type { StageRow, CodeHostAdapter, PRStatus } from 'kanban-cli';
import type { ExitGateRunner, ExitGateResult } from '../src/exit-gates.js';
import type { FrontmatterData } from '../src/locking.js';
import type { SessionExecutor, SessionResult, SessionLoggerLike } from '../src/session.js';

// ---------- Shared test helpers ----------

const REPO_PATH = '/repo';
const NOW = 1700000000000;

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Build a default StageRow for testing. */
function makeStageRow(overrides: Partial<StageRow> = {}): StageRow {
  return {
    id: 'STAGE-001',
    ticket_id: 'TICKET-001',
    epic_id: 'EPIC-001',
    repo_id: 1,
    title: 'Test Stage',
    status: 'PR Created',
    kanban_column: 'review',
    refinement_type: null,
    worktree_branch: 'feature/STAGE-001',
    pr_url: 'https://github.com/org/repo/pull/42',
    pr_number: 42,
    priority: 0,
    due_date: null,
    session_active: 0,
    locked_at: null,
    locked_by: null,
    is_draft: 0,
    pending_merge_parents: null,
    mr_target_branch: null,
    file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
    last_synced: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Build a mock exit gate runner. */
function makeExitGateRunner(result?: Partial<ExitGateResult>): ExitGateRunner & { run: ReturnType<typeof vi.fn> } {
  const defaultResult: ExitGateResult = {
    statusChanged: true,
    statusBefore: 'PR Created',
    statusAfter: 'Done',
    ticketUpdated: true,
    ticketCompleted: false,
    epicUpdated: false,
    epicCompleted: false,
    syncResult: { success: true },
    ...result,
  };
  return {
    run: vi.fn(async () => defaultResult),
  };
}

/** Build a mock CodeHostAdapter. */
function makeCodeHost(prStatus: Partial<PRStatus> = {}): CodeHostAdapter {
  return {
    getPRStatus: vi.fn(() => ({
      merged: false,
      hasUnresolvedComments: false,
      unresolvedThreadCount: 0,
      state: 'open',
      ...prStatus,
    })),
    editPRBase: vi.fn(),
    markPRReady: vi.fn(),
    getBranchHead: vi.fn(() => 'abc123'),
  };
}

/** Build a mock frontmatter store. */
function makeFrontmatterStore(entries: Record<string, FrontmatterData>) {
  const store: Record<string, FrontmatterData> = {};
  for (const [key, value] of Object.entries(entries)) {
    store[key] = structuredClone(value);
  }

  return {
    readFrontmatter: vi.fn(async (filePath: string) => {
      const entry = store[filePath];
      if (!entry) throw new Error(`ENOENT: ${filePath}`);
      return structuredClone(entry);
    }),
    writeFrontmatter: vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
      store[filePath] = structuredClone({ data, content });
    }),
    store,
  };
}

/** Build standard poller deps with overrides. */
function makePollerDeps(overrides: Partial<MRCommentPollerDeps> = {}) {
  const fm = makeFrontmatterStore({
    '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
      data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
      content: '# Stage\n',
    },
  });

  return {
    queryStagesInPRCreated: vi.fn(async () => [] as StageRow[]),
    getCommentTracking: vi.fn(() => null as MrCommentTrackingRow | null),
    upsertCommentTracking: vi.fn(),
    codeHost: makeCodeHost() as CodeHostAdapter | null,
    exitGateRunner: makeExitGateRunner(),
    readFrontmatter: fm.readFrontmatter,
    writeFrontmatter: fm.writeFrontmatter,
    logger: makeLogger(),
    now: () => NOW,
    maxStagesPerCycle: 20,
    ...overrides,
  };
}

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

/** Build a mock Locker. */
function makeLocker(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    acquireLock: vi.fn(async () => {}),
    releaseLock: vi.fn(async () => {}),
    isLocked: vi.fn(async () => false),
    readStatus: vi.fn(async () => 'PR Created'),
    ...overrides,
  };
}

/** Build a mock SessionExecutor. */
function makeSessionExecutor(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    spawn: vi.fn(async (): Promise<SessionResult> => ({ exitCode: 0, durationMs: 1000 })),
    getActiveSessions: vi.fn(() => []),
    killAll: vi.fn(),
    ...overrides,
  };
}

/** Build full mock deps for chain manager. */
function makeChainDeps(overrides: Partial<MRChainManagerDeps> = {}): MRChainManagerDeps & {
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
    logger: makeLogger(),
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

/** Build full mock deps with spawn infrastructure for chain manager. */
function makeSpawnChainDeps(overrides: Partial<MRChainManagerDeps> = {}): MRChainManagerDeps & {
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
    logger: makeLogger(),
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

// ---------- Edge case tests ----------

describe('edge cases', () => {
  describe('no open PRs -> cron cycle completes cleanly', () => {
    it('poller returns empty results when queryStagesInPRCreated returns empty array', async () => {
      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => []),
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll(REPO_PATH);

      expect(results).toEqual([]);
      expect(deps.queryStagesInPRCreated).toHaveBeenCalledWith(REPO_PATH, 20);
      // No code host calls, no exit gate calls
      expect(deps.codeHost!.getPRStatus).not.toHaveBeenCalled();
      expect(deps.exitGateRunner.run).not.toHaveBeenCalled();
      expect(deps.upsertCommentTracking).not.toHaveBeenCalled();
    });

    it('chain manager returns empty results when no tracking rows exist', async () => {
      const deps = makeChainDeps({
        getActiveTrackingRows: vi.fn(async () => []),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toEqual([]);
      expect(deps.logger.info).toHaveBeenCalledWith(
        'No active parent tracking rows found',
        { repoPath: REPO_PATH },
      );
    });
  });

  describe('code host adapter unavailable (null) -> logged, no crash', () => {
    it('poller logs warning and returns empty when codeHost is null', async () => {
      const logger = makeLogger();
      const deps = makePollerDeps({
        codeHost: null,
        logger,
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll(REPO_PATH);

      expect(results).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'No code host adapter available, skipping MR comment poll',
      );
      // queryStagesInPRCreated should NOT be called when code host is null
      expect(deps.queryStagesInPRCreated).not.toHaveBeenCalled();
    });

    it('chain manager logs warning and returns empty when codeHost is null', async () => {
      const deps = makeChainDeps({
        codeHost: null,
        getActiveTrackingRows: vi.fn(async () => [makeRow()]),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toEqual([]);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'No code host adapter configured, skipping parent chain checks',
      );
      // getActiveTrackingRows should NOT be called when code host is null
      expect(deps.getActiveTrackingRows).not.toHaveBeenCalled();
    });
  });

  describe('code host API error for one stage -> continues to next', () => {
    it('poller logs error for failing stage but processes subsequent stage normally', async () => {
      const stage1 = makeStageRow({ id: 'STAGE-001', pr_url: 'https://github.com/org/repo/pull/42' });
      const stage2 = makeStageRow({
        id: 'STAGE-002',
        pr_url: 'https://github.com/org/repo/pull/43',
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
      });

      let callCount = 0;
      const codeHost: CodeHostAdapter = {
        getPRStatus: vi.fn(() => {
          callCount++;
          if (callCount === 1) throw new Error('GitHub API rate limit exceeded');
          return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
        }),
        editPRBase: vi.fn(),
        markPRReady: vi.fn(),
        getBranchHead: vi.fn(() => 'abc123'),
      };

      const tracking2: MrCommentTrackingRow = {
        stage_id: 'STAGE-002',
        last_poll_timestamp: '2024-01-01T00:00:00Z',
        last_known_unresolved_count: 0,
        repo_id: 1,
      };

      const logger = makeLogger();
      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => [stage1, stage2]),
        getCommentTracking: vi.fn((stageId: string) => stageId === 'STAGE-002' ? tracking2 : null),
        codeHost,
        logger,
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll(REPO_PATH);

      // First stage errored, second stage processed successfully
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        stageId: 'STAGE-001',
        prUrl: 'https://github.com/org/repo/pull/42',
        action: 'error',
      });
      expect(results[1].stageId).toBe('STAGE-002');
      expect(results[1].action).toBe('no_change');

      // Error was logged for first stage
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch PR status',
        expect.objectContaining({
          stageId: 'STAGE-001',
          error: 'GitHub API rate limit exceeded',
        }),
      );
    });

    it('chain manager logs error for failing row but processes subsequent row normally', async () => {
      const row1 = makeRow({
        id: 1,
        child_stage_id: 'CHILD-001',
        parent_stage_id: 'PARENT-001',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
        last_known_head: 'aaa111',
      });
      const row2 = makeRow({
        id: 2,
        child_stage_id: 'CHILD-002',
        parent_stage_id: 'PARENT-002',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
        last_known_head: 'bbb222',
      });

      let callCount = 0;
      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('API timeout');
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
      });
      (codeHost.getBranchHead as ReturnType<typeof vi.fn>).mockReturnValue('bbb222');

      const deps = makeChainDeps({
        getActiveTrackingRows: vi.fn(async () => [row1, row2]),
        codeHost,
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      // First row handled error gracefully (returns no_change), second processes normally
      expect(results).toHaveLength(2);
      expect(results[0].childStageId).toBe('CHILD-001');
      expect(results[0].event).toBe('no_change');
      expect(results[1].childStageId).toBe('CHILD-002');
      expect(results[1].event).toBe('no_change');

      // Warning was logged for the first row's failed getPRStatus
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to get PR status for parent',
        expect.objectContaining({
          parentStageId: 'PARENT-001',
          error: 'API timeout',
        }),
      );
    });
  });

  describe('deep parent chain (A->B->C) -> processes bottom-up across cycles', () => {
    it('cycle 1: A merges, B tracking updated and rebase spawned', async () => {
      // Chain: C depends on B, B depends on A
      // In cycle 1, A's PR merges. The chain manager picks up B's tracking row
      // pointing to parent A, detects A is merged, and spawns a rebase for B.
      const rowBdependsOnA = makeRow({
        id: 1,
        child_stage_id: 'STAGE-B',
        parent_stage_id: 'STAGE-A',
        parent_branch: 'epic/stage-a',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
        last_known_head: 'aaa111',
        is_merged: 0,
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [rowBdependsOnA]),
        codeHost,
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-B',
        parentStageId: 'STAGE-A',
        event: 'parent_merged',
        rebaseSpawned: true,
        retargeted: false,
        promotedToReady: false,
      });

      // Tracking row updated to mark A as merged
      expect(deps.updateTrackingRow).toHaveBeenCalledWith(1, {
        is_merged: 1,
        last_checked: expect.any(String),
      });

      // Rebase session spawned for B
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      expect(deps.locker.acquireLock).toHaveBeenCalled();
    });

    it('cycle 2: B merges, C tracking updated and rebase spawned', async () => {
      // After cycle 1, B has been rebased and re-pushed. Now B's PR merges.
      // C's tracking row points to parent B, so the chain manager detects
      // B is merged and spawns a rebase for C.
      const rowCdependsOnB = makeRow({
        id: 2,
        child_stage_id: 'STAGE-C',
        parent_stage_id: 'STAGE-B',
        parent_branch: 'epic/stage-b',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
        last_known_head: 'bbb222',
        is_merged: 0,
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [rowCdependsOnB]),
        codeHost,
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-C',
        parentStageId: 'STAGE-B',
        event: 'parent_merged',
        rebaseSpawned: true,
        retargeted: false,
        promotedToReady: false,
      });

      // Tracking row updated to mark B as merged
      expect(deps.updateTrackingRow).toHaveBeenCalledWith(2, {
        is_merged: 1,
        last_checked: expect.any(String),
      });

      // Rebase session spawned for C
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
    });

    it('full chain A->B->C: only processes one level per cycle', async () => {
      // Both B's and C's tracking rows are present. A has merged.
      // B depends on A (merged), C depends on B (not merged).
      // In one cycle, only B should be affected by A's merge.
      // C's parent (B) is still open, so C gets no_change.
      const rowBdependsOnA = makeRow({
        id: 1,
        child_stage_id: 'STAGE-B',
        parent_stage_id: 'STAGE-A',
        parent_branch: 'epic/stage-a',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
        last_known_head: 'aaa111',
        is_merged: 0,
      });
      const rowCdependsOnB = makeRow({
        id: 2,
        child_stage_id: 'STAGE-C',
        parent_stage_id: 'STAGE-B',
        parent_branch: 'epic/stage-b',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
        last_known_head: 'bbb222',
        is_merged: 0,
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockImplementation((prUrl: string) => {
        if (prUrl.includes('/10')) {
          // A's PR is merged
          return { merged: true, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'merged' };
        }
        // B's PR is still open
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
      });
      (codeHost.getBranchHead as ReturnType<typeof vi.fn>).mockReturnValue('bbb222'); // unchanged for B

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [rowBdependsOnA, rowCdependsOnB]),
        codeHost,
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(2);

      // B's parent (A) merged -> parent_merged, rebase spawned
      expect(results[0].childStageId).toBe('STAGE-B');
      expect(results[0].event).toBe('parent_merged');
      expect(results[0].rebaseSpawned).toBe(true);

      // C's parent (B) not merged, HEAD unchanged -> no_change
      expect(results[1].childStageId).toBe('STAGE-C');
      expect(results[1].event).toBe('no_change');
      expect(results[1].rebaseSpawned).toBe(false);
    });
  });

  describe('rebase_conflict flagged stage -> skipped by cron', () => {
    it('chain manager returns skipped_conflict when frontmatter has rebase_conflict: true', async () => {
      const row = makeRow({
        child_stage_id: 'STAGE-CONFLICT',
        parent_stage_id: 'STAGE-PARENT',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost,
        readFrontmatter: vi.fn(async (): Promise<FrontmatterData> => ({
          data: { rebase_conflict: true },
          content: '',
        })),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        childStageId: 'STAGE-CONFLICT',
        parentStageId: 'STAGE-PARENT',
        event: 'skipped_conflict',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      });

      // Session executor should NOT have been called
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
      // Locker.isLocked should NOT have been called (conflict is checked first)
      expect(deps.locker.isLocked).not.toHaveBeenCalled();
    });

    it('skipped_conflict does not prevent other rows from being processed', async () => {
      const conflictRow = makeRow({
        id: 1,
        child_stage_id: 'STAGE-CONFLICT',
        parent_stage_id: 'PARENT-A',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
      });
      const normalRow = makeRow({
        id: 2,
        child_stage_id: 'STAGE-NORMAL',
        parent_stage_id: 'PARENT-B',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
        last_known_head: 'xyz789',
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      let readFmCallCount = 0;
      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [conflictRow, normalRow]),
        codeHost,
        readFrontmatter: vi.fn(async (): Promise<FrontmatterData> => {
          readFmCallCount++;
          if (readFmCallCount === 1) {
            // First call: conflict stage
            return { data: { rebase_conflict: true }, content: '' };
          }
          // Second call: normal stage
          return { data: {}, content: '' };
        }),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(2);
      expect(results[0].childStageId).toBe('STAGE-CONFLICT');
      expect(results[0].event).toBe('skipped_conflict');
      expect(results[0].rebaseSpawned).toBe(false);

      expect(results[1].childStageId).toBe('STAGE-NORMAL');
      expect(results[1].event).toBe('parent_merged');
      expect(results[1].rebaseSpawned).toBe(true);
    });
  });

  describe('stage removed between query and check -> handled gracefully', () => {
    it('poller handles readFrontmatter throwing for a deleted stage file', async () => {
      const stage = makeStageRow({
        id: 'STAGE-DELETED',
        pr_url: 'https://github.com/org/repo/pull/99',
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-DELETED.md',
      });

      const codeHost = makeCodeHost({ merged: true, state: 'merged' });
      const logger = makeLogger();

      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        codeHost,
        readFrontmatter: vi.fn(async () => {
          throw new Error('ENOENT: no such file or directory');
        }),
        logger,
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll(REPO_PATH);

      // The stage that was deleted results in an error action
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        stageId: 'STAGE-DELETED',
        prUrl: 'https://github.com/org/repo/pull/99',
        action: 'error',
      });

      // Error was logged
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to update stage frontmatter for merge',
        expect.objectContaining({
          stageId: 'STAGE-DELETED',
          error: 'ENOENT: no such file or directory',
        }),
      );
    });

    it('poller continues processing other stages after one is deleted', async () => {
      const deletedStage = makeStageRow({
        id: 'STAGE-DELETED',
        pr_url: 'https://github.com/org/repo/pull/99',
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-DELETED.md',
      });
      const normalStage = makeStageRow({
        id: 'STAGE-NORMAL',
        pr_url: 'https://github.com/org/repo/pull/100',
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-NORMAL.md',
      });

      let getPRStatusCallCount = 0;
      const codeHost: CodeHostAdapter = {
        getPRStatus: vi.fn(() => {
          getPRStatusCallCount++;
          if (getPRStatusCallCount === 1) {
            return { merged: true, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'merged' };
          }
          return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
        }),
        editPRBase: vi.fn(),
        markPRReady: vi.fn(),
        getBranchHead: vi.fn(() => 'abc123'),
      };

      const tracking: MrCommentTrackingRow = {
        stage_id: 'STAGE-NORMAL',
        last_poll_timestamp: '2024-01-01T00:00:00Z',
        last_known_unresolved_count: 0,
        repo_id: 1,
      };

      let readFmCallCount = 0;
      const logger = makeLogger();
      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => [deletedStage, normalStage]),
        getCommentTracking: vi.fn((stageId: string) => stageId === 'STAGE-NORMAL' ? tracking : null),
        codeHost,
        readFrontmatter: vi.fn(async (filePath: string) => {
          readFmCallCount++;
          if (filePath.includes('STAGE-DELETED')) {
            throw new Error('ENOENT: file was deleted');
          }
          return { data: { id: 'STAGE-NORMAL', status: 'PR Created' }, content: '# Stage\n' };
        }),
        logger,
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll(REPO_PATH);

      // First stage errored (deleted), second processed normally
      expect(results).toHaveLength(2);
      expect(results[0].stageId).toBe('STAGE-DELETED');
      expect(results[0].action).toBe('error');
      expect(results[1].stageId).toBe('STAGE-NORMAL');
      expect(results[1].action).toBe('no_change');
    });

    it('chain manager handles readFrontmatter throwing for deleted stage', async () => {
      const row = makeRow({
        child_stage_id: 'STAGE-DELETED',
        parent_stage_id: 'PARENT-001',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [row]),
        codeHost,
        readFrontmatter: vi.fn(async () => {
          throw new Error('ENOENT: no such file or directory');
        }),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      // Error is caught in per-row handler, no result pushed
      expect(results).toHaveLength(0);
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to check parent chain entry',
        expect.objectContaining({
          childStageId: 'STAGE-DELETED',
          error: 'ENOENT: no such file or directory',
        }),
      );

      // Session executor should NOT have been called
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
    });

    it('chain manager continues processing other rows after one stage is deleted', async () => {
      const deletedRow = makeRow({
        id: 1,
        child_stage_id: 'STAGE-DELETED',
        parent_stage_id: 'PARENT-A',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
      });
      const normalRow = makeRow({
        id: 2,
        child_stage_id: 'STAGE-NORMAL',
        parent_stage_id: 'PARENT-B',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
      });

      const codeHost = makeCodeHost();
      (codeHost.getPRStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        merged: true,
        hasUnresolvedComments: false,
        unresolvedThreadCount: 0,
        state: 'merged',
      });

      const deps = makeSpawnChainDeps({
        getActiveTrackingRows: vi.fn(async () => [deletedRow, normalRow]),
        codeHost,
        readFrontmatter: vi.fn(async (filePath: string): Promise<FrontmatterData> => {
          if (filePath.includes('STAGE-DELETED')) {
            throw new Error('ENOENT: file was deleted');
          }
          return { data: {}, content: '' };
        }),
        resolveStageFilePath: vi.fn(async (stageId: string) => `/repo/epics/e1/t1/${stageId}.md`),
      });

      const manager = createMRChainManager(deps);
      const results = await manager.checkParentChains(REPO_PATH);

      // Deleted row errored out (no result), normal row processed
      expect(results).toHaveLength(1);
      expect(results[0].childStageId).toBe('STAGE-NORMAL');
      expect(results[0].event).toBe('parent_merged');
      expect(results[0].rebaseSpawned).toBe(true);

      // Error was logged for deleted row
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to check parent chain entry',
        expect.objectContaining({
          childStageId: 'STAGE-DELETED',
          error: 'ENOENT: file was deleted',
        }),
      );
    });
  });
});
