import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '../../types.js';
import type { RoleService } from './role-service.js';

/**
 * Fastify preHandler that attaches `request.allowedRepoIds` based on the
 * authenticated user's role assignments.
 *
 * - Global admins: allowedRepoIds is NOT set (no filtering — sees all repos).
 * - Regular users: allowedRepoIds = list of repo IDs they have roles for.
 * - Users with no roles: allowedRepoIds = [] (empty — sees nothing).
 * - Local mode (no auth / no roleService): skipped entirely — allowedRepoIds stays undefined.
 */
export function repoScopeMiddleware(roleService: RoleService) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { user?: User }).user;
    if (!user?.id) {
      // No authenticated user (shouldn't happen behind requireAuth, but be safe)
      return;
    }

    // Global admins bypass scoping — they see all repos
    const isAdmin = await roleService.isGlobalAdmin(user.id);
    if (isAdmin) {
      return;
    }

    // Attach the list of repo IDs this user may access
    const repoIds = await roleService.getUserRepos(user.id);
    request.allowedRepoIds = repoIds;
  };
}
