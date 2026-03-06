import { describe, it, expect, vi } from 'vitest';
import { createMRCommentPoller, type MRCommentPollerDeps, type MRPollResult, type MrCommentTrackingRow } from '../src/mr-comment-poller.js';
import type { StageRow, PRStatus, CodeHostAdapter } from 'kanban-cli';
import type { ExitGateRunner, ExitGateResult } from '../src/exit-gates.js';
import type { FrontmatterData } from '../src/locking.js';

const REPO_PATH = '/repo';
const NOW = 1700000000000;

/** Build a default StageRow for testing */
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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Build a mock CodeHostAdapter */
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

/** Build standard poller deps with overrides */
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

describe('createMRCommentPoller', () => {
  it('returns empty results when no stages in PR Created', async () => {
    const deps = makePollerDeps();
    const poller = createMRCommentPoller(deps);

    const results = await poller.poll(REPO_PATH);

    expect(results).toEqual([]);
    expect(deps.queryStagesInPRCreated).toHaveBeenCalledWith(REPO_PATH, 20);
    expect(deps.exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('transitions stage to Done when PR is merged', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ merged: true, state: 'merged' });
    const exitGateRunner = makeExitGateRunner();
    const fm = makeFrontmatterStore({
      [stage.file_path]: {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
    });

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      codeHost,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'merged',
    });

    // Frontmatter was updated to Done
    expect(fm.writeFrontmatter).toHaveBeenCalledWith(
      stage.file_path,
      expect.objectContaining({ status: 'Done' }),
      '# Stage\n',
    );

    // Exit gate was called with correct WorkerInfo
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
    const workerInfoArg = exitGateRunner.run.mock.calls[0][0];
    expect(workerInfoArg.stageId).toBe('STAGE-001');
    expect(workerInfoArg.stageFilePath).toBe(stage.file_path);
    expect(workerInfoArg.worktreePath).toBe('');
    expect(workerInfoArg.worktreeIndex).toBe(-1);
    expect(workerInfoArg.statusBefore).toBe('PR Created');
    expect(exitGateRunner.run.mock.calls[0][1]).toBe(REPO_PATH);
    expect(exitGateRunner.run.mock.calls[0][2]).toBe('Done');

    // Comment tracking was updated
    expect(deps.upsertCommentTracking).toHaveBeenCalledWith({
      stageId: 'STAGE-001',
      timestamp: new Date(NOW).toISOString(),
      count: 0,
      repoId: 1,
    });
  });

  it('transitions stage to Addressing Comments when unresolved count increases', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ unresolvedThreadCount: 3, hasUnresolvedComments: true });
    const exitGateRunner = makeExitGateRunner({
      statusAfter: 'Addressing Comments',
    });
    const fm = makeFrontmatterStore({
      [stage.file_path]: {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
    });

    const tracking: MrCommentTrackingRow = {
      stage_id: 'STAGE-001',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 1,
      repo_id: 1,
    };

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      getCommentTracking: vi.fn(() => tracking),
      codeHost,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'new_comments',
      newUnresolvedCount: 3,
      previousUnresolvedCount: 1,
    });

    // Frontmatter was updated to Addressing Comments
    expect(fm.writeFrontmatter).toHaveBeenCalledWith(
      stage.file_path,
      expect.objectContaining({ status: 'Addressing Comments' }),
      '# Stage\n',
    );

    // Exit gate was called for Addressing Comments transition
    expect(exitGateRunner.run).toHaveBeenCalledTimes(1);
    expect(exitGateRunner.run.mock.calls[0][2]).toBe('Addressing Comments');
  });

  it('returns no_change when unresolved count stays the same', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ unresolvedThreadCount: 2 });

    const tracking: MrCommentTrackingRow = {
      stage_id: 'STAGE-001',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 2,
      repo_id: 1,
    };

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      getCommentTracking: vi.fn(() => tracking),
      codeHost,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'no_change',
      newUnresolvedCount: 2,
      previousUnresolvedCount: 2,
    });

    expect(deps.exitGateRunner.run).not.toHaveBeenCalled();
    // Tracking was still updated (timestamp refreshed)
    expect(deps.upsertCommentTracking).toHaveBeenCalled();
  });

  it('returns no_change when unresolved count decreases', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ unresolvedThreadCount: 1 });

    const tracking: MrCommentTrackingRow = {
      stage_id: 'STAGE-001',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 3,
      repo_id: 1,
    };

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      getCommentTracking: vi.fn(() => tracking),
      codeHost,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'no_change',
      newUnresolvedCount: 1,
      previousUnresolvedCount: 3,
    });

    expect(deps.exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('logs warning and returns empty when code host adapter is null', async () => {
    const logger = makeLogger();
    const deps = makePollerDeps({
      codeHost: null,
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('No code host adapter available, skipping MR comment poll');
    expect(deps.queryStagesInPRCreated).not.toHaveBeenCalled();
  });

  it('enforces maxStagesPerCycle cap', async () => {
    const deps = makePollerDeps({
      maxStagesPerCycle: 5,
    });

    const poller = createMRCommentPoller(deps);
    await poller.poll(REPO_PATH);

    expect(deps.queryStagesInPRCreated).toHaveBeenCalledWith(REPO_PATH, 5);
  });

  it('creates tracking on first poll without triggering transition', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ unresolvedThreadCount: 2, hasUnresolvedComments: true });

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      getCommentTracking: vi.fn(() => null), // No existing tracking
      codeHost,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'first_poll',
      newUnresolvedCount: 2,
    });

    // No exit gate transition on first poll
    expect(deps.exitGateRunner.run).not.toHaveBeenCalled();

    // Tracking was created with baseline count
    expect(deps.upsertCommentTracking).toHaveBeenCalledWith({
      stageId: 'STAGE-001',
      timestamp: new Date(NOW).toISOString(),
      count: 2,
      repoId: 1,
    });
  });

  it('logs error and continues to next stage when PR status fetch fails', async () => {
    const stage1 = makeStageRow({ id: 'STAGE-001' });
    const stage2 = makeStageRow({
      id: 'STAGE-002',
      file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
    });

    let callCount = 0;
    const codeHost: CodeHostAdapter = {
      getPRStatus: vi.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('GitHub API timeout');
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'open' };
      }),
      editPRBase: vi.fn(),
      markPRReady: vi.fn(),
      getBranchHead: vi.fn(() => 'abc123'),
    };

    const tracking: MrCommentTrackingRow = {
      stage_id: 'STAGE-002',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 0,
      repo_id: 1,
    };

    const logger = makeLogger();
    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage1, stage2]),
      getCommentTracking: vi.fn((stageId: string) => stageId === 'STAGE-002' ? tracking : null),
      codeHost,
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    // First stage errored, second stage processed
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
        error: 'GitHub API timeout',
      }),
    );
  });

  it('handles query failure gracefully', async () => {
    const logger = makeLogger();
    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => { throw new Error('DB connection lost'); }),
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to query stages in PR Created',
      expect.objectContaining({
        repoPath: REPO_PATH,
        error: 'DB connection lost',
      }),
    );
  });

  it('handles exit gate failure on merge gracefully (still records result)', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ merged: true });
    const exitGateRunner = makeExitGateRunner();
    exitGateRunner.run = vi.fn(async () => { throw new Error('Sync failed'); });

    const fm = makeFrontmatterStore({
      [stage.file_path]: {
        data: { id: 'STAGE-001', status: 'PR Created' },
        content: '# Stage\n',
      },
    });
    const logger = makeLogger();

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      codeHost,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    // Still records merged action despite exit gate failure
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('merged');

    // Error was logged
    expect(logger.error).toHaveBeenCalledWith(
      'Exit gate failed for merge transition',
      expect.objectContaining({ stageId: 'STAGE-001', error: 'Sync failed' }),
    );

    // Tracking still updated despite exit gate failure
    expect(deps.upsertCommentTracking).toHaveBeenCalled();
  });

  it('handles writeFrontmatter failure during Addressing Comments transition', async () => {
    const stage = makeStageRow();
    const codeHost = makeCodeHost({ unresolvedThreadCount: 5, hasUnresolvedComments: true });
    const exitGateRunner = makeExitGateRunner({ statusAfter: 'Addressing Comments' });

    const tracking: MrCommentTrackingRow = {
      stage_id: 'STAGE-001',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 1,
      repo_id: 1,
    };

    const fm = makeFrontmatterStore({
      [stage.file_path]: {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage\n',
      },
    });
    // Override writeFrontmatter to throw
    fm.writeFrontmatter = vi.fn(async () => { throw new Error('Disk full'); });

    const logger = makeLogger();

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      getCommentTracking: vi.fn(() => tracking),
      codeHost,
      exitGateRunner,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stageId: 'STAGE-001',
      prUrl: 'https://github.com/org/repo/pull/42',
      action: 'error',
    });

    // Error was logged
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to update stage frontmatter for comments',
      expect.objectContaining({ stageId: 'STAGE-001', error: 'Disk full' }),
    );

    // Exit gate was NOT called (frontmatter write failed before it)
    expect(exitGateRunner.run).not.toHaveBeenCalled();
  });

  it('skips stage with missing pr_url and logs warning', async () => {
    const stage = makeStageRow({ pr_url: null as unknown as string });
    const logger = makeLogger();

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage]),
      logger,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Stage in PR Created missing pr_url',
      expect.objectContaining({ stageId: 'STAGE-001' }),
    );
  });

  it('processes multiple stages in sequence', async () => {
    const stage1 = makeStageRow({
      id: 'STAGE-001',
      file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
    });
    const stage2 = makeStageRow({
      id: 'STAGE-002',
      file_path: '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md',
    });

    // Stage 1: merged, Stage 2: unchanged
    let getPRStatusCallCount = 0;
    const codeHost: CodeHostAdapter = {
      getPRStatus: vi.fn(() => {
        getPRStatusCallCount++;
        if (getPRStatusCallCount === 1) return { merged: true, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'merged' };
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 1, state: 'open' };
      }),
      editPRBase: vi.fn(),
      markPRReady: vi.fn(),
      getBranchHead: vi.fn(() => 'abc123'),
    };

    const tracking2: MrCommentTrackingRow = {
      stage_id: 'STAGE-002',
      last_poll_timestamp: '2024-01-01T00:00:00Z',
      last_known_unresolved_count: 1,
      repo_id: 1,
    };

    const fm = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
        data: { id: 'STAGE-001', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 1\n',
      },
      '/repo/epics/EPIC-001/TICKET-001/STAGE-002.md': {
        data: { id: 'STAGE-002', status: 'PR Created', ticket: 'TICKET-001', epic: 'EPIC-001' },
        content: '# Stage 2\n',
      },
    });

    const deps = makePollerDeps({
      queryStagesInPRCreated: vi.fn(async () => [stage1, stage2]),
      getCommentTracking: vi.fn((stageId: string) => {
        if (stageId === 'STAGE-002') return tracking2;
        return null; // First poll for stage1 doesn't matter since it's merged
      }),
      codeHost,
      readFrontmatter: fm.readFrontmatter,
      writeFrontmatter: fm.writeFrontmatter,
    });

    const poller = createMRCommentPoller(deps);
    const results = await poller.poll(REPO_PATH);

    expect(results).toHaveLength(2);
    expect(results[0].stageId).toBe('STAGE-001');
    expect(results[0].action).toBe('merged');
    expect(results[1].stageId).toBe('STAGE-002');
    expect(results[1].action).toBe('no_change');
  });
});
