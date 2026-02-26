import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import type { OrchestratorClient } from '../services/orchestrator-client.js';

/**
 * Interaction routes — REST endpoints for user interactions from the web UI.
 * These relay user actions (messages, approvals, questions, interrupts) to the orchestrator
 * via the WebSocket client.
 */
const interactionPlugin: FastifyPluginCallback<{ orchestratorClient: OrchestratorClient }> = (
  app,
  opts,
  done,
) => {
  const { orchestratorClient } = opts;

  /**
   * POST /api/sessions/:stageId/message
   *
   * Send a follow-up message to an active session.
   */
  app.post<{
    Params: { stageId: string };
    Body: { message: string };
  }>('/api/sessions/:stageId/message', async (req, reply) => {
    const { stageId } = req.params;
    const { message } = req.body ?? {};

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return reply.status(400).send({ error: 'message is required' });
    }

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.sendMessage(stageId, message);
    return reply.status(200).send({ status: 'ok' });
  });

  /**
   * POST /api/sessions/:stageId/approve
   *
   * Approve or deny a tool call approval request.
   */
  app.post<{
    Params: { stageId: string };
    Body: { requestId: string; decision: string; reason?: string };
  }>('/api/sessions/:stageId/approve', async (req, reply) => {
    const { stageId } = req.params;
    const { requestId, decision, reason } = req.body ?? {};

    if (!requestId || typeof requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId is required' });
    }

    if (decision !== 'allow' && decision !== 'deny') {
      return reply.status(400).send({ error: 'decision must be "allow" or "deny"' });
    }

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.approveTool(stageId, requestId, decision, reason);
    return reply.status(200).send({ status: 'ok' });
  });

  /**
   * POST /api/sessions/:stageId/answer
   *
   * Answer an AskUserQuestion request.
   */
  app.post<{
    Params: { stageId: string };
    Body: { requestId: string; answers: Record<string, string> };
  }>('/api/sessions/:stageId/answer', async (req, reply) => {
    const { stageId } = req.params;
    const { requestId, answers } = req.body ?? {};

    if (!requestId || typeof requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId is required' });
    }

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return reply.status(400).send({ error: 'answers must be an object' });
    }

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.answerQuestion(stageId, requestId, answers);
    return reply.status(200).send({ status: 'ok' });
  });

  /**
   * POST /api/sessions/:stageId/interrupt
   *
   * Interrupt an active session.
   */
  app.post<{
    Params: { stageId: string };
  }>('/api/sessions/:stageId/interrupt', async (req, reply) => {
    const { stageId } = req.params;

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.interruptSession(stageId);
    return reply.status(200).send({ status: 'ok' });
  });

  /**
   * GET /api/sessions/:stageId/pending
   *
   * Get pending approvals and questions for a stage.
   */
  app.get<{
    Params: { stageId: string };
  }>('/api/sessions/:stageId/pending', async (req, reply) => {
    const { stageId } = req.params;

    const pending = orchestratorClient.getPendingForStage(stageId);
    return reply.status(200).send({ pending });
  });

  done();
};

export const interactionRoutes = fp(interactionPlugin, { name: 'interaction-routes' });

/**
 * Export the plugin directly for tests that need to pass custom options.
 */
export function registerInteractionRoutes(
  app: FastifyInstance,
  orchestratorClient: OrchestratorClient,
): void {
  interactionPlugin(app, { orchestratorClient }, () => {});
}
