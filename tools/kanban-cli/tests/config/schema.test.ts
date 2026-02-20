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

  describe('jira config', () => {
    const minimalWorkflow = {
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

    it('accepts config with all jira fields', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          reading_script: './scripts/read-jira.sh',
          writing_script: './scripts/write-jira.sh',
          project: 'PROJ',
          assignee: 'user@example.com',
          status_map: {
            first_stage_design: 'In Design',
            stage_pr_created: 'In Review',
            all_stages_done: 'Done',
          },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts config with jira: null (disabled)', () => {
      const config = {
        ...minimalWorkflow,
        jira: null,
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts config with no jira section (disabled)', () => {
      const result = pipelineConfigSchema.safeParse(minimalWorkflow);
      expect(result.success).toBe(true);
    });

    it('accepts config with only reading_script (read-only)', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          reading_script: './scripts/read-jira.sh',
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts config with only writing_script (write-only)', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          writing_script: './scripts/write-jira.sh',
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts status_map with partial keys', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          status_map: {
            first_stage_design: 'In Progress',
          },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jira?.status_map?.first_stage_design).toBe('In Progress');
        expect(result.data.jira?.status_map?.stage_pr_created).toBeUndefined();
        expect(result.data.jira?.status_map?.all_stages_done).toBeUndefined();
      }
    });

    it('accepts status_map with all keys', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          status_map: {
            first_stage_design: 'In Design',
            stage_pr_created: 'In Review',
            all_stages_done: 'Completed',
          },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jira?.status_map?.first_stage_design).toBe('In Design');
        expect(result.data.jira?.status_map?.stage_pr_created).toBe('In Review');
        expect(result.data.jira?.status_map?.all_stages_done).toBe('Completed');
      }
    });

    it('backward compat: existing configs without jira section still parse', () => {
      // This is the same as the minimal config test but explicitly named for backward compat
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
      if (result.success) {
        expect(result.data.jira).toBeUndefined();
      }
    });
  });
});
