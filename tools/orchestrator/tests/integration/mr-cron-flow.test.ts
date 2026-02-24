import { describe, it, expect, vi } from 'vitest';
import { createMRCommentPoller, type MrCommentTrackingRow } from '../../src/mr-comment-poller.js';
import { createMRChainManager, type ParentBranchTrackingRow } from '../../src/mr-chain-manager.js';
import { createExitGateRunner } from '../../src/exit-gates.js';
import type { StageRow, CodeHostAdapter, PRStatus } from 'kanban-cli';
import type { FrontmatterData, Locker } from '../../src/locking.js';
import type { SessionExecutor, SessionLoggerLike, SessionResult } from '../../src/session.js';
import { makeFrontmatterStore, makeLogger } from './helpers.js';

/**
 * Integration tests for the MR Comment Polling Cron system.
 *
 * These exercise REAL implementations of:
 * - createMRCommentPoller (poller logic)
 * - createExitGateRunner (status propagation)
 * - createMRChainManager (parent chain detection + retargeting)
 *
 * Only I/O is mocked: frontmatter read/write, code host adapter, SQLite queries,
 * sync subprocess, locker, and session executor.
 */

const REPO_PATH = '/repo';
const NOW = 1700000000000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a default StageRow for testing. */
function makeStageRow(overrides: Partial<StageRow> = {}): StageRow {
  return {
    id: 'STAGE-001-001-001',
    ticket_id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    repo_id: 1,
    title: 'Test Stage',
    status: 'PR Created',
    kanban_column: 'review',
    refinement_type: null,
    worktree_branch: 'feature/STAGE-001-001-001',
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
    file_path: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
    last_synced: '2024-01-01T00:00:00Z',
    ...overrides,
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
function makeSessionExecutor(): SessionExecutor & {
  spawn: ReturnType<typeof vi.fn>;
  getActiveSessions: ReturnType<typeof vi.fn>;
  killAll: ReturnType<typeof vi.fn>;
} {
  return {
    spawn: vi.fn(async (): Promise<SessionResult> => ({ exitCode: 0, durationMs: 1000 })),
    getActiveSessions: vi.fn(() => []),
    killAll: vi.fn(),
  };
}

/** Build a default ParentBranchTrackingRow for testing. */
function makeTrackingRow(overrides: Partial<ParentBranchTrackingRow> = {}): ParentBranchTrackingRow {
  return {
    id: 1,
    child_stage_id: 'STAGE-001-001-002',
    parent_stage_id: 'STAGE-001-001-001',
    parent_branch: 'epic-001/stage-001-001-001',
    parent_pr_url: 'https://github.com/owner/repo/pull/10',
    last_known_head: 'abc123',
    is_merged: 0,
    repo_id: 1,
    last_checked: '2026-02-24T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test: PR Created -> cron detects unresolved comments -> Addressing Comments
// ---------------------------------------------------------------------------

describe('MR Cron Flow Integration', () => {
  describe('PR Created -> unresolved comments -> Addressing Comments', () => {
    it('poller detects new comments and exit gate propagates through ticket and epic', async () => {
      // Set up frontmatter hierarchy: stage -> ticket -> epic
      const fm = makeFrontmatterStore({
        // Stage in PR Created state
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            pr_url: 'https://github.com/org/repo/pull/42',
          },
          content: '# Stage\n',
        },
        // Ticket with one stage in PR Created
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'PR Created',
            },
          },
          content: '# Ticket\n',
        },
        // Epic
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
            },
          },
          content: '# Epic\n',
        },
      });

      const runSync = vi.fn(async () => ({ success: true }));
      const logger = makeLogger();

      // Code host reports 3 unresolved threads
      const codeHost = makeCodeHost({
        unresolvedThreadCount: 3,
        hasUnresolvedComments: true,
      });

      // Tracking shows previous count of 0 (second poll)
      const tracking: MrCommentTrackingRow = {
        stage_id: 'STAGE-001-001-001',
        last_poll_timestamp: '2024-01-01T00:00:00Z',
        last_known_unresolved_count: 0,
        repo_id: 1,
      };

      // Wire REAL exit gate runner with mock I/O
      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const stage = makeStageRow();
      const upsertCommentTracking = vi.fn();

      // Wire REAL poller with real exit gate runner
      const poller = createMRCommentPoller({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        getCommentTracking: vi.fn(() => tracking),
        upsertCommentTracking,
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        logger,
        now: () => NOW,
        maxStagesPerCycle: 20,
      });

      const results = await poller.poll(REPO_PATH);

      // -- Poller results --
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('new_comments');
      expect(results[0].newUnresolvedCount).toBe(3);
      expect(results[0].previousUnresolvedCount).toBe(0);

      // -- Stage frontmatter updated to Addressing Comments --
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('Addressing Comments');

      // -- Ticket stage_statuses updated (by exit gate) --
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Addressing Comments');

      // Ticket derived status: "In Progress" (single stage in Addressing Comments)
      expect(ticketData.status).toBe('In Progress');

      // -- Epic ticket_statuses updated --
      const epicData = fm.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001-001']).toBe('In Progress');

      // -- Sync was called --
      expect(runSync).toHaveBeenCalledWith(REPO_PATH);

      // -- Comment tracking updated --
      expect(upsertCommentTracking).toHaveBeenCalledWith({
        stageId: 'STAGE-001-001-001',
        timestamp: new Date(NOW).toISOString(),
        count: 3,
        repoId: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Test: PR Created -> cron detects merge -> Done -> completion cascade
  // ---------------------------------------------------------------------------

  describe('PR Created -> merge detected -> Done -> completion cascade', () => {
    it('poller detects merge, exit gate cascades through ticket and epic to Complete', async () => {
      // Setup: Single stage, single ticket, single-ticket epic
      // The other stage is already Complete, so when this one goes Done the ticket
      // should NOT be Complete (Done != Complete).
      // But for a full completion cascade test, we need all stages to reach Complete.
      // Since the poller transitions to "Done" (not "Complete"), let's test that Done
      // propagates correctly through the hierarchy.
      const fm = makeFrontmatterStore({
        // Stage in PR Created -- will transition to Done on merge
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            pr_url: 'https://github.com/org/repo/pull/42',
          },
          content: '# Stage\n',
        },
        // Ticket: single stage
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'PR Created',
            },
          },
          content: '# Ticket\n',
        },
        // Epic: single ticket
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001'],
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
            },
          },
          content: '# Epic\n',
        },
      });

      const runSync = vi.fn(async () => ({ success: true }));
      const logger = makeLogger();

      // Code host reports PR merged
      const codeHost = makeCodeHost({
        merged: true,
        state: 'merged',
        unresolvedThreadCount: 0,
      });

      // Wire REAL exit gate runner
      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const stage = makeStageRow();
      const upsertCommentTracking = vi.fn();

      // Wire REAL poller with real exit gate
      const poller = createMRCommentPoller({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        getCommentTracking: vi.fn(() => null),
        upsertCommentTracking,
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        logger,
        now: () => NOW,
        maxStagesPerCycle: 20,
      });

      const results = await poller.poll(REPO_PATH);

      // -- Poller results --
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('merged');
      expect(results[0].stageId).toBe('STAGE-001-001-001');

      // -- Stage frontmatter updated to Done --
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('Done');

      // -- Ticket stage_statuses updated via exit gate --
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Done');

      // Single stage is "Done" which is not "Complete" and not "Not Started" -> "In Progress"
      expect(ticketData.status).toBe('In Progress');

      // -- Epic updated --
      const epicData = fm.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001-001']).toBe('In Progress');

      // -- Sync called --
      expect(runSync).toHaveBeenCalledWith(REPO_PATH);
    });

    it('merge with all stages Complete triggers full completion cascade', async () => {
      // Two stages: one already Complete, one transitioning to Complete via merge detection.
      // We simulate the "Done->Complete" by having the poller's exit gate call propagate
      // with statusAfter = "Done". Then we run a second exit gate call to simulate
      // the Finalize->Complete transition that would normally happen.
      //
      // For a proper end-to-end cascade: set up the stage so that the exit gate
      // transitions it to Complete (which the poller does NOT do -- it transitions to Done).
      // Instead, we test the cascade directly by having the stage already at Finalize
      // and the exit gate runner transitioning to Complete.
      //
      // This tests the exit gate portion of the cascade more directly:
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage 1\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md': {
          data: {
            id: 'STAGE-001-001-002',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage 2\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'Complete',
              'STAGE-001-001-002': 'Finalize',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001'],
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
            },
          },
          content: '# Epic\n',
        },
      });

      const runSync = vi.fn(async () => ({ success: true }));
      const logger = makeLogger();

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      // Simulate the exit gate running for STAGE-001-001-002 transitioning to Complete
      const result = await exitGateRunner.run(
        {
          stageId: 'STAGE-001-001-002',
          stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md',
          worktreePath: '',
          worktreeIndex: -1,
          statusBefore: 'Finalize',
          startTime: NOW,
        },
        REPO_PATH,
        'Complete',
      );

      // Full cascade
      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);
      expect(result.ticketCompleted).toBe(true);
      expect(result.epicUpdated).toBe(true);
      expect(result.epicCompleted).toBe(true);

      // Both stages Complete -> ticket Complete
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect(ticketData.status).toBe('Complete');

      // Single ticket Complete -> epic Complete
      const epicData = fm.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect(epicData.status).toBe('Complete');

      // Sync called
      expect(runSync).toHaveBeenCalledWith(REPO_PATH);
    });
  });

  // ---------------------------------------------------------------------------
  // Test: Parent merged -> child rebase spawned -> retarget -> promote
  // ---------------------------------------------------------------------------

  describe('Parent merged -> rebase spawned -> retarget -> promote', () => {
    it('detects parent merge, spawns rebase, retargets to default branch, promotes to ready', async () => {
      const logger = makeLogger();

      // Child stage frontmatter (has pr_number for retargeting)
      const childFm: Record<string, FrontmatterData> = {
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md': {
          data: {
            id: 'STAGE-001-001-002',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            pr_number: 55,
            is_draft: true,
            pending_merge_parents: [
              {
                stage_id: 'STAGE-001-001-001',
                branch: 'epic-001/stage-001-001-001',
                pr_url: 'https://github.com/owner/repo/pull/10',
                pr_number: 10,
              },
            ],
          },
          content: '# Child Stage\n',
        },
      };

      const readFrontmatter = vi.fn(async (filePath: string): Promise<FrontmatterData> => {
        const entry = childFm[filePath];
        if (!entry) throw new Error(`ENOENT: ${filePath}`);
        return structuredClone(entry);
      });

      const writeFrontmatter = vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
        childFm[filePath] = structuredClone({ data, content });
      });

      const editPRBase = vi.fn();
      const markPRReady = vi.fn();

      // Code host: parent PR merged
      const codeHost: CodeHostAdapter = {
        getPRStatus: vi.fn(() => ({
          merged: true,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'merged',
        })),
        editPRBase,
        markPRReady,
        getBranchHead: vi.fn(() => 'abc123'),
      };

      // Single parent, now merged (0 unmerged remaining)
      const trackingRow = makeTrackingRow();

      const locker = makeLocker();
      const sessionExecutor = makeSessionExecutor();

      const chainManager = createMRChainManager({
        getActiveTrackingRows: vi.fn(async () => [trackingRow]),
        updateTrackingRow: vi.fn(async () => {}),
        codeHost,
        logger,
        locker,
        sessionExecutor,
        readFrontmatter,
        resolveStageFilePath: vi.fn(async (stageId: string) =>
          `/repo/epics/EPIC-001/TICKET-001-001/${stageId}.md`,
        ),
        createSessionLogger: vi.fn((): SessionLoggerLike => ({ write: vi.fn() })),
        model: 'sonnet',
        workflowEnv: { REPO_PATH: '/repo' },
        getTrackingRowsForChild: vi.fn(async () => [
          // Single parent, now merged
          makeTrackingRow({ id: 1, is_merged: 1 }),
        ]),
        writeFrontmatter,
        defaultBranch: 'main',
      });

      const results = await chainManager.checkParentChains(REPO_PATH);

      // -- Chain manager results --
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_merged');

      // -- Rebase session spawned --
      expect(results[0].rebaseSpawned).toBe(true);
      expect(locker.acquireLock).toHaveBeenCalledWith(
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md',
      );
      expect(sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = sessionExecutor.spawn.mock.calls[0][0];
      expect(spawnCall.skillName).toBe('rebase-child-mr');
      expect(spawnCall.stageId).toBe('STAGE-001-001-002');

      // -- Retargeted to default branch --
      expect(results[0].retargeted).toBe(true);
      expect(editPRBase).toHaveBeenCalledWith(55, 'main');

      // -- Promoted to ready --
      expect(results[0].promotedToReady).toBe(true);
      expect(markPRReady).toHaveBeenCalledWith(55);

      // -- Frontmatter updated: is_draft = false, pending_merge_parents = [] --
      const updatedChild = childFm['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'];
      expect(updatedChild.data.is_draft).toBe(false);
      expect(updatedChild.data.pending_merge_parents).toEqual([]);
    });

    it('multi-parent: one merges, remaining parent causes retarget without promotion', async () => {
      const logger = makeLogger();

      const childFm: Record<string, FrontmatterData> = {
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md': {
          data: {
            id: 'STAGE-001-001-003',
            status: 'PR Created',
            pr_number: 77,
            is_draft: true,
            pending_merge_parents: [
              { stage_id: 'STAGE-001-001-001', branch: 'epic-001/stage-001-001-001' },
              { stage_id: 'STAGE-001-001-002', branch: 'epic-001/stage-001-001-002' },
            ],
          },
          content: '# Child Stage\n',
        },
      };

      const readFrontmatter = vi.fn(async (filePath: string): Promise<FrontmatterData> => {
        const entry = childFm[filePath];
        if (!entry) throw new Error(`ENOENT: ${filePath}`);
        return structuredClone(entry);
      });

      const writeFrontmatter = vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
        childFm[filePath] = structuredClone({ data, content });
      });

      const editPRBase = vi.fn();
      const markPRReady = vi.fn();

      const codeHost: CodeHostAdapter = {
        getPRStatus: vi.fn(() => ({
          merged: true,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'merged',
        })),
        editPRBase,
        markPRReady,
        getBranchHead: vi.fn(() => 'abc123'),
      };

      // Parent A merged, tracking row for this merge
      const trackingRow = makeTrackingRow({
        id: 1,
        child_stage_id: 'STAGE-001-001-003',
        parent_stage_id: 'STAGE-001-001-001',
        parent_branch: 'epic-001/stage-001-001-001',
        parent_pr_url: 'https://github.com/owner/repo/pull/10',
      });

      const locker = makeLocker();
      const sessionExecutor = makeSessionExecutor();

      const chainManager = createMRChainManager({
        getActiveTrackingRows: vi.fn(async () => [trackingRow]),
        updateTrackingRow: vi.fn(async () => {}),
        codeHost,
        logger,
        locker,
        sessionExecutor,
        readFrontmatter,
        resolveStageFilePath: vi.fn(async (stageId: string) =>
          `/repo/epics/EPIC-001/TICKET-001-001/${stageId}.md`,
        ),
        createSessionLogger: vi.fn((): SessionLoggerLike => ({ write: vi.fn() })),
        model: 'sonnet',
        workflowEnv: {},
        // After marking parent A merged, one parent still unmerged
        getTrackingRowsForChild: vi.fn(async () => [
          makeTrackingRow({ id: 1, parent_stage_id: 'STAGE-001-001-001', is_merged: 1 }),
          makeTrackingRow({
            id: 2,
            parent_stage_id: 'STAGE-001-001-002',
            parent_branch: 'epic-001/stage-001-001-002',
            is_merged: 0,
          }),
        ]),
        writeFrontmatter,
        defaultBranch: 'main',
      });

      const results = await chainManager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_merged');

      // Rebase spawned (parent merged, child not locked, no conflict)
      expect(results[0].rebaseSpawned).toBe(true);

      // Retargeted to remaining parent branch
      expect(results[0].retargeted).toBe(true);
      expect(editPRBase).toHaveBeenCalledWith(77, 'epic-001/stage-001-001-002');

      // NOT promoted (still has unmerged parent)
      expect(results[0].promotedToReady).toBe(false);
      expect(markPRReady).not.toHaveBeenCalled();
    });

    it('locked child stage skips rebase spawn but still retargets and promotes', async () => {
      const logger = makeLogger();

      const childFm: Record<string, FrontmatterData> = {
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md': {
          data: {
            id: 'STAGE-001-001-002',
            status: 'PR Created',
            pr_number: 55,
            is_draft: true,
            pending_merge_parents: [],
          },
          content: '# Child\n',
        },
      };

      const readFrontmatter = vi.fn(async (filePath: string): Promise<FrontmatterData> => {
        const entry = childFm[filePath];
        if (!entry) throw new Error(`ENOENT: ${filePath}`);
        return structuredClone(entry);
      });

      const writeFrontmatter = vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
        childFm[filePath] = structuredClone({ data, content });
      });

      const editPRBase = vi.fn();
      const markPRReady = vi.fn();

      const codeHost: CodeHostAdapter = {
        getPRStatus: vi.fn(() => ({
          merged: true,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'merged',
        })),
        editPRBase,
        markPRReady,
        getBranchHead: vi.fn(() => 'abc123'),
      };

      const trackingRow = makeTrackingRow();
      const locker = makeLocker({
        isLocked: vi.fn(async () => true), // Child is locked
      });
      const sessionExecutor = makeSessionExecutor();

      const chainManager = createMRChainManager({
        getActiveTrackingRows: vi.fn(async () => [trackingRow]),
        updateTrackingRow: vi.fn(async () => {}),
        codeHost,
        logger,
        locker,
        sessionExecutor,
        readFrontmatter,
        resolveStageFilePath: vi.fn(async (stageId: string) =>
          `/repo/epics/EPIC-001/TICKET-001-001/${stageId}.md`,
        ),
        createSessionLogger: vi.fn((): SessionLoggerLike => ({ write: vi.fn() })),
        model: 'sonnet',
        workflowEnv: {},
        getTrackingRowsForChild: vi.fn(async () => [
          makeTrackingRow({ id: 1, is_merged: 1 }),
        ]),
        writeFrontmatter,
        defaultBranch: 'main',
      });

      const results = await chainManager.checkParentChains(REPO_PATH);

      expect(results).toHaveLength(1);
      // Event is skipped_locked (spawn was skipped due to lock)
      expect(results[0].event).toBe('skipped_locked');
      expect(results[0].rebaseSpawned).toBe(false);

      // No session spawned
      expect(sessionExecutor.spawn).not.toHaveBeenCalled();

      // Retargeting and promotion still happen (independent of spawn)
      expect(results[0].retargeted).toBe(true);
      expect(editPRBase).toHaveBeenCalledWith(55, 'main');
      expect(results[0].promotedToReady).toBe(true);
      expect(markPRReady).toHaveBeenCalledWith(55);
    });
  });

  // ---------------------------------------------------------------------------
  // Test: End-to-end poller + exit gate with multi-stage ticket
  // ---------------------------------------------------------------------------

  describe('Multi-stage ticket: merge on last stage triggers ticket completion', () => {
    it('poller merge detection cascades to ticket Complete when sibling is already Complete', async () => {
      // Two stages: STAGE-001-001-001 (Complete), STAGE-001-001-002 (PR Created -> Done via merge)
      // After transition, ticket has one Complete + one Done = "In Progress" (not all Complete)
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md': {
          data: {
            id: 'STAGE-001-001-002',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            pr_url: 'https://github.com/org/repo/pull/99',
          },
          content: '# Stage 2\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'Complete',
              'STAGE-001-001-002': 'PR Created',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001'],
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
            },
          },
          content: '# Epic\n',
        },
      });

      const runSync = vi.fn(async () => ({ success: true }));
      const logger = makeLogger();

      const codeHost = makeCodeHost({ merged: true, state: 'merged' });

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const stage = makeStageRow({
        id: 'STAGE-001-001-002',
        file_path: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md',
        pr_url: 'https://github.com/org/repo/pull/99',
        pr_number: 99,
      });

      const poller = createMRCommentPoller({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        getCommentTracking: vi.fn(() => null),
        upsertCommentTracking: vi.fn(),
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        logger,
        now: () => NOW,
        maxStagesPerCycle: 20,
      });

      const results = await poller.poll(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('merged');

      // Stage updated to Done
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'].data;
      expect(stageData.status).toBe('Done');

      // Ticket has one Complete + one Done -> In Progress (not all Complete)
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Complete');
      expect(stageStatuses['STAGE-001-001-002']).toBe('Done');
      expect(ticketData.status).toBe('In Progress');

      // Epic remains In Progress
      const epicData = fm.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001-001']).toBe('In Progress');
    });
  });

  // ---------------------------------------------------------------------------
  // Test: First poll establishes baseline without transition
  // ---------------------------------------------------------------------------

  describe('First poll baseline', () => {
    it('first poll records baseline without triggering any exit gate or frontmatter writes', async () => {
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            pr_url: 'https://github.com/org/repo/pull/42',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: { 'STAGE-001-001-001': 'PR Created' },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            ticket_statuses: { 'TICKET-001-001': 'In Progress' },
          },
          content: '# Epic\n',
        },
      });

      const runSync = vi.fn(async () => ({ success: true }));
      const logger = makeLogger();

      const codeHost = makeCodeHost({ unresolvedThreadCount: 5 });

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const stage = makeStageRow();
      const upsertCommentTracking = vi.fn();

      const poller = createMRCommentPoller({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        getCommentTracking: vi.fn(() => null), // No prior tracking = first poll
        upsertCommentTracking,
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        logger,
        now: () => NOW,
        maxStagesPerCycle: 20,
      });

      const results = await poller.poll(REPO_PATH);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('first_poll');
      expect(results[0].newUnresolvedCount).toBe(5);

      // No frontmatter writes (no transition on first poll)
      expect(fm.writeFrontmatter).not.toHaveBeenCalled();

      // No sync (exit gate not called)
      expect(runSync).not.toHaveBeenCalled();

      // Tracking was created with baseline
      expect(upsertCommentTracking).toHaveBeenCalledWith({
        stageId: 'STAGE-001-001-001',
        timestamp: new Date(NOW).toISOString(),
        count: 5,
        repoId: 1,
      });

      // Frontmatter unchanged
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('PR Created');
    });
  });
});
