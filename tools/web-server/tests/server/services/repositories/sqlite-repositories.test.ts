import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KanbanDatabase } from '../../../../../kanban-cli/dist/db/database.js';
import { createSqliteRepositories } from '../../../../src/server/services/repositories/sqlite/index.js';
import { seedDatabase, SEED_IDS } from '../../../helpers/seed-data.js';

describe('SQLite repository adapters', () => {
  let tmpDir: string;
  let db: KanbanDatabase;
  let repos: ReturnType<typeof createSqliteRepositories>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sqlite-repo-test-'));
    db = new KanbanDatabase(join(tmpDir, 'test.db'));
    seedDatabase(db, tmpDir);
    repos = createSqliteRepositories(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('RepoRepository', () => {
    it('findAll returns array of repos', async () => {
      const all = await repos.repos.findAll();
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBeGreaterThan(0);
      expect(all[0]).toHaveProperty('id');
      expect(all[0]).toHaveProperty('path');
      expect(all[0]).toHaveProperty('name');
    });

    it('findById returns a repo or null', async () => {
      const all = await repos.repos.findAll();
      const found = await repos.repos.findById(all[0].id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(all[0].id);

      const notFound = await repos.repos.findById(99999);
      expect(notFound).toBeNull();
    });
  });

  describe('EpicRepository', () => {
    it('listByRepo returns epics', async () => {
      const allRepos = await repos.repos.findAll();
      const epics = await repos.epics.listByRepo(allRepos[0].id);
      expect(Array.isArray(epics)).toBe(true);
      expect(epics.length).toBeGreaterThan(0);
    });

    it('findById returns an epic or null', async () => {
      const epic = await repos.epics.findById(SEED_IDS.EPIC_AUTH);
      expect(epic).not.toBeNull();
      expect(epic!.id).toBe(SEED_IDS.EPIC_AUTH);

      const notFound = await repos.epics.findById('EPIC-999');
      expect(notFound).toBeNull();
    });
  });

  describe('StageRepository boolean normalisation', () => {
    it('returns session_active and is_draft as booleans', async () => {
      const allRepos = await repos.repos.findAll();
      const stages = await repos.stages.listByRepo(allRepos[0].id);
      expect(stages.length).toBeGreaterThan(0);

      for (const stage of stages) {
        expect(typeof stage.session_active).toBe('boolean');
        expect(typeof stage.is_draft).toBe('boolean');
      }
    });

    it('findById returns boolean fields', async () => {
      const stage = await repos.stages.findById(SEED_IDS.STAGE_AUTH_API);
      expect(stage).not.toBeNull();
      expect(typeof stage!.session_active).toBe('boolean');
      expect(typeof stage!.is_draft).toBe('boolean');
    });
  });

  describe('DependencyRepository boolean normalisation', () => {
    it('returns resolved as boolean', async () => {
      const allRepos = await repos.repos.findAll();
      const deps = await repos.dependencies.listByRepo(allRepos[0].id);
      for (const dep of deps) {
        expect(typeof dep.resolved).toBe('boolean');
      }
    });
  });

  describe('StageSessionRepository boolean normalisation', () => {
    it('returns is_current as boolean after addSession', async () => {
      await repos.stageSessions.addSession(SEED_IDS.STAGE_AUTH_API, 'test-sess', 'Design');
      const sessions = await repos.stageSessions.getSessionsByStageId(SEED_IDS.STAGE_AUTH_API);
      expect(sessions.length).toBe(1);
      expect(typeof sessions[0].is_current).toBe('boolean');
      expect(sessions[0].is_current).toBe(true);
    });

    it('getCurrentSession returns session with boolean is_current', async () => {
      await repos.stageSessions.addSession(SEED_IDS.STAGE_AUTH_API, 'test-sess', 'Design');
      const current = await repos.stageSessions.getCurrentSession(SEED_IDS.STAGE_AUTH_API);
      expect(current).not.toBeNull();
      expect(typeof current!.is_current).toBe('boolean');
      expect(current!.is_current).toBe(true);
    });
  });

  describe('TicketRepository boolean normalisation', () => {
    it('returns has_stages as boolean', async () => {
      const allRepos = await repos.repos.findAll();
      const tickets = await repos.tickets.listByRepo(allRepos[0].id);
      for (const ticket of tickets) {
        if (ticket.has_stages !== null) {
          expect(typeof ticket.has_stages).toBe('boolean');
        }
      }
    });
  });
});
