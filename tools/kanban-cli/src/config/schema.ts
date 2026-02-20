import { z } from 'zod';
import { RESERVED_STATUSES } from '../types/pipeline.js';

const pipelineStateSchema = z
  .object({
    name: z.string().min(1),
    status: z
      .string()
      .min(1)
      .refine((s) => !(RESERVED_STATUSES as readonly string[]).includes(s), {
        message: `Status cannot be a reserved value: ${RESERVED_STATUSES.join(', ')}`,
      }),
    skill: z.string().min(1).optional(),
    resolver: z.string().min(1).optional(),
    transitions_to: z.array(z.string().min(1)).min(1),
  })
  .refine(
    (state) => {
      const hasSkill = state.skill !== undefined;
      const hasResolver = state.resolver !== undefined;
      return hasSkill !== hasResolver; // exactly one must be set (XOR)
    },
    {
      message: 'Each phase must have exactly one of "skill" or "resolver" (not both, not neither)',
    }
  );

const workflowDefaultsSchema = z.object({
  WORKFLOW_REMOTE_MODE: z.boolean().optional(),
  WORKFLOW_AUTO_DESIGN: z.boolean().optional(),
  WORKFLOW_MAX_PARALLEL: z.number().int().positive().optional(),
  WORKFLOW_GIT_PLATFORM: z.enum(['github', 'gitlab', 'auto']).optional(),
  WORKFLOW_LEARNINGS_THRESHOLD: z.number().int().positive().optional(),
  WORKFLOW_JIRA_CONFIRM: z.boolean().optional(),
  WORKFLOW_SLACK_WEBHOOK: z.string().url().optional(),
});

const jiraStatusMapSchema = z.object({
  first_stage_design: z.string().optional(),
  stage_pr_created: z.string().optional(),
  all_stages_done: z.string().optional(),
}).optional();

const jiraConfigSchema = z.object({
  reading_script: z.string().nullable().optional(),
  writing_script: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  status_map: jiraStatusMapSchema,
}).nullable().optional();

export const pipelineConfigSchema = z.object({
  workflow: z.object({
    entry_phase: z.string().min(1),
    phases: z.array(pipelineStateSchema).min(1),
    defaults: workflowDefaultsSchema.optional(),
  }),
  jira: jiraConfigSchema,
});

export type ValidatedPipelineConfig = z.infer<typeof pipelineConfigSchema>;
