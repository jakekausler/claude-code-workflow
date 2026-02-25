import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('stages API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stages-test-'));
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

  it('GET /api/stages returns 200 with array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/stages returns correct count (4 stages from seed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveLength(4);
  });

  it('GET /api/stages?ticket=TICKET-001-001 filters correctly (3 stages)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/stages?ticket=${SEED_IDS.TICKET_LOGIN}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(3);

    const ids = body.map((s: { id: string }) => s.id);
    expect(ids).toContain(SEED_IDS.STAGE_LOGIN_FORM);
    expect(ids).toContain(SEED_IDS.STAGE_AUTH_API);
    expect(ids).toContain(SEED_IDS.STAGE_SESSION_MGMT);
  });

  it('GET /api/stages?ticket=NONEXISTENT returns empty array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages?ticket=NONEXISTENT',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('GET /api/stages/:id returns 200 with detail', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('id', SEED_IDS.STAGE_LOGIN_FORM);
    expect(body).toHaveProperty('title', 'Login Form');
    expect(body).toHaveProperty('status', 'Complete');
    expect(body).toHaveProperty('depends_on');
    expect(body).toHaveProperty('depended_on_by');
  });

  it('STAGE-001-001-001 has correct fields (refinement_type is array, session_active is boolean)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
    });

    const body = JSON.parse(response.body);
    expect(Array.isArray(body.refinement_type)).toBe(true);
    expect(body.refinement_type).toContain('frontend');
    expect(typeof body.session_active).toBe('boolean');
    expect(body.session_active).toBe(false);
    expect(body).toMatchObject({
      id: SEED_IDS.STAGE_LOGIN_FORM,
      title: 'Login Form',
      status: 'Complete',
      ticket_id: SEED_IDS.TICKET_LOGIN,
      epic_id: SEED_IDS.EPIC_AUTH,
      kanban_column: 'done',
      priority: 0,
      is_draft: false,
    });
  });

  it('STAGE-001-001-003 has depends_on (depends on STAGE-001-001-002)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/stages/${SEED_IDS.STAGE_SESSION_MGMT}`,
    });

    const body = JSON.parse(response.body);
    expect(body.depends_on).toHaveLength(1);
    expect(body.depends_on[0]).toMatchObject({
      from_id: SEED_IDS.STAGE_SESSION_MGMT,
      to_id: SEED_IDS.STAGE_AUTH_API,
      from_type: 'stage',
      to_type: 'stage',
    });
    expect(typeof body.depends_on[0].resolved).toBe('boolean');
  });

  it('STAGE-001-001-002 has depended_on_by (depended on by STAGE-001-001-003)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}`,
    });

    const body = JSON.parse(response.body);
    expect(body.depended_on_by).toHaveLength(1);
    expect(body.depended_on_by[0]).toMatchObject({
      from_id: SEED_IDS.STAGE_SESSION_MGMT,
      to_id: SEED_IDS.STAGE_AUTH_API,
      from_type: 'stage',
      to_type: 'stage',
    });
  });

  it('STAGE-999-999-999 returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages/STAGE-999-999-999',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Stage not found');
  });

  it('GET /api/stages/:id with invalid ID format returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages/not-a-stage',
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /api/stages without DataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/stages',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/stages returns application/json content-type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stages',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
