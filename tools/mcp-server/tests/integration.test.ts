import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handlePrCreate,
  handlePrGet,
  handlePrUpdate,
  handlePrClose,
  handlePrAddComment,
  handlePrGetComments,
  handlePrGetStatus,
  type PrToolDeps,
} from '../src/tools/pr.js';
import {
  handleJiraGetTicket,
  handleJiraSearch,
  handleJiraTransition,
  handleJiraAssign,
  handleJiraComment,
  type JiraToolDeps,
} from '../src/tools/jira.js';
import {
  handleMockInjectComment,
  handleMockSetPrMerged,
  type MockAdminDeps,
} from '../src/tools/mock-admin.js';
import { handleConfluenceGetPage, type ConfluenceToolDeps } from '../src/tools/confluence.js';
import { handleEnrichTicket, type EnrichToolDeps } from '../src/tools/enrich.js';
import { handleSlackNotify, type SlackToolDeps } from '../src/tools/slack.js';
import seedData from '../fixtures/mock-data.json';
import { parseResult } from './helpers.js';

/**
 * Integration tests: verify stateful behavior across tool calls using
 * a shared MockState instance. Each describe block exercises a multi-step
 * workflow that spans multiple handler functions.
 */
describe('Integration: cross-tool stateful workflows', () => {
  let state: MockState;
  let prDeps: PrToolDeps;
  let jiraDeps: JiraToolDeps;
  let mockAdminDeps: MockAdminDeps;
  let confluenceDeps: ConfluenceToolDeps;
  let enrichDeps: EnrichToolDeps;
  let slackDeps: SlackToolDeps;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
    process.env.KANBAN_MOCK = 'true';
    state = new MockState(seedData as MockSeedData);
    prDeps = { mockState: state };
    jiraDeps = { mockState: state };
    mockAdminDeps = { mockState: state };
    confluenceDeps = { mockState: state };
    enrichDeps = { mockState: state };
    slackDeps = { mockState: state };
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  describe('PR lifecycle: create → get → update → comment → close', () => {
    it('walks through a full PR lifecycle with state propagating across calls', async () => {
      // Step 1: Create a PR
      const createResult = await handlePrCreate(
        { branch: 'feature/login', title: 'Add login page', body: 'Implements login flow' },
        prDeps,
      );
      expect(createResult.isError).toBeUndefined();
      const { url, number } = parseResult(createResult);
      expect(typeof number).toBe('number');
      expect(url).toContain('/pull/');

      // Step 2: Get the PR and verify initial state
      const getResult = await handlePrGet({ number }, prDeps);
      expect(getResult.isError).toBeUndefined();
      const pr = parseResult(getResult);
      expect(pr.title).toBe('Add login page');
      expect(pr.body).toBe('Implements login flow');
      expect(pr.state).toBe('open');

      // Step 3: Update the title
      const updateResult = await handlePrUpdate(
        { number, title: 'Add login page (v2)' },
        prDeps,
      );
      expect(updateResult.isError).toBeUndefined();
      expect(parseResult(updateResult).success).toBe(true);

      // Step 4: Get again — title should be updated
      const getResult2 = await handlePrGet({ number }, prDeps);
      const pr2 = parseResult(getResult2);
      expect(pr2.title).toBe('Add login page (v2)');
      expect(pr2.body).toBe('Implements login flow'); // body unchanged

      // Step 5: Add a review comment
      const commentResult = await handlePrAddComment(
        { number, body: 'LGTM, minor nit on line 42' },
        prDeps,
      );
      expect(commentResult.isError).toBeUndefined();
      const comment = parseResult(commentResult);
      expect(comment.body).toBe('LGTM, minor nit on line 42');
      expect(comment.id).toBeDefined();

      // Step 6: Get comments — should contain the one we added
      const commentsResult = await handlePrGetComments({ number }, prDeps);
      expect(commentsResult.isError).toBeUndefined();
      const comments = parseResult(commentsResult);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe('LGTM, minor nit on line 42');

      // Step 7: Close the PR
      const closeResult = await handlePrClose({ number }, prDeps);
      expect(closeResult.isError).toBeUndefined();
      expect(parseResult(closeResult).success).toBe(true);

      // Step 8: Get status — should reflect closed state
      const statusResult = await handlePrGetStatus({ prUrl: url }, prDeps);
      expect(statusResult.isError).toBeUndefined();
      const status = parseResult(statusResult);
      expect(status.state).toBe('closed');
      expect(status.merged).toBe(false);
      expect(status.hasUnresolvedComments).toBe(true); // comment still present
    });
  });

  describe('PR merge flow: create → merge → get status', () => {
    it('marks a PR as merged via admin tool and verifies status', async () => {
      // Step 1: Create PR
      const createResult = await handlePrCreate(
        { branch: 'feature/merge-test', title: 'Merge me', body: 'Ready to merge' },
        prDeps,
      );
      const { url, number } = parseResult(createResult);

      // Step 2: Mark merged via admin tool
      const mergeResult = await handleMockSetPrMerged({ prNumber: number }, mockAdminDeps);
      expect(mergeResult.isError).toBeUndefined();
      expect(parseResult(mergeResult).success).toBe(true);

      // Step 3: Get status — should show merged
      const statusResult = await handlePrGetStatus({ prUrl: url }, prDeps);
      expect(statusResult.isError).toBeUndefined();
      const status = parseResult(statusResult);
      expect(status.merged).toBe(true);
      expect(status.state).toBe('merged');
    });
  });

  describe('Jira ticket lifecycle: get → transition → assign → comment → search', () => {
    it('exercises a full Jira ticket workflow with state mutations', async () => {
      // Step 1: Get the seeded ticket
      const getResult = await handleJiraGetTicket({ key: 'PROJ-101' }, jiraDeps);
      expect(getResult.isError).toBeUndefined();
      const ticket = parseResult(getResult);
      expect(ticket.key).toBe('PROJ-101');
      expect(ticket.summary).toBe('User authentication flow');
      expect(ticket.status).toBe('To Do');

      // Step 2: Transition to In Progress
      const transResult = await handleJiraTransition(
        { key: 'PROJ-101', targetStatus: 'In Progress' },
        jiraDeps,
      );
      expect(transResult.isError).toBeUndefined();
      const transData = parseResult(transResult);
      expect(transData.success).toBe(true);
      expect(transData.previousStatus).toBe('To Do');
      expect(transData.newStatus).toBe('In Progress');

      // Step 3: Get ticket again — status should be In Progress
      const getResult2 = await handleJiraGetTicket({ key: 'PROJ-101' }, jiraDeps);
      const ticket2 = parseResult(getResult2);
      expect(ticket2.status).toBe('In Progress');

      // Step 4: Assign the ticket
      const assignResult = await handleJiraAssign(
        { key: 'PROJ-101', assignee: 'dev@example.com' },
        jiraDeps,
      );
      expect(assignResult.isError).toBeUndefined();
      const assignData = parseResult(assignResult);
      expect(assignData.success).toBe(true);
      expect(assignData.assignee).toBe('dev@example.com');

      // Step 5: Add a comment
      const commentResult = await handleJiraComment(
        { key: 'PROJ-101', body: 'Working on it' },
        jiraDeps,
      );
      expect(commentResult.isError).toBeUndefined();
      const commentData = parseResult(commentResult);
      expect(commentData.body).toBe('Working on it');
      expect(commentData.id).toBeDefined();

      // Step 6: Search for the ticket by keyword in its summary
      const searchResult = await handleJiraSearch(
        { jql: 'authentication' },
        jiraDeps,
      );
      expect(searchResult.isError).toBeUndefined();
      const searchData = parseResult(searchResult);
      expect(searchData).toHaveLength(1);
      expect(searchData[0].key).toBe('PROJ-101');
      // The searched ticket should also reflect the new status
      expect(searchData[0].status).toBe('In Progress');
    });
  });

  describe('Mock admin: inject comment → get comments reflects it', () => {
    it('injects a review comment via admin and reads it back via PR tool', async () => {
      // Step 1: Create a PR
      const createResult = await handlePrCreate(
        { branch: 'feature/inject', title: 'Inject test', body: 'body' },
        prDeps,
      );
      const { number } = parseResult(createResult);

      // Step 2: Inject a comment via admin tool
      const injectResult = await handleMockInjectComment(
        { prNumber: number, body: 'Injected review feedback', author: 'reviewer-bot' },
        mockAdminDeps,
      );
      expect(injectResult.isError).toBeUndefined();
      const injected = parseResult(injectResult);
      expect(injected.body).toBe('Injected review feedback');
      expect(injected.author).toBe('reviewer-bot');

      // Step 3: Get comments via PR tool — should contain the injected comment
      const commentsResult = await handlePrGetComments({ number }, prDeps);
      expect(commentsResult.isError).toBeUndefined();
      const comments = parseResult(commentsResult);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe('Injected review feedback');
      expect(comments[0].author).toBe('reviewer-bot');
    });
  });

  describe('Confluence page retrieval', () => {
    it('returns a seeded page by ID', async () => {
      const result = await handleConfluenceGetPage({ pageId: '12345' }, confluenceDeps);
      expect(result.isError).toBeUndefined();
      const page = parseResult(result);
      expect(page.pageId).toBe('12345');
      expect(page.title).toBe('Architecture Overview');
      expect(page.body).toContain('Architecture');
      expect(page.url).toContain('wiki.example.com');
    });

    it('returns error for a nonexistent page', async () => {
      const result = await handleConfluenceGetPage({ pageId: 'nonexistent' }, confluenceDeps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Page not found');
    });
  });

  describe('Enrich ticket', () => {
    it('returns a stub result echoing the ticket path', async () => {
      const result = await handleEnrichTicket(
        { ticketPath: '/path/to/ticket.md' },
        enrichDeps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.ticketId).toBe('/path/to/ticket.md');
      expect(data.freshJiraData).toBe(false);
      expect(data.linkResults).toEqual([]);
    });
  });

  describe('Slack notification flow', () => {
    it('stores a notification in mock state and can be retrieved', async () => {
      const result = await handleSlackNotify(
        {
          title: 'Integration Test',
          message: 'This is a test notification',
          stage: 'STAGE-001',
        },
        slackDeps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data).toContain('mock mode');

      const notifications = state.getNotifications();
      expect(notifications).toHaveLength(1);
      const n = notifications[0];
      expect(n.title).toBe('Integration Test');
      expect(n.message).toBe('This is a test notification');
      expect(n.stage).toBe('STAGE-001');
      expect(n.timestamp).toBeDefined();
    });
  });

  describe('Cross-tool state isolation: PR and Jira do not interfere', () => {
    it('mutating a PR does not affect Jira tickets, and vice versa', async () => {
      // Step 1: Create a PR
      const createResult = await handlePrCreate(
        { branch: 'feature/isolation', title: 'Isolation test', body: 'PR body' },
        prDeps,
      );
      const { number: prNumber, url: prUrl } = parseResult(createResult);

      // Step 2: Transition PROJ-101 Jira ticket
      const transResult = await handleJiraTransition(
        { key: 'PROJ-101', targetStatus: 'Done' },
        jiraDeps,
      );
      expect(transResult.isError).toBeUndefined();

      // Step 3: Get the PR — should still be open, unaffected by Jira transition
      const prResult = await handlePrGet({ number: prNumber }, prDeps);
      expect(prResult.isError).toBeUndefined();
      const pr = parseResult(prResult);
      expect(pr.state).toBe('open');
      expect(pr.title).toBe('Isolation test');

      // Step 4: Get PROJ-101 — should have new status, unaffected by PR creation
      const ticketResult = await handleJiraGetTicket({ key: 'PROJ-101' }, jiraDeps);
      expect(ticketResult.isError).toBeUndefined();
      const ticket = parseResult(ticketResult);
      expect(ticket.status).toBe('Done');

      // Step 5: Close the PR — should not affect Jira
      await handlePrClose({ number: prNumber }, prDeps);

      const ticketResult2 = await handleJiraGetTicket({ key: 'PROJ-101' }, jiraDeps);
      const ticket2 = parseResult(ticketResult2);
      expect(ticket2.status).toBe('Done'); // still Done, not closed

      // Step 6: Verify PR is closed, Jira unchanged
      const statusResult = await handlePrGetStatus({ prUrl: prUrl }, prDeps);
      const status = parseResult(statusResult);
      expect(status.state).toBe('closed');
    });
  });
});
