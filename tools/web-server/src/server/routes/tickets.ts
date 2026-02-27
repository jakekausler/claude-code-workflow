import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { parseRefinementType } from './utils.js';

/** Zod schema for the :id route parameter. */
const ticketIdSchema = z.string().regex(/^TICKET-\d{3}-\d{3}$/);

/** Zod schema for the optional query parameters. */
const ticketQuerySchema = z.object({ epic: z.string().optional() });

const ticketPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/tickets — List all tickets with enrichment.
   */
  app.get('/api/tickets', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const parseResult = ticketQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }
    const { epic } = parseResult.data;

    const repos = app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.send([]);
    }
    const repo = repos[0];

    let tickets = app.dataService.tickets.listByRepo(repo.id);

    // Filter by epic if query param provided
    if (epic) {
      tickets = tickets.filter((t) => t.epic_id === epic);
    }

    const stages = app.dataService.stages.listByRepo(repo.id);

    // Build a map of ticket_id -> stage count for O(n) enrichment
    const stageCountByTicket = new Map<string, number>();
    for (const s of stages) {
      if (s.ticket_id) {
        stageCountByTicket.set(s.ticket_id, (stageCountByTicket.get(s.ticket_id) ?? 0) + 1);
      }
    }

    const result = tickets.map((t) => ({
      id: t.id,
      title: t.title ?? '',
      status: t.status ?? '',
      epic_id: t.epic_id,
      jira_key: t.jira_key,
      source: t.source,
      has_stages: (t.has_stages ?? 0) !== 0,
      file_path: t.file_path,
      stage_count: stageCountByTicket.get(t.id) ?? 0,
    }));

    return reply.send(result);
  });

  /**
   * GET /api/tickets/:id — Ticket detail with its stages.
   */
  app.get('/api/tickets/:id', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const { id } = request.params as { id: string };
    const parsed = ticketIdSchema.safeParse(id);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ticket ID format' });
    }

    const ticket = app.dataService.tickets.findById(id);
    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }

    const stages = app.dataService.stages.listByTicket(id, ticket.repo_id);

    const stageList = stages.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      status: s.status ?? '',
      kanban_column: s.kanban_column,
      refinement_type: parseRefinementType(s.refinement_type),
      worktree_branch: s.worktree_branch,
      session_active: s.session_active !== 0,
      session_id: s.session_id ?? null,
      priority: s.priority,
      due_date: s.due_date,
      pr_url: s.pr_url,
    }));

    return reply.send({
      id: ticket.id,
      title: ticket.title ?? '',
      status: ticket.status ?? '',
      epic_id: ticket.epic_id,
      jira_key: ticket.jira_key,
      source: ticket.source,
      has_stages: (ticket.has_stages ?? 0) !== 0,
      file_path: ticket.file_path,
      stages: stageList,
    });
  });

  done();
};

export const ticketRoutes = fp(ticketPlugin, { name: 'ticket-routes' });
