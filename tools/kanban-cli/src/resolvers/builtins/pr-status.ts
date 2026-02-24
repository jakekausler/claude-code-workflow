import type { ResolverFn } from '../types.js';

/**
 * Built-in resolver for the "PR Created" state.
 * Queries the code host CLI to check PR/MR status.
 *
 * Returns:
 * - "Done" if PR/MR is merged
 * - null if no change (PR still open)
 *
 * Comment detection is handled separately by the MR comment cron loop (Stage 6D).
 *
 * Requires `context.codeHost` to be injected by the orchestration loop.
 * If no code host adapter is available or the stage has no `pr_url`, returns null.
 */
export const prStatusResolver: ResolverFn = async (stage, context) => {
  if (!context.codeHost || !stage.pr_url) {
    return null;
  }

  const status = context.codeHost.getPRStatus(stage.pr_url);

  if (status.merged) return 'Done';
  return null;
};
