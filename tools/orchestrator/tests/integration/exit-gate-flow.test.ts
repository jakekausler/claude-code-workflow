import { describe, it, expect, vi } from 'vitest';
import { createExitGateRunner, type ExitGateDeps } from '../../src/exit-gates.js';
import type { FrontmatterData } from '../../src/locking.js';
import type { WorkerInfo } from '../../src/types.js';
import { makeFrontmatterStore, makeLogger } from './helpers.js';

/**
 * Integration tests for the exit gate flow.
 *
 * These exercise the REAL ExitGateRunner logic end-to-end,
 * mocking only the I/O layer (frontmatter read/write, sync).
 * The tests verify the full chain of effects: stage status change ->
 * ticket stage_statuses update -> ticket status derivation ->
 * epic ticket_statuses update -> sync.
 */

const REPO_PATH = '/repo';

/** Build a standard WorkerInfo for testing. */
function makeWorkerInfo(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    stageId: 'STAGE-001-001-001',
    stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
    worktreePath: '/worktrees/0',
    worktreeIndex: 0,
    statusBefore: 'Build',
    startTime: Date.now(),
    ...overrides,
  };
}

/** Build mock deps backed by the frontmatter store. */
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
  store: Record<string, FrontmatterData>;
} {
  const fm = makeFrontmatterStore(frontmatterEntries);
  const logger = makeLogger();

  return {
    readFrontmatter: fm.readFrontmatter,
    writeFrontmatter: fm.writeFrontmatter,
    runSync: vi.fn(async () => ({ ...syncResult })),
    logger,
    store: fm.store,
  };
}

describe('Exit Gate Flow Integration', () => {
  describe('Stage transitions from Build to Automatic Testing', () => {
    it('propagates status change through ticket and epic hierarchy', async () => {
      const deps = makeDeps({
        // Stage file
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Automatic Testing',
          },
          content: '# Stage\n',
        },
        // Ticket file — two stages, one is Build, one is Not Started
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'Not Started',
            stage_statuses: {
              'STAGE-001-001-001': 'Build',
              'STAGE-001-001-002': 'Not Started',
            },
          },
          content: '# Ticket\n',
        },
        // Epic file
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001'],
            ticket_statuses: {
              'TICKET-001-001': 'Not Started',
            },
          },
          content: '# Epic\n',
        },
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Build' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Automatic Testing');

      // Status changed
      expect(result.statusChanged).toBe(true);
      expect(result.statusBefore).toBe('Build');
      expect(result.statusAfter).toBe('Automatic Testing');

      // Ticket was updated
      expect(result.ticketUpdated).toBe(true);

      // Verify ticket's stage_statuses in the store
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Automatic Testing');
      expect(stageStatuses['STAGE-001-001-002']).toBe('Not Started');

      // Ticket derived status should be "In Progress" (one stage is Automatic Testing, one is Not Started)
      expect(ticketData.status).toBe('In Progress');

      // Epic was updated
      expect(result.epicUpdated).toBe(true);

      // Verify epic's ticket_statuses in the store
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      const ticketStatuses = epicData.ticket_statuses as Record<string, string>;
      expect(ticketStatuses['TICKET-001-001']).toBe('In Progress');

      // Sync was called
      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
      expect(result.syncResult.success).toBe(true);
    });
  });

  describe('All stages complete — ticket derives as Complete', () => {
    it('derives ticket status to Complete and updates epic accordingly', async () => {
      const deps = makeDeps({
        // Stage file — transitioning to Complete
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage\n',
        },
        // Ticket file — other stage already Complete
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'Finalize',
              'STAGE-001-001-002': 'Complete',
            },
          },
          content: '# Ticket\n',
        },
        // Epic file — single ticket
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

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Finalize' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Complete');

      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);
      expect(result.epicUpdated).toBe(true);

      // Both stages now Complete
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Complete');
      expect(stageStatuses['STAGE-001-001-002']).toBe('Complete');

      // Ticket derived to Complete
      expect(ticketData.status).toBe('Complete');

      // Epic ticket_statuses updated to Complete
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001-001']).toBe('Complete');

      // Sync was called
      expect(deps.runSync).toHaveBeenCalledWith(REPO_PATH);
    });
  });

  describe('Status unchanged — early return', () => {
    it('returns early with no writes and no sync when statusBefore === statusAfter', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Build',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: { 'STAGE-001-001-001': 'Build' },
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

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Build' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Build');

      // No change
      expect(result.statusChanged).toBe(false);
      expect(result.ticketUpdated).toBe(false);
      expect(result.epicUpdated).toBe(false);

      // No reads, no writes, no sync
      expect(deps.readFrontmatter).not.toHaveBeenCalled();
      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
      expect(deps.runSync).not.toHaveBeenCalled();

      // syncResult should still report success (early return default)
      expect(result.syncResult.success).toBe(true);
    });
  });

  describe('completion cascade', () => {
    // Differs from "All stages complete" above: this tests a multi-ticket epic (2 tickets) and asserts epicCompleted.
    it('cascades stage Complete through ticket to epic', async () => {
      // Multi-stage ticket (2 stages), multi-ticket epic (2 tickets).
      // STAGE-001-001-001 transitions to Complete; STAGE-001-001-002 already Complete.
      // TICKET-001-002 is already Complete in the epic.
      // Expected: ticket derives Complete -> epic derives Complete.
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'Finalize',
              'STAGE-001-001-002': 'Complete',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001', 'TICKET-001-002'],
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
              'TICKET-001-002': 'Complete',
            },
          },
          content: '# Epic\n',
        },
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Finalize' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Complete');

      // Full cascade: stage -> ticket -> epic all Complete
      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);
      expect(result.epicUpdated).toBe(true);
      expect(result.ticketCompleted).toBe(true);
      expect(result.epicCompleted).toBe(true);

      // Ticket derived to Complete
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect(ticketData.status).toBe('Complete');

      // Epic derived to Complete (both tickets now Complete)
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect(epicData.status).toBe('Complete');

      // Sync was called exactly once (no retry needed since mock returns success)
      expect(deps.runSync).toHaveBeenCalledTimes(1);
    });

    it('partial completion — ticket completes but epic does not', async () => {
      // Stage completes -> ticket derives Complete
      // But epic has another ticket still In Progress -> epic stays In Progress
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001'],
            status: 'In Progress',
            stage_statuses: {
              'STAGE-001-001-001': 'Finalize',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001', 'TICKET-001-002'],
            ticket_statuses: {
              'TICKET-001-001': 'In Progress',
              'TICKET-001-002': 'In Progress',
            },
          },
          content: '# Epic\n',
        },
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Finalize' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Complete');

      // Ticket completes, but epic does NOT
      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);
      expect(result.epicUpdated).toBe(true);
      expect(result.ticketCompleted).toBe(true);
      expect(result.epicCompleted).toBe(false);

      // Ticket derived to Complete (single stage, now Complete)
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect(ticketData.status).toBe('Complete');

      // Epic remains In Progress (TICKET-001-002 still In Progress)
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect(epicData.status).toBe('In Progress');

      // Sync was called
      expect(deps.runSync).toHaveBeenCalledTimes(1);
    });

    it('reverse cascade — revert stage un-completes ticket and epic', async () => {
      // Everything was Complete. Stage reverts from Complete to Build.
      // Ticket should derive In Progress (one stage Build, one Complete).
      // Epic should derive In Progress (ticket no longer Complete).
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Build',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
            status: 'Complete',
            stage_statuses: {
              'STAGE-001-001-001': 'Complete',
              'STAGE-001-001-002': 'Complete',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001'],
            ticket_statuses: {
              'TICKET-001-001': 'Complete',
            },
            status: 'Complete',
          },
          content: '# Epic\n',
        },
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Complete' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Build');

      // Reverse cascade: neither ticket nor epic remain Complete
      expect(result.statusChanged).toBe(true);
      expect(result.ticketUpdated).toBe(true);
      expect(result.epicUpdated).toBe(true);
      expect(result.ticketCompleted).toBe(false);
      expect(result.epicCompleted).toBe(false);

      // Ticket derives In Progress (one stage Build, one Complete)
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect(ticketData.status).toBe('In Progress');
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Build');
      expect(stageStatuses['STAGE-001-001-002']).toBe('Complete');

      // Epic derives In Progress (ticket is no longer Complete)
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect(epicData.status).toBe('In Progress');

      // Sync was called
      expect(deps.runSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multi-ticket epic propagation', () => {
    it('updates epic with correct ticket status when multiple tickets exist', async () => {
      const deps = makeDeps({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Complete',
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Not Started',
            stage_statuses: {
              'STAGE-001-001-001': 'Not Started',
            },
          },
          content: '# Ticket\n',
        },
        '/repo/epics/EPIC-001/EPIC-001.md': {
          data: {
            id: 'EPIC-001',
            tickets: ['TICKET-001-001', 'TICKET-001-002'],
            ticket_statuses: {
              'TICKET-001-001': 'Not Started',
              'TICKET-001-002': 'Complete',
            },
          },
          content: '# Epic\n',
        },
      });

      const runner = createExitGateRunner(deps);
      const workerInfo = makeWorkerInfo({ statusBefore: 'Not Started' });

      const result = await runner.run(workerInfo, REPO_PATH, 'Complete');

      expect(result.epicUpdated).toBe(true);

      // Ticket derived to Complete (single stage, now Complete)
      const ticketData = deps.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect(ticketData.status).toBe('Complete');

      // Epic's ticket_statuses: TICKET-001-001 now Complete, TICKET-001-002 was already Complete
      const epicData = deps.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      const ticketStatuses = epicData.ticket_statuses as Record<string, string>;
      expect(ticketStatuses['TICKET-001-001']).toBe('Complete');
      // TICKET-001-002 remains unchanged
      expect(ticketStatuses['TICKET-001-002']).toBe('Complete');
    });
  });
});
