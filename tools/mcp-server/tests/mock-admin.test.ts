import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handleMockInjectComment,
  handleMockSetPrMerged,
  handleMockSetTicketStatus,
  registerMockAdminTools,
  type MockAdminDeps,
} from '../src/tools/mock-admin.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import seedData from '../fixtures/mock-data.json';
import { parseResult } from './helpers.js';

describe('Mock admin tools', () => {
  let state: MockState;
  let deps: MockAdminDeps;

  beforeEach(() => {
    state = new MockState(seedData as MockSeedData);
    deps = { mockState: state };
  });

  describe('handleMockInjectComment', () => {
    it('injects a comment on an existing PR', async () => {
      // Create a PR first
      const { number } = state.createPr({
        branch: 'feat/test',
        title: 'Test PR',
        body: 'body',
      });

      const result = await handleMockInjectComment(
        { prNumber: number, body: 'Injected comment' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.body).toBe('Injected comment');
      expect(data.author).toBe('anonymous');
      expect(data.id).toBeDefined();
      expect(data.createdAt).toBeDefined();
    });

    it('uses custom author when provided', async () => {
      const { number } = state.createPr({
        branch: 'feat/author',
        title: 'Author PR',
        body: 'body',
      });

      const result = await handleMockInjectComment(
        { prNumber: number, body: 'Review comment', author: 'reviewer-bot' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.author).toBe('reviewer-bot');
    });

    it('persists the comment on the PR', async () => {
      const { number } = state.createPr({
        branch: 'feat/persist',
        title: 'Persist PR',
        body: 'body',
      });

      await handleMockInjectComment(
        { prNumber: number, body: 'Persisted' },
        deps,
      );
      const pr = state.getPr(number);
      expect(pr!.comments).toHaveLength(1);
      expect(pr!.comments[0].body).toBe('Persisted');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handleMockInjectComment(
        { prNumber: 99999, body: 'comment' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });
  });

  describe('handleMockSetPrMerged', () => {
    it('marks an existing PR as merged', async () => {
      const { number } = state.createPr({
        branch: 'feat/merge',
        title: 'Merge PR',
        body: 'body',
      });

      const result = await handleMockSetPrMerged({ prNumber: number }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);

      const pr = state.getPr(number);
      expect(pr!.merged).toBe(true);
      expect(pr!.state).toBe('merged');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handleMockSetPrMerged({ prNumber: 99999 }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });
  });

  describe('handleMockSetTicketStatus', () => {
    it('transitions an existing ticket to a new status', async () => {
      const result = await handleMockSetTicketStatus(
        { key: 'PROJ-101', status: 'In Progress' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe('To Do');
      expect(data.newStatus).toBe('In Progress');
    });

    it('persists the status change', async () => {
      await handleMockSetTicketStatus(
        { key: 'PROJ-101', status: 'Done' },
        deps,
      );
      const ticket = state.getTicket('PROJ-101');
      expect(ticket!.status).toBe('Done');
    });

    it('returns error for nonexistent ticket', async () => {
      const result = await handleMockSetTicketStatus(
        { key: 'PROJ-999', status: 'Done' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Ticket not found');
    });
  });

  describe('registerMockAdminTools', () => {
    it('registers all 3 tools on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      registerMockAdminTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });
});
