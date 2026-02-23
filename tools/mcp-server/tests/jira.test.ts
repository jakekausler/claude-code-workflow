import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handleJiraGetTicket,
  handleJiraSearch,
  handleJiraTransition,
  handleJiraAssign,
  handleJiraComment,
  handleJiraSync,
  registerJiraTools,
  type JiraToolDeps,
} from '../src/tools/jira.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import seedData from '../fixtures/mock-data.json';

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('Jira tools', () => {
  let state: MockState;
  let deps: JiraToolDeps;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
    process.env.KANBAN_MOCK = 'true';
    state = new MockState(seedData as MockSeedData);
    deps = { mockState: state };
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  describe('handleJiraGetTicket', () => {
    it('returns ticket data for existing ticket', async () => {
      const result = await handleJiraGetTicket({ key: 'PROJ-101' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.key).toBe('PROJ-101');
      expect(data.summary).toBe('User authentication flow');
      expect(data.status).toBe('To Do');
      expect(data.type).toBe('Story');
    });

    it('returns error for nonexistent ticket', async () => {
      const result = await handleJiraGetTicket({ key: 'PROJ-999' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Ticket not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraGetTicket({ key: 'PROJ-101' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet configured');
    });
  });

  describe('handleJiraSearch', () => {
    it('returns matching tickets by key', async () => {
      const result = await handleJiraSearch({ jql: 'PROJ-101' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toHaveLength(1);
      expect(data[0].key).toBe('PROJ-101');
    });

    it('returns matching tickets by summary', async () => {
      const result = await handleJiraSearch({ jql: 'rate limiting' }, deps);
      const data = parseResult(result);
      expect(data).toHaveLength(1);
      expect(data[0].key).toBe('PROJ-102');
    });

    it('returns multiple matches', async () => {
      const result = await handleJiraSearch({ jql: 'proj' }, deps);
      const data = parseResult(result);
      expect(data).toHaveLength(2);
    });

    it('returns empty array for no matches', async () => {
      const result = await handleJiraSearch({ jql: 'nonexistent' }, deps);
      const data = parseResult(result);
      expect(data).toEqual([]);
    });

    it('ignores maxResults in mock mode', async () => {
      const result = await handleJiraSearch({ jql: 'proj', maxResults: 1 }, deps);
      const data = parseResult(result);
      expect(data).toHaveLength(2);
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraSearch({ jql: 'test' }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handleJiraTransition', () => {
    it('transitions ticket and returns previous/new status', async () => {
      const result = await handleJiraTransition(
        { key: 'PROJ-101', targetStatus: 'In Progress' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe('To Do');
      expect(data.newStatus).toBe('In Progress');
    });

    it('persists the status change', async () => {
      await handleJiraTransition({ key: 'PROJ-101', targetStatus: 'Done' }, deps);
      const ticket = state.getTicket('PROJ-101');
      expect(ticket!.status).toBe('Done');
    });

    it('returns error for nonexistent ticket', async () => {
      const result = await handleJiraTransition(
        { key: 'PROJ-999', targetStatus: 'Done' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Ticket not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraTransition(
        { key: 'PROJ-101', targetStatus: 'Done' },
        deps,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('handleJiraAssign', () => {
    it('assigns ticket to a user', async () => {
      const result = await handleJiraAssign(
        { key: 'PROJ-101', assignee: 'dev@example.com' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);
      expect(data.assignee).toBe('dev@example.com');
    });

    it('persists the assignment', async () => {
      await handleJiraAssign({ key: 'PROJ-101', assignee: 'dev@example.com' }, deps);
      const ticket = state.getTicket('PROJ-101');
      expect(ticket!.assignee).toBe('dev@example.com');
    });

    it('unassigns ticket when assignee is omitted', async () => {
      // First assign someone
      state.assignTicket('PROJ-101', 'someone@example.com');
      // Then unassign by omitting assignee
      const result = await handleJiraAssign({ key: 'PROJ-101' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.assignee).toBeNull();
      expect(state.getTicket('PROJ-101')!.assignee).toBeNull();
    });

    it('returns error for nonexistent ticket', async () => {
      const result = await handleJiraAssign(
        { key: 'PROJ-999', assignee: 'x' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Ticket not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraAssign({ key: 'PROJ-101', assignee: 'x' }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handleJiraComment', () => {
    it('adds a comment to a ticket', async () => {
      const result = await handleJiraComment(
        { key: 'PROJ-101', body: 'Test comment' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.body).toBe('Test comment');
      expect(data.id).toBeDefined();
      expect(data.author).toBe('anonymous');
    });

    it('persists the comment on the ticket', async () => {
      await handleJiraComment({ key: 'PROJ-101', body: 'Persisted comment' }, deps);
      const ticket = state.getTicket('PROJ-101');
      expect(ticket!.comments).toHaveLength(1);
      expect(ticket!.comments[0].body).toBe('Persisted comment');
    });

    it('returns error for nonexistent ticket', async () => {
      const result = await handleJiraComment(
        { key: 'PROJ-999', body: 'comment' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Ticket not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraComment(
        { key: 'PROJ-101', body: 'comment' },
        deps,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('handleJiraSync', () => {
    it('returns mock sync result', async () => {
      const result = await handleJiraSync(
        { ticketId: 'T-123', repoPath: '/tmp/repo' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.ticket_id).toBe('T-123');
      expect(data.jira_key).toBe('MOCK-KEY');
      expect(data.event).toBeNull();
      expect(data.actions).toEqual([]);
      expect(data.dry_run).toBe(false);
      expect(data.confirmation_needed).toBe(false);
    });

    it('respects dryRun flag', async () => {
      const result = await handleJiraSync(
        { ticketId: 'T-123', repoPath: '/tmp/repo', dryRun: true },
        deps,
      );
      const data = parseResult(result);
      expect(data.dry_run).toBe(true);
    });

    it('defaults dryRun to false when omitted', async () => {
      const result = await handleJiraSync(
        { ticketId: 'T-123', repoPath: '/tmp/repo' },
        deps,
      );
      const data = parseResult(result);
      expect(data.dry_run).toBe(false);
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleJiraSync(
        { ticketId: 'T-123', repoPath: '/tmp/repo' },
        deps,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('registerJiraTools', () => {
    it('registers all 6 tools on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      expect(() => registerJiraTools(server, deps)).not.toThrow();
    });
  });
});
