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
 * Adapter for querying and managing code host (GitHub/GitLab) PR/MR status.
 * Implementations can shell out to `gh`/`glab` CLI or call APIs directly.
 */
export interface CodeHostAdapter {
  /**
   * Query the status of a PR/MR given its URL.
   */
  getPRStatus(prUrl: string): PRStatus;

  /**
   * Retarget a PR/MR to a different base branch.
   * Throws on failure — callers need to know if the mutation failed.
   */
  editPRBase(prNumber: number, newBase: string): void;

  /**
   * Promote a draft PR/MR to ready for review.
   * Throws on failure — callers need to know if the mutation failed.
   */
  markPRReady(prNumber: number): void;

  /**
   * Get the commit SHA at the head of a branch.
   * Returns empty string on failure (safe default).
   */
  getBranchHead(branch: string): string;
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
