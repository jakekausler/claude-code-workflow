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
  worktree_branch?: string;
  refinement_type?: string[];
  [key: string]: unknown;
}

/**
 * Context provided to resolver functions by the orchestration loop.
 */
export interface ResolverContext {
  /** Access to code host API (GitHub/GitLab) — injected by orchestration loop */
  codeHost?: {
    getPRStatus(prUrl: string): Promise<{
      merged: boolean;
      hasNewUnresolvedComments: boolean;
      state: string;
    }>;
  };
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
