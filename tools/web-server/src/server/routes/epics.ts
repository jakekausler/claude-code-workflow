import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';
import { requireRole } from '../deployment/hosted/rbac/rbac-middleware.js';
import { broadcastEvent } from './events.js';

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

    // Read markdown body in local mode
    let body = '';
    if (app.deploymentContext.mode === 'local' && epic.file_path && existsSync(epic.file_path)) {
      try {
        const raw = readFileSync(epic.file_path, 'utf-8');
        const parsed = matter(raw);
        body = parsed.content.trim();
      } catch {
        // Silent fail on read errors
      }
    }

    return reply.send({
      id: epic.id,
      title: epic.title ?? '',
      status: epic.status ?? '',
      jira_key: epic.jira_key,
      file_path: epic.file_path,
      tickets: ticketList,
      body,
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

    broadcastEvent('board-update', {
      type: 'epic_created',
      epicId: id,
    });

    return reply.status(201).send({ id, title, status, file_path });
  });

  /**
   * GET /api/epics/:id/delete-preview — Preview the effects of deleting an epic.
   */
  const deletePreviewOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  app.get('/api/epics/:id/delete-preview', deletePreviewOpts, async (request, reply) => {
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
      return reply.status(404).send({ error: 'Epic not found' });
    }

    const tickets = await app.dataService.tickets.listByEpic(id, epic.repo_id);

    // Collect stages: directly by epic and also by each ticket
    const epicStages = await app.dataService.stages.listByRepo(epic.repo_id);
    const epicDirectStages = epicStages.filter((s) => s.epic_id === id);
    const ticketStageArrays = await Promise.all(
      tickets.map((t) => app.dataService!.stages.listByTicket(t.id, epic.repo_id)),
    );
    const ticketStages = ticketStageArrays.flat();

    // Deduplicate stages by id
    const stageMap = new Map<string, (typeof epicDirectStages)[number]>();
    for (const s of [...epicDirectStages, ...ticketStages]) {
      stageMap.set(s.id, s);
    }
    const allStages = Array.from(stageMap.values());

    const ticketIds = tickets.map((t) => t.id);
    const stageIds = allStages.map((s) => s.id);
    const allItemIds = new Set([id, ...ticketIds, ...stageIds]);

    // Gather dependencies for all items being deleted
    let totalDepsRemoved = 0;
    const relinks: Array<{ from: string; to: string }> = [];
    const relinkSet = new Set<string>();

    for (const itemId of allItemIds) {
      const parents = await app.dataService.dependencies.listByTarget(itemId);
      const children = await app.dataService.dependencies.listBySource(itemId);
      totalDepsRemoved += parents.length + children.length;

      for (const child of children) {
        if (allItemIds.has(child.from_id)) continue;
        for (const parent of parents) {
          if (child.from_id !== parent.to_id) {
            const key = `${child.from_id}->${parent.to_id}`;
            if (!relinkSet.has(key)) {
              relinkSet.add(key);
              relinks.push({ from: child.from_id, to: parent.to_id });
            }
          }
        }
      }
    }

    return reply.send({
      item: { id: epic.id, title: epic.title ?? '', type: 'epic' },
      childrenToDelete: [
        ...tickets.map((t) => ({ id: t.id, title: t.title ?? '', type: 'ticket' as const })),
        ...allStages.map((s) => ({ id: s.id, title: s.title ?? '', type: 'stage' as const })),
      ],
      dependenciesRemoved: totalDepsRemoved,
      dependenciesCreated: relinks,
    });
  });

  /**
   * DELETE /api/epics/:id — Delete an epic, its tickets and stages, and relink dependencies.
   */
  const deleteEpicOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  app.delete('/api/epics/:id', deleteEpicOpts, async (request, reply) => {
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
      return reply.status(404).send({ error: 'Epic not found' });
    }

    try {
      const tickets = await app.dataService.tickets.listByEpic(id, epic.repo_id);

      // Collect all stages (by epic and by each ticket)
      const epicStages = await app.dataService.stages.listByRepo(epic.repo_id);
      const epicDirectStages = epicStages.filter((s) => s.epic_id === id);
      const ticketStageArrays = await Promise.all(
        tickets.map((t) => app.dataService!.stages.listByTicket(t.id, epic.repo_id)),
      );
      const ticketStages = ticketStageArrays.flat();

      const stageMap = new Map<string, string>();
      for (const s of [...epicDirectStages, ...ticketStages]) {
        stageMap.set(s.id, s.id);
      }
      const allStageIds = Array.from(stageMap.keys());
      const ticketIds = tickets.map((t) => t.id);
      const allItemIds = [id, ...ticketIds, ...allStageIds];

      // Relink dependencies for all items
      for (const itemId of allItemIds) {
        await app.dataService.dependencies.relinkAndDelete(itemId);
      }

      // Clean up session records before deleting stages and tickets
      for (const stageId of allStageIds) {
        await app.dataService.stageSessions.deleteByStageId(stageId);
      }
      for (const ticketId of ticketIds) {
        await app.dataService.ticketSessions.deleteByTicketId(ticketId);
      }

      // Delete stages by each ticket, then by epic directly
      for (const t of tickets) {
        await app.dataService.stages.deleteByTicketId(t.id);
      }
      await app.dataService.stages.deleteByEpicId(id);

      // Delete tickets
      await app.dataService.tickets.deleteByEpicId(id);

      // Delete epic
      await app.dataService.epics.deleteById(id);
    } catch (err) {
      request.log.error(err, `Failed to delete epic ${id}`);
      return reply.status(500).send({ error: `Failed to delete epic ${id}` });
    }

    broadcastEvent('board-update', { type: 'epic_deleted', epicId: id });

    return reply.status(200).send({ ok: true });
  });

  done();
};

export const epicRoutes = fp(epicPlugin, { name: 'epic-routes' });
