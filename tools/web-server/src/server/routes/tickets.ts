import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { parseRefinementType } from './utils.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import type { RoleService } from '../deployment/hosted/rbac/role-service.js';
import { requireRole } from '../deployment/hosted/rbac/rbac-middleware.js';

export interface TicketRouteOptions {
  roleService?: RoleService;
}

/** Zod schema for the :id route parameter. */
const ticketIdSchema = z.string().regex(/^TICKET-\d{3}-\d{3}$/);

/** Zod schema for the optional query parameters. */
const ticketQuerySchema = z.object({ epic: z.string().optional() });

const ticketPlugin: FastifyPluginCallback<TicketRouteOptions> = (app, opts, done) => {
  const { roleService } = opts;
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

    const repos = await app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.send([]);
    }
    const repo = repos[0];

    let tickets = await app.dataService.tickets.listByRepo(repo.id);

    // Filter by epic if query param provided
    if (epic) {
      tickets = tickets.filter((t) => t.epic_id === epic);
    }

    const stages = await app.dataService.stages.listByRepo(repo.id);

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
      has_stages: (t.has_stages ?? false) !== false,
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

    const ticket = await app.dataService.tickets.findById(id);
    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }

    const stages = await app.dataService.stages.listByTicket(id, ticket.repo_id);

    const stageList = stages.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      status: s.status ?? '',
      kanban_column: s.kanban_column,
      refinement_type: parseRefinementType(s.refinement_type),
      worktree_branch: s.worktree_branch,
      session_active: s.session_active !== false,
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
      has_stages: (ticket.has_stages ?? false) !== false,
      file_path: ticket.file_path,
      stages: stageList,
    });
  });

  /**
   * POST /api/tickets — Create a new ticket with a markdown file.
   */
  const createTicketSchema = z.object({
    title: z.string().min(1),
    epic_id: z.string().min(1),
    status: z.string().min(1).default('to_convert'),
    description: z.string().optional(),
  });

  const postTicketOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  app.post('/api/tickets', postTicketOpts, async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    // Filesystem operations not supported in hosted mode
    if (app.deploymentContext.mode === 'hosted') {
      return reply.code(501).send({ error: 'Not supported in hosted mode' });
    }

    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { title, epic_id, status, description } = parsed.data;

    const repos = await app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.status(503).send({ error: 'No repos configured' });
    }
    const repo = repos[0];

    const epic = await app.dataService.epics.findById(epic_id);
    if (!epic) {
      return reply.status(404).send({ error: `Epic ${epic_id} not found` });
    }

    // Parse epic number from e.g. EPIC-042 -> 42
    const epicMatch = /^EPIC-(\d+)$/.exec(epic_id);
    if (!epicMatch) {
      return reply.status(400).send({ error: 'Invalid epic ID format' });
    }
    const epicNum = parseInt(epicMatch[1], 10);
    const epicNumPadded = String(epicNum).padStart(3, '0');

    // Find max ticket number for this epic
    const allTickets = await app.dataService.tickets.listByRepo(repo.id);
    const prefix = `TICKET-${epicNumPadded}-`;
    const ticketNums = allTickets
      .filter((t) => t.id.startsWith(prefix))
      .map((t) => {
        const m = new RegExp(`^TICKET-\\d{3}-(\\d+)$`).exec(t.id);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const nextTicketNum = ticketNums.length > 0 ? Math.max(...ticketNums) + 1 : 1;
    const id = `TICKET-${epicNumPadded}-${String(nextTicketNum).padStart(3, '0')}`;

    // Derive file path from epic's file path
    // Epic: .../epics/EPIC-XXX/EPIC-XXX.md -> ticket: .../epics/EPIC-XXX/<id>/<id>.md
    const file_path = join(dirname(epic.file_path ?? ''), id, `${id}.md`);
    mkdirSync(dirname(file_path), { recursive: true });
    writeFileSync(file_path, matter.stringify(description ?? '', { title, status, epic: epic_id }));

    await app.dataService.tickets.upsert({
      id,
      epic_id,
      repo_id: repo.id,
      title,
      status,
      jira_key: null,
      source: null,
      has_stages: 0,
      file_path,
      last_synced: new Date().toISOString(),
    });

    return reply.status(201).send({ id, title, status, epic_id, file_path });
  });

  /**
   * POST /api/tickets/:id/convert
   *
   * Launches a Claude session to convert the ticket into stage files.
   * Requires an epicId in the request body. Sends a launch_conversion
   * message to the orchestrator via WebSocket.
   */
  const convertTicketSchema = z.object({
    epicId: z.string().min(1),
  });

  const convertTicketOpts = roleService
    ? { preHandler: requireRole(roleService, 'developer') }
    : {};

  app.post('/api/tickets/:id/convert', convertTicketOpts, async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const { id } = request.params as { id: string };
    const parsedId = ticketIdSchema.safeParse(id);
    if (!parsedId.success) {
      return reply.status(400).send({ error: 'Invalid ticket ID format' });
    }

    const ticket = await app.dataService.tickets.findById(id);
    if (!ticket) {
      return reply.status(404).send({ error: 'Ticket not found' });
    }

    const parsedBody = convertTicketSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsedBody.error.issues });
    }
    const { epicId } = parsedBody.data;

    const epic = await app.dataService.epics.findById(epicId);
    if (!epic) {
      return reply.status(404).send({ error: `Epic ${epicId} not found` });
    }

    if (!app.orchestratorClient) {
      return reply.status(503).send({ error: 'Orchestrator not connected' });
    }

    if (!app.orchestratorClient.isConnected()) {
      return reply.status(503).send({ error: 'Orchestrator not connected' });
    }

    app.orchestratorClient.launchConversion(id, epicId);

    return reply.status(202).send({ ticketId: id, epicId, status: 'conversion_started' });
  });

  done();
};

export const ticketRoutes = fp(ticketPlugin, { name: 'ticket-routes' });
