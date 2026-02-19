/**
 * Minimal stage data passed to resolvers.
 * Full stage type will be defined in Stage 1 when frontmatter parsing is built.
 */
export interface ResolverStageInput {
  id: string;
  status: string;
  ticket_id?: string;
  epic_id?: string;
  pr_url?: string;
  pr_number?: number;
  worktree_branch?: string;
  refinement_type?: string[];
  [key: string]: unknown;
}

/**
 * PR/MR status returned by the code host adapter.
 */
export interface PRStatus {
  /** Whether the PR/MR has been merged */
  merged: boolean;
  /** Whether there are unresolved review comments */
  hasUnresolvedComments: boolean;
  /** Raw state string from the platform (e.g., 'open', 'closed', 'merged') */
  state: string;
}

/**
 * Adapter for querying code host (GitHub/GitLab) PR/MR status.
 * Implementations can shell out to `gh`/`glab` CLI or call APIs directly.
 */
export interface CodeHostAdapter {
  getPRStatus(prUrl: string): PRStatus;
}

/**
 * Context provided to resolver functions by the orchestration loop.
 */
export interface ResolverContext {
  /** Access to code host API (GitHub/GitLab) -- injected by orchestration loop */
  codeHost?: CodeHostAdapter;
  /** Current environment variable values */
  env: Record<string, string | undefined>;
}

/**
 * A resolver function. Called by the orchestration loop on each tick
 * for stages in a resolver state.
 *
 * @returns A transition target name (from transitions_to), or null for no change.
 */
export type ResolverFn = (
  stage: ResolverStageInput,
  context: ResolverContext
) => string | null | Promise<string | null>;
