import { describe, it, expect } from 'vitest';
import { buildBoard, toColumnKey } from '../../../src/cli/logic/board.js';
import type { StageBoardItem, TicketBoardItem } from '../../../src/cli/logic/board.js';
import type { PipelineConfig } from '../../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
    ],
  },
};

describe('toColumnKey', () => {
  it('converts a display name to a snake_case key', () => {
    expect(toColumnKey('User Design Feedback')).toBe('user_design_feedback');
  });

  it('handles single word', () => {
    expect(toColumnKey('Design')).toBe('design');
  });

  it('handles PR Created', () => {
    expect(toColumnKey('PR Created')).toBe('pr_created');
  });
});

describe('buildBoard', () => {
  it('returns all system columns plus pipeline columns', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    const columnKeys = Object.keys(result.columns);
    // System columns
    expect(columnKeys).toContain('to_convert');
    expect(columnKeys).toContain('backlog');
    expect(columnKeys).toContain('ready_for_work');
    expect(columnKeys).toContain('done');
    // Pipeline columns
    expect(columnKeys).toContain('design');
    expect(columnKeys).toContain('build');
  });

  it('places tickets without stages in to_convert', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Checkout', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md' },
      ],
      stages: [],
      dependencies: [],
    });
    expect(result.columns.to_convert).toHaveLength(1);
    expect(result.columns.to_convert[0].id).toBe('TICKET-001-001');
  });

  it('places stages with unresolved deps in backlog', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Not Started', kanban_column: 'backlog', refinement_type: '["frontend"]', worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [
        { id: 1, from_id: 'STAGE-001-001-001', to_id: 'STAGE-001-001-002', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
    });
    expect(result.columns.backlog).toHaveLength(1);
    expect(result.columns.backlog[0].id).toBe('STAGE-001-001-001');
    expect((result.columns.backlog[0] as any).blocked_by).toContain('STAGE-001-001-002');
  });

  it('places stages with status Not Started and all deps resolved in ready_for_work', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Not Started', kanban_column: 'ready_for_work', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.ready_for_work).toHaveLength(1);
  });

  it('places stages with pipeline status in the matching pipeline column', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Design', kanban_column: 'design', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.design).toHaveLength(1);
  });

  it('places completed stages in done', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Login Form', status: 'Complete', kanban_column: 'done', refinement_type: '["frontend"]', worktree_branch: 'branch-1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.columns.done).toHaveLength(1);
  });

  it('computes stats correctly', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'T1', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'f.md' },
      ],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', refinement_type: '["frontend"]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '["frontend"]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    expect(result.stats.total_stages).toBe(2);
    expect(result.stats.total_tickets).toBe(1);
    expect(result.stats.by_column.ready_for_work).toBe(1);
    expect(result.stats.by_column.done).toBe(1);
    expect(result.stats.by_column.to_convert).toBe(1);
  });

  it('filters by epic', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-002-001-001', ticket_id: 'TICKET-002-001', epic_id: 'EPIC-002', title: 'S2', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { epic: 'EPIC-001' },
    });
    expect(result.columns.design).toHaveLength(1);
    expect(result.columns.design[0].id).toBe('STAGE-001-001-001');
  });

  it('filters by ticket', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-002-001', ticket_id: 'TICKET-001-002', epic_id: 'EPIC-001', title: 'S2', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { ticket: 'TICKET-001-001' },
    });
    expect(result.columns.design).toHaveLength(1);
  });

  it('filters by column', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { column: 'design' },
    });
    // Only the design column should have items; other columns empty
    expect(result.columns.design).toHaveLength(1);
    expect(result.columns.done).toHaveLength(0);
  });

  it('excludes done stages when excludeDone is true', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Complete', kanban_column: 'done', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
      filters: { excludeDone: true },
    });
    expect(result.columns.done).toHaveLength(0);
    expect(result.columns.design).toHaveLength(1);
  });

  it('includes generated_at timestamp and repo path', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    expect(result.generated_at).toBeDefined();
    expect(result.repo).toBe('/tmp/test-repo');
  });

  it('reads column names from pipeline config, not hardcoded', () => {
    const customConfig: PipelineConfig = {
      workflow: {
        entry_phase: 'Spike',
        phases: [
          { name: 'Spike', skill: 'my-spike', status: 'Spike', transitions_to: ['Done'] },
        ],
      },
    };
    const result = buildBoard({
      config: customConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
    });
    const columnKeys = Object.keys(result.columns);
    expect(columnKeys).toContain('spike');
    expect(columnKeys).not.toContain('design');
    expect(columnKeys).not.toContain('build');
    // System columns always present
    expect(columnKeys).toContain('to_convert');
    expect(columnKeys).toContain('backlog');
    expect(columnKeys).toContain('ready_for_work');
    expect(columnKeys).toContain('done');
  });

  it('includes pending_merge_parents for stages that have them', () => {
    const pendingParents = JSON.stringify([
      { stage_id: 'STAGE-001-001-001', branch: 'feature/parent', pr_url: 'https://github.com/org/repo/pull/10', pr_number: 10 },
    ]);
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Child Stage', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, pending_merge_parents: pendingParents, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    const item = result.columns.design[0] as StageBoardItem;
    expect(item.pending_merge_parents).toBeDefined();
    expect(item.pending_merge_parents).toHaveLength(1);
    expect(item.pending_merge_parents![0].stage_id).toBe('STAGE-001-001-001');
    expect(item.pending_merge_parents![0].branch).toBe('feature/parent');
    expect(item.pending_merge_parents![0].pr_url).toBe('https://github.com/org/repo/pull/10');
    expect(item.pending_merge_parents![0].pr_number).toBe(10);
  });

  it('does NOT include pending_merge_parents for stages without them', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Normal Stage', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    const item = result.columns.design[0] as StageBoardItem;
    expect(item.pending_merge_parents).toBeUndefined();
  });

  it('does NOT include pending_merge_parents when JSON is empty array', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Stage', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, pending_merge_parents: '[]', file_path: 'f.md' },
      ],
      dependencies: [],
    });
    const item = result.columns.design[0] as StageBoardItem;
    expect(item.pending_merge_parents).toBeUndefined();
  });

  it('does NOT include pending_merge_parents when JSON is invalid', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'Stage', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, pending_merge_parents: 'not-valid-json', file_path: 'f.md' },
      ],
      dependencies: [],
    });
    const item = result.columns.design[0] as StageBoardItem;
    expect(item.pending_merge_parents).toBeUndefined();
  });

  it('board output without any pending merge parents is unchanged from current', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
        { id: 'STAGE-001-001-002', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S2', status: 'Build', kanban_column: 'build', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: true, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    // Ensure no stage has pending_merge_parents key in JSON output
    const json = JSON.stringify(result);
    expect(json).not.toContain('pending_merge_parents');
  });
});

describe('buildBoard (global mode)', () => {
  it('includes repos array at top level when global flag is set', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '(global)',
      epics: [],
      tickets: [],
      stages: [],
      dependencies: [],
      global: true,
      repos: ['repo-alpha', 'repo-beta'],
    });
    expect(result.repos).toEqual(['repo-alpha', 'repo-beta']);
    expect(result.repo).toBe('(global)');
  });

  it('includes repo field on stage items in global mode', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '(global)',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-A-001', ticket_id: 'TICKET-A-001', epic_id: 'EPIC-A', title: 'Stage from Alpha', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-alpha' },
        { id: 'STAGE-B-001', ticket_id: 'TICKET-B-001', epic_id: 'EPIC-B', title: 'Stage from Beta', status: 'Build', kanban_column: 'build', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-beta' },
      ],
      dependencies: [],
      global: true,
      repos: ['repo-alpha', 'repo-beta'],
    });
    const designItem = result.columns.design[0] as StageBoardItem;
    expect(designItem.repo).toBe('repo-alpha');
    const buildItem = result.columns.build[0] as StageBoardItem;
    expect(buildItem.repo).toBe('repo-beta');
  });

  it('includes repo field on ticket items in global mode', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '(global)',
      epics: [],
      tickets: [
        { id: 'TICKET-A-001', epic_id: 'EPIC-A', title: 'Ticket Alpha', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'f.md', repo: 'repo-alpha' },
        { id: 'TICKET-B-001', epic_id: 'EPIC-B', title: 'Ticket Beta', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'f.md', repo: 'repo-beta' },
      ],
      stages: [],
      dependencies: [],
      global: true,
      repos: ['repo-alpha', 'repo-beta'],
    });
    expect(result.columns.to_convert).toHaveLength(2);
    const ticketA = result.columns.to_convert[0] as TicketBoardItem;
    expect(ticketA.repo).toBe('repo-alpha');
    const ticketB = result.columns.to_convert[1] as TicketBoardItem;
    expect(ticketB.repo).toBe('repo-beta');
  });

  it('aggregates stages from multiple repos into correct columns', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '(global)',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-A-001', ticket_id: 'TICKET-A-001', epic_id: 'EPIC-A', title: 'Alpha Design', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-alpha' },
        { id: 'STAGE-B-001', ticket_id: 'TICKET-B-001', epic_id: 'EPIC-B', title: 'Beta Design', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-beta' },
        { id: 'STAGE-A-002', ticket_id: 'TICKET-A-001', epic_id: 'EPIC-A', title: 'Alpha Build', status: 'Build', kanban_column: 'build', refinement_type: '[]', worktree_branch: 'b3', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-alpha' },
      ],
      dependencies: [],
      global: true,
      repos: ['repo-alpha', 'repo-beta'],
    });
    expect(result.columns.design).toHaveLength(2);
    expect(result.columns.build).toHaveLength(1);
    expect(result.stats.total_stages).toBe(3);
    expect(result.stats.by_column.design).toBe(2);
    expect(result.stats.by_column.build).toBe(1);
  });

  it('does NOT include repos or repo fields in single-repo mode (regression)', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '/tmp/test-repo',
      epics: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'T1', status: 'Not Started', jira_key: null, source: 'local', has_stages: false, file_path: 'f.md' },
      ],
      stages: [
        { id: 'STAGE-001-001-001', ticket_id: 'TICKET-001-001', epic_id: 'EPIC-001', title: 'S1', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md' },
      ],
      dependencies: [],
    });
    // No repos array at top level
    expect(result.repos).toBeUndefined();
    // No repo field on items
    const json = JSON.stringify(result);
    // repo appears only as the top-level field, not on any item
    const parsed = JSON.parse(json);
    expect(parsed.repo).toBe('/tmp/test-repo');
    const stageItem = parsed.columns.design[0];
    expect(stageItem.repo).toBeUndefined();
    const ticketItem = parsed.columns.to_convert[0];
    expect(ticketItem.repo).toBeUndefined();
  });

  it('filters by epic in global mode', () => {
    const result = buildBoard({
      config: testConfig,
      repoPath: '(global)',
      epics: [],
      tickets: [],
      stages: [
        { id: 'STAGE-A-001', ticket_id: 'TICKET-A-001', epic_id: 'EPIC-A', title: 'Alpha', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b1', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-alpha' },
        { id: 'STAGE-B-001', ticket_id: 'TICKET-B-001', epic_id: 'EPIC-B', title: 'Beta', status: 'Design', kanban_column: 'design', refinement_type: '[]', worktree_branch: 'b2', priority: 0, due_date: null, session_active: false, file_path: 'f.md', repo: 'repo-beta' },
      ],
      dependencies: [],
      filters: { epic: 'EPIC-A' },
      global: true,
      repos: ['repo-alpha', 'repo-beta'],
    });
    expect(result.columns.design).toHaveLength(1);
    expect(result.columns.design[0].id).toBe('STAGE-A-001');
  });
});
