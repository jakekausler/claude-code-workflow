import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../../src/server/app.js';
import { DataService } from '../../src/server/services/data-service.js';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { seedDatabase, SEED_IDS } from '../helpers/seed-data.js';

describe('delete routes', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let db: KanbanDatabase;
  let dataService: DataService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-delete-test-'));
    db = new KanbanDatabase(path.join(tmpDir, 'test.db'));
    seedDatabase(db, tmpDir);
    dataService = DataService.fromSqlite(db);
    app = await createServer({ logger: false, isDev: true, dataService });
  });

  afterEach(async () => {
    await app.close();
    dataService.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── DELETE /api/stages/:id ──────────────────────────────────────────

  describe('DELETE /api/stages/:id', () => {
    it('deletes a stage and returns 200', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ ok: true });

      // Verify the stage is gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('returns 404 for nonexistent stage', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/stages/STAGE-999-999-999',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Stage not found');
    });

    it('re-links dependencies when deleting a middle node', async () => {
      // Seed data has: SESSION_MGMT depends on AUTH_API
      // Add: LOGIN_FORM depends on SESSION_MGMT
      // Chain: LOGIN_FORM -> SESSION_MGMT -> AUTH_API
      // Delete SESSION_MGMT => LOGIN_FORM should depend on AUTH_API
      await dataService.dependencies.upsert({
        from_id: SEED_IDS.STAGE_LOGIN_FORM,
        to_id: SEED_IDS.STAGE_SESSION_MGMT,
        from_type: 'stage',
        to_type: 'stage',
        repo_id: 1,
      });

      // Delete the middle node
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/stages/${SEED_IDS.STAGE_SESSION_MGMT}`,
      });
      expect(deleteResponse.statusCode).toBe(200);

      // Verify LOGIN_FORM now depends on AUTH_API (re-linked)
      const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
      });
      expect(detailResponse.statusCode).toBe(200);
      const detail = JSON.parse(detailResponse.body);
      const depIds = detail.depends_on.map((d: { to_id: string }) => d.to_id);
      expect(depIds).toContain(SEED_IDS.STAGE_AUTH_API);
    });
  });

  // ── DELETE /api/tickets/:id ──────────────────────────────────────────

  describe('DELETE /api/tickets/:id', () => {
    it('deletes a ticket and its stages', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ ok: true });

      // Verify the ticket is gone
      const ticketGet = await app.inject({
        method: 'GET',
        url: `/api/tickets/${SEED_IDS.TICKET_LOGIN}`,
      });
      expect(ticketGet.statusCode).toBe(404);

      // Verify the stages are gone
      for (const stageId of [
        SEED_IDS.STAGE_LOGIN_FORM,
        SEED_IDS.STAGE_AUTH_API,
        SEED_IDS.STAGE_SESSION_MGMT,
      ]) {
        const stageGet = await app.inject({
          method: 'GET',
          url: `/api/stages/${stageId}`,
        });
        expect(stageGet.statusCode).toBe(404);
      }
    });

    it('returns 404 for nonexistent ticket', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/tickets/TICKET-999-999',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Ticket not found');
    });
  });

  // ── DELETE /api/epics/:id ───────────────────────────────────────────

  describe('DELETE /api/epics/:id', () => {
    it('deletes an epic and all its children', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/epics/${SEED_IDS.EPIC_AUTH}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ ok: true });

      // Verify the epic is gone
      const epicGet = await app.inject({
        method: 'GET',
        url: `/api/epics/${SEED_IDS.EPIC_AUTH}`,
      });
      expect(epicGet.statusCode).toBe(404);

      // Verify tickets are gone
      for (const ticketId of [SEED_IDS.TICKET_LOGIN, SEED_IDS.TICKET_REGISTRATION]) {
        const ticketGet = await app.inject({
          method: 'GET',
          url: `/api/tickets/${ticketId}`,
        });
        expect(ticketGet.statusCode).toBe(404);
      }

      // Verify stages are gone
      for (const stageId of [
        SEED_IDS.STAGE_LOGIN_FORM,
        SEED_IDS.STAGE_AUTH_API,
        SEED_IDS.STAGE_SESSION_MGMT,
        SEED_IDS.STAGE_SIGNUP_FORM,
      ]) {
        const stageGet = await app.inject({
          method: 'GET',
          url: `/api/stages/${stageId}`,
        });
        expect(stageGet.statusCode).toBe(404);
      }
    });

    it('returns 404 for nonexistent epic', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/epics/EPIC-999',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Epic not found');
    });
  });

  // ── GET /api/stages/:id/delete-preview ──────────────────────────────

  describe('GET /api/stages/:id/delete-preview', () => {
    it('returns preview with dependency info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}/delete-preview`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('item');
      expect(body.item).toMatchObject({
        id: SEED_IDS.STAGE_AUTH_API,
        title: 'Auth API',
        type: 'stage',
      });
      expect(body).toHaveProperty('childrenToDelete');
      expect(Array.isArray(body.childrenToDelete)).toBe(true);
      expect(body).toHaveProperty('dependenciesRemoved');
      expect(typeof body.dependenciesRemoved).toBe('number');
      expect(body).toHaveProperty('dependenciesCreated');
      expect(Array.isArray(body.dependenciesCreated)).toBe(true);
    });
  });

  // ── Dependency re-linking (detailed test) ──────────────────────────

  describe('dependency re-linking', () => {
    it('re-links through deleted item: X->A, A->Y becomes X->Y', async () => {
      // Use existing seed stages:
      //   X = STAGE_LOGIN_FORM
      //   A = STAGE_AUTH_API
      //   Y = STAGE_SIGNUP_FORM
      //
      // Set up: X depends on A, A depends on Y
      // (Clear existing deps first by using fresh ones)

      // A depends on Y
      await dataService.dependencies.upsert({
        from_id: SEED_IDS.STAGE_AUTH_API,
        to_id: SEED_IDS.STAGE_SIGNUP_FORM,
        from_type: 'stage',
        to_type: 'stage',
        repo_id: 1,
      });

      // X depends on A
      await dataService.dependencies.upsert({
        from_id: SEED_IDS.STAGE_LOGIN_FORM,
        to_id: SEED_IDS.STAGE_AUTH_API,
        from_type: 'stage',
        to_type: 'stage',
        repo_id: 1,
      });

      // Delete A (the middle node)
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}`,
      });
      expect(deleteResponse.statusCode).toBe(200);

      // Verify A is gone
      const aGet = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_AUTH_API}`,
      });
      expect(aGet.statusCode).toBe(404);

      // Verify X now depends on Y (the re-linked dependency)
      const xDetail = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_LOGIN_FORM}`,
      });
      expect(xDetail.statusCode).toBe(200);
      const xBody = JSON.parse(xDetail.body);
      const xDepTargets = xBody.depends_on.map((d: { to_id: string }) => d.to_id);
      expect(xDepTargets).toContain(SEED_IDS.STAGE_SIGNUP_FORM);

      // Verify Y is depended on by X
      const yDetail = await app.inject({
        method: 'GET',
        url: `/api/stages/${SEED_IDS.STAGE_SIGNUP_FORM}`,
      });
      expect(yDetail.statusCode).toBe(200);
      const yBody = JSON.parse(yDetail.body);
      const yDependedOnByIds = yBody.depended_on_by.map((d: { from_id: string }) => d.from_id);
      expect(yDependedOnByIds).toContain(SEED_IDS.STAGE_LOGIN_FORM);
    });
  });
});
