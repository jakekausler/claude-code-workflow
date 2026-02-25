import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/server/app.js';

describe('GET /api/health', () => {
  it('returns ok status with timestamp', async () => {
    const app = await createServer({ logger: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    // Verify timestamp is valid ISO string
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

describe('GET /api/unknown', () => {
  it('returns 404 for unknown API routes', async () => {
    const app = await createServer({ logger: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not found');
  });
});
