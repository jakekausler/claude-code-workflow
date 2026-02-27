import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { EventBroadcaster } from '../deployment/index.js';

export interface SSEClient {
  reply: FastifyReply;
  timer: ReturnType<typeof setInterval>;
}

/**
 * Mutable broadcaster reference. Set via `setBroadcaster()` during server
 * startup so that `broadcastEvent()` delegates to the deployment-context's
 * EventBroadcaster instead of managing its own client Set.
 *
 * Falls back to a no-op when no broadcaster has been configured (e.g. in
 * unit tests that call `broadcastEvent` before the server boots).
 */
let broadcaster: EventBroadcaster | null = null;

/**
 * Wire the module-level `broadcastEvent` to an EventBroadcaster.
 * Called once from `createServer()` after the deployment context is created.
 */
export function setBroadcaster(b: EventBroadcaster): void {
  broadcaster = b;
}

export function broadcastEvent(channel: string, data: unknown): void {
  if (broadcaster) {
    broadcaster.broadcast(channel, data);
  }
}

export function getClientCount(): number {
  return broadcaster?.clientCount ?? 0;
}

const KEEPALIVE_MS = 30_000;

const eventsPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/api/events', (request, reply) => {
    const eventBroadcaster = app.deploymentContext?.getEventBroadcaster();

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial connected event
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`,
    );

    const timer = setInterval(() => {
      try {
        reply.raw.write(':ping\n\n');
      } catch {
        clearInterval(timer);
        eventBroadcaster?.removeClient(reply);
      }
    }, KEEPALIVE_MS);

    // Register with the EventBroadcaster for broadcast delivery
    eventBroadcaster?.addClient(reply);

    request.raw.on('close', () => {
      clearInterval(timer);
      eventBroadcaster?.removeClient(reply);
    });

    // Keep the connection open — do not call reply.send()
    // Fastify handles this via the raw response after hijack()
  });

  done();
};

export const eventRoutes = fp(eventsPlugin, { name: 'event-routes' });
