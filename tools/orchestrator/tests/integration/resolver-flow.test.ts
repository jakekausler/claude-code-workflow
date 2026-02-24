import { describe, it, expect, vi } from 'vitest';
import { createExitGateRunner } from '../../src/exit-gates.js';
import { createResolverRunner } from '../../src/resolvers.js';
import type { PipelineConfig, ResolverContext, CodeHostAdapter } from 'kanban-cli';
import { ResolverRegistry, prStatusResolver, testingRouterResolver } from 'kanban-cli';
import { makeFrontmatterStore, makeLogger } from './helpers.js';

/**
 * Integration tests for the resolver flow.
 *
 * These exercise the REAL ResolverRunner + REAL ExitGateRunner + REAL resolver
 * functions from kanban-cli, wired together end-to-end.
 * Only the I/O layer is mocked (frontmatter read/write, sync, stage discovery).
 *
 * The tests verify the complete chain:
 * resolver execution -> stage frontmatter update -> exit gate propagation ->
 * ticket/epic frontmatter update -> sync.
 */

const REPO_PATH = '/repo';

/** Pipeline config with PR Created as a resolver state. */
function makePRPipelineConfig(): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'Design', skill: 'design', transitions_to: ['Build'] },
        { name: 'Build', status: 'Build', skill: 'implement', transitions_to: ['PR Created'] },
        { name: 'PR Created', status: 'PR Created', resolver: 'pr-status', transitions_to: ['Done'] },
      ],
    },
  };
}

/** Pipeline config with testing-router as a resolver state. */
function makeTestingRouterPipelineConfig(): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', status: 'Design', skill: 'design', transitions_to: ['Build'] },
        { name: 'Build', status: 'Build', skill: 'implement', transitions_to: ['Automatic Testing'] },
        { name: 'Automatic Testing', status: 'Automatic Testing', skill: 'auto-test', transitions_to: ['Testing Router'] },
        { name: 'Testing Router', status: 'Testing Router', resolver: 'testing-router', transitions_to: ['Manual Testing', 'Finalize'] },
        { name: 'Manual Testing', status: 'Manual Testing', skill: 'manual-test', transitions_to: ['Finalize'] },
        { name: 'Finalize', status: 'Finalize', skill: 'finalize', transitions_to: ['Done'] },
      ],
    },
  };
}

/** Build a mock CodeHostAdapter. */
function makeCodeHost(prStatus: { merged: boolean; hasUnresolvedComments: boolean; state: string }): CodeHostAdapter {
  return {
    getPRStatus: () => prStatus,
    editPRBase: () => {},
    markPRReady: () => {},
    getBranchHead: () => '',
  };
}

describe('Resolver Flow Integration', () => {
  describe('PR merged -> stage transitions to Done', () => {
    it('propagates through resolver, exit gate, ticket, and epic', async () => {
      const fm = makeFrontmatterStore({
        // Stage in PR Created state
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            session_active: false,
            pr_url: 'https://github.com/org/repo/pull/1',
          },
          content: '# Stage\n',
        },
        // Ticket file
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
        // Epic file
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

      // Build real registry with the real pr-status resolver
      const registry = new ResolverRegistry();
      registry.register('pr-status', prStatusResolver);

      // Build real exit gate runner with mock I/O
      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      // Build real resolver runner with real registry and real exit gate
      const resolverRunner = createResolverRunner(makePRPipelineConfig(), {
        registry,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        discoverStageFiles: vi.fn(async () => [
          '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
        ]),
        logger,
      });

      // Context with code host that says PR is merged
      const context: ResolverContext = {
        codeHost: makeCodeHost({ merged: true, hasUnresolvedComments: false, state: 'merged' }),
        env: {},
      };

      const results = await resolverRunner.checkAll(REPO_PATH, context);

      // Should have one result
      expect(results).toHaveLength(1);
      expect(results[0].stageId).toBe('STAGE-001-001-001');
      expect(results[0].resolverName).toBe('pr-status');
      expect(results[0].previousStatus).toBe('PR Created');
      expect(results[0].newStatus).toBe('Done');
      expect(results[0].propagated).toBe(true);

      // Stage frontmatter updated to Done (by resolver runner)
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('Done');

      // Ticket's stage_statuses updated (by exit gate)
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      const stageStatuses = ticketData.stage_statuses as Record<string, string>;
      expect(stageStatuses['STAGE-001-001-001']).toBe('Done');

      // Ticket derived status: single stage "Done" -> "In Progress" (Done is not Complete)
      expect(ticketData.status).toBe('In Progress');

      // Epic's ticket_statuses updated
      const epicData = fm.store['/repo/epics/EPIC-001/EPIC-001.md'].data;
      expect((epicData.ticket_statuses as Record<string, string>)['TICKET-001-001']).toBe('In Progress');

      // Sync was called
      expect(runSync).toHaveBeenCalledWith(REPO_PATH);
    });
  });

  describe('PR not merged -> no transition', () => {
    it('returns null newStatus and makes no frontmatter writes', async () => {
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            session_active: false,
            pr_url: 'https://github.com/org/repo/pull/1',
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

      const registry = new ResolverRegistry();
      registry.register('pr-status', prStatusResolver);

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const resolverRunner = createResolverRunner(makePRPipelineConfig(), {
        registry,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        discoverStageFiles: vi.fn(async () => [
          '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
        ]),
        logger,
      });

      const context: ResolverContext = {
        codeHost: makeCodeHost({ merged: false, hasUnresolvedComments: false, state: 'open' }),
        env: {},
      };

      const results = await resolverRunner.checkAll(REPO_PATH, context);

      expect(results).toHaveLength(1);
      expect(results[0].newStatus).toBeNull();
      expect(results[0].propagated).toBe(false);

      // No frontmatter writes at all
      expect(fm.writeFrontmatter).not.toHaveBeenCalled();

      // No sync call (exit gate not invoked)
      expect(runSync).not.toHaveBeenCalled();
    });
  });

  describe('testing-router routes to Finalize for backend', () => {
    it('transitions backend stage to Finalize (skipping manual testing)', async () => {
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Testing Router',
            session_active: false,
            refinement_type: ['backend'],
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: { 'STAGE-001-001-001': 'Testing Router' },
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

      const registry = new ResolverRegistry();
      registry.register('testing-router', testingRouterResolver);

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const resolverRunner = createResolverRunner(makeTestingRouterPipelineConfig(), {
        registry,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        discoverStageFiles: vi.fn(async () => [
          '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
        ]),
        logger,
      });

      const context: ResolverContext = { env: {} };

      const results = await resolverRunner.checkAll(REPO_PATH, context);

      expect(results).toHaveLength(1);
      expect(results[0].stageId).toBe('STAGE-001-001-001');
      expect(results[0].resolverName).toBe('testing-router');
      expect(results[0].previousStatus).toBe('Testing Router');
      expect(results[0].newStatus).toBe('Finalize');
      expect(results[0].propagated).toBe(true);

      // Stage frontmatter updated to Finalize
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('Finalize');

      // Ticket stage_statuses updated
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect((ticketData.stage_statuses as Record<string, string>)['STAGE-001-001-001']).toBe('Finalize');

      // Sync was called
      expect(runSync).toHaveBeenCalledWith(REPO_PATH);
    });
  });

  describe('testing-router routes to Manual Testing for frontend', () => {
    it('transitions frontend stage to Manual Testing', async () => {
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'Testing Router',
            session_active: false,
            refinement_type: ['frontend'],
          },
          content: '# Stage\n',
        },
        '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
          data: {
            id: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'In Progress',
            stage_statuses: { 'STAGE-001-001-001': 'Testing Router' },
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

      const registry = new ResolverRegistry();
      registry.register('testing-router', testingRouterResolver);

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const resolverRunner = createResolverRunner(makeTestingRouterPipelineConfig(), {
        registry,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        discoverStageFiles: vi.fn(async () => [
          '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
        ]),
        logger,
      });

      const context: ResolverContext = { env: {} };

      const results = await resolverRunner.checkAll(REPO_PATH, context);

      expect(results).toHaveLength(1);
      expect(results[0].newStatus).toBe('Manual Testing');
      expect(results[0].propagated).toBe(true);

      // Stage frontmatter updated to Manual Testing
      const stageData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'].data;
      expect(stageData.status).toBe('Manual Testing');

      // Ticket stage_statuses updated
      const ticketData = fm.store['/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'].data;
      expect((ticketData.stage_statuses as Record<string, string>)['STAGE-001-001-001']).toBe('Manual Testing');
    });
  });

  describe('Locked stage is skipped', () => {
    it('skips stage with session_active === true and produces no results', async () => {
      const fm = makeFrontmatterStore({
        '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
          data: {
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            status: 'PR Created',
            session_active: true,
            pr_url: 'https://github.com/org/repo/pull/1',
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

      const registry = new ResolverRegistry();
      registry.register('pr-status', prStatusResolver);

      const exitGateRunner = createExitGateRunner({
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        runSync,
        logger,
      });

      const resolverRunner = createResolverRunner(makePRPipelineConfig(), {
        registry,
        exitGateRunner,
        readFrontmatter: fm.readFrontmatter,
        writeFrontmatter: fm.writeFrontmatter,
        discoverStageFiles: vi.fn(async () => [
          '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md',
        ]),
        logger,
      });

      const context: ResolverContext = {
        codeHost: makeCodeHost({ merged: true, hasUnresolvedComments: false, state: 'merged' }),
        env: {},
      };

      const results = await resolverRunner.checkAll(REPO_PATH, context);

      // Locked stage produces no results
      expect(results).toEqual([]);

      // No writes at all
      expect(fm.writeFrontmatter).not.toHaveBeenCalled();

      // No sync call
      expect(runSync).not.toHaveBeenCalled();
    });
  });
});
