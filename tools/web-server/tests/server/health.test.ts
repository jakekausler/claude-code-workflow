import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';

describe('server API routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer({ logger: false, isDev: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health returns ok status with timestamp', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp']);
  });

  it('GET /api/nonexistent returns 404 for unknown API routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not found');
  });
});
