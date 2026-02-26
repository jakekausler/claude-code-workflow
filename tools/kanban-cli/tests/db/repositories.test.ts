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
  SummaryRepository,
  CommentTrackingRepository,
} from '../../src/db/repositories/index.js';
import type {
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
  SummaryRow,
  MrCommentTrackingRow,
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

    it('findAll returns empty array when no repos exist', () => {
      const repos = new RepoRepository(db);
      expect(repos.findAll()).toEqual([]);
    });

    it('findAll returns all registered repos ordered by name', () => {
      const repos = new RepoRepository(db);
      repos.upsert('/repo/one', 'repo-one');
      repos.upsert('/repo/two', 'repo-two');
      repos.upsert('/repo/three', 'repo-three');
      const all = repos.findAll();
      expect(all).toHaveLength(3);
      const names = all.map((r) => r.name);
      expect(names).toEqual(['repo-one', 'repo-three', 'repo-two']);
    });

    it('findByName returns null when name not found', () => {
      const repos = new RepoRepository(db);
      expect(repos.findByName('nonexistent')).toBeNull();
    });

    it('findByName returns correct repo when name matches', () => {
      const repos = new RepoRepository(db);
      repos.upsert('/my/repo', 'my-repo');
      repos.upsert('/other/repo', 'other-repo');
      const found = repos.findByName('my-repo');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('my-repo');
      expect(found!.path).toBe('/my/repo');
    });

    it('findByName is case-sensitive', () => {
      const repos = new RepoRepository(db);
      repos.upsert('/my/repo', 'My-Repo');
      expect(repos.findByName('My-Repo')).not.toBeNull();
      expect(repos.findByName('my-repo')).toBeNull();
      expect(repos.findByName('MY-REPO')).toBeNull();
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
        pr_url: string | null;
        pr_number: number | null;
        priority: number;
        due_date: string | null;
        session_active: number;
        locked_at: string | null;
        locked_by: string | null;
        is_draft: number;
        pending_merge_parents: string | null;
        mr_target_branch: string | null;
        session_id: string | null;
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
        pr_url: null,
        pr_number: null,
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

    it('listByTicket with repoId filters by repo', () => {
      const repos = new RepoRepository(db);
      const epics = new EpicRepository(db);
      const tickets = new TicketRepository(db);
      const stages = new StageRepository(db);

      const repoId1 = insertRepo(repos, '/test/repo1', 'repo-1');
      const repoId2 = insertRepo(repos, '/test/repo2', 'repo-2');

      insertEpic(epics, repoId1, 'epic-1');
      insertEpic(epics, repoId2, 'epic-1');
      insertTicket(tickets, repoId1, 'epic-1', 'ticket-1');
      insertTicket(tickets, repoId2, 'epic-1', 'ticket-1');

      stages.upsert(makeStageData(repoId1, { id: 'stage-r1-1', ticket_id: 'ticket-1' }));
      stages.upsert(makeStageData(repoId1, { id: 'stage-r1-2', ticket_id: 'ticket-1' }));
      stages.upsert(makeStageData(repoId2, { id: 'stage-r2-1', ticket_id: 'ticket-1' }));

      // Without repoId: returns all 3
      expect(stages.listByTicket('ticket-1')).toHaveLength(3);

      // With repoId: scoped to each repo
      expect(stages.listByTicket('ticket-1', repoId1)).toHaveLength(2);
      expect(stages.listByTicket('ticket-1', repoId2)).toHaveLength(1);
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

    it('upsert with new fields persists is_draft, pending_merge_parents, mr_target_branch', () => {
      const { stages, repoId } = setupStagePrereqs();
      const parents = [
        { stage_id: 'stage-parent', branch: 'feature/parent', pr_url: 'https://github.com/pr/1', pr_number: 1 },
      ];

      stages.upsert(
        makeStageData(repoId, {
          id: 'stage-new-fields',
          is_draft: 1,
          pending_merge_parents: JSON.stringify(parents),
          mr_target_branch: 'develop',
        })
      );

      const found = stages.findById('stage-new-fields');
      expect(found).not.toBeNull();
      expect(found!.is_draft).toBe(1);
      expect(found!.mr_target_branch).toBe('develop');
      const parsed = JSON.parse(found!.pending_merge_parents!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].stage_id).toBe('stage-parent');
      expect(parsed[0].branch).toBe('feature/parent');
      expect(parsed[0].pr_url).toBe('https://github.com/pr/1');
      expect(parsed[0].pr_number).toBe(1);
    });

    it('upsert without new fields uses defaults (is_draft=0, pending_merge_parents=null, mr_target_branch=null)', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-defaults' }));

      const found = stages.findById('stage-defaults');
      expect(found).not.toBeNull();
      expect(found!.is_draft).toBe(0);
      expect(found!.pending_merge_parents).toBeNull();
      expect(found!.mr_target_branch).toBeNull();
    });

    it('findById returns new fields with correct types', () => {
      const { stages, repoId } = setupStagePrereqs();
      const parents = [
        { stage_id: 's1', branch: 'b1', pr_url: 'https://example.com/pr/10', pr_number: 10 },
        { stage_id: 's2', branch: 'b2', pr_url: 'https://example.com/pr/20', pr_number: 20 },
      ];

      stages.upsert(
        makeStageData(repoId, {
          id: 'stage-json',
          is_draft: 0,
          pending_merge_parents: JSON.stringify(parents),
          mr_target_branch: 'main',
        })
      );

      const found = stages.findById('stage-json');
      expect(found).not.toBeNull();
      expect(typeof found!.is_draft).toBe('number');
      expect(typeof found!.mr_target_branch).toBe('string');
      expect(typeof found!.pending_merge_parents).toBe('string');

      const parsed = JSON.parse(found!.pending_merge_parents!);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].stage_id).toBe('s1');
      expect(parsed[1].stage_id).toBe('s2');
    });

    it('updatePendingMergeParents updates correctly', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-pmp' }));

      // Initially null
      expect(stages.findById('stage-pmp')!.pending_merge_parents).toBeNull();

      // Set parents
      const parents = [
        { stage_id: 'parent-1', branch: 'feat/a', pr_url: 'https://example.com/pr/5', pr_number: 5 },
      ];
      stages.updatePendingMergeParents('stage-pmp', parents);

      const found = stages.findById('stage-pmp');
      expect(found!.pending_merge_parents).not.toBeNull();
      const parsed = JSON.parse(found!.pending_merge_parents!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].stage_id).toBe('parent-1');

      // Clear parents (empty array)
      stages.updatePendingMergeParents('stage-pmp', []);
      expect(stages.findById('stage-pmp')!.pending_merge_parents).toBeNull();
    });

    it('updateSessionId writes a session ID and findBySessionId reads it back', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-sess' }));

      // Initially null
      expect(stages.findById('stage-sess')!.session_id).toBeNull();

      // Set session ID
      stages.updateSessionId('stage-sess', 'session-abc-123');

      const found = stages.findById('stage-sess');
      expect(found!.session_id).toBe('session-abc-123');

      // Find by session ID
      const bySession = stages.findBySessionId('session-abc-123');
      expect(bySession).not.toBeNull();
      expect(bySession!.id).toBe('stage-sess');
    });

    it('findBySessionId returns null for unknown session ID', () => {
      const stages = new StageRepository(db);
      expect(stages.findBySessionId('nonexistent-session')).toBeNull();
    });

    it('updateSessionId with null clears the session_id', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-clear' }));
      stages.updateSessionId('stage-clear', 'session-to-clear');
      expect(stages.findById('stage-clear')!.session_id).toBe('session-to-clear');

      // Clear it
      stages.updateSessionId('stage-clear', null);
      expect(stages.findById('stage-clear')!.session_id).toBeNull();
      expect(stages.findBySessionId('session-to-clear')).toBeNull();
    });

    it('upsert preserves session_id when provided', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-preserve', session_id: 'sess-xyz' }));
      expect(stages.findById('stage-preserve')!.session_id).toBe('sess-xyz');

      // Re-upsert with session_id still set
      stages.upsert(makeStageData(repoId, { id: 'stage-preserve', title: 'Updated', session_id: 'sess-xyz' }));
      const found = stages.findById('stage-preserve');
      expect(found!.title).toBe('Updated');
      expect(found!.session_id).toBe('sess-xyz');
    });

    it('upsert without session_id defaults to null', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(makeStageData(repoId, { id: 'stage-no-sess' }));
      expect(stages.findById('stage-no-sess')!.session_id).toBeNull();
    });

    it('list methods return new fields on StageRow', () => {
      const { stages, repoId } = setupStagePrereqs();

      stages.upsert(
        makeStageData(repoId, {
          id: 'stage-list',
          is_draft: 1,
          mr_target_branch: 'release/1.0',
          pending_merge_parents: JSON.stringify([{ stage_id: 'p1', branch: 'b', pr_url: 'u', pr_number: 1 }]),
        })
      );

      const byRepo = stages.listByRepo(repoId);
      expect(byRepo).toHaveLength(1);
      expect(byRepo[0].is_draft).toBe(1);
      expect(byRepo[0].mr_target_branch).toBe('release/1.0');
      expect(byRepo[0].pending_merge_parents).not.toBeNull();

      const byTicket = stages.listByTicket('ticket-1');
      expect(byTicket).toHaveLength(1);
      expect(byTicket[0].is_draft).toBe(1);

      const byColumn = stages.listByColumn(repoId, 'ready_for_work');
      expect(byColumn).toHaveLength(1);
      expect(byColumn[0].mr_target_branch).toBe('release/1.0');
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

  // ─── SummaryRepository ─────────────────────────────────────────

  describe('SummaryRepository', () => {
    function setupSummaryPrereqs() {
      const repos = new RepoRepository(db);
      const summaries = new SummaryRepository(db);
      const repoId = insertRepo(repos);
      return { repos, summaries, repoId };
    }

    it('upserts a summary and finds it by item', () => {
      const { summaries, repoId } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'abc123',
        model: 'haiku',
        summary: 'This stage implemented login form UI.',
        repo_id: repoId,
      });

      const found = summaries.findByItem('STAGE-001-001-001', 'stage', repoId);
      expect(found).not.toBeNull();
      expect(found!.item_id).toBe('STAGE-001-001-001');
      expect(found!.item_type).toBe('stage');
      expect(found!.content_hash).toBe('abc123');
      expect(found!.model).toBe('haiku');
      expect(found!.summary).toBe('This stage implemented login form UI.');
      expect(found!.created_at).toBeTruthy();
    });

    it('findByItem returns null for unknown item', () => {
      const { summaries, repoId } = setupSummaryPrereqs();
      expect(summaries.findByItem('nonexistent', 'stage', repoId)).toBeNull();
    });

    it('upsert replaces existing summary on same item_id + item_type + repo_id', () => {
      const { summaries, repoId } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'abc123',
        model: 'haiku',
        summary: 'Old summary.',
        repo_id: repoId,
      });

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'def456',
        model: 'sonnet',
        summary: 'New summary.',
        repo_id: repoId,
      });

      const found = summaries.findByItem('STAGE-001-001-001', 'stage', repoId);
      expect(found!.content_hash).toBe('def456');
      expect(found!.model).toBe('sonnet');
      expect(found!.summary).toBe('New summary.');
      expect(summaries.listByRepo(repoId)).toHaveLength(1);
    });

    it('listByRepo returns all summaries for a repo', () => {
      const { summaries, repoId } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'abc',
        model: 'haiku',
        summary: 'Stage summary.',
        repo_id: repoId,
      });
      summaries.upsert({
        item_id: 'TICKET-001-001',
        item_type: 'ticket',
        content_hash: 'def',
        model: 'haiku',
        summary: 'Ticket summary.',
        repo_id: repoId,
      });

      expect(summaries.listByRepo(repoId)).toHaveLength(2);
    });

    it('listByRepo returns empty array for repo with no summaries', () => {
      const { summaries, repoId } = setupSummaryPrereqs();
      expect(summaries.listByRepo(repoId)).toHaveLength(0);
    });

    it('deleteByRepo clears all summaries for a repo but not others', () => {
      const { summaries, repoId, repos } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'abc',
        model: 'haiku',
        summary: 'Summary 1.',
        repo_id: repoId,
      });

      const repoId2 = repos.upsert('/other/repo', 'other');
      summaries.upsert({
        item_id: 'STAGE-002-001-001',
        item_type: 'stage',
        content_hash: 'xyz',
        model: 'haiku',
        summary: 'Summary 2.',
        repo_id: repoId2,
      });

      summaries.deleteByRepo(repoId);

      expect(summaries.listByRepo(repoId)).toHaveLength(0);
      expect(summaries.listByRepo(repoId2)).toHaveLength(1);
    });

    it('deleteByItem removes a specific summary', () => {
      const { summaries, repoId } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'STAGE-001-001-001',
        item_type: 'stage',
        content_hash: 'abc',
        model: 'haiku',
        summary: 'Summary.',
        repo_id: repoId,
      });
      summaries.upsert({
        item_id: 'TICKET-001-001',
        item_type: 'ticket',
        content_hash: 'def',
        model: 'haiku',
        summary: 'Ticket summary.',
        repo_id: repoId,
      });

      summaries.deleteByItem('STAGE-001-001-001', 'stage', repoId);

      expect(summaries.findByItem('STAGE-001-001-001', 'stage', repoId)).toBeNull();
      expect(summaries.findByItem('TICKET-001-001', 'ticket', repoId)).not.toBeNull();
    });

    it('distinguishes between different item types with same item_id', () => {
      const { summaries, repoId } = setupSummaryPrereqs();

      summaries.upsert({
        item_id: 'ID-001',
        item_type: 'stage',
        content_hash: 'abc',
        model: 'haiku',
        summary: 'Stage summary.',
        repo_id: repoId,
      });
      summaries.upsert({
        item_id: 'ID-001',
        item_type: 'ticket',
        content_hash: 'def',
        model: 'haiku',
        summary: 'Ticket summary.',
        repo_id: repoId,
      });

      const stageSummary = summaries.findByItem('ID-001', 'stage', repoId);
      const ticketSummary = summaries.findByItem('ID-001', 'ticket', repoId);
      expect(stageSummary!.summary).toBe('Stage summary.');
      expect(ticketSummary!.summary).toBe('Ticket summary.');
      expect(summaries.listByRepo(repoId)).toHaveLength(2);
    });
  });

  // ─── CommentTrackingRepository ──────────────────────────────────

  describe('CommentTrackingRepository', () => {
    function setupCommentTrackingPrereqs() {
      const repos = new RepoRepository(db);
      const tracking = new CommentTrackingRepository(db);
      const repoId = insertRepo(repos);
      return { repos, tracking, repoId };
    }

    it('getCommentTracking returns null for unknown stage', () => {
      const { tracking } = setupCommentTrackingPrereqs();
      expect(tracking.getCommentTracking('nonexistent-stage')).toBeNull();
    });

    it('upsertCommentTracking creates a new row', () => {
      const { tracking, repoId } = setupCommentTrackingPrereqs();

      tracking.upsertCommentTracking({
        stageId: 'stage-1',
        timestamp: '2026-02-24T10:00:00Z',
        count: 3,
        repoId,
      });

      const found = tracking.getCommentTracking('stage-1');
      expect(found).not.toBeNull();
      expect(found!.stage_id).toBe('stage-1');
      expect(found!.last_poll_timestamp).toBe('2026-02-24T10:00:00Z');
      expect(found!.last_known_unresolved_count).toBe(3);
      expect(found!.repo_id).toBe(repoId);
    });

    it('upsertCommentTracking updates an existing row', () => {
      const { tracking, repoId } = setupCommentTrackingPrereqs();

      tracking.upsertCommentTracking({
        stageId: 'stage-1',
        timestamp: '2026-02-24T10:00:00Z',
        count: 3,
        repoId,
      });
      tracking.upsertCommentTracking({
        stageId: 'stage-1',
        timestamp: '2026-02-24T11:00:00Z',
        count: 1,
        repoId,
      });

      const found = tracking.getCommentTracking('stage-1');
      expect(found).not.toBeNull();
      expect(found!.last_poll_timestamp).toBe('2026-02-24T11:00:00Z');
      expect(found!.last_known_unresolved_count).toBe(1);
    });

    it('getCommentTracking returns stored data across multiple inserts', () => {
      const { tracking, repoId } = setupCommentTrackingPrereqs();

      tracking.upsertCommentTracking({
        stageId: 'stage-abc',
        timestamp: '2026-01-15T08:30:00Z',
        count: 5,
        repoId,
      });
      tracking.upsertCommentTracking({
        stageId: 'stage-xyz',
        timestamp: '2026-03-01T16:45:00Z',
        count: 12,
        repoId,
      });

      const first = tracking.getCommentTracking('stage-abc');
      const second = tracking.getCommentTracking('stage-xyz');
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      // Verify each row retains its own distinct values
      expect(first!.last_poll_timestamp).toBe('2026-01-15T08:30:00Z');
      expect(first!.last_known_unresolved_count).toBe(5);
      expect(second!.last_poll_timestamp).toBe('2026-03-01T16:45:00Z');
      expect(second!.last_known_unresolved_count).toBe(12);
      // Confirm stage_id and repo_id are correct on each
      expect(first!.stage_id).toBe('stage-abc');
      expect(second!.stage_id).toBe('stage-xyz');
      expect(first!.repo_id).toBe(repoId);
      expect(second!.repo_id).toBe(repoId);
    });

    it('upsertCommentTracking with zero count stores correctly', () => {
      const { tracking, repoId } = setupCommentTrackingPrereqs();

      tracking.upsertCommentTracking({
        stageId: 'stage-zero',
        timestamp: '2026-02-24T12:00:00Z',
        count: 0,
        repoId,
      });

      const found = tracking.getCommentTracking('stage-zero');
      expect(found).not.toBeNull();
      expect(found!.last_known_unresolved_count).toBe(0);
    });

    it('tracks multiple stages independently', () => {
      const { tracking, repoId } = setupCommentTrackingPrereqs();

      tracking.upsertCommentTracking({
        stageId: 'stage-a',
        timestamp: '2026-02-24T10:00:00Z',
        count: 2,
        repoId,
      });
      tracking.upsertCommentTracking({
        stageId: 'stage-b',
        timestamp: '2026-02-24T11:00:00Z',
        count: 7,
        repoId,
      });

      const foundA = tracking.getCommentTracking('stage-a');
      const foundB = tracking.getCommentTracking('stage-b');

      expect(foundA!.last_known_unresolved_count).toBe(2);
      expect(foundB!.last_known_unresolved_count).toBe(7);
    });
  });
});
