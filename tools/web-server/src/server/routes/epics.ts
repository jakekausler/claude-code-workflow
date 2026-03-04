import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';
import { requireRole } from '../deployment/hosted/rbac/rbac-middleware.js';

export interface EpicRouteOptions {
  roleService?: RoleService;
}

/** Zod schema for the :id route parameter. */
const epicIdSchema = z.string().regex(/^EPIC-\d{3}$/);

const epicPlugin: FastifyPluginCallback<EpicRouteOptions> = (app, opts, done) => {
  const { roleService } = opts;
  /**
   * GET /api/epics — List all epics with ticket counts.
   */
  app.get('/api/epics', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const allRepos = await app.dataService.repos.findAll();
    const repos = request.allowedRepoIds
      ? allRepos.filter((r) => request.allowedRepoIds!.includes(String(r.id)))
      : allRepos;
    if (repos.length === 0) {
      return reply.send([]);
    }

    // Aggregate across all allowed repos
    const epics = (await Promise.all(repos.map((r) => app.dataService!.epics.listByRepo(r.id)))).flat();
    const tickets = (await Promise.all(repos.map((r) => app.dataService!.tickets.listByRepo(r.id)))).flat();

    // Build a map of epic_id -> ticket count for O(n) instead of O(n*m)
    const ticketCountByEpic = new Map<string, number>();
    for (const t of tickets) {
      if (t.epic_id) {
        ticketCountByEpic.set(t.epic_id, (ticketCountByEpic.get(t.epic_id) ?? 0) + 1);
      }
    }

    const result = epics.map((e) => ({
      id: e.id,
      title: e.title ?? '',
      status: e.status ?? '',
      jira_key: e.jira_key,
      file_path: e.file_path,
      ticket_count: ticketCountByEpic.get(e.id) ?? 0,
    }));

    return reply.send(result);
  });

  /**
   * GET /api/epics/:id — Epic detail with its tickets.
   */
  app.get('/api/epics/:id', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const { id } = request.params as { id: string };
    const parsed = epicIdSchema.safeParse(id);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid epic ID format' });
    }

    const epic = await app.dataService.epics.findById(id);
    if (!epic) {
      return reply.status(404).send({ error: 'Epic not found' });
    }

    // Repo-scoped access check
    if (request.allowedRepoIds && !request.allowedRepoIds.includes(String(epic.repo_id))) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const tickets = await app.dataService.tickets.listByEpic(id, epic.repo_id);
    const stages = await app.dataService.stages.listByRepo(epic.repo_id);

    // Build a map of ticket_id -> stage count
    const stageCountByTicket = new Map<string, number>();
    for (const s of stages) {
      if (s.ticket_id) {
        stageCountByTicket.set(s.ticket_id, (stageCountByTicket.get(s.ticket_id) ?? 0) + 1);
      }
    }

    const ticketList = tickets.map((t) => ({
      id: t.id,
      title: t.title ?? '',
      status: t.status ?? '',
      jira_key: t.jira_key,
      source: t.source,
      has_stages: (t.has_stages ?? false) !== false,
      stage_count: stageCountByTicket.get(t.id) ?? 0,
    }));

    return reply.send({
      id: epic.id,
      title: epic.title ?? '',
      status: epic.status ?? '',
      jira_key: epic.jira_key,
      file_path: epic.file_path,
      tickets: ticketList,
    });
  });

  /**
   * POST /api/epics — Create a new epic with a markdown file.
   */
  const createEpicSchema = z.object({
    title: z.string().min(1),
    status: z.string().min(1).default('to_convert'),
    description: z.string().optional(),
  });

  const postEpicOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  app.post('/api/epics', postEpicOpts, async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    // Filesystem operations not supported in hosted mode
    if (app.deploymentContext.mode === 'hosted') {
      return reply.code(501).send({ error: 'Not supported in hosted mode' });
    }

    const parsed = createEpicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { title, status, description } = parsed.data;

    const repos = await app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.status(503).send({ error: 'No repos configured' });
    }
    const repo = repos[0];

    // Generate next EPIC ID
    const existingEpics = await app.dataService.epics.listByRepo(repo.id);
    const nums = existingEpics
      .map((e) => {
        const m = /^EPIC-(\d+)$/.exec(e.id);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const id = `EPIC-${String(nextNum).padStart(3, '0')}`;

    const file_path = join(repo.path, 'epics', id, `${id}.md`);
    mkdirSync(dirname(file_path), { recursive: true });
    writeFileSync(file_path, matter.stringify(description ?? '', { title, status }));

    await app.dataService.epics.upsert({
      id,
      repo_id: repo.id,
      title,
      status,
      jira_key: null,
      file_path,
      last_synced: new Date().toISOString(),
    });

    return reply.status(201).send({ id, title, status, file_path });
  });

  done();
};

export const epicRoutes = fp(epicPlugin, { name: 'epic-routes' });
