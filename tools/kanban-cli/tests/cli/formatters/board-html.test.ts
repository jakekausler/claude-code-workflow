import { describe, it, expect } from 'vitest';
import { renderBoardHtml } from '../../../src/cli/formatters/board-html.js';
import type { BoardOutput } from '../../../src/cli/logic/board.js';

function makeBoardOutput(overrides?: Partial<BoardOutput>): BoardOutput {
  return {
    generated_at: '2026-01-15T10:00:00.000Z',
    repo: '/tmp/test-repo',
    columns: {
      to_convert: [],
      backlog: [],
      ready_for_work: [],
      design: [],
      build: [],
      done: [],
    },
    stats: {
      total_stages: 0,
      total_tickets: 0,
      by_column: {},
    },
    ...overrides,
  };
}

describe('renderBoardHtml', () => {
  it('produces a valid HTML document starting with <!DOCTYPE html>', () => {
    const html = renderBoardHtml(makeBoardOutput());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
  });

  it('contains column headers for system columns', () => {
    const html = renderBoardHtml(makeBoardOutput());
    expect(html).toContain('To Convert');
    expect(html).toContain('Backlog');
    expect(html).toContain('Ready For Work');
    expect(html).toContain('Done');
  });

  it('contains column headers for pipeline columns', () => {
    const html = renderBoardHtml(makeBoardOutput());
    expect(html).toContain('Design');
    expect(html).toContain('Build');
  });

  it('contains stage card data (IDs and titles)', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [],
        backlog: [],
        ready_for_work: [],
        design: [
          {
            type: 'stage',
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            title: 'Login Form UI',
            session_active: true,
          },
        ],
        build: [],
        done: [],
      },
      stats: {
        total_stages: 1,
        total_tickets: 0,
        by_column: { design: 1 },
      },
    });
    const html = renderBoardHtml(board);
    expect(html).toContain('STAGE-001-001-001');
    expect(html).toContain('Login Form UI');
    expect(html).toContain('TICKET-001-001');
    expect(html).toContain('EPIC-001');
  });

  it('contains ticket card data for to_convert', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [
          {
            type: 'ticket',
            id: 'TICKET-002-001',
            epic: 'EPIC-002',
            title: 'Checkout Flow',
            jira_key: 'PROJ-42',
            source: 'jira',
          },
        ],
        backlog: [],
        ready_for_work: [],
        design: [],
        build: [],
        done: [],
      },
      stats: {
        total_stages: 0,
        total_tickets: 1,
        by_column: { to_convert: 1 },
      },
    });
    const html = renderBoardHtml(board);
    expect(html).toContain('TICKET-002-001');
    expect(html).toContain('Checkout Flow');
    expect(html).toContain('EPIC-002');
    expect(html).toContain('jira');
    expect(html).toContain('PROJ-42');
  });

  it('contains stats', () => {
    const board = makeBoardOutput({
      stats: {
        total_stages: 5,
        total_tickets: 3,
        by_column: { backlog: 2, design: 3 },
      },
    });
    const html = renderBoardHtml(board);
    expect(html).toContain('Total Stages:</strong> 5');
    expect(html).toContain('Total Tickets:</strong> 3');
    expect(html).toContain('Backlog:</strong> 2');
    expect(html).toContain('Design:</strong> 3');
  });

  it('renders session active indicator', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [],
        backlog: [],
        ready_for_work: [],
        design: [
          {
            type: 'stage',
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            title: 'Active Stage',
            session_active: true,
          },
        ],
        build: [],
        done: [],
      },
      stats: { total_stages: 1, total_tickets: 0, by_column: { design: 1 } },
    });
    const html = renderBoardHtml(board);
    expect(html).toContain('session-dot');
    expect(html).toContain('Session active');
  });

  it('empty board still produces valid HTML', () => {
    const board = makeBoardOutput({
      columns: {},
      stats: { total_stages: 0, total_tickets: 0, by_column: {} },
    });
    const html = renderBoardHtml(board);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    expect(html).toContain('Kanban Board');
  });

  it('escapes HTML special characters in titles', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [],
        backlog: [],
        ready_for_work: [],
        design: [
          {
            type: 'stage',
            id: 'STAGE-XSS',
            ticket: 'TICKET-XSS',
            epic: 'EPIC-XSS',
            title: '<script>alert("xss")</script>',
          },
        ],
        build: [],
        done: [],
      },
      stats: { total_stages: 1, total_tickets: 0, by_column: { design: 1 } },
    });
    const html = renderBoardHtml(board);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('contains generated timestamp in footer', () => {
    const board = makeBoardOutput({ generated_at: '2026-01-15T10:00:00.000Z' });
    const html = renderBoardHtml(board);
    expect(html).toContain('2026-01-15T10:00:00.000Z');
    expect(html).toContain('<footer>');
  });

  it('contains data-column attributes for each column', () => {
    const html = renderBoardHtml(makeBoardOutput());
    expect(html).toContain('data-column="to_convert"');
    expect(html).toContain('data-column="backlog"');
    expect(html).toContain('data-column="ready_for_work"');
    expect(html).toContain('data-column="design"');
    expect(html).toContain('data-column="build"');
    expect(html).toContain('data-column="done"');
  });

  it('shows warning indicator for stages with pending merge parents', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [],
        backlog: [],
        ready_for_work: [],
        design: [
          {
            type: 'stage',
            id: 'STAGE-001-001-002',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            title: 'Child Stage',
            pending_merge_parents: [
              { stage_id: 'STAGE-001-001-001', branch: 'feature/parent', pr_url: 'https://github.com/org/repo/pull/10', pr_number: 10 },
            ],
          },
        ],
        build: [],
        done: [],
      },
      stats: { total_stages: 1, total_tickets: 0, by_column: { design: 1 } },
    });
    const html = renderBoardHtml(board);
    expect(html).toContain('pending-merge');
    expect(html).toContain('Pending merge: STAGE-001-001-001');
  });

  it('does NOT show warning indicator for stages without pending merge parents', () => {
    const board = makeBoardOutput({
      columns: {
        to_convert: [],
        backlog: [],
        ready_for_work: [],
        design: [
          {
            type: 'stage',
            id: 'STAGE-001-001-001',
            ticket: 'TICKET-001-001',
            epic: 'EPIC-001',
            title: 'Normal Stage',
          },
        ],
        build: [],
        done: [],
      },
      stats: { total_stages: 1, total_tickets: 0, by_column: { design: 1 } },
    });
    const html = renderBoardHtml(board);
    expect(html).not.toContain('class="pending-merge"');
  });
});
