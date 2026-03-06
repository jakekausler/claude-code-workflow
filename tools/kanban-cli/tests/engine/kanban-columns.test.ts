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

  it('returns done for status Complete', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('done');
  });

  it('returns backlog for a pipeline status with unresolved dependencies', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('backlog');
  });

  it('returns the snake_case pipeline column name for a resolved pipeline status', () => {
    const column = computeKanbanColumn({
      status: 'Design',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('design');
  });

  it('returns ready_for_work for status Not Started with resolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('ready_for_work');
  });

  it('returns backlog for status Not Started with unresolved deps', () => {
    const column = computeKanbanColumn({
      status: 'Not Started',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('backlog');
  });

  it('returns the snake_case pipeline column for Build status', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('build');
  });

  it('returns backlog for an unknown status (not pipeline, not system)', () => {
    const column = computeKanbanColumn({
      status: 'SomeUnknownStatus',
      pipelineStatuses,
      hasUnresolvedDeps: false,
    });
    expect(column).toBe('backlog');
  });
});

describe('computeKanbanColumn edge cases', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const pipelineStatuses = sm.getAllStatuses();

  it('pipeline status with unresolved deps goes to backlog even if in pipeline', () => {
    const column = computeKanbanColumn({
      status: 'Build',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('backlog');
  });

  it('Complete status ignores dependency resolution', () => {
    const column = computeKanbanColumn({
      status: 'Complete',
      pipelineStatuses,
      hasUnresolvedDeps: true,
    });
    expect(column).toBe('done');
  });
});
