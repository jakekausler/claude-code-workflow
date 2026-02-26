import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerInteractionRoutes } from '../../src/server/routes/interaction.js';

function createMockOrchestratorClient() {
  return {
    sendMessage: vi.fn(),
    approveTool: vi.fn(),
    answerQuestion: vi.fn(),
    interruptSession: vi.fn(),
    getSession: vi.fn(),
    getPendingForStage: vi.fn().mockReturnValue([]),
    isSessionBusy: vi.fn().mockReturnValue(false),
    on: vi.fn(),
  };
}

describe('Interaction routes', () => {
  let app: ReturnType<typeof Fastify>;
  let orchestratorClient: ReturnType<typeof createMockOrchestratorClient>;

  beforeEach(async () => {
    app = Fastify();
    orchestratorClient = createMockOrchestratorClient();
    registerInteractionRoutes(app, orchestratorClient as any);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/sessions/:stageId/message', () => {
    it('returns 200 when session is idle', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/message',
        payload: { message: 'Fix the bug' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.sendMessage).toHaveBeenCalledWith('STAGE-A', 'Fix the bug');
    });

    it('returns 404 when no session exists', async () => {
      orchestratorClient.getSession.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-X/message',
        payload: { message: 'hello' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when message is empty', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/message',
        payload: { message: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/sessions/:stageId/approve', () => {
    it('returns 200 on successful approval', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'allow' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.approveTool).toHaveBeenCalledWith(
        'STAGE-A', 'req-001', 'allow', undefined,
      );
    });

    it('passes reason for deny decisions', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'deny', reason: 'Unsafe' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.approveTool).toHaveBeenCalledWith(
        'STAGE-A', 'req-001', 'deny', 'Unsafe',
      );
    });

    it('returns 400 for invalid decision', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'maybe' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when requestId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { decision: 'allow' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when no session exists', async () => {
      orchestratorClient.getSession.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-X/approve',
        payload: { requestId: 'req-001', decision: 'allow' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/sessions/:stageId/answer', () => {
    it('returns 200 on successful answer', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/answer',
        payload: { requestId: 'req-002', answers: { q1: 'yes' } },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.answerQuestion).toHaveBeenCalledWith(
        'STAGE-A', 'req-002', { q1: 'yes' },
      );
    });

    it('returns 400 when requestId is missing', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/answer',
        payload: { answers: { q1: 'yes' } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when answers is an array', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/answer',
        payload: { requestId: 'req-002', answers: ['yes'] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when answers is a string', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/answer',
        payload: { requestId: 'req-002', answers: 'yes' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when no session exists', async () => {
      orchestratorClient.getSession.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-X/answer',
        payload: { requestId: 'req-002', answers: { q1: 'yes' } },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/sessions/:stageId/interrupt', () => {
    it('returns 200 on interrupt', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/interrupt',
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.interruptSession).toHaveBeenCalledWith('STAGE-A');
    });

    it('returns 404 when no session exists', async () => {
      orchestratorClient.getSession.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-X/interrupt',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/sessions/:stageId/pending', () => {
    it('returns pending approvals/questions', async () => {
      orchestratorClient.getPendingForStage.mockReturnValue([
        { requestId: 'req-001', toolName: 'Bash', input: {}, stageId: 'STAGE-A', createdAt: 123 },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/STAGE-A/pending',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.pending).toHaveLength(1);
      expect(body.pending[0].requestId).toBe('req-001');
    });
  });
});
