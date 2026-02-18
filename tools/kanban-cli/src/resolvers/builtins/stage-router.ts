import type { ResolverFn } from '../types.js';

/**
 * Built-in stub resolver for stage routing.
 *
 * This is a no-op placeholder. Users who need routing create custom resolvers
 * that read stage metadata (e.g., refinement_type) and return the appropriate
 * first phase. See docs/plans/2026-02-16-kanban-workflow-redesign-design.md
 * Section 6.4 for examples.
 *
 * Returns null (no routing — stages should use entry_phase directly).
 */
export const stageRouterResolver: ResolverFn = (_stage, _context) => {
  return null;
};
