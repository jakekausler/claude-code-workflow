import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

export interface SSEClient {
  reply: FastifyReply;
  timer: ReturnType<typeof setInterval>;
}

const clients = new Set<SSEClient>();

export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.reply.raw.write(payload);
    } catch {
      clearInterval(client.timer);
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

const KEEPALIVE_MS = 30_000;

const eventsPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    reply.hijack();

    // Send initial connected event
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`,
    );

    const timer = setInterval(() => {
      try {
        reply.raw.write(':ping\n\n');
      } catch {
        clearInterval(timer);
        clients.delete(client);
      }
    }, KEEPALIVE_MS);

    const client: SSEClient = { reply, timer };
    clients.add(client);

    request.raw.on('close', () => {
      clearInterval(timer);
      clients.delete(client);
    });

    // Keep the connection open — do not call reply.send()
    // Fastify handles this via the raw response after hijack()
  });

  done();
};

export const eventRoutes = fp(eventsPlugin, { name: 'event-routes' });
