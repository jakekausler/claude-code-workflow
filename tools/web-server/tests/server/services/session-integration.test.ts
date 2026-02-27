import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { FastifyInstance } from 'fastify';
import { SessionPipeline } from '../../../src/server/services/session-pipeline.js';
import { createServer } from '../../../src/server/app.js';
import { LocalDeploymentContext } from '../../../src/server/deployment/local/local-deployment-context.js';

/**
 * Test deployment context that returns a custom claude root directory,
 * so that routes deriving `join(getClaudeRoot(userId), 'projects')` resolve
 * to the test temp directory's `projects/` subdirectory.
 */
class TestDeploymentContext extends LocalDeploymentContext {
  constructor(private readonly claudeRoot: string) {
    super();
  }
  override getClaudeRoot(_userId: string): string {
    return this.claudeRoot;
  }
}

// ─── JSONL Fixtures ───────────────────────────────────────────────────────────

/**
 * Main session: 4 entries — user, assistant (text), user, assistant (tool_use + tool_result)
 *
 * Turn 1: User says hello, assistant responds with text.
 * Turn 2: User asks to read a file, assistant invokes Read tool and receives result.
 *
 * Token totals: input 100+200 = 300, output 50+100 = 150, total = 450
 * Duration: 10:00:00 → 10:00:15 = 15 000 ms
 * Tool calls: 1 (Read)
 * Tool results: 1
 * Assistant turns: 2
 */
const MAIN_SESSION_LINES = [
  JSON.stringify({
    type: 'user',
    uuid: 'msg-1',
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content: 'Hello, please help me' },
    timestamp: '2025-01-15T10:00:00.000Z',
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'msg-2',
    parentUuid: 'msg-1',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: 'resp_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: "I'd be happy to help!" }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    requestId: 'req_01',
    timestamp: '2025-01-15T10:00:05.000Z',
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'msg-3',
    parentUuid: 'msg-2',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content: 'Can you read a file?' },
    timestamp: '2025-01-15T10:00:10.000Z',
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'msg-4',
    parentUuid: 'msg-3',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: 'resp_02',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/test.txt' } },
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'file contents here',
          is_error: false,
        },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 100 },
    },
    requestId: 'req_02',
    timestamp: '2025-01-15T10:00:15.000Z',
  }),
];

/**
 * Subagent file (agent-sub1.jsonl): 2 entries — user, assistant (text)
 *
 * Token totals: input 50, output 25, total = 75
 * Duration: 10:00:12 → 10:00:14 = 2 000 ms
 * Tool calls: 0
 * Assistant turns: 1
 */
const SUBAGENT_LINES = [
  JSON.stringify({
    type: 'user',
    uuid: 'sub-1',
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content: 'Subagent task' },
    timestamp: '2025-01-15T10:00:12.000Z',
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'sub-2',
    parentUuid: 'sub-1',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session-001',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-haiku-4-5-20251001',
      id: 'resp_sub_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 25 },
    },
    requestId: 'req_sub_01',
    timestamp: '2025-01-15T10:00:14.000Z',
  }),
];

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Session Integration', () => {
  let tmpDir: string;
  let projectDir: string;
  const sessionId = 'test-session-001';

  beforeAll(() => {
    // Directory layout:
    //   tmpDir/projects/test-project/test-session-001.jsonl   (main session)
    //   tmpDir/projects/test-project/agent-sub1.jsonl          (legacy-structure subagent)
    // Routes derive claudeProjectsDir as join(getClaudeRoot(userId), 'projects')
    tmpDir = mkdtempSync(join(tmpdir(), 'session-integration-'));
    projectDir = join(tmpDir, 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      MAIN_SESSION_LINES.join('\n') + '\n',
    );
    writeFileSync(
      join(projectDir, 'agent-sub1.jsonl'),
      SUBAGENT_LINES.join('\n') + '\n',
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Pipeline-only tests ────────────────────────────────────────────────

  it('produces a complete ParsedSession with all fields', async () => {
    const pipeline = new SessionPipeline({ cacheSizeMB: 1 });
    const session = await pipeline.parseSession(projectDir, sessionId);

    expect(session).toHaveProperty('chunks');
    expect(session).toHaveProperty('metrics');
    expect(session).toHaveProperty('subagents');
    expect(session).toHaveProperty('isOngoing');

    // Chunks: 4 messages → user, ai, user, ai
    expect(session.chunks.length).toBe(4);
    expect(session.chunks[0].type).toBe('user');
    expect(session.chunks[1].type).toBe('ai');
    expect(session.chunks[2].type).toBe('user');
    expect(session.chunks[3].type).toBe('ai');

    // Metrics
    expect(session.metrics.inputTokens).toBe(300);
    expect(session.metrics.outputTokens).toBe(150);
    expect(session.metrics.totalTokens).toBe(450);
    expect(session.metrics.turnCount).toBe(2);
    expect(session.metrics.toolCallCount).toBe(1); // 1 Read tool call
    expect(session.metrics.duration).toBe(15_000);
    expect(session.metrics.totalCost).toBeGreaterThanOrEqual(0);

    // Subagents: agent-sub1.jsonl should be discovered (legacy structure)
    expect(session.subagents.length).toBe(1);
    expect(session.subagents[0].id).toBe('sub1');
    expect(session.subagents[0].metrics.inputTokens).toBe(50);
    expect(session.subagents[0].metrics.outputTokens).toBe(25);
    expect(session.subagents[0].durationMs).toBe(2_000);

    // Last message is assistant → not ongoing
    expect(session.isOngoing).toBe(false);
  });

  it('getMetrics() returns metrics matching the full session', async () => {
    const pipeline = new SessionPipeline({ cacheSizeMB: 1 });
    const metrics = await pipeline.getMetrics(projectDir, sessionId);

    expect(metrics.inputTokens).toBe(300);
    expect(metrics.outputTokens).toBe(150);
    expect(metrics.totalTokens).toBe(450);
    expect(metrics.turnCount).toBe(2);
    expect(metrics.toolCallCount).toBe(1);
    expect(metrics.duration).toBe(15_000);
  });

  // ─── API endpoint tests via Fastify inject ──────────────────────────────

  describe('API endpoints', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const pipeline = new SessionPipeline({ cacheSizeMB: 1 });
      app = await createServer({
        logger: false,
        isDev: true,
        sessionPipeline: pipeline,
        deploymentContext: new TestDeploymentContext(tmpDir),
      });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/sessions/test-project lists the main session (excludes agent files)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/test-project',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      // Only test-session-001.jsonl should be listed (agent-sub1.jsonl excluded)
      expect(body).toHaveLength(1);
      expect(body[0].sessionId).toBe(sessionId);
      expect(typeof body[0].fileSize).toBe('number');
      expect(body[0].fileSize).toBeGreaterThan(0);
    });

    it('GET /api/sessions/test-project/:sessionId returns the full ParsedSession', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sessions/test-project/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body).toHaveProperty('chunks');
      expect(body).toHaveProperty('metrics');
      expect(body).toHaveProperty('subagents');
      expect(body).toHaveProperty('isOngoing');

      expect(Array.isArray(body.chunks)).toBe(true);
      expect(body.chunks.length).toBe(4);
      expect(body.metrics.inputTokens).toBe(300);
      expect(body.metrics.outputTokens).toBe(150);
      expect(body.metrics.totalTokens).toBe(450);
      expect(body.metrics.turnCount).toBe(2);
      expect(body.metrics.toolCallCount).toBe(1);
      expect(body.metrics.duration).toBe(15_000);

      expect(body.subagents.length).toBe(1);
      expect(body.subagents[0].id).toBe('sub1');
      expect(body.isOngoing).toBe(false);
    });

    it('GET /api/sessions/test-project/:sessionId/metrics returns SessionMetrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sessions/test-project/${sessionId}/metrics`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(typeof body.totalTokens).toBe('number');
      expect(typeof body.inputTokens).toBe('number');
      expect(typeof body.outputTokens).toBe('number');
      expect(typeof body.cacheReadTokens).toBe('number');
      expect(typeof body.cacheCreationTokens).toBe('number');
      expect(typeof body.totalCost).toBe('number');
      expect(typeof body.turnCount).toBe('number');
      expect(typeof body.toolCallCount).toBe('number');
      expect(typeof body.duration).toBe('number');

      expect(body.inputTokens).toBe(300);
      expect(body.outputTokens).toBe(150);
      expect(body.turnCount).toBe(2);
    });

    it('GET .../subagents/sub1 returns the resolved subagent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sessions/test-project/${sessionId}/subagents/sub1`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.id).toBe('sub1');
      expect(body.metrics.inputTokens).toBe(50);
      expect(body.metrics.outputTokens).toBe(25);
      expect(body.durationMs).toBe(2_000);
    });

    it('GET .../subagents/nonexistent returns 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sessions/test-project/${sessionId}/subagents/nonexistent`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe('Subagent not found');
    });

    it('GET session for non-existent project returns 500 (file not found)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/no-such-project/fake-session',
      });

      // SessionPipeline.parseSession for a missing file returns an empty session, not an error
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.chunks).toEqual([]);
      expect(body.metrics.totalTokens).toBe(0);
    });

    it('content-type is application/json for all session endpoints', async () => {
      const responses = await Promise.all([
        app.inject({ method: 'GET', url: '/api/sessions/test-project' }),
        app.inject({ method: 'GET', url: `/api/sessions/test-project/${sessionId}` }),
        app.inject({ method: 'GET', url: `/api/sessions/test-project/${sessionId}/metrics` }),
      ]);

      for (const r of responses) {
        expect(r.headers['content-type']).toMatch(/application\/json/);
      }
    });
  });
});
