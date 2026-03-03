import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { User } from '../deployment/types.js';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';

export interface MeRouteOptions {
  roleService?: RoleService;
}

const mePlugin: FastifyPluginCallback<MeRouteOptions> = (app, opts, done) => {
  const { roleService } = opts;

  /**
   * GET /api/me — Returns the current user and their effective role.
   *
   * In local mode: { mode: 'local', user: null }
   * In hosted mode: { mode: 'hosted', user: { ...profile, role } }
   */
  app.get('/api/me', async (request, reply) => {
    const deploymentMode = app.deploymentContext.mode;
    const user = (request as typeof request & { user?: User }).user ?? null;

    if (deploymentMode === 'local' || !user) {
      return reply.send({ mode: deploymentMode, user: null });
    }

    // Hosted mode: resolve the user's effective role (no repoId = global role)
    let role: string = 'viewer';
    if (roleService) {
      const effectiveRole = await roleService.getUserRole(user.id, null);
      role = effectiveRole ?? 'viewer';
    }

    return reply.send({
      mode: deploymentMode,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role,
      },
    });
  });

  done();
};

export const meRoutes = fp(mePlugin, { name: 'me-routes' });
