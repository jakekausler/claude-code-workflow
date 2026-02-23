import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handlePrCreate,
  handlePrUpdate,
  handlePrGet,
  handlePrClose,
  handlePrGetComments,
  handlePrAddComment,
  handlePrGetStatus,
  handlePrMarkReady,
  extractPrNumber,
  registerPrTools,
  type PrToolDeps,
} from '../src/tools/pr.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import seedData from '../fixtures/mock-data.json';

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('PR tools', () => {
  let state: MockState;
  let deps: PrToolDeps;
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

  describe('handlePrCreate', () => {
    it('creates a PR and returns url and number', async () => {
      const result = await handlePrCreate(
        { branch: 'feature/auth', title: 'Add auth', body: 'Auth implementation' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.url).toContain('/pull/');
      expect(typeof data.number).toBe('number');
    });

    it('created PR is readable via getPr', async () => {
      const createResult = await handlePrCreate(
        { branch: 'feature/auth', title: 'Add auth', body: 'Auth body' },
        deps,
      );
      const { number } = parseResult(createResult);

      const getResult = await handlePrGet({ number }, deps);
      expect(getResult.isError).toBeUndefined();
      const pr = parseResult(getResult);
      expect(pr.title).toBe('Add auth');
      expect(pr.body).toBe('Auth body');
      expect(pr.branch).toBe('feature/auth');
      expect(pr.state).toBe('open');
      expect(pr.draft).toBe(false);
    });

    it('respects optional fields (base, draft, assignees, reviewers)', async () => {
      const result = await handlePrCreate(
        {
          branch: 'fix/bug',
          title: 'Fix bug',
          body: 'Bug fix',
          base: 'develop',
          draft: true,
          assignees: ['alice'],
          reviewers: ['bob'],
        },
        deps,
      );
      const { number } = parseResult(result);

      const getResult = await handlePrGet({ number }, deps);
      const pr = parseResult(getResult);
      expect(pr.base).toBe('develop');
      expect(pr.draft).toBe(true);
      expect(pr.assignees).toEqual(['alice']);
      expect(pr.reviewers).toEqual(['bob']);
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrCreate(
        { branch: 'x', title: 'x', body: 'x' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet configured');
    });
  });

  describe('handlePrUpdate', () => {
    it('updates PR fields', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/a', title: 'Original', body: 'Original body' }, deps),
      );

      const result = await handlePrUpdate(
        { number, title: 'Updated', body: 'Updated body' },
        deps,
      );
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);

      const pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.title).toBe('Updated');
      expect(pr.body).toBe('Updated body');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrUpdate({ number: 99999, title: 'x' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrUpdate({ number: 1, title: 'x' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet configured');
    });
  });

  describe('handlePrGet', () => {
    it('returns PR data for existing PR', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/b', title: 'Get test', body: 'body' }, deps),
      );

      const result = await handlePrGet({ number }, deps);
      expect(result.isError).toBeUndefined();
      const pr = parseResult(result);
      expect(pr.number).toBe(number);
      expect(pr.title).toBe('Get test');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrGet({ number: 99999 }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrGet({ number: 1 }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePrClose', () => {
    it('closes an open PR', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/c', title: 'Close test', body: 'body' }, deps),
      );

      const result = await handlePrClose({ number }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);

      const pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.state).toBe('closed');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrClose({ number: 99999 }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrClose({ number: 1 }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePrGetComments', () => {
    it('returns empty array for PR with no comments', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/d', title: 'Comments test', body: 'body' }, deps),
      );

      const result = await handlePrGetComments({ number }, deps);
      expect(result.isError).toBeUndefined();
      const comments = parseResult(result);
      expect(comments).toEqual([]);
    });

    it('returns comments after adding them', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/e', title: 'Comments test 2', body: 'body' }, deps),
      );

      await handlePrAddComment({ number, body: 'First comment' }, deps);
      await handlePrAddComment({ number, body: 'Second comment' }, deps);

      const result = await handlePrGetComments({ number }, deps);
      const comments = parseResult(result);
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe('First comment');
      expect(comments[1].body).toBe('Second comment');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrGetComments({ number: 99999 }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrGetComments({ number: 1 }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePrAddComment', () => {
    it('adds a comment and returns the full comment object', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/f', title: 'Add comment test', body: 'body' }, deps),
      );

      const result = await handlePrAddComment({ number, body: 'Test comment' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.id).toBeDefined();
      expect(typeof data.id).toBe('string');
      expect(data.body).toBe('Test comment');
      expect(data.createdAt).toBeDefined();
    });

    it('persists comment on the PR', async () => {
      const { number } = parseResult(
        await handlePrCreate({ branch: 'feat/g', title: 'Persist comment test', body: 'body' }, deps),
      );

      await handlePrAddComment({ number, body: 'Persisted comment' }, deps);
      const pr = state.getPr(number);
      expect(pr!.comments).toHaveLength(1);
      expect(pr!.comments[0].body).toBe('Persisted comment');
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrAddComment({ number: 99999, body: 'comment' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrAddComment({ number: 1, body: 'comment' }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePrGetStatus', () => {
    it('returns open state for new PR', async () => {
      const { number, url } = parseResult(
        await handlePrCreate({ branch: 'feat/h', title: 'Status test', body: 'body' }, deps),
      );

      const result = await handlePrGetStatus({ prUrl: url }, deps);
      expect(result.isError).toBeUndefined();
      const status = parseResult(result);
      expect(status.merged).toBe(false);
      expect(status.state).toBe('open');
      expect(status.hasUnresolvedComments).toBe(false);
    });

    it('reflects merged state', async () => {
      const { number, url } = parseResult(
        await handlePrCreate({ branch: 'feat/i', title: 'Merge test', body: 'body' }, deps),
      );
      state.setPrMerged(number);

      const result = await handlePrGetStatus({ prUrl: url }, deps);
      const status = parseResult(result);
      expect(status.merged).toBe(true);
      expect(status.state).toBe('merged');
    });

    it('reflects closed state', async () => {
      const { number, url } = parseResult(
        await handlePrCreate({ branch: 'feat/j', title: 'Close status test', body: 'body' }, deps),
      );
      state.closePr(number);

      const result = await handlePrGetStatus({ prUrl: url }, deps);
      const status = parseResult(result);
      expect(status.state).toBe('closed');
      expect(status.merged).toBe(false);
    });

    it('reflects hasUnresolvedComments when comments exist', async () => {
      const { number, url } = parseResult(
        await handlePrCreate({ branch: 'feat/k', title: 'Comments status', body: 'body' }, deps),
      );
      state.addPrComment(number, { body: 'A comment' });

      const result = await handlePrGetStatus({ prUrl: url }, deps);
      const status = parseResult(result);
      expect(status.hasUnresolvedComments).toBe(true);
    });

    it('returns error for nonexistent PR URL', async () => {
      const result = await handlePrGetStatus(
        { prUrl: 'https://github.com/org/repo/pull/99999' },
        deps,
      );
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns error for unparseable URL', async () => {
      const result = await handlePrGetStatus({ prUrl: 'https://example.com/not-a-pr' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Could not parse PR number');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrGetStatus(
        { prUrl: 'https://github.com/org/repo/pull/1' },
        deps,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePrMarkReady', () => {
    it('marks a draft PR as ready', async () => {
      const { number } = parseResult(
        await handlePrCreate(
          { branch: 'feat/l', title: 'Draft PR', body: 'body', draft: true },
          deps,
        ),
      );

      // Verify it starts as draft
      let pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.draft).toBe(true);

      const result = await handlePrMarkReady({ number }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);

      // Verify it's no longer draft
      pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.draft).toBe(false);
    });

    it('succeeds idempotently on a non-draft PR', async () => {
      const { number } = parseResult(
        await handlePrCreate(
          { branch: 'feat/m', title: 'Non-draft PR', body: 'body', draft: false },
          deps,
        ),
      );

      // Verify it starts as non-draft
      let pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.draft).toBe(false);

      // markReady should succeed even though it's already non-draft
      const result = await handlePrMarkReady({ number }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.success).toBe(true);

      // Still non-draft
      pr = parseResult(await handlePrGet({ number }, deps));
      expect(pr.draft).toBe(false);
    });

    it('returns error for nonexistent PR', async () => {
      const result = await handlePrMarkReady({ number: 99999 }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('PR not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handlePrMarkReady({ number: 1 }, deps);
      expect(result.isError).toBe(true);
    });
  });

  describe('extractPrNumber', () => {
    it('parses GitHub PR URL', () => {
      expect(extractPrNumber('https://github.com/org/repo/pull/42')).toBe(42);
    });

    it('parses GitLab MR URL', () => {
      expect(extractPrNumber('https://gitlab.com/org/repo/-/merge_requests/17')).toBe(17);
    });

    it('returns null for non-PR URL', () => {
      expect(extractPrNumber('https://example.com/not-a-pr')).toBeNull();
    });

    it('parses URL with trailing path segments', () => {
      expect(extractPrNumber('https://github.com/org/repo/pull/99/files')).toBe(99);
    });
  });

  describe('registerPrTools', () => {
    it('registers all 8 tools on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      registerPrTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(8);
    });
  });
});
