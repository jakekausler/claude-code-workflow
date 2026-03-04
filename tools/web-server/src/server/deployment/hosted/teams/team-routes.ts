import type { FastifyInstance } from 'fastify';
import type { User } from '../../types.js';
import type { TeamService } from './team-service.js';
import type { RoleService } from '../rbac/role-service.js';
import { requireRole } from '../rbac/rbac-middleware.js';

export function registerTeamRoutes(
  app: FastifyInstance,
  teamService: TeamService,
  roleService: RoleService,
): void {
  const adminGuard = requireRole(roleService, 'global_admin', { getRepoId: () => null });

  // Create team
  app.post<{ Body: { name: string; description?: string } }>(
    '/api/teams',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { name, description } = request.body;
      const team = await teamService.createTeam(name, description ?? '', user.id);
      return team;
    },
  );

  // List all teams
  app.get('/api/teams', async () => {
    return teamService.getAllTeams();
  });

  // Get team detail
  app.get<{ Params: { teamId: string } }>(
    '/api/teams/:teamId',
    async (request, reply) => {
      const detail = await teamService.getTeamDetail(request.params.teamId);
      if (!detail) return reply.code(404).send({ error: 'Team not found' });
      return detail;
    },
  );

  // Delete team
  app.delete<{ Params: { teamId: string } }>(
    '/api/teams/:teamId',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      await teamService.deleteTeam(request.params.teamId);
      return { success: true };
    },
  );

  // Add member to team
  app.post<{ Params: { teamId: string }; Body: { userId: string } }>(
    '/api/teams/:teamId/members',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { teamId } = request.params;
      const { userId } = request.body;
      await teamService.addMember(teamId, userId);
      return { success: true };
    },
  );

  // Remove member from team
  app.delete<{ Params: { teamId: string; userId: string } }>(
    '/api/teams/:teamId/members/:userId',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { teamId, userId } = request.params;
      await teamService.removeMember(teamId, userId);
      return { success: true };
    },
  );

  // Set team repo access
  app.post<{
    Params: { teamId: string };
    Body: { repoId: number; roleName: 'admin' | 'developer' | 'viewer' };
  }>(
    '/api/teams/:teamId/repos',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { teamId } = request.params;
      const { repoId, roleName } = request.body;
      await teamService.setTeamRepoAccess(teamId, repoId, roleName);
      return { success: true };
    },
  );

  // Remove team repo access
  app.delete<{ Params: { teamId: string; repoId: string } }>(
    '/api/teams/:teamId/repos/:repoId',
    { preHandler: adminGuard },
    async (request, reply) => {
      const user = (request as typeof request & { user?: User }).user;
      if (!user?.id) return reply.code(401).send({ error: 'Unauthorized' });
      const { teamId, repoId } = request.params;
      await teamService.removeTeamRepoAccess(teamId, parseInt(repoId, 10));
      return { success: true };
    },
  );

  // Get user's teams
  app.get<{ Params: { userId: string } }>(
    '/api/users/:userId/teams',
    async (request) => {
      return teamService.getUserTeams(request.params.userId);
    },
  );

  // Get effective role for a user on a repo
  app.get<{ Params: { userId: string; repoId: string } }>(
    '/api/users/:userId/repos/:repoId/effective-role',
    async (request) => {
      const role = await teamService.getEffectiveRole(
        request.params.userId,
        request.params.repoId,
      );
      return { effectiveRole: role };
    },
  );
}
