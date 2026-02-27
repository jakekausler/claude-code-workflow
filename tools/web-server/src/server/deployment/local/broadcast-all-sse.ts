import type { FastifyReply } from 'fastify';
import type { EventBroadcaster } from '../types.js';

/**
 * Broadcast-all SSE implementation for local (single-user) deployment.
 * Sends events to ALL connected clients regardless of scope.
 * Maintains a Set of connected clients and cleans up dead connections.
 */
export class BroadcastAllSSE implements EventBroadcaster {
  private clients = new Set<FastifyReply>();

  addClient(reply: FastifyReply, _scope?: { userId: string }): void {
    this.clients.add(reply);
    reply.raw.on('close', () => {
      this.clients.delete(reply);
    });
  }

  removeClient(reply: FastifyReply): void {
    this.clients.delete(reply);
  }

  broadcast(event: string, data: unknown, _scope?: { userId?: string }): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        const ok = client.raw.write(payload);
        if (!ok) {
          this.clients.delete(client);
        }
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
