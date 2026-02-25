import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { parseRefinementType } from './utils.js';

/** Zod schema for the :id route parameter. */
const stageIdSchema = z.string().regex(/^STAGE-\d{3}-\d{3}-\d{3}$/);

/** Zod schema for the optional query parameters. */
const stageQuerySchema = z.object({ ticket: z.string().optional() });

const stagePlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/stages — List all stages with optional ticket filter.
   */
  app.get('/api/stages', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const parseResult = stageQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parseResult.error.issues });
    }
    const { ticket } = parseResult.data;

    const repos = app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.send([]);
    }
    const repo = repos[0];

    let stages = app.dataService.stages.listByRepo(repo.id);

    // Filter by ticket if query param provided
    if (ticket) {
      stages = stages.filter((s) => s.ticket_id === ticket);
    }

    const result = stages.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      status: s.status ?? '',
      ticket_id: s.ticket_id,
      epic_id: s.epic_id,
      kanban_column: s.kanban_column,
      refinement_type: parseRefinementType(s.refinement_type),
      worktree_branch: s.worktree_branch,
      session_active: s.session_active !== 0,
      priority: s.priority,
      due_date: s.due_date,
      pr_url: s.pr_url,
      file_path: s.file_path,
    }));

    return reply.send(result);
  });

  /**
   * GET /api/stages/:id — Stage detail with dependencies.
   */
  app.get('/api/stages/:id', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const { id } = request.params as { id: string };
    const parsed = stageIdSchema.safeParse(id);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid stage ID format' });
    }

    const stage = app.dataService.stages.findById(id);
    if (!stage) {
      return reply.status(404).send({ error: 'Stage not found' });
    }

    // Fetch dependencies in both directions
    const depsFrom = app.dataService.dependencies.listByTarget(id);
    const depsTo = app.dataService.dependencies.listBySource(id);

    const mapDep = (d: { id: number; from_id: string; to_id: string; from_type: string; to_type: string; resolved: number }) => ({
      id: d.id,
      from_id: d.from_id,
      to_id: d.to_id,
      from_type: d.from_type,
      to_type: d.to_type,
      resolved: d.resolved !== 0,
    });

    return reply.send({
      id: stage.id,
      title: stage.title ?? '',
      status: stage.status ?? '',
      ticket_id: stage.ticket_id,
      epic_id: stage.epic_id,
      kanban_column: stage.kanban_column,
      refinement_type: parseRefinementType(stage.refinement_type),
      worktree_branch: stage.worktree_branch,
      session_active: stage.session_active !== 0,
      priority: stage.priority,
      due_date: stage.due_date,
      pr_url: stage.pr_url,
      pr_number: stage.pr_number,
      is_draft: stage.is_draft !== 0,
      pending_merge_parents: stage.pending_merge_parents,
      mr_target_branch: stage.mr_target_branch,
      file_path: stage.file_path,
      depends_on: depsFrom.map(mapDep),
      depended_on_by: depsTo.map(mapDep),
    });
  });

  done();
};

export const stageRoutes = fp(stagePlugin, { name: 'stage-routes' });
