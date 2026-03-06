import type { FastifyReply } from 'fastify';
import type { EventBroadcaster } from '../types.js';

/**
 * User-scoped SSE implementation for hosted (multi-user) deployment.
 * Routes events to per-user connection sets so each user only receives
 * events for their own sessions. Supports unscoped broadcast for
 * admin/system-wide events.
 */
export class UserScopedSSE implements EventBroadcaster {
  private userClients = new Map<string, Set<FastifyReply>>();

  get clientCount(): number {
    let count = 0;
    for (const clients of this.userClients.values()) {
      count += clients.size;
    }
    return count;
  }

  addClient(reply: FastifyReply, scope?: { userId: string }): void {
    if (!scope?.userId) {
      throw new Error('UserScopedSSE requires a userId scope');
    }

    let clients = this.userClients.get(scope.userId);
    if (!clients) {
      clients = new Set();
      this.userClients.set(scope.userId, clients);
    }
    clients.add(reply);

    // Clean up on connection close or error
    reply.raw.on('close', () => {
      this.removeClient(reply);
    });
    reply.raw.on('error', () => {
      this.removeClient(reply);
    });
  }

  removeClient(reply: FastifyReply): void {
    for (const [userId, clients] of this.userClients.entries()) {
      if (clients.delete(reply)) {
        if (clients.size === 0) {
          this.userClients.delete(userId);
        }
        break;
      }
    }
  }

  broadcast(event: string, data: unknown, scope?: { userId?: string }): void {
    if (scope?.userId) {
      // Send only to this user's connections
      const clients = this.userClients.get(scope.userId);
      if (clients) {
        this.sendToClients(clients, event, data);
      }
    } else {
      // Admin broadcast: send to all connected clients across all users
      for (const clients of this.userClients.values()) {
        this.sendToClients(clients, event, data);
      }
    }
  }

  private sendToClients(clients: Set<FastifyReply>, event: string, data: unknown): void {
    const safeEvent = event.replace(/[\n\r]/g, '');
    const payload = `event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`;
    const dead: FastifyReply[] = [];

    for (const client of clients) {
      try {
        const ok = client.raw.write(payload);
        if (!ok) {
          dead.push(client);
        }
      } catch {
        dead.push(client);
      }
    }

    for (const client of dead) {
      this.removeClient(client);
    }
  }
}
