import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import { SessionPipeline } from '../../src/server/services/session-pipeline.js';
import { FileWatcher } from '../../src/server/services/file-watcher.js';
import { broadcastEvent, getClientCount } from '../../src/server/routes/events.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SSE endpoint', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sse-test-'));
    const fw = new FileWatcher({ rootDir: tempDir });
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
      fileWatcher: fw,
      sessionPipeline: new SessionPipeline(),
    });
    // Listen on a random port for real HTTP testing
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterEach(async () => {
    await app?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('responds with SSE headers on GET /api/events', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');

    // Abort the connection so the test can finish
    controller.abort();
  });

  it('sends an initial connected event', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toMatch(/^event: connected\ndata: /);
    const dataLine = text.split('\n')[1];
    const payload = JSON.parse(dataLine.replace('data: ', ''));
    expect(payload).toHaveProperty('timestamp');
    expect(typeof payload.timestamp).toBe('number');

    controller.abort();
  });

  it('broadcasts events to connected clients and tracks client count', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read and discard the initial connected event
    await reader.read();

    // Verify client count is 1
    expect(getClientCount()).toBe(1);

    // Broadcast a test event
    broadcastEvent('test-channel', { foo: 'bar' });

    // Read the next chunk
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('event: test-channel');
    expect(text).toContain('"foo":"bar"');

    controller.abort();
  });
});

describe('FileWatcher decoration', () => {
  let app: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sse-test-'));
  });

  afterEach(async () => {
    await app?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('decorates fileWatcher on app when provided', async () => {
    const fw = new FileWatcher({ rootDir: tempDir });
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
      fileWatcher: fw,
    });
    expect(app.fileWatcher).toBe(fw);
  });

  it('decorates fileWatcher as null when not provided', async () => {
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
    });
    expect(app.fileWatcher).toBeNull();
  });
});
