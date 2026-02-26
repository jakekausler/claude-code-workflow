import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { SessionPipeline } from '../../src/server/services/session-pipeline.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

/**
 * Minimal JSONL fixture: two user/assistant turns.
 * This is enough for SessionPipeline to produce chunks, metrics, and subagents.
 */
const FIXTURE_LINES = [
  JSON.stringify({
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 's1',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content: 'Hello, what files are in this directory?' },
    timestamp: '2026-02-25T10:00:00.000Z',
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 's1',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Let me check the directory for you.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    requestId: 'req_01',
    timestamp: '2026-02-25T10:00:01.000Z',
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'u2',
    parentUuid: 'a1',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 's1',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content: 'Can you show me the contents of README.md?' },
    timestamp: '2026-02-25T10:00:10.000Z',
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a2',
    parentUuid: 'u2',
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 's1',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: 'msg_02',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Here are the contents of README.md.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 150, output_tokens: 30 },
    },
    requestId: 'req_02',
    timestamp: '2026-02-25T10:00:12.000Z',
  }),
];

describe('sessions API', () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sessions-test-'));

    // Create mock session files
    const projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'session-abc123.jsonl'),
      FIXTURE_LINES.join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(projectDir, 'session-def456.jsonl'),
      FIXTURE_LINES.join('\n') + '\n',
    );
    fs.writeFileSync(path.join(projectDir, 'agent-xxx.jsonl'), '{"type":"agent"}\n'); // should be excluded

    app = await createServer({
      logger: false,
      isDev: true,
      claudeProjectsDir: tmpDir,
      sessionPipeline: new SessionPipeline(),
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Session listing ────────────────────────────────────────────────

  it('GET /api/sessions/test-project returns 200 with array of sessions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns correct session count (2, excluding agent-*.jsonl)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);

    const ids = body.map((s: { sessionId: string }) => s.sessionId).sort();
    expect(ids).toEqual(['session-abc123', 'session-def456']);
  });

  it('each session has sessionId, filePath, lastModified, fileSize', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project',
    });

    const body = JSON.parse(response.body);
    for (const session of body) {
      expect(session).toHaveProperty('sessionId');
      expect(session).toHaveProperty('filePath');
      expect(session).toHaveProperty('lastModified');
      expect(session).toHaveProperty('fileSize');
      expect(typeof session.sessionId).toBe('string');
      expect(typeof session.filePath).toBe('string');
      expect(typeof session.lastModified).toBe('string');
      expect(typeof session.fileSize).toBe('number');
    }
  });

  it('non-existent project returns empty array (not 404)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/does-not-exist',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('rejects path traversal in projectId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/..%2F..%2Fetc',
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid project ID');
  });

  it('content-type is application/json', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  // ─── Session detail (with pipeline) ─────────────────────────────────

  it('GET /api/sessions/:projectId/:sessionId returns ParsedSession shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('chunks');
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('subagents');
    expect(body).toHaveProperty('isOngoing');
    expect(Array.isArray(body.chunks)).toBe(true);
    expect(Array.isArray(body.subagents)).toBe(true);
    expect(typeof body.isOngoing).toBe('boolean');
  });

  it('session detail returns metrics with expected numeric fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const m = body.metrics;
    expect(typeof m.totalTokens).toBe('number');
    expect(typeof m.inputTokens).toBe('number');
    expect(typeof m.outputTokens).toBe('number');
    expect(typeof m.totalCost).toBe('number');
    expect(typeof m.turnCount).toBe('number');
    expect(typeof m.toolCallCount).toBe('number');
    expect(typeof m.duration).toBe('number');
  });

  it('session detail with invalid sessionId returns 400', async () => {
    // Use encodeURIComponent so the slash characters stay as a single path segment
    const badId = encodeURIComponent('../etc/passwd');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/test-project/${badId}`,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid session ID');
  });

  // ─── Metrics endpoint ───────────────────────────────────────────────

  it('GET /api/sessions/:projectId/:sessionId/metrics returns SessionMetrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123/metrics',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(typeof body.totalTokens).toBe('number');
    expect(typeof body.inputTokens).toBe('number');
    expect(typeof body.outputTokens).toBe('number');
    expect(typeof body.cacheReadTokens).toBe('number');
    expect(typeof body.cacheCreationTokens).toBe('number');
    expect(typeof body.totalCost).toBe('number');
    expect(typeof body.turnCount).toBe('number');
    expect(typeof body.toolCallCount).toBe('number');
    expect(typeof body.duration).toBe('number');
  });

  it('metrics endpoint with invalid sessionId returns 400', async () => {
    const badId = encodeURIComponent('../bad');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/test-project/${badId}/metrics`,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid session ID');
  });

  // ─── Subagent endpoint ──────────────────────────────────────────────

  it('subagent endpoint with unknown agentId returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123/subagents/nonexistent',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Subagent not found');
  });

  it('subagent endpoint with invalid sessionId returns 400', async () => {
    const badId = encodeURIComponent('../etc');
    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/test-project/${badId}/subagents/agent1`,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Invalid session ID');
  });

  // ─── Stage-to-session endpoint ──────────────────────────────────────

  describe('GET /api/stages/:stageId/session', () => {
    let stageApp: FastifyInstance;
    let stageDb: KanbanDatabase;
    let stageDataService: DataService;
    let stageTmpDir: string;

    beforeEach(async () => {
      stageTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stage-session-test-'));
      stageDb = new KanbanDatabase(path.join(stageTmpDir, 'test.db'));
      seedDatabase(stageDb, stageTmpDir);
      stageDataService = new DataService({ db: stageDb });

      // Link one stage to a session so we can test the happy path
      stageDataService.stages.updateSessionId(SEED_IDS.STAGE_AUTH_API, 'sess-linked-123');

      stageApp = await createServer({
        logger: false,
        isDev: true,
        dataService: stageDataService,
        claudeProjectsDir: tmpDir,
      });
    });

    afterEach(async () => {
      await stageApp.close();
      stageDataService.close();
      fs.rmSync(stageTmpDir, { recursive: true, force: true });
    });

    it('returns 404 when stage does not exist', async () => {
      const response = await stageApp.inject({
        method: 'GET',
        url: '/api/stages/STAGE-999-999-999/session',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Stage not found');
    });

    it('returns 404 when stage has no session_id', async () => {
      // STAGE_LOGIN_FORM has no session_id (null by default from seed)
      const response = await stageApp.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}/session`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('No session linked to this stage');
    });

    it('returns 200 with sessionId and stageId when stage has session_id', async () => {
      const response = await stageApp.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/session`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        sessionId: 'sess-linked-123',
        stageId: SEED_IDS.STAGE_AUTH_API,
      });
    });
  });

  // ─── 501 when no pipeline configured ────────────────────────────────

  describe('without SessionPipeline', () => {
    let noPipelineApp: FastifyInstance;

    beforeEach(async () => {
      noPipelineApp = await createServer({
        logger: false,
        isDev: true,
        claudeProjectsDir: tmpDir,
      });
    });

    afterEach(async () => {
      await noPipelineApp.close();
    });

    it('session detail returns 501 when no pipeline configured', async () => {
      const response = await noPipelineApp.inject({
        method: 'GET',
        url: '/api/sessions/test-project/session-abc123',
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Session parsing not configured');
    });

    it('metrics returns 501 when no pipeline configured', async () => {
      const response = await noPipelineApp.inject({
        method: 'GET',
        url: '/api/sessions/test-project/session-abc123/metrics',
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Session parsing not configured');
    });

    it('subagent returns 501 when no pipeline configured', async () => {
      const response = await noPipelineApp.inject({
        method: 'GET',
        url: '/api/sessions/test-project/session-abc123/subagents/agent1',
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Session parsing not configured');
    });
  });
});
