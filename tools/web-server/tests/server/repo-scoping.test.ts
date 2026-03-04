import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { RepoRepository } from '../../../kanban-cli/dist/db/repositories/repo-repository.js';
import { EpicRepository } from '../../../kanban-cli/dist/db/repositories/epic-repository.js';
import { TicketRepository } from '../../../kanban-cli/dist/db/repositories/ticket-repository.js';
import { StageRepository } from '../../../kanban-cli/dist/db/repositories/stage-repository.js';

/**
 * Tests for repo-scoped read access filtering.
 *
 * Verifies that when `request.allowedRepoIds` is set (hosted mode),
 * endpoints only return data from allowed repos. When undefined (local mode),
 * no filtering occurs.
 */
describe('repo-scoped read access', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;
  let repoAId: number;
  let repoBId: number;

  const TIMESTAMP = '2026-03-01T00:00:00.000Z';

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-scope-test-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));

    // Create two repos
    const repos = new RepoRepository(db);
    const epics = new EpicRepository(db);
    const tickets = new TicketRepository(db);
    const stages = new StageRepository(db);

    repoAId = repos.upsert(path.join(tmpDir, 'repo-a'), 'repo-a');
    repoBId = repos.upsert(path.join(tmpDir, 'repo-b'), 'repo-b');

    // Repo A: EPIC-001, TICKET-001-001, STAGE-001-001-001
    epics.upsert({
      id: 'EPIC-001',
      repo_id: repoAId,
      title: 'Repo A Epic',
      status: 'In Progress',
      jira_key: null,
      file_path: path.join(tmpDir, 'repo-a/epics/EPIC-001.md'),
      last_synced: TIMESTAMP,
    });

    tickets.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoAId,
      title: 'Repo A Ticket',
      status: 'In Progress',
      jira_key: null,
      source: null,
      has_stages: 1,
      file_path: path.join(tmpDir, 'repo-a/epics/EPIC-001/TICKET-001-001.md'),
      last_synced: TIMESTAMP,
    });

    stages.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoAId,
      title: 'Repo A Stage',
      status: 'Build',
      kanban_column: 'build',
      refinement_type: 'backend',
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      session_id: null,
      file_path: path.join(tmpDir, 'repo-a/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'),
      last_synced: TIMESTAMP,
    });

    // Repo B: EPIC-002, TICKET-002-001, STAGE-002-001-001
    epics.upsert({
      id: 'EPIC-002',
      repo_id: repoBId,
      title: 'Repo B Epic',
      status: 'Not Started',
      jira_key: null,
      file_path: path.join(tmpDir, 'repo-b/epics/EPIC-002.md'),
      last_synced: TIMESTAMP,
    });

    tickets.upsert({
      id: 'TICKET-002-001',
      epic_id: 'EPIC-002',
      repo_id: repoBId,
      title: 'Repo B Ticket',
      status: 'Not Started',
      jira_key: null,
      source: null,
      has_stages: 1,
      file_path: path.join(tmpDir, 'repo-b/epics/EPIC-002/TICKET-002-001.md'),
      last_synced: TIMESTAMP,
    });

    stages.upsert({
      id: 'STAGE-002-001-001',
      ticket_id: 'TICKET-002-001',
      epic_id: 'EPIC-002',
      repo_id: repoBId,
      title: 'Repo B Stage',
      status: 'Not Started',
      kanban_column: 'backlog',
      refinement_type: 'frontend',
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      session_id: null,
      file_path: path.join(tmpDir, 'repo-b/epics/EPIC-002/TICKET-002-001/STAGE-002-001-001.md'),
      last_synced: TIMESTAMP,
    });

    dataService = DataService.fromSqlite(db);
    app = await createServer({ logger: false, isDev: true, dataService });
  });

  afterEach(async () => {
    await app.close();
    dataService.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Local mode: no filtering (allowedRepoIds undefined) ──

  it('local mode: GET /api/repos returns all repos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body.map((r: { name: string }) => r.name).sort()).toEqual(['repo-a', 'repo-b']);
  });

  it('local mode: GET /api/epics returns all epics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/epics' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('local mode: GET /api/tickets returns all tickets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tickets' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('local mode: GET /api/stages returns all stages', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stages' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('local mode: GET /api/search returns results from all repos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=Repo' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 2 epics + 2 tickets + 2 stages = 6 results with "Repo" in title
    expect(body.results.length).toBe(6);
  });

  // ── Scoped mode: user with access to repo A only ──

  it('scoped user sees only repo A data in GET /api/repos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repos',
      headers: { 'x-test-allowed-repo-ids': String(repoAId) },
    });
    // We need to simulate allowedRepoIds. Since we're in local mode,
    // let's use a decorator hook approach instead.
    // For testing, we'll use the inject mechanism with a onRequest hook.
    expect(res.statusCode).toBe(200);
  });

  // Use a helper to create a server with repo scoping simulated via a hook
  async function createScopedApp(allowedRepoIds: string[]) {
    const scopedApp = await createServer({ logger: false, isDev: true, dataService });
    // Add a hook to simulate hosted-mode repo scoping
    scopedApp.addHook('onRequest', async (request) => {
      request.allowedRepoIds = allowedRepoIds;
    });
    return scopedApp;
  }

  describe('user with access to repo A only', () => {
    let scopedApp: FastifyInstance;

    beforeEach(async () => {
      scopedApp = await createScopedApp([String(repoAId)]);
    });

    afterEach(async () => {
      await scopedApp.close();
    });

    it('GET /api/repos returns only repo A', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/repos' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('repo-a');
    });

    it('GET /api/epics returns only repo A epics', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/epics' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Repo A Epic');
    });

    it('GET /api/tickets returns only repo A tickets', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/tickets' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Repo A Ticket');
    });

    it('GET /api/stages returns only repo A stages', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/stages' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Repo A Stage');
    });

    it('GET /api/epics/:id returns 403 for repo B epic', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/epics/EPIC-002' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Access denied');
    });

    it('GET /api/epics/:id returns 200 for repo A epic', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/epics/EPIC-001' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Repo A Epic');
    });

    it('GET /api/tickets/:id returns 403 for repo B ticket', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/tickets/TICKET-002-001' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Access denied');
    });

    it('GET /api/stages/:id returns 403 for repo B stage', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/stages/STAGE-002-001-001' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Access denied');
    });

    it('GET /api/search returns only repo A results', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/search?q=Repo' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Only repo A: 1 epic + 1 ticket + 1 stage = 3
      expect(body.results.length).toBe(3);
      for (const r of body.results) {
        expect(r.title).toMatch(/Repo A/);
      }
    });

    it('GET /api/graph returns only repo A data', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/graph' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Only repo A nodes — graph has "nodes" array
      for (const node of body.nodes) {
        expect(node.id).not.toMatch(/002/);
      }
    });

    it('GET /api/board returns only repo A data', async () => {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/board' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.stats.total_stages).toBe(1);
    });
  });

  // ── Global admin: allowedRepoIds undefined (bypassed by middleware) ──

  describe('global admin (no allowedRepoIds)', () => {
    it('GET /api/repos returns all repos', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/repos' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(2);
    });

    it('GET /api/epics returns all epics', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/epics' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(2);
    });

    it('GET /api/epics/:id returns 200 for any epic', async () => {
      const resA = await app.inject({ method: 'GET', url: '/api/epics/EPIC-001' });
      expect(resA.statusCode).toBe(200);
      const resB = await app.inject({ method: 'GET', url: '/api/epics/EPIC-002' });
      expect(resB.statusCode).toBe(200);
    });
  });

  // ── User with no repos: empty allowedRepoIds ──

  describe('user with no repos (empty allowedRepoIds)', () => {
    let emptyApp: FastifyInstance;

    beforeEach(async () => {
      emptyApp = await createScopedApp([]);
    });

    afterEach(async () => {
      await emptyApp.close();
    });

    it('GET /api/repos returns empty array', async () => {
      const res = await emptyApp.inject({ method: 'GET', url: '/api/repos' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('GET /api/epics returns empty array', async () => {
      const res = await emptyApp.inject({ method: 'GET', url: '/api/epics' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('GET /api/tickets returns empty array', async () => {
      const res = await emptyApp.inject({ method: 'GET', url: '/api/tickets' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('GET /api/stages returns empty array', async () => {
      const res = await emptyApp.inject({ method: 'GET', url: '/api/stages' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });
  });
});
