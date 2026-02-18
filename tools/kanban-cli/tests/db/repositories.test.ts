import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from '../../src/db/repositories/index.js';
import type {
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
} from '../../src/db/repositories/index.js';

describe('Repositories', () => {
  let tmpDir: string;
  let db: KanbanDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-repo-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: insert a repo so foreign keys are satisfied.
   */
  function insertRepo(repos: RepoRepository, repoPath = '/test/repo', name = 'test-repo'): number {
    return repos.upsert(repoPath, name);
  }

  /**
   * Helper: insert an epic so tickets/stages can reference it.
   */
  function insertEpic(epics: EpicRepository, repoId: number, id = 'epic-1'): void {
    epics.upsert({
      id,
      repo_id: repoId,
      title: 'Test Epic',
      status: 'in-progress',
      jira_key: null,
      file_path: '/test/epic.md',
      last_synced: new Date().toISOString(),
    });
  }

  /**
   * Helper: insert a ticket so stages can reference it.
   */
  function insertTicket(
    tickets: TicketRepository,
    repoId: number,
    epicId = 'epic-1',
    id = 'ticket-1'
  ): void {
    tickets.upsert({
      id,
      epic_id: epicId,
      repo_id: repoId,
      title: 'Test Ticket',
      status: 'open',
      jira_key: null,
      source: 'local',
      has_stages: 1,
      file_path: '/test/ticket.md',
      last_synced: new Date().toISOString(),
    });
  }

  // ─── RepoRepository ──────────────────────────────────────────────

  describe('RepoRepository', () => {
    it('upserts a new repo and returns its id', () => {
      const repos = new RepoRepository(db);
      const id = repos.upsert('/my/repo', 'my-repo');
      expect(id).toBeGreaterThan(0);
    });

    it('findByPath returns the repo', () => {
      const repos = new RepoRepository(db);
      repos.upsert('/my/repo', 'my-repo');
      const found = repos.findByPath('/my/repo');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('my-repo');
      expect(found!.path).toBe('/my/repo');
      expect(found!.registered_at).toBeTruthy();
    });

    it('findById returns the repo', () => {
      const repos = new RepoRepository(db);
      const id = repos.upsert('/my/repo', 'my-repo');
      const found = repos.findById(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
    });

    it('findByPath returns null for unknown path', () => {
      const repos = new RepoRepository(db);
      expect(repos.findByPath('/nonexistent')).toBeNull();
    });

    it('findById returns null for unknown id', () => {
      const repos = new RepoRepository(db);
      expect(repos.findById(999)).toBeNull();
    });

    it('upsert updates name on duplicate path', () => {
      const repos = new RepoRepository(db);
      const id1 = repos.upsert('/my/repo', 'old-name');
      const id2 = repos.upsert('/my/repo', 'new-name');
      expect(id1).toBe(id2);
      const found = repos.findById(id1);
      expect(found!.name).toBe('new-name');
    });
  });

  // ─── EpicRepository ──────────────────────────────────────────────

  describe('EpicRepository', () => {
    it('upserts an epic and finds it by id', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const repoId = insertRepo(repos);

      epics.upsert({
        id: 'epic-1',
        repo_id: repoId,
        title: 'My Epic',
        status: 'planning',
        jira_key: 'PROJ-100',
        file_path: '/epics/epic-1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      const found = epics.findById('epic-1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('My Epic');
      expect(found!.status).toBe('planning');
      expect(found!.jira_key).toBe('PROJ-100');
      expect(found!.file_path).toBe('/epics/epic-1.md');
      expect(found!.last_synced).toBe('2026-01-01T00:00:00Z');
    });

    it('findById returns null for unknown id', () => {
      const epics = new EpicRepository(db);
      expect(epics.findById('nonexistent')).toBeNull();
    });

    it('listByRepo returns all epics for a repo', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const repoId = insertRepo(repos);

      epics.upsert({
        id: 'epic-1',
        repo_id: repoId,
        title: 'Epic 1',
        status: 'active',
        jira_key: null,
        file_path: '/e1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });
      epics.upsert({
        id: 'epic-2',
        repo_id: repoId,
        title: 'Epic 2',
        status: 'done',
        jira_key: null,
        file_path: '/e2.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      const list = epics.listByRepo(repoId);
      expect(list).toHaveLength(2);
    });

    it('listByRepo returns empty array for repo with no epics', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const repoId = insertRepo(repos);
      expect(epics.listByRepo(repoId)).toHaveLength(0);
    });

    it('upsert replaces existing epic on same id', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const repoId = insertRepo(repos);

      epics.upsert({
        id: 'epic-1',
        repo_id: repoId,
        title: 'Old Title',
        status: 'planning',
        jira_key: null,
        file_path: '/e1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      epics.upsert({
        id: 'epic-1',
        repo_id: repoId,
        title: 'New Title',
        status: 'active',
        jira_key: 'PROJ-1',
        file_path: '/e1.md',
        last_synced: '2026-02-01T00:00:00Z',
      });

      const found = epics.findById('epic-1');
      expect(found!.title).toBe('New Title');
      expect(found!.status).toBe('active');
      expect(found!.jira_key).toBe('PROJ-1');
      expect(epics.listByRepo(repoId)).toHaveLength(1);
    });
  });

  // ─── TicketRepository ─────────────────────────────────────────────

  describe('TicketRepository', () => {
    it('upserts a ticket and finds it by id', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId);

      tickets.upsert({
        id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'My Ticket',
        status: 'open',
        jira_key: 'PROJ-200',
        source: 'jira',
        has_stages: 1,
        file_path: '/tickets/t1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      const found = tickets.findById('ticket-1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('My Ticket');
      expect(found!.epic_id).toBe('epic-1');
      expect(found!.source).toBe('jira');
      expect(found!.has_stages).toBe(1);
      expect(found!.jira_key).toBe('PROJ-200');
    });

    it('findById returns null for unknown id', () => {
      const tickets = new TicketRepository(db);
      expect(tickets.findById('nonexistent')).toBeNull();
    });

    it('listByRepo returns all tickets for a repo', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId);

      tickets.upsert({
        id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'T1',
        status: 'open',
        jira_key: null,
        source: 'local',
        has_stages: 0,
        file_path: '/t1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });
      tickets.upsert({
        id: 'ticket-2',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'T2',
        status: 'open',
        jira_key: null,
        source: 'local',
        has_stages: 1,
        file_path: '/t2.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      expect(tickets.listByRepo(repoId)).toHaveLength(2);
    });

    it('listByEpic returns tickets belonging to an epic', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId, 'epic-1');
      insertEpic(epics, repoId, 'epic-2');

      tickets.upsert({
        id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'T1',
        status: 'open',
        jira_key: null,
        source: 'local',
        has_stages: 0,
        file_path: '/t1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });
      tickets.upsert({
        id: 'ticket-2',
        epic_id: 'epic-2',
        repo_id: repoId,
        title: 'T2',
        status: 'open',
        jira_key: null,
        source: 'local',
        has_stages: 0,
        file_path: '/t2.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      expect(tickets.listByEpic('epic-1')).toHaveLength(1);
      expect(tickets.listByEpic('epic-2')).toHaveLength(1);
      expect(tickets.listByEpic('epic-3')).toHaveLength(0);
    });

    it('upsert replaces existing ticket on same id', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId);

      tickets.upsert({
        id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'Old',
        status: 'open',
        jira_key: null,
        source: 'local',
        has_stages: 0,
        file_path: '/t1.md',
        last_synced: '2026-01-01T00:00:00Z',
      });

      tickets.upsert({
        id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'New',
        status: 'closed',
        jira_key: 'J-1',
        source: 'jira',
        has_stages: 1,
        file_path: '/t1.md',
        last_synced: '2026-02-01T00:00:00Z',
      });

      const found = tickets.findById('ticket-1');
      expect(found!.title).toBe('New');
      expect(found!.status).toBe('closed');
      expect(tickets.listByRepo(repoId)).toHaveLength(1);
    });
  });

  // ─── StageRepository ──────────────────────────────────────────────

  describe('StageRepository', () => {
    function makeStageData(
      repoId: number,
      overrides: Partial<{
        id: string;
        ticket_id: string | null;
        epic_id: string | null;
        title: string | null;
        status: string | null;
        kanban_column: string | null;
        refinement_type: string | null;
        worktree_branch: string | null;
        priority: number;
        due_date: string | null;
        session_active: number;
        locked_at: string | null;
        locked_by: string | null;
        file_path: string;
        last_synced: string;
      }> = {}
    ) {
      return {
        id: 'stage-1',
        ticket_id: 'ticket-1',
        epic_id: 'epic-1',
        repo_id: repoId,
        title: 'Stage 1',
        status: 'open',
        kanban_column: 'ready_for_work',
        refinement_type: 'skill',
        worktree_branch: null,
        priority: 0,
        due_date: null,
        session_active: 0,
        locked_at: null,
        locked_by: null,
        file_path: '/stages/s1.md',
        last_synced: '2026-01-01T00:00:00Z',
        ...overrides,
      };
    }

    function setupStagePrereqs() {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const stages = new StageRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId);
      insertTicket(tickets, repoId);
      return { repos, epics, tickets, stages, repoId };
    }

    it('upserts a stage with all fields and finds it by id', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(
        makeStageData(repoId, {
          title: 'Full Stage',
          status: 'in-progress',
          kanban_column: 'Code Review',
          refinement_type: 'resolver',
          worktree_branch: 'feature/foo',
          priority: 5,
          due_date: '2026-03-01',
          session_active: 1,
          locked_at: '2026-02-18T10:00:00Z',
          locked_by: 'agent-1',
        })
      );

      const found = stages.findById('stage-1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Full Stage');
      expect(found!.status).toBe('in-progress');
      expect(found!.kanban_column).toBe('Code Review');
      expect(found!.refinement_type).toBe('resolver');
      expect(found!.worktree_branch).toBe('feature/foo');
      expect(found!.priority).toBe(5);
      expect(found!.due_date).toBe('2026-03-01');
      expect(found!.session_active).toBe(1);
      expect(found!.locked_at).toBe('2026-02-18T10:00:00Z');
      expect(found!.locked_by).toBe('agent-1');
    });

    it('findById returns null for unknown id', () => {
      const stages = new StageRepository(db);
      expect(stages.findById('nonexistent')).toBeNull();
    });

    it('listByRepo returns all stages for a repo', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-1' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-2' }));

      expect(stages.listByRepo(repoId)).toHaveLength(2);
    });

    it('listByTicket returns stages for a specific ticket', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const stages = new StageRepository(db);
      const repoId = insertRepo(repos);
      insertEpic(epics, repoId);
      insertTicket(tickets, repoId, 'epic-1', 'ticket-1');
      insertTicket(tickets, repoId, 'epic-1', 'ticket-2');

      stages.upsert(makeStageData(repoId, { id: 'stage-1', ticket_id: 'ticket-1' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-2', ticket_id: 'ticket-2' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-3', ticket_id: 'ticket-1' }));

      expect(stages.listByTicket('ticket-1')).toHaveLength(2);
      expect(stages.listByTicket('ticket-2')).toHaveLength(1);
    });

    it('listByColumn returns stages in a specific kanban column', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-1', kanban_column: 'Code Review' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-2', kanban_column: 'Code Review' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-3', kanban_column: 'ready_for_work' }));

      expect(stages.listByColumn(repoId, 'Code Review')).toHaveLength(2);
      expect(stages.listByColumn(repoId, 'ready_for_work')).toHaveLength(1);
      expect(stages.listByColumn(repoId, 'done')).toHaveLength(0);
    });

    it('listReady returns stages not in backlog or done and not session_active', () => {
      const { stages, repoId } = setupStagePrereqs();

      // Ready: not session_active, not backlog, not done
      stages.upsert(makeStageData(repoId, { id: 'stage-ready', kanban_column: 'ready_for_work', session_active: 0 }));
      stages.upsert(makeStageData(repoId, { id: 'stage-review', kanban_column: 'Code Review', session_active: 0 }));

      // Not ready: session_active
      stages.upsert(makeStageData(repoId, { id: 'stage-active', kanban_column: 'ready_for_work', session_active: 1 }));

      // Not ready: backlog column
      stages.upsert(makeStageData(repoId, { id: 'stage-backlog', kanban_column: 'backlog', session_active: 0 }));

      // Not ready: done column
      stages.upsert(makeStageData(repoId, { id: 'stage-done', kanban_column: 'done', session_active: 0 }));

      const ready = stages.listReady(repoId);
      expect(ready).toHaveLength(2);
      const readyIds = ready.map((s) => s.id).sort();
      expect(readyIds).toEqual(['stage-ready', 'stage-review']);
    });

    it('upsert replaces existing stage on same id', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-1', title: 'Old' }));
      stages.upsert(makeStageData(repoId, { id: 'stage-1', title: 'New' }));

      const found = stages.findById('stage-1');
      expect(found!.title).toBe('New');
      expect(stages.listByRepo(repoId)).toHaveLength(1);
    });
  });

  // ─── DependencyRepository ─────────────────────────────────────────

  describe('DependencyRepository', () => {
    function setupDepPrereqs() {
      const repos = new RepoRepository(db);
      const deps = new DependencyRepository(db);
      const repoId = insertRepo(repos);
      return { repos, deps, repoId };
    }

    it('upserts a dependency and lists by target', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      const list = deps.listByTarget('stage-2');
      expect(list).toHaveLength(1);
      expect(list[0].from_id).toBe('stage-2');
      expect(list[0].to_id).toBe('stage-1');
      expect(list[0].from_type).toBe('stage');
      expect(list[0].to_type).toBe('stage');
      expect(list[0].resolved).toBe(0);
    });

    it('upserts a dependency and lists by source', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      const list = deps.listBySource('stage-1');
      expect(list).toHaveLength(1);
      expect(list[0].from_id).toBe('stage-2');
    });

    it('listByTarget returns empty for unknown id', () => {
      const { deps } = setupDepPrereqs();
      expect(deps.listByTarget('nonexistent')).toHaveLength(0);
    });

    it('listBySource returns empty for unknown id', () => {
      const { deps } = setupDepPrereqs();
      expect(deps.listBySource('nonexistent')).toHaveLength(0);
    });

    it('resolve marks a dependency as resolved', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      deps.resolve('stage-2', 'stage-1');

      const list = deps.listByTarget('stage-2');
      expect(list[0].resolved).toBe(1);
    });

    it('allResolved returns true when no dependencies exist', () => {
      const { deps } = setupDepPrereqs();
      expect(deps.allResolved('stage-1')).toBe(true);
    });

    it('allResolved returns false when unresolved dependencies exist', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      expect(deps.allResolved('stage-2')).toBe(false);
    });

    it('allResolved returns true when all dependencies are resolved', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-3',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });
      deps.upsert({
        from_id: 'stage-3',
        to_id: 'stage-2',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      deps.resolve('stage-3', 'stage-1');
      deps.resolve('stage-3', 'stage-2');

      expect(deps.allResolved('stage-3')).toBe(true);
    });

    it('allResolved returns false when some dependencies are unresolved', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-3',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });
      deps.upsert({
        from_id: 'stage-3',
        to_id: 'stage-2',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      deps.resolve('stage-3', 'stage-1');
      // stage-3 -> stage-2 is still unresolved

      expect(deps.allResolved('stage-3')).toBe(false);
    });

    it('upsert updates existing dependency on same from_id + to_id', () => {
      const { deps, repoId } = setupDepPrereqs();

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'ticket',
        to_type: 'epic',
        repo_id: repoId,
      });

      const list = deps.listByTarget('stage-2');
      expect(list).toHaveLength(1);
      expect(list[0].from_type).toBe('ticket');
      expect(list[0].to_type).toBe('epic');
    });

    it('deleteByRepo clears all dependencies for a repo', () => {
      const { deps, repoId, repos } = setupDepPrereqs();

      // Add deps for repo
      deps.upsert({
        from_id: 'stage-2',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });
      deps.upsert({
        from_id: 'stage-3',
        to_id: 'stage-1',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId,
      });

      // Add dep for different repo
      const repoId2 = repos.upsert('/other/repo', 'other');
      deps.upsert({
        from_id: 'stage-4',
        to_id: 'stage-5',
        from_type: 'stage',
        to_type: 'stage',
        repo_id: repoId2,
      });

      deps.deleteByRepo(repoId);

      // First repo's deps are gone
      expect(deps.listByTarget('stage-2')).toHaveLength(0);
      expect(deps.listByTarget('stage-3')).toHaveLength(0);

      // Other repo's deps remain
      expect(deps.listByTarget('stage-4')).toHaveLength(1);
    });
  });
});
