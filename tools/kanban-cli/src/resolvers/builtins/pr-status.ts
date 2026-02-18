import type { ResolverFn } from '../types.js';

/**
 * Built-in resolver for the "PR Created" state.
 * Polls the code host API to check PR status.
 *
 * Returns:
 * - "Done" if PR is merged
 * - "Addressing Comments" if PR has new unresolved comments
 * - null if no change (PR still open, no new comments)
 */
export const prStatusResolver: ResolverFn = async (stage, context) => {
  if (!context.codeHost || !stage.pr_url) {
    return null;
  }

  const status = await context.codeHost.getPRStatus(stage.pr_url);

  if (status.merged) return 'Done';
  if (status.hasNewUnresolvedComments) return 'Addressing Comments';
  return null;
};
