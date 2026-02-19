import type { ResolverFn } from '../types.js';

/**
 * Built-in resolver for the "PR Created" state.
 * Queries the code host CLI to check PR/MR status.
 *
 * Returns:
 * - "Done" if PR/MR is merged
 * - "Addressing Comments" if PR/MR has unresolved review comments
 * - null if no change (PR still open, no actionable comments)
 *
 * Requires `context.codeHost` to be injected by the orchestration loop.
 * If no code host adapter is available or the stage has no `pr_url`, returns null.
 */
export const prStatusResolver: ResolverFn = (stage, context) => {
  if (!context.codeHost || !stage.pr_url) {
    return null;
  }

  const status = context.codeHost.getPRStatus(stage.pr_url);

  if (status.merged) return 'Done';
  if (status.hasUnresolvedComments) return 'Addressing Comments';
  return null;
};
