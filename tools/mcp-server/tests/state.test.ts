import { describe, it, expect, beforeEach } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import seedData from '../fixtures/mock-data.json';

describe('MockState', () => {
  let state: MockState;

  beforeEach(() => {
    state = new MockState(seedData as MockSeedData);
  });

  describe('constructor', () => {
    it('seeds tickets from fixture data', () => {
      const ticket = state.getTicket('PROJ-101');
      expect(ticket).not.toBeNull();
      expect(ticket!.summary).toBe('User authentication flow');
      expect(ticket!.comments).toEqual([]);
    });

    it('seeds pages from fixture data', () => {
      const page = state.getPage('12345');
      expect(page).not.toBeNull();
      expect(page!.title).toBe('Architecture Overview');
    });

    it('works without seed data', () => {
      const empty = new MockState();
      expect(empty.getTicket('PROJ-101')).toBeNull();
      expect(empty.getPage('12345')).toBeNull();
    });
  });

  describe('createPr', () => {
    it('generates sequential PR numbers starting at 1000', () => {
      const pr1 = state.createPr({ branch: 'feat-a', title: 'PR A', body: 'Body A' });
      const pr2 = state.createPr({ branch: 'feat-b', title: 'PR B', body: 'Body B' });
      expect(pr1.number).toBe(1000);
      expect(pr2.number).toBe(1001);
    });

    it('returns url and number', () => {
      const result = state.createPr({ branch: 'feat-x', title: 'PR X', body: 'Body' });
      expect(result.url).toBe(`https://github.com/mock-org/mock-repo/pull/${result.number}`);
      expect(typeof result.number).toBe('number');
    });

    it('creates a PR readable via getPr', () => {
      const { number } = state.createPr({
        branch: 'feat-y',
        title: 'PR Y',
        body: 'Body Y',
        base: 'develop',
        draft: true,
        assignees: ['alice'],
        reviewers: ['bob'],
      });
      const pr = state.getPr(number);
      expect(pr).not.toBeNull();
      expect(pr!.title).toBe('PR Y');
      expect(pr!.branch).toBe('feat-y');
      expect(pr!.base).toBe('develop');
      expect(pr!.draft).toBe(true);
      expect(pr!.state).toBe('open');
      expect(pr!.merged).toBe(false);
      expect(pr!.assignees).toEqual(['alice']);
      expect(pr!.reviewers).toEqual(['bob']);
      expect(pr!.comments).toEqual([]);
    });

    it('uses defaults for optional fields', () => {
      const { number } = state.createPr({ branch: 'feat-z', title: 'PR Z', body: 'Body Z' });
      const pr = state.getPr(number)!;
      expect(pr.base).toBe('main');
      expect(pr.draft).toBe(false);
      expect(pr.assignees).toEqual([]);
      expect(pr.reviewers).toEqual([]);
    });

    it('starts numbering after max seeded PR number', () => {
      const seedWithPrs: MockSeedData = {
        tickets: {},
        pages: {},
        prs: {
          500: {
            number: 500,
            url: 'https://github.com/mock-org/mock-repo/pull/500',
            title: 'Existing',
            body: 'body',
            branch: 'feat',
            base: 'main',
            state: 'open',
            draft: false,
            merged: false,
            assignees: [],
            reviewers: [],
          },
        },
      };
      const s = new MockState(seedWithPrs);
      const result = s.createPr({ branch: 'new', title: 'New', body: 'b' });
      expect(result.number).toBe(501);
    });
  });

  describe('getPr', () => {
    it('returns null for nonexistent PR', () => {
      expect(state.getPr(9999)).toBeNull();
    });

    it('returns a deep copy - mutation does not affect store', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'Original', body: 'body' });
      const copy = state.getPr(number)!;
      copy.title = 'Mutated';
      copy.comments.push({ id: 'fake', body: 'fake', author: 'fake', createdAt: 'fake' });

      const fresh = state.getPr(number)!;
      expect(fresh.title).toBe('Original');
      expect(fresh.comments).toEqual([]);
    });
  });

  describe('updatePr', () => {
    it('updates specified fields and returns true', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'Old', body: 'old body' });
      const result = state.updatePr(number, { title: 'New', body: 'new body', draft: true });
      expect(result).toBe(true);

      const pr = state.getPr(number)!;
      expect(pr.title).toBe('New');
      expect(pr.body).toBe('new body');
      expect(pr.draft).toBe(true);
    });

    it('returns false for nonexistent PR', () => {
      expect(state.updatePr(9999, { title: 'X' })).toBe(false);
    });

    it('only updates provided fields', () => {
      const { number } = state.createPr({
        branch: 'feat',
        title: 'Title',
        body: 'Body',
        assignees: ['alice'],
      });
      state.updatePr(number, { title: 'Updated Title' });

      const pr = state.getPr(number)!;
      expect(pr.title).toBe('Updated Title');
      expect(pr.body).toBe('Body');
      expect(pr.assignees).toEqual(['alice']);
    });
  });

  describe('closePr', () => {
    it('sets state to closed', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      const result = state.closePr(number);
      expect(result).toBe(true);
      expect(state.getPr(number)!.state).toBe('closed');
    });

    it('returns false for nonexistent PR', () => {
      expect(state.closePr(9999)).toBe(false);
    });
  });

  describe('setPrMerged', () => {
    it('sets merged flag and state to merged', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      const result = state.setPrMerged(number);
      expect(result).toBe(true);

      const pr = state.getPr(number)!;
      expect(pr.state).toBe('merged');
      expect(pr.merged).toBe(true);
    });

    it('returns false for nonexistent PR', () => {
      expect(state.setPrMerged(9999)).toBe(false);
    });
  });

  describe('addPrComment', () => {
    it('adds comment with sequential ID', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      const c1 = state.addPrComment(number, { body: 'First', author: 'alice' });
      const c2 = state.addPrComment(number, { body: 'Second', author: 'bob' });

      expect(c1).not.toBeNull();
      expect(c1!.id).toBe('comment-1');
      expect(c1!.body).toBe('First');
      expect(c1!.author).toBe('alice');

      expect(c2).not.toBeNull();
      expect(c2!.id).toBe('comment-2');
    });

    it('readable via getPrComments', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      state.addPrComment(number, { body: 'Hello' });

      const comments = state.getPrComments(number);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe('Hello');
    });

    it('returns null for nonexistent PR', () => {
      expect(state.addPrComment(9999, { body: 'X' })).toBeNull();
    });

    it('defaults author to anonymous', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      const comment = state.addPrComment(number, { body: 'no author' });
      expect(comment!.author).toBe('anonymous');
    });
  });

  describe('getPrComments', () => {
    it('returns empty array for PR with no comments', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      expect(state.getPrComments(number)).toEqual([]);
    });

    it('returns empty array for nonexistent PR', () => {
      expect(state.getPrComments(9999)).toEqual([]);
    });
  });

  describe('getPrStatus', () => {
    it('reflects current state', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      const status = state.getPrStatus(number);
      expect(status).toEqual({ merged: false, hasUnresolvedComments: false, state: 'open' });
    });

    it('reflects merged state', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      state.setPrMerged(number);
      const status = state.getPrStatus(number)!;
      expect(status.merged).toBe(true);
      expect(status.state).toBe('merged');
    });

    it('reflects hasUnresolvedComments when comments exist', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      state.addPrComment(number, { body: 'review comment' });
      const status = state.getPrStatus(number)!;
      expect(status.hasUnresolvedComments).toBe(true);
    });

    it('reflects closed state after closePr', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      state.closePr(number);
      const status = state.getPrStatus(number)!;
      expect(status.state).toBe('closed');
    });

    it('returns null for nonexistent PR', () => {
      expect(state.getPrStatus(9999)).toBeNull();
    });
  });

  describe('getTicket', () => {
    it('returns seeded ticket', () => {
      const ticket = state.getTicket('PROJ-101');
      expect(ticket).not.toBeNull();
      expect(ticket!.key).toBe('PROJ-101');
      expect(ticket!.summary).toBe('User authentication flow');
      expect(ticket!.status).toBe('To Do');
      expect(ticket!.type).toBe('Story');
      expect(ticket!.labels).toEqual(['backend']);
    });

    it('returns null for nonexistent ticket', () => {
      expect(state.getTicket('PROJ-999')).toBeNull();
    });

    it('returns a deep copy', () => {
      const copy = state.getTicket('PROJ-101')!;
      copy.summary = 'Mutated';
      copy.labels.push('mutated');

      const fresh = state.getTicket('PROJ-101')!;
      expect(fresh.summary).toBe('User authentication flow');
      expect(fresh.labels).toEqual(['backend']);
    });
  });

  describe('searchTickets', () => {
    it('matches on key substring', () => {
      const results = state.searchTickets('PROJ-101');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('PROJ-101');
    });

    it('matches on summary substring (case-insensitive)', () => {
      const results = state.searchTickets('rate limiting');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('PROJ-102');
    });

    it('returns multiple matches', () => {
      const results = state.searchTickets('proj');
      expect(results).toHaveLength(2);
    });

    it('returns empty array for no matches', () => {
      const results = state.searchTickets('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('transitionTicket', () => {
    it('updates status and returns previous and new', () => {
      const result = state.transitionTicket('PROJ-101', 'In Progress');
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.previousStatus).toBe('To Do');
      expect(result!.newStatus).toBe('In Progress');

      const ticket = state.getTicket('PROJ-101')!;
      expect(ticket.status).toBe('In Progress');
    });

    it('returns null for nonexistent ticket', () => {
      expect(state.transitionTicket('PROJ-999', 'Done')).toBeNull();
    });
  });

  describe('assignTicket', () => {
    it('updates assignee', () => {
      const result = state.assignTicket('PROJ-101', 'dev@example.com');
      expect(result).toBe(true);
      expect(state.getTicket('PROJ-101')!.assignee).toBe('dev@example.com');
    });

    it('sets assignee to null (unassign)', () => {
      state.assignTicket('PROJ-102', null);
      expect(state.getTicket('PROJ-102')!.assignee).toBeNull();
    });

    it('returns false for nonexistent ticket', () => {
      expect(state.assignTicket('PROJ-999', 'x')).toBe(false);
    });
  });

  describe('addTicketComment', () => {
    it('adds comment to ticket with sequential ID', () => {
      const comment = state.addTicketComment('PROJ-101', { body: 'A comment', author: 'dev' });
      expect(comment).not.toBeNull();
      expect(comment!.id).toBe('comment-1');
      expect(comment!.body).toBe('A comment');
      expect(comment!.author).toBe('dev');

      const ticket = state.getTicket('PROJ-101')!;
      expect(ticket.comments).toHaveLength(1);
      expect(ticket.comments[0].body).toBe('A comment');
    });

    it('shares comment ID sequence with PR comments', () => {
      const { number } = state.createPr({ branch: 'feat', title: 'T', body: 'B' });
      state.addPrComment(number, { body: 'PR comment' });
      const ticketComment = state.addTicketComment('PROJ-101', { body: 'Ticket comment' });
      expect(ticketComment!.id).toBe('comment-2');
    });

    it('defaults author to anonymous', () => {
      const comment = state.addTicketComment('PROJ-101', { body: 'no author given' });
      expect(comment!.author).toBe('anonymous');
    });

    it('returns null for nonexistent ticket', () => {
      expect(state.addTicketComment('PROJ-999', { body: 'X' })).toBeNull();
    });
  });

  describe('getPage', () => {
    it('returns seeded page', () => {
      const page = state.getPage('12345');
      expect(page).not.toBeNull();
      expect(page!.title).toBe('Architecture Overview');
      expect(page!.url).toBe('https://wiki.example.com/pages/12345');
    });

    it('returns null for nonexistent page', () => {
      expect(state.getPage('99999')).toBeNull();
    });

    it('returns a deep copy', () => {
      const copy = state.getPage('12345')!;
      copy.title = 'Mutated';

      const fresh = state.getPage('12345')!;
      expect(fresh.title).toBe('Architecture Overview');
    });
  });
});
