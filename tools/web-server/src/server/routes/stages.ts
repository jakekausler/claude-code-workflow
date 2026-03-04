import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, basename, extname, join } from 'node:path';
import matter from 'gray-matter';
import { parseRefinementType } from './utils.js';

/**
 * Phase display name → file suffix mapping.
 * Matches the sibling file naming convention:
 *   STAGE-001-001-001-design.md, STAGE-001-001-001-build.md, etc.
 */
const PHASE_SUFFIXES: Record<string, string> = {
  'Design': 'design',
  'User Design Feedback': 'user-design-feedback',
  'Build': 'build',
  'Automatic Testing': 'automatic-testing',
  'Manual Testing': 'manual-testing',
  'Finalize': 'finalize',
  'PR Created': 'pr-created',
  'Addressing Comments': 'addressing-comments',
};

/**
 * Discover and read sibling phase files for a stage.
 * Returns a map of phase display name → markdown content.
 */
function readPhaseContents(filePath: string): Record<string, string> {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext); // e.g. "STAGE-001-001-001"

  const result: Record<string, string> = {};

  for (const [phaseName, suffix] of Object.entries(PHASE_SUFFIXES)) {
    const siblingPath = join(dir, `${base}-${suffix}${ext}`);
    if (existsSync(siblingPath)) {
      try {
        const raw = readFileSync(siblingPath, 'utf-8');
        const parsed = matter(raw);
        const content = parsed.content.trim();
        if (content) {
          result[phaseName] = content;
        }
      } catch {
        // Skip unreadable sibling files
      }
    }
  }

  return result;
}

/** Fields already exposed as structured properties in the stage detail response. */
const KNOWN_FRONTMATTER_KEYS = new Set([
  'id', 'ticket', 'epic', 'title', 'status', 'session_active',
  'refinement_type', 'depends_on', 'worktree_branch', 'pr_url',
  'pr_number', 'priority', 'due_date', 'pending_merge_parents',
  'is_draft', 'mr_target_branch', 'checklists',
]);

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

    const repos = await app.dataService.repos.findAll();
    if (repos.length === 0) {
      return reply.send([]);
    }
    const repo = repos[0];

    let stages = await app.dataService.stages.listByRepo(repo.id);

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
      session_active: s.session_active !== false,
      session_id: s.session_id ?? null,
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

    const stage = await app.dataService.stages.findById(id);
    if (!stage) {
      return reply.status(404).send({ error: 'Stage not found' });
    }

    // Fetch dependencies in both directions
    const depsFrom = await app.dataService.dependencies.listByTarget(id);
    const depsTo = await app.dataService.dependencies.listBySource(id);

    const mapDep = (d: { id: number; from_id: string; to_id: string; from_type: string; to_type: string; resolved: boolean }) => ({
      id: d.id,
      from_id: d.from_id,
      to_id: d.to_id,
      from_type: d.from_type,
      to_type: d.to_type,
      resolved: d.resolved !== false,
    });

    // Read markdown body, checklists, extra frontmatter fields, and phase sibling contents
    let body = '';
    let checklists: Array<{ title: string; items: Array<{ text: string; checked: boolean }> }> = [];
    let frontmatterFields: Record<string, unknown> = {};
    let phaseContents: Record<string, string> = {};

    // Filesystem reads only in local mode
    if (app.deploymentContext.mode === 'local' && stage.file_path && existsSync(stage.file_path)) {
      try {
        const raw = readFileSync(stage.file_path, 'utf-8');
        const fileParsed = matter(raw);
        body = fileParsed.content.trim();
        if (Array.isArray(fileParsed.data.checklists)) {
          checklists = fileParsed.data.checklists;
        }
        // Collect frontmatter fields not already in the structured response
        for (const [key, value] of Object.entries(fileParsed.data)) {
          if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
            frontmatterFields[key] = value;
          }
        }
        // Discover and read sibling phase files
        phaseContents = readPhaseContents(stage.file_path);
      } catch {
        // If file read or parse fails, return empty defaults
      }
    }

    return reply.send({
      id: stage.id,
      title: stage.title ?? '',
      status: stage.status ?? '',
      ticket_id: stage.ticket_id,
      epic_id: stage.epic_id,
      kanban_column: stage.kanban_column,
      refinement_type: parseRefinementType(stage.refinement_type),
      worktree_branch: stage.worktree_branch,
      session_active: stage.session_active !== false,
      session_id: stage.session_id ?? null,
      priority: stage.priority,
      due_date: stage.due_date,
      pr_url: stage.pr_url,
      pr_number: stage.pr_number,
      is_draft: stage.is_draft !== false,
      pending_merge_parents: stage.pending_merge_parents,
      mr_target_branch: stage.mr_target_branch,
      file_path: stage.file_path,
      depends_on: depsFrom.map(mapDep),
      depended_on_by: depsTo.map(mapDep),
      body,
      checklists,
      frontmatter_fields: frontmatterFields,
      phase_contents: phaseContents,
    });
  });

  done();
};

export const stageRoutes = fp(stagePlugin, { name: 'stage-routes' });
