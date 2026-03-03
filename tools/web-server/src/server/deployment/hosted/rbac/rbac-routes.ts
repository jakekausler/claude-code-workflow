import type { FastifyInstance } from 'fastify';
import type { User } from '../../types.js';
import { type RoleService, type RoleName } from './role-service.js';
import { requireRole } from './rbac-middleware.js';

export function registerRbacRoutes(app: FastifyInstance, roleService: RoleService): void {
  const pool = roleService.getPool();

  // List roles for a repo
  app.get<{ Params: { repoId: string } }>(
    '/api/roles/:repoId',
    { preHandler: requireRole(roleService, 'developer') },
    async (request) => {
      const { repoId } = request.params;
      const result = await pool.query(
        `SELECT r.*, u.username FROM roles r JOIN users u ON r.user_id = u.id WHERE r.repo_id = $1`,
        [repoId],
      );
      return result.rows;
    },
  );

  // List roles for a user
  app.get<{ Params: { userId: string } }>(
    '/api/roles/user/:userId',
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { userId } = request.params;
      if (user.id !== userId && !(await roleService.isGlobalAdmin(user.id))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const result = await pool.query(`SELECT * FROM roles WHERE user_id = $1`, [userId]);
      return result.rows;
    },
  );

  // Assign role
  app.post<{ Body: { userId: string; repoId: string | null; roleName: RoleName } }>(
    '/api/roles',
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { userId, repoId, roleName } = request.body;
      try {
        await roleService.assignRole(userId, repoId ?? null, roleName, user.id);
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(403).send({ error: message });
      }
    },
  );

  // Remove role
  app.delete<{ Params: { userId: string; repoId: string } }>(
    '/api/roles/:userId/:repoId',
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { userId, repoId } = request.params;
      const isAdmin = await roleService.isGlobalAdmin(user.id);
      if (!isAdmin) {
        const role = await roleService.getUserRole(user.id, repoId);
        if (!role || !(['global_admin', 'admin'] as string[]).includes(role)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
      }
      await roleService.removeRole(userId, repoId === 'null' ? null : repoId);
      return { success: true };
    },
  );
}
