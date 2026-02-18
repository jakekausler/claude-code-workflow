import { describe, it, expect } from 'vitest';
import { computeKanbanColumn } from '../../src/engine/kanban-columns.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import { StateMachine } from '../../src/engine/state-machine.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      {
        name: 'Design',
        skill: 'phase-design',
        status: 'Design',
        transitions_to: ['Build'],
      },
      {
        name: 'Build',
        skill: 'phase-build',
        status: 'Build',
        transitions_to: ['Done'],
      },
    ],
  },
};

describe('computeKanbanColumn', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const pipelineStatuses = sm.getAllStatuses();

  it('returns Done for status Complete', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Done');
  });

  it('returns Backlog for a pipeline status with unresolved dependencies', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('returns the pipeline column name for a resolved pipeline status', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Design');
  });

  it('returns Ready for Work for status Not Started with resolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Ready for Work');
  });

  it('returns Backlog for status Not Started with unresolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('returns the pipeline column for Build status', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Build');
  });

  it('returns Backlog for an unknown status (not pipeline, not system)', () => {
    const column = computeKanbanColumn({
      status: 'SomeUnknownStatus',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('Backlog');
  });
});

describe('computeKanbanColumn edge cases', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const pipelineStatuses = sm.getAllStatuses();

  it('pipeline status with unresolved deps goes to Backlog even if in pipeline', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Backlog');
  });

  it('Complete status ignores dependency resolution', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('Done');
  });
});
