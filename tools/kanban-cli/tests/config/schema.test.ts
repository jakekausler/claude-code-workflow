import { describe, it, expect } from 'vitest';
import { pipelineConfigSchema } from '../../src/config/schema.js';

describe('pipelineConfigSchema', () => {
  it('accepts a valid minimal config', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects a phase with both skill and resolver', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            resolver: 'some-resolver',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a phase with neither skill nor resolver', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a phase using a reserved status', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Not Started',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts a config with defaults', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
          WORKFLOW_MAX_PARALLEL: 3,
        },
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts a resolver state without skill', () => {
    const config = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          {
            name: 'Check',
            resolver: 'pr-status',
            status: 'Checking',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('requires at least one phase', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty transitions_to', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: [],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
