import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';

describe('sessions API', () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sessions-test-'));

    // Create mock session files
    const projectDir = path.join(tmpDir, 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'session-abc123.jsonl'), '{"type":"test"}\n');
    fs.writeFileSync(path.join(projectDir, 'session-def456.jsonl'), '{"type":"test"}\n');
    fs.writeFileSync(path.join(projectDir, 'agent-xxx.jsonl'), '{"type":"agent"}\n'); // should be excluded

    app = await createServer({
      logger: false,
      isDev: true,
      claudeProjectsDir: tmpDir,
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

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

  it('GET /api/sessions/test-project/session-abc123 returns 501', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123',
    });

    expect(response.statusCode).toBe(501);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not Implemented');
    expect(body.message).toContain('Stage 9E');
  });

  it('GET /api/sessions/test-project/session-abc123/metrics returns 501', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123/metrics',
    });

    expect(response.statusCode).toBe(501);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not Implemented');
  });

  it('GET /api/sessions/test-project/session-abc123/subagents/agent1 returns 501', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/test-project/session-abc123/subagents/agent1',
    });

    expect(response.statusCode).toBe(501);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not Implemented');
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
});
