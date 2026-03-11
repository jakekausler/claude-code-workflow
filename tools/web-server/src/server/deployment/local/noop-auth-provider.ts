import type { FastifyReply, FastifyRequest, FastifyInstance, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthProvider, User } from '../types.js';

/**
 * No-op auth provider for local (single-user) deployment.
 * All requests pass through with no authentication required.
 */
export class NoopAuthProvider implements AuthProvider {
  async getAuthenticatedUser(_request: FastifyRequest): Promise<User | null> {
    return null;
  }

  requireAuth(): FastifyPluginCallback {
    return fp(
      (app: FastifyInstance, _opts: Record<string, unknown>, done: () => void) => {
        app.addHook('preHandler', async (_request: FastifyRequest, _reply: FastifyReply) => {
          // Intentionally empty — all requests pass through in local mode.
          // Uses async signature (not callback) to avoid interfering with
          // reply.hijack() on SSE routes.
        });
        done();
      },
      { name: 'noop-auth' },
    );
  }

  async getUserIdFromRequest(_request: FastifyRequest): Promise<string> {
    return 'local-user';
  }
}
