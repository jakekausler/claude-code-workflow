/**
 * A single state in the workflow pipeline.
 * Every state has either a `skill` (Claude session) or a `resolver` (TypeScript function).
 */
export interface PipelineState {
  /** Display name for this state (e.g., "Design", "PR Created") */
  name: string;

  /** Unique status value written to stage frontmatter */
  status: string;

  /** Claude skill reference — spawns a Claude session. Mutually exclusive with `resolver`. */
  skill?: string;

  /** TypeScript resolver function name — lightweight automation. Mutually exclusive with `skill`. */
  resolver?: string;

  /** Valid next states this state can transition to. "Done" is always valid. */
  transitions_to: string[];
}

/**
 * Environment variable defaults that can be set in config.
 */
export interface WorkflowDefaults {
  WORKFLOW_REMOTE_MODE?: boolean;
  WORKFLOW_AUTO_DESIGN?: boolean;
  WORKFLOW_MAX_PARALLEL?: number;
  WORKFLOW_GIT_PLATFORM?: 'github' | 'gitlab' | 'auto';
  WORKFLOW_LEARNINGS_THRESHOLD?: number;
  WORKFLOW_JIRA_CONFIRM?: boolean;
  WORKFLOW_SLACK_WEBHOOK?: string;
}

/**
 * Jira status mapping for workflow transitions.
 */
export interface JiraStatusMap {
  first_stage_design?: string;
  stage_pr_created?: string;
  all_stages_done?: string;
}

/**
 * Jira integration configuration.
 * When null or undefined, Jira integration is disabled.
 */
export interface JiraConfig {
  reading_script?: string | null;
  writing_script?: string | null;
  project?: string | null;
  assignee?: string | null;
  status_map?: JiraStatusMap;
}

/**
 * Configuration for a single cron job.
 */
export interface CronJobConfig {
  /** Whether this cron job is enabled */
  enabled: boolean;

  /** Polling interval in seconds (30–3600) */
  interval_seconds: number;
}

/**
 * Cron job configuration section.
 * Each field controls a specific periodic task.
 */
export interface CronConfig {
  /** MR comment polling cron job */
  mr_comment_poll?: CronJobConfig;

  /** Insights threshold checking cron job */
  insights_threshold?: CronJobConfig;
}

/**
 * The complete workflow pipeline configuration.
 * Loaded from YAML, validated by Zod schema.
 */
export interface PipelineConfig {
  workflow: {
    /** Name of the first state a stage enters from Ready for Work */
    entry_phase: string;

    /** Ordered list of pipeline states */
    phases: PipelineState[];

    /** Environment variable defaults (overridable by actual env vars) */
    defaults?: WorkflowDefaults;
  };

  /** Jira integration configuration. Null or undefined means disabled. */
  jira?: JiraConfig | null;

  /** Cron job configuration. Optional; omit to use defaults or disable cron. */
  cron?: CronConfig;
}

/**
 * Reserved status values used by system columns. Pipeline states cannot use these.
 */
export const RESERVED_STATUSES = ['Not Started', 'Complete'] as const;

/**
 * Reserved transition target representing the terminal state.
 */
export const DONE_TARGET = 'Done' as const;

/**
 * The status value that represents the terminal "Done" state in frontmatter.
 */
export const COMPLETE_STATUS = 'Complete' as const;

/**
 * Discriminated state types for the orchestration loop.
 */
export type SkillState = PipelineState & { skill: string; resolver?: undefined };
export type ResolverState = PipelineState & { resolver: string; skill?: undefined };

/**
 * Type guard: is this a skill state?
 */
export function isSkillState(state: PipelineState): state is SkillState {
  return state.skill !== undefined && state.resolver === undefined;
}

/**
 * Type guard: is this a resolver state?
 */
export function isResolverState(state: PipelineState): state is ResolverState {
  return state.resolver !== undefined && state.skill === undefined;
}
