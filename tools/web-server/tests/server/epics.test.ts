import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('epics API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epics-test-'));
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

  it('GET /api/epics returns 200 with array of epics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/epics returns correct count (2 epics from seed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
  });

  it('GET /api/epics includes ticket_count for each epic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics',
    });

    const body = JSON.parse(response.body);
    const authEpic = body.find((e: { id: string }) => e.id === SEED_IDS.EPIC_AUTH);
    const paymentsEpic = body.find((e: { id: string }) => e.id === SEED_IDS.EPIC_PAYMENTS);

    expect(authEpic).toBeDefined();
    expect(paymentsEpic).toBeDefined();
    // EPIC-001 has 2 tickets: Login Flow, Registration
    expect(authEpic.ticket_count).toBe(2);
    // EPIC-002 has 1 ticket: Checkout
    expect(paymentsEpic.ticket_count).toBe(1);
  });

  it('GET /api/epics/:id returns 200 with epic detail and tickets array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/epics/${SEED_IDS.EPIC_AUTH}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('id', SEED_IDS.EPIC_AUTH);
    expect(body).toHaveProperty('title', 'Auth System');
    expect(body).toHaveProperty('status', 'In Progress');
    expect(body).toHaveProperty('tickets');
    expect(Array.isArray(body.tickets)).toBe(true);
  });

  it('GET /api/epics/EPIC-001 includes correct tickets', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/epics/${SEED_IDS.EPIC_AUTH}`,
    });

    const body = JSON.parse(response.body);
    const ticketIds = body.tickets.map((t: { id: string }) => t.id);
    expect(ticketIds).toContain(SEED_IDS.TICKET_LOGIN);
    expect(ticketIds).toContain(SEED_IDS.TICKET_REGISTRATION);
    expect(body.tickets).toHaveLength(2);

    // Verify ticket shape
    const loginTicket = body.tickets.find(
      (t: { id: string }) => t.id === SEED_IDS.TICKET_LOGIN,
    );
    expect(loginTicket).toMatchObject({
      id: SEED_IDS.TICKET_LOGIN,
      title: 'Login Flow',
      status: 'In Progress',
      has_stages: true,
      stage_count: 3,
    });
  });

  it('GET /api/epics/EPIC-999 returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics/EPIC-999',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Epic not found');
  });

  it('GET /api/epics without DataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/epics',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/epics/:id with invalid format returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics/not-an-epic',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /api/epics returns application/json content-type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/epics',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
