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

    it('rejects unknown status_map keys', () => {
      const config = {
        ...minimalWorkflow,
        jira: {
          status_map: {
            first_stage_design: 'In Progress',
            unknown_event: 'Bad Status',
          },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
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

  describe('cron config', () => {
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

    it('accepts cron config with valid values', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 300 },
          insights_threshold: { enabled: false, interval_seconds: 600 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cron?.mr_comment_poll?.enabled).toBe(true);
        expect(result.data.cron?.mr_comment_poll?.interval_seconds).toBe(300);
        expect(result.data.cron?.insights_threshold?.enabled).toBe(false);
        expect(result.data.cron?.insights_threshold?.interval_seconds).toBe(600);
      }
    });

    it('rejects cron config with interval_seconds below 30', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 29 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('rejects cron config with interval_seconds above 3600', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 3601 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('accepts config with missing cron section (optional)', () => {
      const result = pipelineConfigSchema.safeParse(minimalWorkflow);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cron).toBeUndefined();
      }
    });

    it('accepts cron with only mr_comment_poll', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 60 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts cron with only insights_threshold', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          insights_threshold: { enabled: true, interval_seconds: 120 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts interval_seconds at boundary min (30)', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 30 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('accepts interval_seconds at boundary max (3600)', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 3600 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('rejects non-integer interval_seconds', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 300.5 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean enabled', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: 'yes', interval_seconds: 300 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('accepts empty cron object', () => {
      const config = {
        ...minimalWorkflow,
        cron: {},
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('rejects unknown cron keys', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { enabled: true, interval_seconds: 300 },
          mr_coment_poll: { enabled: true, interval_seconds: 300 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('rejects cron job config missing enabled field', () => {
      const config = {
        ...minimalWorkflow,
        cron: {
          mr_comment_poll: { interval_seconds: 300 },
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('backward compat: existing configs without cron section still parse', () => {
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
        jira: {
          reading_script: './scripts/read-jira.sh',
        },
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cron).toBeUndefined();
      }
    });
  });
});
