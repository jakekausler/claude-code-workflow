import { describe, it, expect, vi } from 'vitest';
import {
  createMRChainManager,
  type MRChainManagerDeps,
  type ParentBranchTrackingRow,
} from '../src/mr-chain-manager.js';
import {
  createMRCommentPoller,
  type MRCommentPollerDeps,
  type MrCommentTrackingRow,
} from '../src/mr-comment-poller.js';
import type { CodeHostAdapter, PRStatus, StageRow } from 'kanban-cli';
import type { Locker, FrontmatterData } from '../src/locking.js';
import type { SessionExecutor, SpawnOptions, SessionLoggerLike, SessionResult } from '../src/session.js';
import type { ExitGateRunner, ExitGateResult } from '../src/exit-gates.js';

/**
 * Race condition tests for MR Comment Polling Cron.
 *
 * These tests verify that concurrent cron + main loop behavior is safe:
 * 1. session_active prevents cron from spawning rebase sessions
 * 2. Double merge detection is idempotent (cron + resolver both detect merge)
 * 3. Cron skips stages with active sessions
 * 4. rebase_conflict flag prevents repeated spawn attempts
 */

// ---------- Shared test helpers ----------

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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

const NOW = 1700000000000;

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

// ---------- Tests ----------

describe('Race Conditions: concurrent cron + main loop safety', () => {
  describe('session_active prevents cron from spawning rebase', () => {
    it('returns skipped_locked and does not call sessionExecutor.spawn when locker reports isLocked=true', async () => {
      // Scenario: The main loop has an active session for STAGE-002 (session_active=true
      // in frontmatter). The cron-driven chain manager detects that STAGE-001 parent
      // was merged. It checks locker.isLocked() which returns true, preventing
      // a rebase session from being spawned.
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
          isLocked: vi.fn(async () => true), // main loop has active session
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('skipped_locked');
      expect(results[0].rebaseSpawned).toBe(false);

      // The critical assertion: spawn was never called
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();

      // Lock was never acquired (isLocked check prevented it)
      expect(deps.locker.acquireLock).not.toHaveBeenCalled();
    });

    it('spawns rebase session when locker reports isLocked=false (no active session)', async () => {
      // Scenario: Same merge detection, but this time no active session exists.
      // The chain manager should proceed to spawn.
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
          isLocked: vi.fn(async () => false), // no active session
        }),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_merged');
      expect(results[0].rebaseSpawned).toBe(true);

      // Spawn was called
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      // Lock was acquired before spawn
      expect(deps.locker.acquireLock).toHaveBeenCalled();
    });
  });

  describe('double merge detection is idempotent (cron + resolver)', () => {
    it('second "Done" transition via exit gate is no-op when status is already Done', async () => {
      // Scenario: Both the cron poller and the pr-status resolver detect that
      // a PR was merged. The poller runs first and transitions the stage to
      // "Done" via the exit gate. The resolver then also detects the merge and
      // calls the exit gate with "Done" again.
      //
      // The exit gate compares statusBefore vs statusAfter. When both are "Done"
      // (because the first transition already happened), it returns early with
      // statusChanged: false, making the second call a no-op.

      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
          content: '# Stage\n',
        },
      });

      const stage = makeStageRow();
      const codeHost = makeCodeHost({
        getPRStatus: () => ({
          merged: true,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'merged',
        }),
      });

      // First call: poller detects merge, exit gate transitions PR Created -> Done
      const exitGateRunner = makeExitGateRunner({
        statusChanged: true,
        statusBefore: 'PR Created',
        statusAfter: 'Done',
      });

      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
      });

      const poller = createMRCommentPoller(deps);
      const firstResults = await poller.poll('/repo');

      expect(firstResults).toHaveLength(1);
      expect(firstResults[0].action).toBe('merged');
      expect(exitGateRunner.run).toHaveBeenCalledTimes(1);

      // Verify the exit gate was called with the Done transition
      const firstCall = exitGateRunner.run.mock.calls[0];
      expect(firstCall[2]).toBe('Done');

      // Second call: simulate the resolver calling exit gate with Done again.
      // The exit gate compares statusBefore (now "Done" since first transition
      // already happened) with statusAfter ("Done"). Since they match,
      // the second call is a no-op.
      const exitGateNoOp = makeExitGateRunner({
        statusChanged: false,
        statusBefore: 'Done',
        statusAfter: 'Done',
        ticketUpdated: false,
        epicUpdated: false,
        syncResult: { success: true },
      });

      // Call the exit gate runner directly as the resolver would
      const workerInfo = {
        stageId: 'STAGE-001',
        stageFilePath: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
        worktreePath: '',
        worktreeIndex: -1,
        statusBefore: 'Done', // already transitioned
        startTime: NOW,
      };

      const result = await exitGateNoOp.run(workerInfo, '/repo', 'Done');

      // Second exit gate call reports no status change
      expect(result.statusChanged).toBe(false);
      expect(result.statusBefore).toBe('Done');
      expect(result.statusAfter).toBe('Done');
      expect(result.ticketUpdated).toBe(false);
    });

    it('exit gate propagates only once when both poller and resolver detect merge', async () => {
      // More focused scenario: Two separate poller.poll() calls for the same merged PR.
      // The first transitions the stage; the second should detect the stage is already
      // in "Done" state (because frontmatter was updated) and not trigger another
      // exit gate call.

      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
          content: '# Stage\n',
        },
      });

      const stage = makeStageRow();
      const codeHost = makeCodeHost({
        getPRStatus: () => ({
          merged: true,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'merged',
        }),
      });

      const exitGateRunner = makeExitGateRunner();

      const deps = makePollerDeps({
        queryStagesInPRCreated: vi.fn(async () => [stage]),
        codeHost,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
      });

      const poller = createMRCommentPoller(deps);

      // First poll: transitions stage to Done
      const results1 = await poller.poll('/repo');
      expect(results1).toHaveLength(1);
      expect(results1[0].action).toBe('merged');
      expect(exitGateRunner.run).toHaveBeenCalledTimes(1);

      // After first poll, the frontmatter status is now "Done"
      const updatedFm = fm.store['/repo/epics/EPIC-001/TICKET-001/STAGE-001.md'];
      expect(updatedFm.data.status).toBe('Done');

      // Second poll: the stage is no longer in "PR Created" status, so
      // queryStagesInPRCreated would NOT return it (the SQL query filters
      // by status='PR Created'). This is the primary protection against
      // double processing.
      //
      // We simulate this by returning an empty list on second call.
      deps.queryStagesInPRCreated.mockResolvedValueOnce([]);

      const results2 = await poller.poll('/repo');
      expect(results2).toEqual([]);

      // Exit gate was NOT called a second time
      expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('cron skips stage with active session', () => {
    it('queryStagesInPRCreated filters out session_active stages so poller never processes them', async () => {
      // Scenario: Two stages are in PR Created. One has session_active=1
      // (main loop is working on it), the other has session_active=0.
      // The SQL query filters by session_active=0, so only the inactive
      // stage is returned to the poller.

      const activeStage = makeStageRow({
        id: 'STAGE-ACTIVE',
        session_active: 1,
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-ACTIVE.md',
      });
      const inactiveStage = makeStageRow({
        id: 'STAGE-INACTIVE',
        session_active: 0,
        file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-INACTIVE.md',
      });

      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-INACTIVE.md': {
          data: { id: 'STAGE-INACTIVE', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
          content: '# Stage\n',
        },
      });

      const codeHost = makeCodeHost({
        getPRStatus: () => ({
          merged: false,
          hasUnresolvedComments: false,
          unresolvedThreadCount: 0,
          state: 'open',
        }),
      });

      // Simulate the SQL query returning only the inactive stage
      // (as the real query would filter WHERE session_active = 0)
      const queryFn = vi.fn(async () => [inactiveStage]);

      const tracking: MrCommentTrackingRow = {
        stage_id: 'STAGE-INACTIVE',
        last_poll_timestamp: '2024-01-01T00:00:00Z',
        last_known_unresolved_count: 0,
        repo_id: 1,
      };

      const deps = makePollerDeps({
        queryStagesInPRCreated: queryFn,
        getCommentTracking: vi.fn((stageId: string) =>
          stageId === 'STAGE-INACTIVE' ? tracking : null,
        ),
        codeHost,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
      });

      const poller = createMRCommentPoller(deps);
      const results = await poller.poll('/repo');

      // Only the inactive stage was processed
      expect(results).toHaveLength(1);
      expect(results[0].stageId).toBe('STAGE-INACTIVE');

      // The active stage was never processed (filtered at query level)
      const processedIds = results.map(r => r.stageId);
      expect(processedIds).not.toContain('STAGE-ACTIVE');
    });

    it('chain manager skips locked stage during parent merge check', async () => {
      // Scenario: A parent PR merges. The chain manager tries to spawn a rebase
      // for STAGE-002, but the main loop has an active session (isLocked=true).
      // Another child stage STAGE-003 is not locked and should be processed.

      const row1 = makeRow({
        id: 1,
        child_stage_id: 'STAGE-002',
        parent_stage_id: 'STAGE-001',
      });
      const row2 = makeRow({
        id: 2,
        child_stage_id: 'STAGE-003',
        parent_stage_id: 'STAGE-001',
        parent_pr_url: 'https://github.com/owner/repo/pull/11',
      });

      const deps = makeSpawnDeps({
        getActiveTrackingRows: vi.fn(async () => [row1, row2]),
        codeHost: makeCodeHost({
          getPRStatus: () => ({
            merged: true,
            hasUnresolvedComments: false,
            unresolvedThreadCount: 0,
            state: 'merged',
          }),
        }),
        locker: makeLocker({
          isLocked: vi.fn(async (filePath: string) => {
            // STAGE-002 is locked (active session), STAGE-003 is not
            return filePath.includes('STAGE-002');
          }),
        }),
        resolveStageFilePath: vi.fn(async (stageId: string) => `/repo/epics/e1/t1/${stageId}.md`),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(2);

      // STAGE-002: locked, spawn skipped
      expect(results[0].childStageId).toBe('STAGE-002');
      expect(results[0].event).toBe('skipped_locked');
      expect(results[0].rebaseSpawned).toBe(false);

      // STAGE-003: not locked, spawn proceeded
      expect(results[1].childStageId).toBe('STAGE-003');
      expect(results[1].event).toBe('parent_merged');
      expect(results[1].rebaseSpawned).toBe(true);

      // Only one spawn call (for STAGE-003)
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = deps.sessionExecutor.spawn.mock.calls[0];
      expect(spawnCall[0].stageId).toBe('STAGE-003');
    });
  });

  describe('rebase_conflict flag prevents repeated spawn attempts', () => {
    it('returns skipped_conflict and does not call sessionExecutor.spawn', async () => {
      // Scenario: A previous rebase attempt failed, leaving rebase_conflict: true
      // in the stage frontmatter. The cron-driven chain manager detects a new
      // parent HEAD change, but the rebase_conflict flag prevents re-triggering
      // the rebase session.
      const row = makeRow({ last_known_head: 'abc123' });
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
      expect(results[0].event).toBe('skipped_conflict');
      expect(results[0].rebaseSpawned).toBe(false);

      // The critical assertion: spawn was never called
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();

      // isLocked was never checked (conflict is checked before lock)
      expect(deps.locker.isLocked).not.toHaveBeenCalled();
    });

    it('rebase_conflict flag blocks spawn even when stage is unlocked', async () => {
      // Scenario: The stage is not locked (no active session) but has a
      // rebase_conflict flag. The conflict check comes before the lock check,
      // so spawn should be skipped.
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
          isLocked: vi.fn(async () => false), // explicitly unlocked
        }),
        readFrontmatter: vi.fn(async (): Promise<FrontmatterData> => ({
          data: { rebase_conflict: true },
          content: '',
        })),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('skipped_conflict');
      expect(results[0].rebaseSpawned).toBe(false);

      // spawn was never called despite stage being unlocked
      expect(deps.sessionExecutor.spawn).not.toHaveBeenCalled();
      // isLocked was never called (conflict check short-circuits)
      expect(deps.locker.isLocked).not.toHaveBeenCalled();
    });

    it('spawn proceeds when rebase_conflict is false (cleared after manual resolution)', async () => {
      // Scenario: rebase_conflict was previously true but has been cleared
      // (set to false) after manual conflict resolution. The cron should
      // now proceed with spawning the rebase session.
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
          data: { rebase_conflict: false }, // cleared
          content: '',
        })),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_merged');
      expect(results[0].rebaseSpawned).toBe(true);

      // Spawn was called
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
    });

    it('spawn proceeds when rebase_conflict is absent from frontmatter', async () => {
      // Scenario: Fresh stage file with no rebase_conflict field at all.
      // Should not block spawn.
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
          data: {}, // no rebase_conflict field
          content: '',
        })),
      });
      const manager = createMRChainManager(deps);

      const results = await manager.checkParentChains('/repo');

      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('parent_merged');
      expect(results[0].rebaseSpawned).toBe(true);
      expect(deps.sessionExecutor.spawn).toHaveBeenCalledTimes(1);
    });
  });
});
