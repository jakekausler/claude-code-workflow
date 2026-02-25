import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Sessions routes — list session files for a Claude project and
 * provide 501 stubs for detail endpoints (available in Stage 9E).
 */
const sessionsPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/sessions/:projectId
   *
   * Lists `.jsonl` session files for the given project, excluding
   * `agent-*.jsonl` files at the root level.  Returns an empty array
   * when the project directory does not exist.
   */
  app.get('/api/sessions/:projectId', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const decoded = decodeURIComponent(projectId);
    const projectDir = resolve(app.claudeProjectsDir, decoded);

    // Path traversal guard
    if (!projectDir.startsWith(resolve(app.claudeProjectsDir))) {
      return reply.status(400).send({ error: 'Invalid project ID' });
    }

    let files: string[];
    try {
      files = readdirSync(projectDir);
    } catch {
      // Directory does not exist — return empty list, not 404
      return reply.send([]);
    }

    const sessions = files
      .filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map((f) => {
        const filePath = join(projectDir, f);
        const st = statSync(filePath);
        return {
          sessionId: f.replace(/\.jsonl$/, ''),
          filePath,
          lastModified: st.mtime.toISOString(),
          fileSize: st.size,
        };
      });

    return reply.send(sessions);
  });

  /**
   * GET /api/sessions/:projectId/:sessionId — stub (501)
   */
  app.get('/api/sessions/:projectId/:sessionId', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Session detail parsing available in Stage 9E',
    });
  });

  /**
   * GET /api/sessions/:projectId/:sessionId/metrics — stub (501)
   */
  app.get('/api/sessions/:projectId/:sessionId/metrics', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Session detail parsing available in Stage 9E',
    });
  });

  /**
   * GET /api/sessions/:projectId/:sessionId/subagents/:agentId — stub (501)
   */
  app.get(
    '/api/sessions/:projectId/:sessionId/subagents/:agentId',
    async (_request, reply) => {
      return reply.status(501).send({
        error: 'Not Implemented',
        message: 'Session detail parsing available in Stage 9E',
      });
    },
  );

  done();
};

export const sessionRoutes = fp(sessionsPlugin, { name: 'session-routes' });
