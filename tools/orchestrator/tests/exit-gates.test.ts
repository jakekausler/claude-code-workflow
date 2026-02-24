import { describe, it, expect, vi } from 'vitest';
import { createExitGateRunner, deriveTicketStatus, deriveEpicStatus, type ExitGateDeps } from '../src/exit-gates.js';
import type { FrontmatterData } from '../src/locking.js';
import type { WorkerInfo } from '../src/types.js';

/** Build a standard WorkerInfo for testing. */
function makeWorkerInfo(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    stageId: 'STAGE-001',
    stageFilePath: '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md',
    worktreePath: '/worktrees/0',
    worktreeIndex: 0,
    statusBefore: 'Not Started',
    startTime: Date.now(),
    ...overrides,
  };
}

/** Build mock frontmatter data keyed by file path. */
function makeFrontmatterStore(entries: Record<string, FrontmatterData>): Record<string, FrontmatterData> {
  // Deep clone each entry so mutations in tests don't bleed across calls
  const store: Record<string, FrontmatterData> = {};
  for (const [key, value] of Object.entries(entries)) {
    store[key] = structuredClone({ data: value.data, content: value.content });
  }
  return store;
}

/** Build mock deps with controlled frontmatter data and sync behavior. */
function makeDeps(
  frontmatterEntries: Record<string, FrontmatterData>,
  syncResult: { success: boolean; error?: string } = { success: true },
): ExitGateDeps & {
  readFrontmatter: ReturnType<typeof vi.fn>;
  writeFrontmatter: ReturnType<typeof vi.fn>;
  runSync: ReturnType<typeof vi.fn>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  const store = makeFrontmatterStore(frontmatterEntries);

  return {
    readFrontmatter: vi.fn(async (filePath: string) => {
      const entry = store[filePath];
      if (!entry) throw new Error(`ENOENT: ${filePath}`);
      // Return a fresh copy so mutations within the runner are captured by writeFrontmatter
      return structuredClone({ data: entry.data, content: entry.content });
    }),
    writeFrontmatter: vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
      // Update the store so subsequent reads reflect writes
      store[filePath] = structuredClone({ data, content });
    }),
    runSync: vi.fn(async () => ({ ...syncResult })),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

const REPO_PATH = '/repo';

describe('deriveTicketStatus', () => {
  it('returns null for empty map', () => {
    expect(deriveTicketStatus({})).toBeNull();
  });

  it('returns "Complete" when all stages are Complete', () => {
    expect(deriveTicketStatus({
      'STAGE-001': 'Complete',
      'STAGE-002': 'Complete',
    })).toBe('Complete');
  });

  it('returns "Not Started" when all stages are Not Started', () => {
    expect(deriveTicketStatus({
      'STAGE-001': 'Not Started',
      'STAGE-002': 'Not Started',
    })).toBe('Not Started');
  });

  it('returns "In Progress" for mixed statuses', () => {
    expect(deriveTicketStatus({
      'STAGE-001': 'Complete',
      'STAGE-002': 'Not Started',
    })).toBe('In Progress');
  });

  it('returns "In Progress" when any stage has a pipeline phase status', () => {
    expect(deriveTicketStatus({
      'STAGE-001': 'Implementation',
      'STAGE-002': 'Not Started',
    })).toBe('In Progress');
  });
});

describe('deriveEpicStatus', () => {
  it('returns null for empty map', () => {
    expect(deriveEpicStatus({})).toBeNull();
  });

  it('returns Complete when all tickets are Complete', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'Complete',
    })).toBe('Complete');
  });

  it('returns Not Started when all tickets are Not Started', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Not Started',
      'TICKET-001-002': 'Not Started',
    })).toBe('Not Started');
  });

  it('returns In Progress for mixed statuses', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'In Progress',
    })).toBe('In Progress');
  });

  it('returns In Progress when some Complete and some Not Started', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'Not Started',
    })).toBe('In Progress');
  });
});

describe('createExitGateRunner', () => {
  describe('early return', () => {
    it('returns early when status unchanged (statusBefore === statusAfter)', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Not Started' },
          content: '# Stage\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Not Started');

      expect(result.statusChanged).toBe(false);
      expect(result.statusBefore).toBe('Not Started');
      expect(result.statusAfter).toBe('Not Started');
      expect(result.ticketUpdated).toBe(false);
      expect(result.epicUpdated).toBe(false);
      expect(result.syncResult.success).toBe(true);
      // Should not read any frontmatter files
      expect(deps.readFrontmatter).not.toHaveBeenCalled();
      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
      expect(deps.runSync).not.toHaveBeenCalled();
    });
  });

  describe('ticket frontmatter update', () => {
    it('updates ticket frontmatter with new stage status', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'In Progress', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);

      // Check that ticket frontmatter was written with correct stage_statuses
      const ticketWriteCall = deps.writeFrontmatter.mock.calls.find(
        (call: unknown[]) => call[0] === '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md',
      );
      expect(ticketWriteCall).toBeDefined();
      const ticketData = ticketWriteCall![1] as Record<string, unknown>;
      expect((ticketData.stage_statuses as Record<string, string>)['STAGE-001']).toBe('Implementation');
    });
  });

  describe('ticket status derivation', () => {
    it('derives ticket status as "Complete" when all stages are Complete', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Complete' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: {
            id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'In Progress',
            stage_statuses: { 'STAGE-001': 'Implementation', 'STAGE-002': 'Complete' },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'In Progress', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Implementation' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Complete');

      expect(result.ticketUpdated).toBe(true);
      const ticketWriteCall = deps.writeFrontmatter.mock.calls.find(
        (call: unknown[]) => call[0] === '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md',
      );
      const ticketData = ticketWriteCall![1] as Record<string, unknown>;
      expect(ticketData.status).toBe('Complete');
    });

    it('derives ticket status as "In Progress" for mixed statuses', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: {
            id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started',
            stage_statuses: { 'STAGE-001': 'Not Started', 'STAGE-002': 'Not Started' },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'In Progress', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.ticketUpdated).toBe(true);
      const ticketWriteCall = deps.writeFrontmatter.mock.calls.find(
        (call: unknown[]) => call[0] === '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md',
      );
      const ticketData = ticketWriteCall![1] as Record<string, unknown>;
      // STAGE-001 is now "Implementation", STAGE-002 is still "Not Started" -> mixed -> "In Progress"
      expect(ticketData.status).toBe('In Progress');
    });

    it('derives ticket status as "Not Started" when all stages are Not Started', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Not Started' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: {
            id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'In Progress',
            stage_statuses: { 'STAGE-001': 'Implementation', 'STAGE-002': 'Not Started' },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'In Progress', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      // statusBefore was Implementation, now going back to Not Started
      const workerInfo = makeWorkerInfo({ statusBefore: 'Implementation' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Not Started');

      expect(result.ticketUpdated).toBe(true);
      const ticketWriteCall = deps.writeFrontmatter.mock.calls.find(
        (call: unknown[]) => call[0] === '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md',
      );
      const ticketData = ticketWriteCall![1] as Record<string, unknown>;
      // STAGE-001 is now "Not Started", STAGE-002 is also "Not Started" -> all Not Started
      expect(ticketData.status).toBe('Not Started');
    });
  });

  describe('epic frontmatter update', () => {
    it('updates epic frontmatter with derived ticket status', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: {
            id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started',
            stage_statuses: { 'STAGE-001': 'Not Started' },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.epicUpdated).toBe(true);
      const epicWriteCall = deps.writeFrontmatter.mock.calls.find(
        (call: unknown[]) => call[0] === '/repo/epics/EPIC-001/EPIC-001.md',
      );
      expect(epicWriteCall).toBeDefined();
      const epicData = epicWriteCall![1] as Record<string, unknown>;
      // Derived ticket status: STAGE-001 is "Implementation" -> "In Progress"
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001']).toBe('In Progress');
    });
  });

  describe('sync', () => {
    it('calls runSync after updates', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
      expect(result.syncResult.success).toBe(true);
    });

    it('retries sync once on failure, then warns', async () => {
      let callCount = 0;
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      // Override runSync to fail both times
      deps.runSync = vi.fn(async () => {
        callCount++;
        return { success: false, error: `sync error attempt ${callCount}` };
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(deps.runSync).toHaveBeenCalledTimes(2);
      expect(result.syncResult.success).toBe(false);
      expect(result.syncResult.error).toContain('sync error attempt 2');
      // Should have warned about failure and retry
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Sync failed, retrying once',
        expect.objectContaining({ error: expect.stringContaining('sync error attempt 1') }),
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Sync failed on retry',
        expect.objectContaining({ error: expect.stringContaining('sync error attempt 2') }),
      );
    });

    it('succeeds on retry if second attempt passes', async () => {
      let callCount = 0;
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      deps.runSync = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { success: false, error: 'first attempt failed' };
        return { success: true };
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(deps.runSync).toHaveBeenCalledTimes(2);
      expect(result.syncResult.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles missing ticket file gracefully (logs warning, continues)', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        // No ticket file
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.ticketUpdated).toBe(false);
      // Epic is not updated because derivedStatus is null when ticket read fails
      expect(result.epicUpdated).toBe(false);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to update ticket frontmatter',
        expect.objectContaining({ ticketFilePath: '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md' }),
      );
      // Should still have called sync
      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
    });

    it('handles missing epic file gracefully (logs warning, continues)', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        // No epic file
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.ticketUpdated).toBe(true);
      expect(result.epicUpdated).toBe(false);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to update epic frontmatter',
        expect.objectContaining({ epicFilePath: '/repo/epics/EPIC-001/EPIC-001.md' }),
      );
      // Should still have called sync
      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
    });

    it('handles stage file read failure gracefully (no ticket/epic updates, sync still runs)', async () => {
      const deps = makeDeps({
        // No stage file — readFrontmatter will throw for the stage path
        '/repo/epics/EPIC-001/TICKET-001/TICKET-001.md': {
          data: { id: 'TICKET-001', epic: 'EPIC-001', title: 'Ticket', status: 'Not Started', stage_statuses: {} },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: { id: 'EPIC-001', title: 'Epic', status: 'Not Started', ticket_statuses: {} },
          content: '# Epic\n',
        },
      });
      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(false);
      expect(result.epicUpdated).toBe(false);
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Failed to read stage frontmatter',
        expect.objectContaining({ stageFilePath: workerInfo.stageFilePath }),
      );
      // Sync should still run even when stage read fails
      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
      expect(result.syncResult.success).toBe(true);
    });

    it('never throws even when all operations fail', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001/STAGE-001.md': {
          data: { id: 'STAGE-001', ticket: 'TICKET-001', epic: 'EPIC-001', status: 'Implementation' },
          content: '# Stage\n',
        },
        // No ticket file, no epic file
      });
      deps.runSync = vi.fn(async () => ({ success: false, error: 'sync error' }));

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      // Should not throw
      const result = await runner.run(workerInfo, REPO_PATH, 'Implementation');

      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(false);
      expect(result.epicUpdated).toBe(false);
      expect(result.syncResult.success).toBe(false);
    });
  });
});
