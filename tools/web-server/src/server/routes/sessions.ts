import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';

/** Validate that a session ID looks safe (alphanumeric, hyphens, underscores). */
const SESSION_ID_RE = /^[\w-]+$/;

/**
 * Sessions routes — list session files for a Claude project,
 * parse session detail, metrics, and subagent data via SessionPipeline.
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
      files = await readdir(projectDir);
    } catch {
      // Directory does not exist — return empty list, not 404
      return reply.send([]);
    }

    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));

    const sessions = await Promise.all(
      jsonlFiles.map(async (f) => {
        const filePath = join(projectDir, f);
        const st = await stat(filePath);
        return {
          sessionId: f.replace(/\.jsonl$/, ''),
          filePath,
          lastModified: st.mtime.toISOString(),
          fileSize: st.size,
        };
      }),
    );

    return reply.send(sessions);
  });

  /**
   * GET /api/sessions/:projectId/:sessionId
   *
   * Returns a fully parsed session (chunks, metrics, subagents, isOngoing).
   * Requires a SessionPipeline to be configured on the server; returns 501 otherwise.
   */
  // TODO: The sessionId validation + path traversal guard pattern is repeated across
  // session endpoints. Extract into a shared preValidation hook if more session
  // endpoints are added.
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/sessions/:projectId/:sessionId',
    async (request, reply) => {
      const { projectId, sessionId } = request.params;

      if (!SESSION_ID_RE.test(sessionId)) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const decoded = decodeURIComponent(projectId);
      const projectDir = resolve(app.claudeProjectsDir, decoded);

      // Path traversal guard
      if (!projectDir.startsWith(resolve(app.claudeProjectsDir))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (!app.sessionPipeline) {
        return reply.status(501).send({ error: 'Session parsing not configured' });
      }

      try {
        const session = await app.sessionPipeline.parseSession(projectDir, sessionId);
        return session;
      } catch (err) {
        request.log.error(err, 'Failed to parse session');
        return reply.status(500).send({ error: 'Failed to parse session' });
      }
    },
  );

  /**
   * GET /api/sessions/:projectId/:sessionId/metrics
   *
   * Returns SessionMetrics for a parsed session.
   * Requires a SessionPipeline to be configured on the server; returns 501 otherwise.
   */
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/sessions/:projectId/:sessionId/metrics',
    async (request, reply) => {
      const { projectId, sessionId } = request.params;

      if (!SESSION_ID_RE.test(sessionId)) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const decoded = decodeURIComponent(projectId);
      const projectDir = resolve(app.claudeProjectsDir, decoded);

      if (!projectDir.startsWith(resolve(app.claudeProjectsDir))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (!app.sessionPipeline) {
        return reply.status(501).send({ error: 'Session parsing not configured' });
      }

      try {
        const metrics = await app.sessionPipeline.getMetrics(projectDir, sessionId);
        return metrics;
      } catch (err) {
        request.log.error(err, 'Failed to compute session metrics');
        return reply.status(500).send({ error: 'Failed to compute session metrics' });
      }
    },
  );

  /**
   * GET /api/sessions/:projectId/:sessionId/subagents/:agentId
   *
   * Returns a single subagent (Process) by ID from the parsed session.
   * Requires a SessionPipeline to be configured on the server; returns 501 otherwise.
   */
  app.get<{ Params: { projectId: string; sessionId: string; agentId: string } }>(
    '/api/sessions/:projectId/:sessionId/subagents/:agentId',
    async (request, reply) => {
      const { projectId, sessionId, agentId } = request.params;

      if (!SESSION_ID_RE.test(sessionId)) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const decoded = decodeURIComponent(projectId);
      const projectDir = resolve(app.claudeProjectsDir, decoded);

      if (!projectDir.startsWith(resolve(app.claudeProjectsDir))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (!app.sessionPipeline) {
        return reply.status(501).send({ error: 'Session parsing not configured' });
      }

      try {
        const session = await app.sessionPipeline.parseSession(projectDir, sessionId);
        const agent = session.subagents.find((s) => s.id === agentId);
        if (!agent) {
          return reply.status(404).send({ error: 'Subagent not found' });
        }
        return agent;
      } catch (err) {
        request.log.error(err, 'Failed to parse session for subagent lookup');
        return reply.status(500).send({ error: 'Failed to parse session' });
      }
    },
  );

  /**
   * GET /api/stages/:stageId/session
   *
   * Convenience endpoint — looks up a stage's linked session_id and returns
   * a reference. Requires both DataService (for stage lookup) and
   * SessionPipeline to be configured.
   */
  app.get<{ Params: { stageId: string } }>(
    '/api/stages/:stageId/session',
    async (request, reply) => {
      const { stageId } = request.params;

      if (!app.dataService) {
        return reply.status(503).send({ error: 'Database not initialized' });
      }

      const stage = app.dataService.stages.findById(stageId);
      if (!stage) {
        return reply.status(404).send({ error: 'Stage not found' });
      }

      if (!stage.session_id) {
        return reply.status(404).send({ error: 'No session linked to this stage' });
      }

      return { sessionId: stage.session_id, stageId };
    },
  );

  done();
};

export const sessionRoutes = fp(sessionsPlugin, { name: 'session-routes' });
