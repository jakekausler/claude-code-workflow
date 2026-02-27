import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { PendingItem } from '../services/orchestrator-client.js';

export interface SessionStatusResponse {
  stageId: string;
  sessionId: string;
  status: 'starting' | 'active' | 'ended';
  waitingType: 'user_input' | 'permission' | null;
  spawnedAt: number;
  lastActivity: number;
}

/**
 * Compute a waiting type from the pending items for a session.
 *
 * Pending items returned by `getPendingForStage` can have `type: 'approval'`
 * (permission request) or `type: 'question'` (user input request). If there
 * are no pending items, the session is not waiting for anything.
 *
 * Priority: user_input (questions) takes precedence over permission (approvals)
 * when both types are pending.
 */
export function computeWaitingType(pending: PendingItem[]): SessionStatusResponse['waitingType'] {
  if (pending.length === 0) return null;

  for (const item of pending) {
    if (item.type === 'question') return 'user_input';
  }

  // Default to permission if there are pending items but no questions
  return 'permission';
}

const orchestratorPlugin: FastifyPluginCallback = (app, _opts, done) => {
  /**
   * GET /api/orchestrator/sessions
   *
   * Returns all orchestrator sessions with computed waitingType.
   * Used by the frontend for initial page-load hydration.
   */
  app.get('/api/orchestrator/sessions', async (_request, reply) => {
    const client = app.orchestratorClient;
    if (!client) {
      return reply.status(503).send({ error: 'Orchestrator not connected' });
    }

    const allSessions = client.getAllSessions();
    const sessions: SessionStatusResponse[] = allSessions.map((session) => {
      let waitingType: SessionStatusResponse['waitingType'] = null;

      if (session.status === 'active') {
        const pending = client.getPendingForStage(session.stageId);
        waitingType = computeWaitingType(pending);
      }

      return {
        stageId: session.stageId,
        sessionId: session.sessionId,
        status: session.status,
        waitingType,
        spawnedAt: session.spawnedAt,
        lastActivity: session.lastActivity,
      };
    });

    return reply.send({ sessions });
  });

  done();
};

export const orchestratorRoutes = fp(orchestratorPlugin, { name: 'orchestrator-routes' });
