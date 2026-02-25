import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { buildGraph } from '../../../../kanban-cli/dist/cli/logic/graph.js';
import type {
  GraphEpicRow,
  GraphTicketRow,
  GraphStageRow,
  GraphDependencyRow,
} from '../../../../kanban-cli/dist/cli/logic/graph.js';
import { formatGraphAsMermaid } from '../../../../kanban-cli/dist/cli/formatters/graph-mermaid.js';
import type { DataService } from '../services/data-service.js';

/** Allowed query-string keys for /api/graph. */
const ALLOWED_GRAPH_PARAMS = new Set(['epic', 'mermaid']);

/** Zod schema for /api/graph query parameters. */
const graphQuerySchema = z.object({
  epic: z.string().optional(),
  mermaid: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

/**
 * Maps database epic rows to the shapes that buildGraph() expects.
 */
function mapEpics(
  rows: { id: string; title: string | null; status: string | null; file_path: string }[],
): GraphEpicRow[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '',
    status: r.status ?? '',
  }));
}

function mapTickets(
  rows: {
    id: string;
    epic_id: string | null;
    title: string | null;
    status: string | null;
    jira_key: string | null;
    source: string | null;
    has_stages: number | null;
    file_path: string;
  }[],
): GraphTicketRow[] {
  return rows.map((r) => ({
    id: r.id,
    epic_id: r.epic_id ?? '',
    title: r.title ?? '',
    status: r.status ?? '',
  }));
}

function mapStages(
  rows: {
    id: string;
    ticket_id: string | null;
    epic_id: string | null;
    title: string | null;
    status: string | null;
    kanban_column: string | null;
    refinement_type: string | null;
    worktree_branch: string | null;
    priority: number;
    due_date: string | null;
    session_active: number;
    pending_merge_parents: string | null;
    file_path: string;
  }[],
): GraphStageRow[] {
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id ?? '',
    epic_id: r.epic_id ?? '',
    title: r.title ?? '',
    status: r.status ?? '',
  }));
}

function mapDependencies(
  rows: {
    id: number;
    from_id: string;
    to_id: string;
    from_type: string;
    to_type: string;
    resolved: number;
  }[],
): GraphDependencyRow[] {
  return rows.map((r) => ({
    id: r.id,
    from_id: r.from_id,
    to_id: r.to_id,
    from_type: r.from_type,
    to_type: r.to_type,
    resolved: r.resolved !== 0,
  }));
}

/** Shared data returned by {@link fetchGraphData}. */
interface GraphData {
  epics: GraphEpicRow[];
  tickets: GraphTicketRow[];
  stages: GraphStageRow[];
  dependencies: GraphDependencyRow[];
}

/**
 * Fetch and map the common graph data from the first repo.
 * Returns `null` when no repos exist.
 */
function fetchGraphData(dataService: DataService): GraphData | null {
  const repos = dataService.repos.findAll();
  if (repos.length === 0) return null;
  const repo = repos[0];

  return {
    epics: mapEpics(dataService.epics.listByRepo(repo.id)),
    tickets: mapTickets(dataService.tickets.listByRepo(repo.id)),
    stages: mapStages(dataService.stages.listByRepo(repo.id)),
    dependencies: mapDependencies(dataService.dependencies.listByRepo(repo.id)),
  };
}

const graphPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/api/graph', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    // Reject unknown query-string keys before Zod validation
    const rawQuery = request.query as Record<string, unknown>;
    for (const key of Object.keys(rawQuery)) {
      if (!ALLOWED_GRAPH_PARAMS.has(key)) {
        return reply.status(400).send({ error: `Unknown parameter: ${key}` });
      }
    }

    const result = graphQuerySchema.safeParse(rawQuery);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: result.error.issues });
    }

    const { epic, mermaid } = result.data;

    const data = fetchGraphData(app.dataService);
    if (!data) {
      const emptyGraph = { nodes: [], edges: [], cycles: [], critical_path: [] };
      if (mermaid) {
        return reply.send({ mermaid: formatGraphAsMermaid(emptyGraph) });
      }
      return reply.send(emptyGraph);
    }

    const graph = buildGraph({
      epics: data.epics,
      tickets: data.tickets,
      stages: data.stages,
      dependencies: data.dependencies,
      filters: { epic },
    });

    if (mermaid) {
      return reply.send({ mermaid: formatGraphAsMermaid(graph) });
    }

    return reply.send(graph);
  });

  done();
};

export const graphRoutes = fp(graphPlugin, { name: 'graph-routes' });
