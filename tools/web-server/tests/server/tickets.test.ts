import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('tickets API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-tickets-test-'));
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

  it('GET /api/tickets returns 200 with array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/tickets returns correct count (3 tickets from seed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveLength(3);
  });

  it('GET /api/tickets includes stage_count per ticket', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets',
    });

    const body = JSON.parse(response.body);
    const loginTicket = body.find((t: { id: string }) => t.id === SEED_IDS.TICKET_LOGIN);
    const registrationTicket = body.find(
      (t: { id: string }) => t.id === SEED_IDS.TICKET_REGISTRATION,
    );
    const checkoutTicket = body.find(
      (t: { id: string }) => t.id === SEED_IDS.TICKET_CHECKOUT,
    );

    expect(loginTicket).toBeDefined();
    expect(registrationTicket).toBeDefined();
    expect(checkoutTicket).toBeDefined();

    // TICKET-001-001 has 3 stages
    expect(loginTicket.stage_count).toBe(3);
    // TICKET-001-002 has 1 stage
    expect(registrationTicket.stage_count).toBe(1);
    // TICKET-002-001 has 0 stages
    expect(checkoutTicket.stage_count).toBe(0);
  });

  it('GET /api/tickets?epic=EPIC-001 filters correctly (2 tickets)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tickets?epic=${SEED_IDS.EPIC_AUTH}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);

    const ids = body.map((t: { id: string }) => t.id);
    expect(ids).toContain(SEED_IDS.TICKET_LOGIN);
    expect(ids).toContain(SEED_IDS.TICKET_REGISTRATION);
  });

  it('GET /api/tickets?epic=EPIC-999 returns empty array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets?epic=EPIC-999',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('GET /api/tickets/:id returns 200 with detail and stages array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('id', SEED_IDS.TICKET_LOGIN);
    expect(body).toHaveProperty('title', 'Login Flow');
    expect(body).toHaveProperty('status', 'In Progress');
    expect(body).toHaveProperty('epic_id', SEED_IDS.EPIC_AUTH);
    expect(body).toHaveProperty('has_stages', true);
    expect(body).toHaveProperty('stages');
    expect(Array.isArray(body.stages)).toBe(true);
  });

  it('GET /api/tickets/TICKET-001-001 includes correct 3 stages', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}`,
    });

    const body = JSON.parse(response.body);
    expect(body.stages).toHaveLength(3);

    const stageIds = body.stages.map((s: { id: string }) => s.id);
    expect(stageIds).toContain(SEED_IDS.STAGE_LOGIN_FORM);
    expect(stageIds).toContain(SEED_IDS.STAGE_AUTH_API);
    expect(stageIds).toContain(SEED_IDS.STAGE_SESSION_MGMT);

    // Verify stage shape: refinement_type is parsed to array, session_active is boolean
    const loginForm = body.stages.find(
      (s: { id: string }) => s.id === SEED_IDS.STAGE_LOGIN_FORM,
    );
    expect(loginForm).toMatchObject({
      id: SEED_IDS.STAGE_LOGIN_FORM,
      title: 'Login Form',
      status: 'Complete',
      kanban_column: 'done',
      session_active: false,
      priority: 0,
    });
    expect(Array.isArray(loginForm.refinement_type)).toBe(true);

    const authApi = body.stages.find(
      (s: { id: string }) => s.id === SEED_IDS.STAGE_AUTH_API,
    );
    expect(authApi).toMatchObject({
      due_date: '2026-03-15',
      priority: 1,
    });
  });

  it('GET /api/tickets/TICKET-999-999 returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets/TICKET-999-999',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Ticket not found');
  });

  it('GET /api/tickets/:id with invalid ID format returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets/not-a-ticket',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /api/tickets without DataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/tickets',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/tickets returns application/json content-type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tickets',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
