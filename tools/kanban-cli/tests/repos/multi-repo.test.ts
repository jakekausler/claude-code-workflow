import { describe, it, expect, vi } from 'vitest';
import { createMultiRepoHelper } from '../../src/repos/multi-repo.js';
import type { MultiRepoDeps } from '../../src/repos/multi-repo.js';
import type { RepoEntry } from '../../src/repos/registry.js';
import type { RepoRecord } from '../../src/types/work-items.js';
import type { KanbanDatabase } from '../../src/db/database.js';
import type { EpicRow, TicketRow, StageRow, DependencyRow } from '../../src/db/repositories/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    path: '/projects/backend',
    name: 'backend',
    ...overrides,
  };
}

function makeRepoRecord(overrides: Partial<RepoRecord> = {}): RepoRecord {
  return {
    id: 1,
    path: '/projects/backend',
    name: 'backend',
    registered_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEpicRow(overrides: Partial<EpicRow> = {}): EpicRow {
  return {
    id: 'EPIC-001',
    repo_id: 1,
    title: 'Test Epic',
    status: 'Open',
    jira_key: null,
    file_path: '/projects/backend/epics/001/epic.md',
    last_synced: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 'TICKET-001',
    epic_id: 'EPIC-001',
    repo_id: 1,
    title: 'Test Ticket',
    status: 'Open',
    jira_key: null,
    source: 'local',
    has_stages: 1,
    file_path: '/projects/backend/epics/001/tickets/001.md',
    last_synced: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStageRow(overrides: Partial<StageRow> = {}): StageRow {
  return {
    id: 'EPIC-001-TICKET-001-S1',
    ticket_id: 'TICKET-001',
    epic_id: 'EPIC-001',
    repo_id: 1,
    title: 'Test Stage',
    status: 'Not Started',
    kanban_column: 'backlog',
    refinement_type: '[]',
    worktree_branch: null,
    pr_url: null,
    pr_number: null,
    priority: 0,
    due_date: null,
    session_active: 0,
    locked_at: null,
    locked_by: null,
    is_draft: 0,
    pending_merge_parents: null,
    mr_target_branch: null,
    file_path: '/projects/backend/epics/001/tickets/001/stages/S1.md',
    last_synced: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDependencyRow(overrides: Partial<DependencyRow> = {}): DependencyRow {
  return {
    id: 1,
    from_id: 'EPIC-001-TICKET-001-S2',
    to_id: 'EPIC-001-TICKET-001-S1',
    from_type: 'stage',
    to_type: 'stage',
    resolved: 0,
    repo_id: 1,
    target_repo_name: null,
    ...overrides,
  };
}

/** Stub KanbanDatabase — syncRepo is mocked so the DB is never used directly. */
const mockDb = {} as KanbanDatabase;

/**
 * Build mock deps with sensible defaults. Each dep can be overridden.
 */
function makeDeps(overrides: Partial<MultiRepoDeps> = {}): MultiRepoDeps {
  return {
    registry: {
      loadRepos: vi.fn().mockReturnValue([]),
      registerRepo: vi.fn(),
      unregisterRepo: vi.fn(),
      findByName: vi.fn().mockReturnValue(null),
    },
    db: mockDb,
    repoRepo: {
      findByPath: vi.fn().mockReturnValue(null),
      findById: vi.fn().mockReturnValue(null),
    },
    epicRepo: {
      listByRepo: vi.fn().mockReturnValue([]),
    },
    ticketRepo: {
      listByRepo: vi.fn().mockReturnValue([]),
    },
    stageRepo: {
      listByRepo: vi.fn().mockReturnValue([]),
    },
    depRepo: {
      listByRepo: vi.fn().mockReturnValue([]),
    },
    loadConfig: vi.fn().mockReturnValue({ workflow: { phases: [] } }),
    syncRepo: vi.fn(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createMultiRepoHelper', () => {
  // ── syncAllRepos ─────────────────────────────────────────────────

  describe('syncAllRepos()', () => {
    it('syncs each registered repo', () => {
      const repos: RepoEntry[] = [
        makeRepoEntry({ path: '/projects/backend', name: 'backend' }),
        makeRepoEntry({ path: '/projects/frontend', name: 'frontend' }),
      ];

      const syncRepoFn = vi.fn();
      const loadConfigFn = vi.fn().mockReturnValue({ workflow: { phases: [] } });

      const deps = makeDeps({
        registry: {
          loadRepos: vi.fn().mockReturnValue(repos),
          registerRepo: vi.fn(),
          unregisterRepo: vi.fn(),
          findByName: vi.fn().mockReturnValue(null),
        },
        repoRepo: {
          findByPath: vi.fn()
            .mockReturnValueOnce(makeRepoRecord({ id: 1, path: '/projects/backend', name: 'backend' }))
            .mockReturnValueOnce(makeRepoRecord({ id: 2, path: '/projects/frontend', name: 'frontend' })),
          findById: vi.fn(),
        },
        loadConfig: loadConfigFn,
        syncRepo: syncRepoFn,
      });

      const helper = createMultiRepoHelper(deps);
      helper.syncAllRepos();

      expect(syncRepoFn).toHaveBeenCalledTimes(2);
      expect(syncRepoFn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: '/projects/backend', db: mockDb }),
      );
      expect(syncRepoFn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: '/projects/frontend', db: mockDb }),
      );
      expect(loadConfigFn).toHaveBeenCalledTimes(2);
      expect(loadConfigFn).toHaveBeenCalledWith({ repoPath: '/projects/backend' });
      expect(loadConfigFn).toHaveBeenCalledWith({ repoPath: '/projects/frontend' });
    });

    it('returns correct repo info list', () => {
      const repos: RepoEntry[] = [
        makeRepoEntry({ path: '/projects/backend', name: 'backend' }),
        makeRepoEntry({ path: '/projects/frontend', name: 'frontend' }),
      ];

      const deps = makeDeps({
        registry: {
          loadRepos: vi.fn().mockReturnValue(repos),
          registerRepo: vi.fn(),
          unregisterRepo: vi.fn(),
          findByName: vi.fn().mockReturnValue(null),
        },
        repoRepo: {
          findByPath: vi.fn()
            .mockReturnValueOnce(makeRepoRecord({ id: 1, path: '/projects/backend', name: 'backend' }))
            .mockReturnValueOnce(makeRepoRecord({ id: 2, path: '/projects/frontend', name: 'frontend' })),
          findById: vi.fn(),
        },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.syncAllRepos();

      expect(result).toEqual([
        { repoId: 1, repoName: 'backend', repoPath: '/projects/backend' },
        { repoId: 2, repoName: 'frontend', repoPath: '/projects/frontend' },
      ]);
    });

    it('handles empty registry (returns [])', () => {
      const deps = makeDeps({
        registry: {
          loadRepos: vi.fn().mockReturnValue([]),
          registerRepo: vi.fn(),
          unregisterRepo: vi.fn(),
          findByName: vi.fn().mockReturnValue(null),
        },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.syncAllRepos();

      expect(result).toEqual([]);
      expect(deps.syncRepo).not.toHaveBeenCalled();
    });

    it('skips repos not found in database after sync and warns on stderr', () => {
      const repos: RepoEntry[] = [
        makeRepoEntry({ path: '/projects/backend', name: 'backend' }),
        makeRepoEntry({ path: '/projects/missing', name: 'missing' }),
      ];

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const deps = makeDeps({
        registry: {
          loadRepos: vi.fn().mockReturnValue(repos),
          registerRepo: vi.fn(),
          unregisterRepo: vi.fn(),
          findByName: vi.fn().mockReturnValue(null),
        },
        repoRepo: {
          findByPath: vi.fn()
            .mockReturnValueOnce(makeRepoRecord({ id: 1, path: '/projects/backend', name: 'backend' }))
            .mockReturnValueOnce(null), // missing repo
          findById: vi.fn(),
        },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.syncAllRepos();

      // Only backend is in the result
      expect(result).toEqual([
        { repoId: 1, repoName: 'backend', repoPath: '/projects/backend' },
      ]);

      // Warning was emitted for the missing repo
      expect(stderrSpy).toHaveBeenCalledWith(
        "Warning: repo 'missing' at '/projects/missing' not found in database after sync\n",
      );

      stderrSpy.mockRestore();
    });
  });

  // ── loadAllRepoData ──────────────────────────────────────────────

  describe('loadAllRepoData()', () => {
    it('aggregates data from multiple repos', () => {
      const deps = makeDeps({
        repoRepo: {
          findByPath: vi.fn(),
          findById: vi.fn()
            .mockReturnValueOnce(makeRepoRecord({ id: 1, name: 'backend' }))
            .mockReturnValueOnce(makeRepoRecord({ id: 2, name: 'frontend' })),
        },
        epicRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeEpicRow({ id: 'EPIC-001', repo_id: 1 })])
            .mockReturnValueOnce([makeEpicRow({ id: 'EPIC-002', repo_id: 2 })]),
        },
        ticketRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeTicketRow({ id: 'TICKET-001', repo_id: 1 })])
            .mockReturnValueOnce([makeTicketRow({ id: 'TICKET-002', repo_id: 2 })]),
        },
        stageRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeStageRow({ id: 'S1', repo_id: 1 })])
            .mockReturnValueOnce([makeStageRow({ id: 'S2', repo_id: 2 })]),
        },
        depRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeDependencyRow({ id: 1, repo_id: 1 })])
            .mockReturnValueOnce([makeDependencyRow({ id: 2, repo_id: 2 })]),
        },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.loadAllRepoData([1, 2]);

      expect(result.epics).toHaveLength(2);
      expect(result.tickets).toHaveLength(2);
      expect(result.stages).toHaveLength(2);
      expect(result.deps).toHaveLength(2);
    });

    it('adds repo field to each item', () => {
      const deps = makeDeps({
        repoRepo: {
          findByPath: vi.fn(),
          findById: vi.fn()
            .mockReturnValueOnce(makeRepoRecord({ id: 1, name: 'backend' }))
            .mockReturnValueOnce(makeRepoRecord({ id: 2, name: 'frontend' })),
        },
        epicRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeEpicRow({ id: 'EPIC-001', repo_id: 1 })])
            .mockReturnValueOnce([makeEpicRow({ id: 'EPIC-002', repo_id: 2 })]),
        },
        ticketRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeTicketRow({ id: 'TICKET-001', repo_id: 1 })])
            .mockReturnValueOnce([]),
        },
        stageRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([makeStageRow({ id: 'S1', repo_id: 1 })])
            .mockReturnValueOnce([]),
        },
        depRepo: {
          listByRepo: vi.fn()
            .mockReturnValueOnce([])
            .mockReturnValueOnce([makeDependencyRow({ id: 1, repo_id: 2 })]),
        },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.loadAllRepoData([1, 2]);

      // Epics
      expect(result.epics[0].repo).toBe('backend');
      expect(result.epics[1].repo).toBe('frontend');

      // Tickets
      expect(result.tickets[0].repo).toBe('backend');

      // Stages
      expect(result.stages[0].repo).toBe('backend');

      // Deps
      expect(result.deps[0].repo).toBe('frontend');
    });

    it('returns empty arrays for unsynced repos (not found in DB)', () => {
      const deps = makeDeps({
        repoRepo: {
          findByPath: vi.fn(),
          findById: vi.fn().mockReturnValue(null), // repo not found
        },
        epicRepo: { listByRepo: vi.fn().mockReturnValue([]) },
        ticketRepo: { listByRepo: vi.fn().mockReturnValue([]) },
        stageRepo: { listByRepo: vi.fn().mockReturnValue([]) },
        depRepo: { listByRepo: vi.fn().mockReturnValue([]) },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.loadAllRepoData([99]);

      expect(result.epics).toEqual([]);
      expect(result.tickets).toEqual([]);
      expect(result.stages).toEqual([]);
      expect(result.deps).toEqual([]);
    });

    it('handles empty repoIds array', () => {
      const deps = makeDeps();
      const helper = createMultiRepoHelper(deps);
      const result = helper.loadAllRepoData([]);

      expect(result.epics).toEqual([]);
      expect(result.tickets).toEqual([]);
      expect(result.stages).toEqual([]);
      expect(result.deps).toEqual([]);
    });

    it('throws when repository dependencies are missing', () => {
      // Create helper without db or repo dependencies
      const helper = createMultiRepoHelper({
        registry: {
          loadRepos: vi.fn().mockReturnValue([]),
          registerRepo: vi.fn(),
          unregisterRepo: vi.fn(),
          findByName: vi.fn().mockReturnValue(null),
        },
      });

      expect(() => helper.loadAllRepoData([1])).toThrow(
        'Repository dependencies are required for loadAllRepoData',
      );
    });

    it('uses "unknown" for repos not found by ID', () => {
      const deps = makeDeps({
        repoRepo: {
          findByPath: vi.fn(),
          findById: vi.fn().mockReturnValue(null),
        },
        epicRepo: {
          listByRepo: vi.fn().mockReturnValue([makeEpicRow({ id: 'EPIC-001', repo_id: 99 })]),
        },
        ticketRepo: { listByRepo: vi.fn().mockReturnValue([]) },
        stageRepo: { listByRepo: vi.fn().mockReturnValue([]) },
        depRepo: { listByRepo: vi.fn().mockReturnValue([]) },
      });

      const helper = createMultiRepoHelper(deps);
      const result = helper.loadAllRepoData([99]);

      expect(result.epics[0].repo).toBe('unknown');
    });
  });
});
