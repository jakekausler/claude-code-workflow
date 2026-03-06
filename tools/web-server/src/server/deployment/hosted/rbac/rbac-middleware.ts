import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '../../types.js';
import { type RoleService, type RoleName, ROLE_HIERARCHY } from './role-service.js';

export { type RoleName, ROLE_HIERARCHY };

export function extractRepoId(request: FastifyRequest): string | null {
  const params = request.params as Record<string, string>;
  const body = request.body as Record<string, string> | null;
  return params?.repoId ?? body?.repoId ?? null;
}

export function requireRole(
  roleService: RoleService,
  minRole: RoleName,
  opts?: { getRepoId?: (req: FastifyRequest) => string | null },
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { user?: User }).user;
    if (!user?.id) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const repoId = opts?.getRepoId ? opts.getRepoId(request) : extractRepoId(request);
    const effectiveRole = await roleService.getUserRole(user.id, repoId);

    if (!effectiveRole || ROLE_HIERARCHY[effectiveRole] < ROLE_HIERARCHY[minRole]) {
      reply.code(403).send({
        error: 'Forbidden',
        message: `Requires ${minRole} role or higher`,
      });
      return;
    }
  };
}
