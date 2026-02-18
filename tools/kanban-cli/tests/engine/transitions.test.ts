import { describe, it, expect } from 'vitest';
import { TransitionValidator } from '../../src/engine/transitions.js';
import { StateMachine } from '../../src/engine/state-machine.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import { DONE_TARGET } from '../../src/types/pipeline.js';

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

describe('TransitionValidator', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const validator = new TransitionValidator(sm);

  it('allows a valid transition (Design → Build)', () => {
    const result = validator.validate('Design', 'Build');
    expect(result.valid).toBe(true);
  });

  it('allows a valid transition (Design → User Design Feedback)', () => {
    const result = validator.validate('Design', 'User Design Feedback');
    expect(result.valid).toBe(true);
  });

  it('allows transition to Done when declared', () => {
    const result = validator.validate('Build', 'Done');
    expect(result.valid).toBe(true);
  });

  it('rejects an undeclared transition (Design → Done)', () => {
    const result = validator.validate('Design', 'Done');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('rejects transition from unknown status', () => {
    const result = validator.validate('NonExistent', 'Build');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects transition to unknown status (not a state and not Done)', () => {
    const result = validator.validate('Design', 'NonExistent');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('rejects self-transition', () => {
    const result = validator.validate('Design', 'Design');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('resolves target name to target status', () => {
    // transitions_to uses names, but the status field is what's stored in frontmatter
    // "User Design Feedback" (name) has status "User Design Feedback" (same in default config)
    const result = validator.resolveTransitionTarget('Design', 'User Design Feedback');
    expect(result).toBe('User Design Feedback');
  });

  it('resolves Done target', () => {
    const result = validator.resolveTransitionTarget('Build', 'Done');
    expect(result).toBe('Complete');
  });

  it('returns null for invalid target', () => {
    const result = validator.resolveTransitionTarget('Design', 'NonExistent');
    expect(result).toBeNull();
  });
});
