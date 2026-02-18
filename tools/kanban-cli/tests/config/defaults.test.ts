import { describe, it, expect } from 'vitest';
import { defaultPipelineConfig } from '../../src/config/defaults.js';
import { pipelineConfigSchema } from '../../src/config/schema.js';

describe('defaultPipelineConfig', () => {
  it('passes schema validation', () => {
    const result = pipelineConfigSchema.safeParse(defaultPipelineConfig);
    expect(result.success).toBe(true);
  });

  it('has Design as entry_phase', () => {
    expect(defaultPipelineConfig.workflow.entry_phase).toBe('Design');
  });

  it('contains all expected default phases', () => {
    const names = defaultPipelineConfig.workflow.phases.map((p) => p.name);
    expect(names).toEqual([
      'Design',
      'User Design Feedback',
      'Build',
      'Automatic Testing',
      'Manual Testing',
      'Finalize',
      'PR Created',
      'Addressing Comments',
    ]);
  });

  it('has exactly one resolver state (PR Created)', () => {
    const resolvers = defaultPipelineConfig.workflow.phases.filter((p) => p.resolver);
    expect(resolvers).toHaveLength(1);
    expect(resolvers[0].name).toBe('PR Created');
  });

  it('has all other phases as skill states', () => {
    const skills = defaultPipelineConfig.workflow.phases.filter((p) => p.skill);
    expect(skills).toHaveLength(7);
  });

  it('has sensible defaults', () => {
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(false);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_AUTO_DESIGN).toBe(false);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(1);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_GIT_PLATFORM).toBe('auto');
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_LEARNINGS_THRESHOLD).toBe(10);
  });

  it('Finalize can transition to both Done and PR Created', () => {
    const finalize = defaultPipelineConfig.workflow.phases.find((p) => p.name === 'Finalize');
    expect(finalize?.transitions_to).toContain('Done');
    expect(finalize?.transitions_to).toContain('PR Created');
  });
});
