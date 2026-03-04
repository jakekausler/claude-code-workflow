import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

const searchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.enum(['epic', 'ticket', 'stage']).optional(),
  status: z.string().optional(),
});

export interface SearchResult {
  type: 'epic' | 'ticket' | 'stage';
  id: string;
  title: string;
  status: string;
  parentContext: string;
}

const searchPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/api/search', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const parseResult = searchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }

    const { q, type, status } = parseResult.data;
    const term = q.toLowerCase();
    const results: SearchResult[] = [];

    const repos = await app.dataService.repos.findAll();
    if (repos.length === 0) return reply.send({ results: [] });
    const repo = repos[0];

    // Search epics
    if (!type || type === 'epic') {
      const epics = await app.dataService.epics.listByRepo(repo.id);
      for (const epic of epics) {
        if (!epic.title?.toLowerCase().includes(term)) continue;
        if (status && epic.status !== status) continue;
        results.push({
          type: 'epic',
          id: epic.id,
          title: epic.title ?? '',
          status: epic.status ?? '',
          parentContext: '',
        });
      }
    }

    // Search tickets
    if (!type || type === 'ticket') {
      const tickets = await app.dataService.tickets.listByRepo(repo.id);
      const epicMap = new Map<string, string>();
      for (const e of await app.dataService.epics.listByRepo(repo.id)) {
        epicMap.set(e.id, e.title ?? e.id);
      }
      for (const ticket of tickets) {
        if (!ticket.title?.toLowerCase().includes(term)) continue;
        if (status && ticket.status !== status) continue;
        const epicTitle = ticket.epic_id ? (epicMap.get(ticket.epic_id) ?? ticket.epic_id) : '';
        results.push({
          type: 'ticket',
          id: ticket.id,
          title: ticket.title ?? '',
          status: ticket.status ?? '',
          parentContext: epicTitle ? `in ${epicTitle}` : '',
        });
      }
    }

    // Search stages
    if (!type || type === 'stage') {
      const stages = await app.dataService.stages.listByRepo(repo.id);
      const ticketMap = new Map<string, string>();
      for (const t of await app.dataService.tickets.listByRepo(repo.id)) {
        ticketMap.set(t.id, t.title ?? t.id);
      }
      for (const stage of stages) {
        if (!stage.title?.toLowerCase().includes(term)) continue;
        if (status && stage.status !== status) continue;
        const ticketTitle = stage.ticket_id ? (ticketMap.get(stage.ticket_id) ?? stage.ticket_id) : '';
        results.push({
          type: 'stage',
          id: stage.id,
          title: stage.title ?? '',
          status: stage.status ?? '',
          parentContext: ticketTitle ? `in ${ticketTitle}` : '',
        });
      }
    }

    return reply.send({ results: results.slice(0, 50) });
  });

  done();
};

export const searchRoutes = fp(searchPlugin, { name: 'search-routes' });
