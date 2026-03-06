import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPgRepositories } from '../../../../src/server/services/repositories/pg/index.js';
import type { Pool, QueryResult } from 'pg';

/**
 * Create a mock pg.Pool that returns the given rows for any query.
 */
function mockPool(rows: Record<string, unknown>[] = []): Pool {
  const queryFn = vi.fn().mockResolvedValue({ rows } as QueryResult);
  const clientRelease = vi.fn();
  const connectFn = vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: clientRelease,
  });
  return {
    query: queryFn,
    connect: connectFn,
  } as unknown as Pool;
}

describe('PG repository implementations', () => {
  describe('PgRepoRepository', () => {
    it('findAll queries repos table', async () => {
      const pool = mockPool([
        { id: 1, path: '/tmp/repo', name: 'test-repo', registered_at: '2024-01-01' },
      ]);
      const repos = createPgRepositories(pool);

      const result = await repos.repos.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-repo');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
      );
    });

    it('findById returns null when not found', async () => {
      const pool = mockPool([]);
      const repos = createPgRepositories(pool);

      const result = await repos.repos.findById(999);
      expect(result).toBeNull();
    });

    it('upsert uses ON CONFLICT', async () => {
      const pool = mockPool([{ id: 42 }]);
      const repos = createPgRepositories(pool);

      const id = await repos.repos.upsert('/tmp/repo', 'test-repo');
      expect(id).toBe(42);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.arrayContaining(['/tmp/repo', 'test-repo']),
      );
    });
  });

  describe('PgEpicRepository', () => {
    it('findById returns row or null', async () => {
      const pool = mockPool([{ id: 'EPIC-001', repo_id: 1, title: 'Auth', status: 'active', jira_key: null, file_path: '/f', last_synced: 'ts' }]);
      const repos = createPgRepositories(pool);

      const epic = await repos.epics.findById('EPIC-001');
      expect(epic).not.toBeNull();
      expect(epic!.id).toBe('EPIC-001');
    });

    it('upsert uses ON CONFLICT', async () => {
      const pool = mockPool([]);
      const repos = createPgRepositories(pool);

      await repos.epics.upsert({
        id: 'EPIC-001', repo_id: 1, title: 'Auth', status: 'active',
        jira_key: null, file_path: '/f', last_synced: 'ts',
      });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array),
      );
    });
  });

  describe('PgStageRepository', () => {
    it('listReady queries with boolean false', async () => {
      const pool = mockPool([]);
      const repos = createPgRepositories(pool);

      await repos.stages.listReady(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('session_active = false'),
        [1],
      );
    });
  });

  describe('PgDependencyRepository', () => {
    it('resolve uses boolean true', async () => {
      const pool = mockPool([]);
      const repos = createPgRepositories(pool);

      await repos.dependencies.resolve('from-1', 'to-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('resolved = true'),
        ['from-1', 'to-1'],
      );
    });

    it('allResolved returns true when count is 0', async () => {
      const pool = mockPool([{ count: '0' }]);
      const repos = createPgRepositories(pool);

      const result = await repos.dependencies.allResolved('from-1');
      expect(result).toBe(true);
    });

    it('allResolved returns false when count > 0', async () => {
      const pool = mockPool([{ count: '2' }]);
      const repos = createPgRepositories(pool);

      const result = await repos.dependencies.allResolved('from-1');
      expect(result).toBe(false);
    });
  });

  describe('PgStageSessionRepository', () => {
    it('addSession uses transaction', async () => {
      const pool = mockPool([]);
      const repos = createPgRepositories(pool);

      await repos.stageSessions.addSession('STAGE-001-001-001', 'sess-1', 'Design');
      // Should have used connect() for transaction
      expect(pool.connect).toHaveBeenCalled();
    });
  });

  describe('PgTicketSessionRepository', () => {
    let pool: Pool;
    let repos: ReturnType<typeof createPgRepositories>;

    beforeEach(() => {
      pool = mockPool([
        { id: 1, ticket_id: 'T-1', session_id: 's-1', session_type: 'convert', started_at: 'ts', ended_at: null },
      ]);
      repos = createPgRepositories(pool);
    });

    it('getSessionsByTicketId queries with ticket_id', async () => {
      const result = await repos.ticketSessions.getSessionsByTicketId('T-1');
      expect(result).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ticket_id'),
        ['T-1'],
      );
    });
  });
});
