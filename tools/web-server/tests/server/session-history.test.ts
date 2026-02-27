import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('session history API', () => {
  let app: FastifyInstance;
  let db: KanbanDatabase;
  let dataService: DataService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hist-'));

    // Create a claude projects dir (required by server)
    const claudeDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(claudeDir, { recursive: true });

    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    seedDatabase(db, tmpDir);
    dataService = new DataService({ db });

    app = await createServer({
      logger: false,
      isDev: true,
      claudeProjectsDir: claudeDir,
      dataService,
    });
  });

  afterEach(async () => {
    await app.close();
    dataService.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/stages/:stageId/sessions', () => {
    it('returns empty array when no sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toEqual([]);
    });

    it('returns sessions with projectId', async () => {
      dataService.stageSessions.addSession(SEED_IDS.STAGE_AUTH_API, 'sess-1', 'Design');

      const res = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe('sess-1');
      expect(body.sessions[0].phase).toBe('Design');
      expect(body.sessions[0].isCurrent).toBe(true);
      expect(body.sessions[0].projectId).toBe(tmpDir.replace(/\//g, '-'));
    });

    it('returns multiple sessions ordered by is_current DESC, started_at DESC', async () => {
      dataService.stageSessions.addSession(SEED_IDS.STAGE_AUTH_API, 'sess-old', 'Design');
      dataService.stageSessions.addSession(SEED_IDS.STAGE_AUTH_API, 'sess-new', 'Build');

      const res = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(2);
      // Current session first
      expect(body.sessions[0].sessionId).toBe('sess-new');
      expect(body.sessions[0].isCurrent).toBe(true);
      // Previous session second (ended)
      expect(body.sessions[1].sessionId).toBe('sess-old');
      expect(body.sessions[1].isCurrent).toBe(false);
    });

    it('returns 404 for unknown stage', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stages/STAGE-999-999-999/sessions',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Stage not found');
    });
  });

  describe('GET /api/tickets/:ticketId/sessions', () => {
    it('returns empty array when no sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toEqual([]);
    });

    it('returns sessions with projectId', async () => {
      dataService.ticketSessions.addSession(SEED_IDS.TICKET_LOGIN, 'sess-conv', 'convert');

      const res = await app.inject({
        method: 'GET',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}/sessions`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe('sess-conv');
      expect(body.sessions[0].sessionType).toBe('convert');
      expect(body.sessions[0].projectId).toBe(tmpDir.replace(/\//g, '-'));
    });

    it('returns 404 for unknown ticket', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tickets/TICKET-999-999/sessions',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Ticket not found');
    });
  });
});
