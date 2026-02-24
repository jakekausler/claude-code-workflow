import type { ResolverFn } from '../types.js';

/** Refinement types that require manual testing. */
const MANUAL_TESTING_TYPES = new Set(['frontend', 'ux', 'accessibility']);

/**
 * Built-in resolver for testing phase routing.
 *
 * Routes stages to the appropriate testing phase based on the
 * `refinement_type` array in stage frontmatter:
 *
 * - If refinement_type contains "frontend", "ux", or "accessibility"
 *   → returns "Manual Testing"
 * - Otherwise → returns "Finalize"
 *
 * This resolver always returns a transition target (never null).
 */
export const testingRouterResolver: ResolverFn = (stage, _context) => {
  const types = stage.refinement_type ?? [];
  const needsManualTesting = types.some((t) => MANUAL_TESTING_TYPES.has(t));
  return needsManualTesting ? 'Manual Testing' : 'Finalize';
};
