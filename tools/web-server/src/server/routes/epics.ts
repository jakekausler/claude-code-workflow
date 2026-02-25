import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

/** Zod schema for the :id route parameter. */
const epicIdSchema = z.string().regex(/^EPIC-\d{3}$/);

const epicPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/epics — List all epics with ticket counts.
   */
  app.get('/api/epics', async (_request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const repos = app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.send([]);
    }
    const repo = repos[0];

    const epics = app.dataService.epics.listByRepo(repo.id);
    const tickets = app.dataService.tickets.listByRepo(repo.id);

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

    const epic = app.dataService.epics.findById(id);
    if (!epic) {
      return reply.status(404).send({ error: 'Epic not found' });
    }

    const tickets = app.dataService.tickets.listByEpic(id, epic.repo_id);
    const stages = app.dataService.stages.listByRepo(epic.repo_id);

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
      has_stages: (t.has_stages ?? 0) !== 0,
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

  done();
};

export const epicRoutes = fp(epicPlugin, { name: 'epic-routes' });
