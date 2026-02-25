import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const repoPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/repos — List all registered repos.
   */
  app.get('/api/repos', async (_request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const repos = app.dataService.repos.findAll();
    const result = repos.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
    }));

    return reply.send(result);
  });

  done();
};

export const repoRoutes = fp(repoPlugin, { name: 'repo-routes' });
