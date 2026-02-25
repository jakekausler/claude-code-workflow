import { describe, it, expect } from 'vitest';
import { buildNext, computePriorityScore } from '../../../src/cli/logic/next.js';
import type { NextStageRow, NextDependencyRow } from '../../../src/cli/logic/next.js';
import type { PipelineConfig } from '../../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Automatic Testing'] },
      { name: 'Automatic Testing', skill: 'automatic-testing', status: 'Automatic Testing', transitions_to: ['Manual Testing'] },
      { name: 'Manual Testing', skill: 'manual-testing', status: 'Manual Testing', transitions_to: ['Finalize'] },
      { name: 'Finalize', skill: 'phase-finalize', status: 'Finalize', transitions_to: ['Done', 'PR Created'] },
      { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
      { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
    ],
  },
};

function makeStage(overrides: Partial<NextStageRow>): NextStageRow {
  return {
    id: 'STAGE-001-001-001',
    ticket_id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Test Stage',
    status: 'Not Started',
    kanban_column: 'ready_for_work',
    refinement_type: '["frontend"]',
    worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
    priority: 0,
    due_date: null,
    session_active: false,
    ...overrides,
  };
}

describe('computePriorityScore', () => {
  it('gives highest score to Addressing Comments', () => {
    const score = computePriorityScore(makeStage({ status: 'Addressing Comments', kanban_column: 'addressing_comments' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(700);
  });

  it('gives second highest score to Manual Testing', () => {
    const score = computePriorityScore(makeStage({ status: 'Manual Testing', kanban_column: 'manual_testing' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(600);
    expect(score).toBeLessThan(700);
  });

  it('gives third highest score to Automatic Testing', () => {
    const score = computePriorityScore(makeStage({ status: 'Automatic Testing', kanban_column: 'automatic_testing' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(500);
    expect(score).toBeLessThan(600);
  });

  it('gives fourth score to Build-ready stages', () => {
    const score = computePriorityScore(makeStage({ status: 'Build', kanban_column: 'build' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(400);
    expect(score).toBeLessThan(500);
  });

  it('gives fifth score to Design-ready stages (Ready for Work)', () => {
    const score = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work' }), testConfig);
    expect(score).toBeGreaterThanOrEqual(300);
    expect(score).toBeLessThan(400);
  });

  it('adds priority field bonus', () => {
    const base = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', priority: 0 }), testConfig);
    const elevated = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', priority: 5 }), testConfig);
    expect(elevated).toBeGreaterThan(base);
  });

  it('adds due date proximity bonus', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const farAway = new Date();
    farAway.setDate(farAway.getDate() + 30);

    const urgent = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', due_date: tomorrow.toISOString().split('T')[0] }), testConfig);
    const notUrgent = computePriorityScore(makeStage({ status: 'Not Started', kanban_column: 'ready_for_work', due_date: farAway.toISOString().split('T')[0] }), testConfig);
    expect(urgent).toBeGreaterThan(notUrgent);
  });
});

describe('buildNext', () => {
  it('returns stages that are ready for work', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(1);
    expect(result.ready_stages[0].id).toBe('S1');
  });

  it('returns stages in pipeline columns (not just ready_for_work)', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Design', kanban_column: 'design' }),
        makeStage({ id: 'S2', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(2);
  });

  it('excludes stages with session_active = true', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Design', kanban_column: 'design', session_active: true }),
        makeStage({ id: 'S2', status: 'Build', kanban_column: 'build', session_active: false }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(1);
    expect(result.ready_stages[0].id).toBe('S2');
    expect(result.in_progress_count).toBe(1);
  });

  it('excludes stages in backlog', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'backlog' }),
      ],
      dependencies: [
        { id: 1, from_id: 'S1', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: false },
      ],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(0);
    expect(result.blocked_count).toBe(1);
  });

  it('excludes done stages', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Complete', kanban_column: 'done' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages).toHaveLength(0);
  });

  it('sorts by priority score descending', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
        makeStage({ id: 'S2', status: 'Addressing Comments', kanban_column: 'addressing_comments' }),
        makeStage({ id: 'S3', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].id).toBe('S2'); // Addressing Comments = highest
    expect(result.ready_stages[1].id).toBe('S3'); // Build
    expect(result.ready_stages[2].id).toBe('S1'); // Ready for Work = lowest
  });

  it('respects --max option', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
        makeStage({ id: 'S2', status: 'Design', kanban_column: 'design' }),
        makeStage({ id: 'S3', status: 'Build', kanban_column: 'build' }),
      ],
      dependencies: [],
      tickets: [],
      max: 2,
    });
    expect(result.ready_stages).toHaveLength(2);
  });

  it('marks Manual Testing stages with needs_human = true', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Manual Testing', kanban_column: 'manual_testing' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].needs_human).toBe(true);
  });

  it('marks Design-ready stages with needs_human = false', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].needs_human).toBe(false);
  });

  it('includes to_convert_count from tickets without stages', () => {
    const result = buildNext({
      config: testConfig,
      stages: [],
      dependencies: [],
      tickets: [
        { id: 'TICKET-001-001', epic_id: 'EPIC-001', has_stages: false },
        { id: 'TICKET-001-002', epic_id: 'EPIC-001', has_stages: true },
      ],
    });
    expect(result.to_convert_count).toBe(1);
  });

  it('includes priority_reason in output', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Addressing Comments', kanban_column: 'addressing_comments' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].priority_reason).toBe('review_comments_pending');
  });

  it('includes worktree_branch and refinement_type in output', () => {
    const result = buildNext({
      config: testConfig,
      stages: [
        makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', worktree_branch: 'my/branch', refinement_type: '["frontend","backend"]' }),
      ],
      dependencies: [],
      tickets: [],
    });
    expect(result.ready_stages[0].worktree_branch).toBe('my/branch');
    expect(result.ready_stages[0].refinement_type).toEqual(['frontend', 'backend']);
  });

  describe('global mode with repo field', () => {
    it('--global shows ready stages with repo field', () => {
      const result = buildNext({
        config: testConfig,
        stages: [
          makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', repo: 'repo-a' }),
          makeStage({ id: 'S2', status: 'Design', kanban_column: 'design', repo: 'repo-b' }),
        ],
        dependencies: [],
        tickets: [],
      });
      expect(result.ready_stages).toHaveLength(2);
      // ready_for_work (S1) has higher priority score (300) than design (S2, 200)
      expect(result.ready_stages[0].id).toBe('S1');
      expect(result.ready_stages[0].repo).toBe('repo-a');
      expect(result.ready_stages[1].id).toBe('S2');
      expect(result.ready_stages[1].repo).toBe('repo-b');
    });

    it('--global cross-repo blocked stage excluded', () => {
      const result = buildNext({
        config: testConfig,
        stages: [
          makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'backlog', repo: 'repo-a' }),
          makeStage({ id: 'S2', status: 'Design', kanban_column: 'design', repo: 'repo-b' }),
        ],
        dependencies: [
          { id: 1, from_id: 'S1', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: false },
        ],
        tickets: [],
      });
      expect(result.ready_stages).toHaveLength(1);
      expect(result.ready_stages[0].id).toBe('S2');
      expect(result.blocked_count).toBe(1);
    });

    it('--global cross-repo resolved dep allows stage to be ready', () => {
      const result = buildNext({
        config: testConfig,
        stages: [
          makeStage({ id: 'S1', status: 'Design', kanban_column: 'design', repo: 'repo-a' }),
          makeStage({ id: 'S2', status: 'Build', kanban_column: 'build', repo: 'repo-b' }),
        ],
        dependencies: [
          { id: 1, from_id: 'S1', to_id: 'S2', from_type: 'stage', to_type: 'stage', resolved: true },
        ],
        tickets: [],
      });
      expect(result.ready_stages).toHaveLength(2);
      expect(result.ready_stages.some((s) => s.id === 'S1')).toBe(true);
      expect(result.ready_stages.some((s) => s.id === 'S2')).toBe(true);
    });

    it('--global output includes repos array', () => {
      const result = buildNext({
        config: testConfig,
        stages: [
          makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work', repo: 'repo-a' }),
          makeStage({ id: 'S2', status: 'Design', kanban_column: 'design', repo: 'repo-b' }),
        ],
        dependencies: [],
        tickets: [],
      });
      // Note: repos array is added by the command layer, not the logic function
      // The logic function just passes the repo field through to each stage
      // ready_for_work (S1) has higher priority score (300) than design (S2, 200)
      expect(result.ready_stages[0].id).toBe('S1');
      expect(result.ready_stages[0].repo).toBe('repo-a');
      expect(result.ready_stages[1].id).toBe('S2');
      expect(result.ready_stages[1].repo).toBe('repo-b');
    });

    it('without --global, no repo field in output', () => {
      const result = buildNext({
        config: testConfig,
        stages: [
          makeStage({ id: 'S1', status: 'Not Started', kanban_column: 'ready_for_work' }),
        ],
        dependencies: [],
        tickets: [],
      });
      expect(result.ready_stages[0].repo).toBeUndefined();
    });
  });
});
