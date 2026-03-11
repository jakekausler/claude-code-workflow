import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { writeFileSync, appendFileSync } from 'node:fs';

const LOG_FILE = '/tmp/frontend-logs.txt';

const devLogsPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * POST /api/dev/logs — Append a formatted log line to the frontend log file.
   */
  app.post<{
    Body: { level: string; message: string; timestamp: string };
  }>('/api/dev/logs', async (request, reply) => {
    const { level, message, timestamp } = request.body;
    appendFileSync(LOG_FILE, `[${timestamp}] [${level.toUpperCase()}] ${message}\n`);
    return reply.send({ ok: true });
  });

  /**
   * POST /api/dev/logs/reset — Truncate the frontend log file.
   */
  app.post('/api/dev/logs/reset', async (_request, reply) => {
    writeFileSync(LOG_FILE, '');
    return reply.send({ ok: true });
  });

  done();
};

export const devLogsRoutes = fp(devLogsPlugin, { name: 'dev-logs-routes' });
