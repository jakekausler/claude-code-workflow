import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('board API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-test-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    seedDatabase(db, tmpDir);
    dataService = new DataService({ db });
    app = await createServer({ logger: false, isDev: true, dataService });
  });

  afterEach(async () => {
    await app.close();
    dataService.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/board returns 200 with columns and stats', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('generated_at');
    expect(body).toHaveProperty('repo');
    expect(body).toHaveProperty('columns');
    expect(body).toHaveProperty('stats');
    expect(typeof body.columns).toBe('object');
  });

  it('GET /api/board has correct stats counts', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board',
    });

    const body = JSON.parse(response.body);
    // Seed data: 4 stages total, 1 ticket without stages (Checkout, has_stages=0)
    expect(body.stats.total_stages).toBe(4);
    expect(body.stats.total_tickets).toBe(1);
  });

  it('GET /api/board?epic=EPIC-001 filters by epic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/board?epic=${SEED_IDS.EPIC_AUTH}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // All stages in EPIC-001: Login Form (done), Auth API (build),
    // Session Mgmt (backlog), Signup Form (ready_for_work) = 4 stages
    expect(body.stats.total_stages).toBe(4);
    // No tickets without stages in EPIC-001
    expect(body.stats.total_tickets).toBe(0);
  });

  it('GET /api/board?epic=EPIC-002 filters to Payments epic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/board?epic=${SEED_IDS.EPIC_PAYMENTS}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // EPIC-002 has no stages, only 1 ticket without stages (Checkout)
    expect(body.stats.total_stages).toBe(0);
    expect(body.stats.total_tickets).toBe(1);
  });

  it('GET /api/board?ticket=TICKET-001-001 filters by ticket', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/board?ticket=${SEED_IDS.TICKET_LOGIN}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // TICKET-001-001 has 3 stages: Login Form, Auth API, Session Mgmt
    expect(body.stats.total_stages).toBe(3);
    // The ticket itself has stages, so it won't appear in to_convert
    expect(body.stats.total_tickets).toBe(0);
  });

  it('GET /api/stats returns stats object with correct shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('total_stages');
    expect(body).toHaveProperty('total_tickets');
    expect(body).toHaveProperty('by_column');
    expect(typeof body.total_stages).toBe('number');
    expect(typeof body.total_tickets).toBe('number');
    expect(typeof body.by_column).toBe('object');
  });

  it('GET /api/stats returns correct totals', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats',
    });

    const body = JSON.parse(response.body);
    // Stats without filters: all 4 stages, 1 ticket without stages
    expect(body.total_stages).toBe(4);
    expect(body.total_tickets).toBe(1);
  });

  it('GET /api/board without dataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/board',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/stats without dataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/stats',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/board with unknown param returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board?badParam=foo',
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
  });

  it('GET /api/board?excludeDone=true excludes done stages', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board?excludeDone=true',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // The "done" column should be absent or contain no stages
    if (body.columns.done) {
      expect(body.columns.done).toHaveLength(0);
    }
    // Non-done stages should still be present (backlog, build, ready_for_work = 3)
    expect(body.stats.total_stages).toBe(3);
  });

  it('GET /api/board?column=build filters to build column', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/board?column=build',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // The build column should have exactly 1 stage (Auth API)
    expect(body.columns.build).toHaveLength(1);
    expect(body.columns.build[0].title).toBe('Auth API');
    // Other columns should be empty (column filter skips placement)
    expect(body.columns.done).toHaveLength(0);
    expect(body.columns.backlog).toHaveLength(0);
    expect(body.columns.ready_for_work).toHaveLength(0);
  });

  it('GET /api/board with empty database returns empty board', async () => {
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-empty-'));
    const emptyDb = new KanbanDatabase(path.join(emptyTmpDir, 'empty.db'));
    const emptyDs = new DataService({ db: emptyDb });
    const emptyApp = await createServer({ logger: false, isDev: true, dataService: emptyDs });
    try {
      const response = await emptyApp.inject({ method: 'GET', url: '/api/board' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.columns).toEqual({});
      expect(body.stats.total_stages).toBe(0);
      expect(body.stats.total_tickets).toBe(0);
    } finally {
      await emptyApp.close();
      emptyDs.close();
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });
});
