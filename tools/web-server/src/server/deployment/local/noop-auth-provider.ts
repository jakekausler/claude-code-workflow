import type { FastifyRequest, FastifyInstance, FastifyPluginCallback } from 'fastify';
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
    return (app: FastifyInstance, _opts: Record<string, unknown>, done: () => void) => {
      app.addHook('preHandler', (_request: FastifyRequest, _reply: unknown, done: () => void) => {
        done();
      });
      done();
    };
  }

  async getUserIdFromRequest(_request: FastifyRequest): Promise<string> {
    return 'local-user';
  }
}
