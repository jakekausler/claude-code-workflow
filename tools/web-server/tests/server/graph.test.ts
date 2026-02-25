import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('graph API', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-graph-test-'));
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

  it('GET /api/graph returns 200 with nodes, edges, cycles, critical_path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
    expect(body).toHaveProperty('cycles');
    expect(body).toHaveProperty('critical_path');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(Array.isArray(body.cycles)).toBe(true);
    expect(Array.isArray(body.critical_path)).toBe(true);
  });

  it('GET /api/graph has correct node count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph',
    });

    const body = JSON.parse(response.body);
    // Seed: 2 epics + 3 tickets + 4 stages = 9 nodes
    expect(body.nodes).toHaveLength(9);
  });

  it('GET /api/graph has correct edge count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph',
    });

    const body = JSON.parse(response.body);
    // Seed: 1 dependency (STAGE-001-001-003 -> STAGE-001-001-002)
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0].from).toBe(SEED_IDS.STAGE_SESSION_MGMT);
    expect(body.edges[0].to).toBe(SEED_IDS.STAGE_AUTH_API);
    expect(body.edges[0].type).toBe('depends_on');
  });

  it('GET /api/graph?epic=EPIC-001 filters correctly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/graph?epic=${SEED_IDS.EPIC_AUTH}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // EPIC-001 has: 1 epic + 2 tickets + 4 stages = 7 nodes
    expect(body.nodes).toHaveLength(7);
    // All node IDs should belong to EPIC-001
    for (const node of body.nodes) {
      expect(node.id).toMatch(/^(EPIC-001|TICKET-001|STAGE-001)/);
    }
    // The dependency is within EPIC-001, so still 1 edge
    expect(body.edges).toHaveLength(1);
  });

  it('GET /api/graph?mermaid=true returns mermaid string', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph?mermaid=true',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('mermaid');
    expect(typeof body.mermaid).toBe('string');
    expect(body.mermaid).toContain('graph TD');
  });

  it('GET /api/graph with empty database returns empty graph', async () => {
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-graph-empty-'));
    const emptyDb = new KanbanDatabase(path.join(emptyTmpDir, 'empty.db'));
    const emptyDs = new DataService({ db: emptyDb });
    const emptyApp = await createServer({ logger: false, isDev: true, dataService: emptyDs });
    try {
      const response = await emptyApp.inject({ method: 'GET', url: '/api/graph' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.nodes).toEqual([]);
      expect(body.edges).toEqual([]);
      expect(body.cycles).toEqual([]);
      expect(body.critical_path).toEqual([]);
    } finally {
      await emptyApp.close();
      emptyDs.close();
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });

  it('GET /api/graph without dataService returns 503', async () => {
    const noDbApp = await createServer({ logger: false, isDev: true });
    try {
      const response = await noDbApp.inject({
        method: 'GET',
        url: '/api/graph',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database not initialized');
    } finally {
      await noDbApp.close();
    }
  });

  it('GET /api/graph returns application/json content-type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('GET /api/graph with unknown param returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph?badParam=foo',
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
  });

  it('GET /api/graph?mermaid=true with empty database returns mermaid string', async () => {
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-empty-'));
    const emptyDb = new KanbanDatabase(path.join(emptyTmpDir, 'empty.db'));
    const emptyDs = new DataService({ db: emptyDb });
    const emptyApp = await createServer({ logger: false, isDev: true, dataService: emptyDs });
    try {
      const response = await emptyApp.inject({
        method: 'GET',
        url: '/api/graph?mermaid=true',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.mermaid).toBe('string');
    } finally {
      await emptyApp.close();
      emptyDs.close();
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });

  it('GET /api/graph?mermaid=yes returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph?mermaid=yes',
    });
    expect(response.statusCode).toBe(400);
  });
});
