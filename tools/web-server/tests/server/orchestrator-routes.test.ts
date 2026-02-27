import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { orchestratorRoutes, type SessionStatusResponse } from '../../src/server/routes/orchestrator.js';

function createMockOrchestratorClient() {
  return {
    getAllSessions: vi.fn().mockReturnValue([]),
    getPendingForStage: vi.fn().mockReturnValue([]),
    getSession: vi.fn(),
    sendMessage: vi.fn(),
    approveTool: vi.fn(),
    answerQuestion: vi.fn(),
    interruptSession: vi.fn(),
    on: vi.fn(),
  };
}

describe('Orchestrator routes', () => {
  let app: FastifyInstance;
  let orchestratorClient: ReturnType<typeof createMockOrchestratorClient>;

  beforeEach(async () => {
    app = Fastify();
    orchestratorClient = createMockOrchestratorClient();
    app.decorate('orchestratorClient', orchestratorClient);
    await app.register(orchestratorRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/orchestrator/sessions', () => {
    it('returns empty sessions array when no sessions exist', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual({ sessions: [] });
    });

    it('returns sessions with computed waitingType from pending approvals', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-1',
          sessionId: 'sess-abc',
          processId: 1234,
          worktreePath: '/tmp/worktree',
          status: 'active',
          spawnedAt: 1000,
          lastActivity: 2000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([
        { type: 'approval', requestId: 'req-1', toolName: 'Bash' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].waitingType).toBe('permission');
    });

    it('returns waitingType user_input when pending has question type', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-2',
          sessionId: 'sess-def',
          processId: 5678,
          worktreePath: '/tmp/worktree2',
          status: 'active',
          spawnedAt: 3000,
          lastActivity: 4000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([
        { type: 'question', requestId: 'req-2', question: 'Which option?' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions[0].waitingType).toBe('user_input');
    });

    it('returns waitingType null for active sessions with no pending items', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-3',
          sessionId: 'sess-ghi',
          processId: 9999,
          worktreePath: '/tmp/worktree3',
          status: 'active',
          spawnedAt: 5000,
          lastActivity: 6000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions[0].waitingType).toBeNull();
    });

    it('returns waitingType null for non-active sessions', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-4',
          sessionId: 'sess-jkl',
          processId: 1111,
          worktreePath: '/tmp/worktree4',
          status: 'ended',
          spawnedAt: 7000,
          lastActivity: 8000,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions[0].waitingType).toBeNull();
      // Should not call getPendingForStage for non-active sessions
      expect(orchestratorClient.getPendingForStage).not.toHaveBeenCalled();
    });

    it('returns proper structure with all required fields', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-5',
          sessionId: 'sess-mno',
          processId: 2222,
          worktreePath: '/tmp/worktree5',
          status: 'active',
          spawnedAt: 9000,
          lastActivity: 10000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { sessions: SessionStatusResponse[] };
      const session = body.sessions[0];

      expect(session).toEqual({
        stageId: 'stage-5',
        sessionId: 'sess-mno',
        status: 'active',
        waitingType: null,
        spawnedAt: 9000,
        lastActivity: 10000,
      });
    });

    it('handles multiple sessions with different statuses', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 'stage-a',
          sessionId: 'sess-1',
          processId: 100,
          worktreePath: '/tmp/wt1',
          status: 'active',
          spawnedAt: 1000,
          lastActivity: 2000,
        },
        {
          stageId: 'stage-b',
          sessionId: 'sess-2',
          processId: 200,
          worktreePath: '/tmp/wt2',
          status: 'starting',
          spawnedAt: 3000,
          lastActivity: 4000,
        },
        {
          stageId: 'stage-c',
          sessionId: 'sess-3',
          processId: 300,
          worktreePath: '/tmp/wt3',
          status: 'ended',
          spawnedAt: 5000,
          lastActivity: 6000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(3);
      expect(body.sessions.map((s: SessionStatusResponse) => s.status)).toEqual([
        'active',
        'starting',
        'ended',
      ]);
      // Only active sessions should have getPendingForStage called
      expect(orchestratorClient.getPendingForStage).toHaveBeenCalledTimes(1);
      expect(orchestratorClient.getPendingForStage).toHaveBeenCalledWith('stage-a');
    });

    it('returns 503 when orchestratorClient is null', async () => {
      // Create a separate app with null orchestratorClient
      const appNoClient = Fastify();
      appNoClient.decorate('orchestratorClient', null);
      await appNoClient.register(orchestratorRoutes);
      await appNoClient.ready();

      const res = await appNoClient.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Orchestrator not connected');

      await appNoClient.close();
    });

    it('prioritizes user_input over permission when both pending', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 's1',
          sessionId: 'sess-1',
          processId: 1,
          worktreePath: '/tmp',
          status: 'active',
          spawnedAt: 1000,
          lastActivity: 2000,
        },
      ]);
      orchestratorClient.getPendingForStage.mockReturnValue([
        { type: 'approval', requestId: 'r1', toolName: 'Bash' },
        { type: 'question', requestId: 'r2', question: 'Which?' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions[0].waitingType).toBe('user_input');
    });

    it('returns waitingType null for starting sessions without checking pending', async () => {
      orchestratorClient.getAllSessions.mockReturnValue([
        {
          stageId: 's1',
          sessionId: 'sess-1',
          processId: 1,
          worktreePath: '/tmp',
          status: 'starting',
          spawnedAt: 1000,
          lastActivity: 2000,
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/orchestrator/sessions',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions[0].waitingType).toBeNull();
      expect(orchestratorClient.getPendingForStage).not.toHaveBeenCalled();
    });
  });
});
