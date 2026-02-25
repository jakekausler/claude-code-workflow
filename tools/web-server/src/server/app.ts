import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  logger?: boolean;
  vitePort?: number;
}

export async function createServer(
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const { logger = true, vitePort = 3101 } = options;
  const isDev = process.env.NODE_ENV !== 'production';

  const app = Fastify({ logger });

  // CORS — allow localhost origins
  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  // --- API routes ---
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // --- Static serving / dev proxy ---
  if (!isDev) {
    // Production: serve built client assets
    const clientDir = join(__dirname, '../client');
    if (existsSync(clientDir)) {
      const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf-8');

      await app.register(fastifyStatic, {
        root: clientDir,
        prefix: '/',
        wildcard: false,
      });

      // SPA fallback — serve index.html for non-API routes
      app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/')) {
          return reply.status(404).send({ error: 'Not found' });
        }
        return reply.type('text/html').send(indexHtml);
      });
    }
  } else {
    // Development: proxy non-API requests to Vite dev server
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      try {
        const viteUrl = `http://localhost:${vitePort}${request.url}`;
        const response = await fetch(viteUrl, {
          headers: { host: `localhost:${vitePort}` },
        });

        reply.status(response.status);
        const contentType = response.headers.get('content-type');
        if (contentType) {
          reply.header('content-type', contentType);
        }

        const body = Buffer.from(await response.arrayBuffer());
        return reply.send(body);
      } catch {
        return reply
          .status(502)
          .send({ error: 'Vite dev server not available' });
      }
    });
  }

  return app;
}
