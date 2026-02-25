import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { DataService } from '../../src/server/services/data-service.js';
import { createServer } from '../../src/server/app.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from '../../../kanban-cli/dist/db/repositories/index.js';

describe('DataService', () => {
  let tmpDir: string;
  let db: KanbanDatabase;
  let service: DataService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-service-test-'));
    db = new KanbanDatabase(join(tmpDir, 'test.db'));
    service = new DataService({ db });
  });

  afterEach(() => {
    try {
      service.close();
    } catch {
      // Already closed — safe to ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provides access to the raw database', () => {
    expect(service.database).toBe(db);
  });

  it('provides a RepoRepository instance', () => {
    expect(service.repos).toBeInstanceOf(RepoRepository);
  });

  it('provides an EpicRepository instance', () => {
    expect(service.epics).toBeInstanceOf(EpicRepository);
  });

  it('provides a TicketRepository instance', () => {
    expect(service.tickets).toBeInstanceOf(TicketRepository);
  });

  it('provides a StageRepository instance', () => {
    expect(service.stages).toBeInstanceOf(StageRepository);
  });

  it('provides a DependencyRepository instance', () => {
    expect(service.dependencies).toBeInstanceOf(DependencyRepository);
  });

  it('close() closes the database connection', () => {
    service.close();
    // After closing, raw() should still return the instance but
    // any query on it should throw because the connection is closed.
    expect(() => db.raw().prepare('SELECT 1').get()).toThrow();
  });

  describe('DataService Fastify decoration', () => {
    it('decorates Fastify with the provided DataService', async () => {
      const app = await createServer({ logger: false, isDev: true, dataService: service });
      expect(app.dataService).toBe(service);
      await app.close();
    });

    it('defaults dataService to null when not provided', async () => {
      const app = await createServer({ logger: false, isDev: true });
      expect(app.dataService).toBeNull();
      await app.close();
    });
  });
});
