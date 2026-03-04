import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const repoPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/repos — List all registered repos.
   */
  app.get('/api/repos', async (request, reply) => {
    if (!app.dataService) {
      return reply.status(503).send({ error: 'Database not initialized' });
    }

    const allRepos = await app.dataService.repos.findAll();
    const repos = request.allowedRepoIds
      ? allRepos.filter((r) => request.allowedRepoIds!.includes(String(r.id)))
      : allRepos;
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
