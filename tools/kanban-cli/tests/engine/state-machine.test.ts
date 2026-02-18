import { describe, it, expect } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      {
        name: 'Design',
        skill: 'phase-design',
        status: 'Design',
        transitions_to: ['Build', 'User Design Feedback'],
      },
      {
        name: 'User Design Feedback',
        skill: 'user-design-feedback',
        status: 'User Design Feedback',
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

describe('StateMachine', () => {
  it('creates from a valid config', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm).toBeDefined();
  });

  it('returns the entry state', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const entry = sm.getEntryState();
    expect(entry.name).toBe('Design');
  });

  it('looks up state by status', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const state = sm.getStateByStatus('Build');
    expect(state?.name).toBe('Build');
  });

  it('looks up state by name', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const state = sm.getStateByName('User Design Feedback');
    expect(state?.status).toBe('User Design Feedback');
  });

  it('returns null for unknown status', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm.getStateByStatus('NonExistent')).toBeNull();
  });

  it('returns all states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm.getAllStates()).toHaveLength(3);
  });

  it('returns all status values', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const statuses = sm.getAllStatuses();
    expect(statuses).toContain('Design');
    expect(statuses).toContain('Build');
    expect(statuses).toContain('User Design Feedback');
  });

  it('identifies skill states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const skillStates = sm.getSkillStates();
    expect(skillStates).toHaveLength(3);
  });

  it('identifies resolver states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const resolverStates = sm.getResolverStates();
    expect(resolverStates).toHaveLength(0);
  });
});
