import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import { syncRepo, type SyncResult } from '../../src/sync/sync.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { EpicRepository } from '../../src/db/repositories/epic-repository.js';
import { TicketRepository } from '../../src/db/repositories/ticket-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
    ],
  },
};

describe('syncRepo', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-sync-test-' + Date.now());
  const repoDir = path.join(tmpDir, 'repo');
  const epicsDir = path.join(repoDir, 'epics', 'auth');
  let db: KanbanDatabase;
  let dbPath: string;

  beforeEach(() => {
    fs.mkdirSync(epicsDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEpic(id: string, title: string): void {
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
title: ${title}
status: In Progress
jira_key: null
tickets:
  - TICKET-001-001
depends_on: []
---

# ${title}
`
    );
  }

  function writeTicket(id: string, epicId: string, title: string): void {
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
epic: ${epicId}
title: ${title}
status: In Progress
jira_key: null
source: local
stages:
  - STAGE-001-001-001
depends_on: []
---

# ${title}
`
    );
  }

  function writeStage(
    id: string,
    ticketId: string,
    epicId: string,
    title: string,
    status: string,
    deps: string[] = []
  ): void {
    const depsYaml = deps.length > 0
      ? deps.map((d) => `  - ${d}`).join('\n')
      : '[]';
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
      `---
id: ${id}
ticket: ${ticketId}
epic: ${epicId}
title: ${title}
status: ${status}
session_active: false
refinement_type:
  - frontend
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
worktree_branch: null
priority: 0
due_date: null
---

# ${title}
`
    );
  }

  it('syncs epics, tickets, and stages to the database', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    const result = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result.epics).toBe(1);
    expect(result.tickets).toBe(1);
    expect(result.stages).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('populates the repos table', () => {
    writeEpic('EPIC-001', 'Auth');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const repos = new RepoRepository(db);
    const repo = repos.findByPath(repoDir);
    expect(repo).not.toBeNull();
    expect(repo!.name).toBe('repo');
  });

  it('populates epic data correctly', () => {
    writeEpic('EPIC-001', 'Auth');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const epics = new EpicRepository(db);
    const epic = epics.findById('EPIC-001');
    expect(epic).not.toBeNull();
    expect(epic!.title).toBe('Auth');
    expect(epic!.status).toBe('In Progress');
  });

  it('populates ticket data correctly', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const tickets = new TicketRepository(db);
    const ticket = tickets.findById('TICKET-001-001');
    expect(ticket).not.toBeNull();
    expect(ticket!.title).toBe('Login');
    expect(ticket!.source).toBe('local');
  });

  it('computes kanban_column for stages in pipeline statuses', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('design');
  });

  it('computes kanban_column as ready_for_work for Not Started status', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Not Started');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('ready_for_work');
  });

  it('computes kanban_column as done for Complete status', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Complete');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('done');
  });

  it('computes kanban_column as backlog for stages with unresolved deps', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Build'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const blocked = stages.findById('STAGE-001-001-001');
    // STAGE-001-001-002 is not Complete, so the dependency is unresolved
    expect(blocked!.kanban_column).toBe('backlog');
  });

  it('resolves deps when dependency stage is Complete', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Complete'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const resolved = stages.findById('STAGE-001-001-001');
    expect(resolved!.kanban_column).toBe('design');

    const deps = new DependencyRepository(db);
    expect(deps.allResolved('STAGE-001-001-001')).toBe(true);
  });

  it('creates dependency records', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage(
      'STAGE-001-001-001',
      'TICKET-001-001',
      'EPIC-001',
      'Login Form',
      'Design',
      ['STAGE-001-001-002']
    );
    writeStage(
      'STAGE-001-001-002',
      'TICKET-001-001',
      'EPIC-001',
      'Login API',
      'Build'
    );

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const deps = new DependencyRepository(db);
    const depList = deps.listByTarget('STAGE-001-001-001');
    expect(depList).toHaveLength(1);
    expect(depList[0].to_id).toBe('STAGE-001-001-002');
  });

  it('collects errors for malformed files without stopping sync', () => {
    writeEpic('EPIC-001', 'Auth');
    // Write a bad stage file (missing required fields)
    fs.writeFileSync(
      path.join(epicsDir, 'STAGE-BAD-001.md'),
      `---
id: STAGE-BAD-001
---

# Bad stage
`
    );

    const result = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result.epics).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('STAGE-BAD-001');
  });

  it('is idempotent — running sync twice produces the same data', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    syncRepo({ repoPath: repoDir, db, config: testConfig });
    const result2 = syncRepo({ repoPath: repoDir, db, config: testConfig });

    expect(result2.epics).toBe(1);
    expect(result2.tickets).toBe(1);
    expect(result2.stages).toBe(1);

    const stages = new StageRepository(db);
    const allStages = stages.listByRepo(
      new RepoRepository(db).findByPath(repoDir)!.id
    );
    expect(allStages).toHaveLength(1);
  });

  it('returns empty counts when no files exist', () => {
    const emptyRepo = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(emptyRepo, { recursive: true });

    const result = syncRepo({ repoPath: emptyRepo, db, config: testConfig });

    expect(result.epics).toBe(0);
    expect(result.tickets).toBe(0);
    expect(result.stages).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  describe('cross-repo dependencies', () => {
    const targetRepoDir = path.join(tmpDir, 'backend');
    const targetEpicsDir = path.join(targetRepoDir, 'epics', 'api');

    function writeTargetEpic(id: string, title: string): void {
      fs.writeFileSync(
        path.join(targetEpicsDir, `${id}.md`),
        `---
id: ${id}
title: ${title}
status: In Progress
jira_key: null
tickets:
  - TICKET-002-001
depends_on: []
---

# ${title}
`
      );
    }

    function writeTargetTicket(id: string, epicId: string, title: string): void {
      fs.writeFileSync(
        path.join(targetEpicsDir, `${id}.md`),
        `---
id: ${id}
epic: ${epicId}
title: ${title}
status: In Progress
jira_key: null
source: local
stages:
  - STAGE-002-001-001
depends_on: []
---

# ${title}
`
      );
    }

    function writeTargetStage(
      id: string,
      ticketId: string,
      epicId: string,
      title: string,
      status: string,
      deps: string[] = []
    ): void {
      const depsYaml = deps.length > 0
        ? deps.map((d) => `  - ${d}`).join('\n')
        : '[]';
      fs.writeFileSync(
        path.join(targetEpicsDir, `${id}.md`),
        `---
id: ${id}
ticket: ${ticketId}
epic: ${epicId}
title: ${title}
status: ${status}
session_active: false
refinement_type:
  - backend
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
worktree_branch: null
priority: 0
due_date: null
---

# ${title}
`
      );
    }

    beforeEach(() => {
      fs.mkdirSync(targetEpicsDir, { recursive: true });
    });

    it('local deps continue working unchanged (regression)', () => {
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['STAGE-001-001-002']
      );
      writeStage(
        'STAGE-001-001-002',
        'TICKET-001-001',
        'EPIC-001',
        'Login API',
        'Complete'
      );

      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].to_id).toBe('STAGE-001-001-002');
      expect(deps[0].target_repo_name).toBeNull();
      expect(deps[0].resolved).toBe(1);

      const stageRepo = new StageRepository(db);
      const stage = stageRepo.findById('STAGE-001-001-001');
      expect(stage!.kanban_column).toBe('design');
    });

    it('stores cross-repo dep with target_repo_name set', () => {
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/STAGE-002-001-001']
      );

      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].to_id).toBe('STAGE-002-001-001');
      expect(deps[0].target_repo_name).toBe('backend');
    });

    it('resolves cross-repo dep when target repo is synced and item is Complete', () => {
      // Sync the target repo first with a Complete stage
      writeTargetEpic('EPIC-002', 'API');
      writeTargetTicket('TICKET-002-001', 'EPIC-002', 'Endpoints');
      writeTargetStage(
        'STAGE-002-001-001',
        'TICKET-002-001',
        'EPIC-002',
        'REST API',
        'Complete'
      );
      syncRepo({ repoPath: targetRepoDir, db, config: testConfig });

      // Sync the current repo with a cross-repo dep on the target stage
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/STAGE-002-001-001']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].resolved).toBe(1);

      const stageRepo = new StageRepository(db);
      const stage = stageRepo.findById('STAGE-001-001-001');
      expect(stage!.kanban_column).toBe('design');
    });

    it('cross-repo dep stays unresolved when target repo not in DB', () => {
      // Don't sync the target repo — it doesn't exist in DB yet
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/STAGE-002-001-001']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].resolved).toBe(0);

      const stageRepo = new StageRepository(db);
      const stage = stageRepo.findById('STAGE-001-001-001');
      expect(stage!.kanban_column).toBe('backlog');
    });

    it('cross-repo dep stays unresolved when target item is not Complete', () => {
      // Sync the target repo with a non-Complete stage
      writeTargetEpic('EPIC-002', 'API');
      writeTargetTicket('TICKET-002-001', 'EPIC-002', 'Endpoints');
      writeTargetStage(
        'STAGE-002-001-001',
        'TICKET-002-001',
        'EPIC-002',
        'REST API',
        'Build'
      );
      syncRepo({ repoPath: targetRepoDir, db, config: testConfig });

      // Sync the current repo with a cross-repo dep on the incomplete target
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/STAGE-002-001-001']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].resolved).toBe(0);

      const stageRepo = new StageRepository(db);
      const stage = stageRepo.findById('STAGE-001-001-001');
      expect(stage!.kanban_column).toBe('backlog');
    });

    it('cross-repo stage dep soft-resolves with PR Created status', () => {
      // Sync the target repo with a stage in "PR Created" status
      writeTargetEpic('EPIC-002', 'API');
      writeTargetTicket('TICKET-002-001', 'EPIC-002', 'Endpoints');
      writeTargetStage(
        'STAGE-002-001-001',
        'TICKET-002-001',
        'EPIC-002',
        'REST API',
        'PR Created'
      );
      syncRepo({ repoPath: targetRepoDir, db, config: testConfig });

      // Sync the current repo with a cross-repo dep on the soft-resolved target
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/STAGE-002-001-001']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      // Hard-resolution should be false (not Complete)
      expect(deps[0].resolved).toBe(0);

      // But soft-or-hard-resolution should unblock the kanban column
      const stageRepo = new StageRepository(db);
      const stage = stageRepo.findById('STAGE-001-001-001');
      expect(stage!.kanban_column).toBe('design');
    });

    it('cross-repo ticket dep resolves when all target stages are Complete', () => {
      // Sync the target repo with all stages Complete
      writeTargetEpic('EPIC-002', 'API');
      writeTargetTicket('TICKET-002-001', 'EPIC-002', 'Endpoints');
      writeTargetStage(
        'STAGE-002-001-001',
        'TICKET-002-001',
        'EPIC-002',
        'REST API',
        'Complete'
      );
      syncRepo({ repoPath: targetRepoDir, db, config: testConfig });

      // Sync the current repo with a cross-repo ticket dep
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/TICKET-002-001']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].to_id).toBe('TICKET-002-001');
      expect(deps[0].target_repo_name).toBe('backend');
      expect(deps[0].resolved).toBe(1);
    });

    it('cross-repo epic dep resolves when all target tickets/stages are Complete', () => {
      // Sync the target repo with all stages Complete
      writeTargetEpic('EPIC-002', 'API');
      writeTargetTicket('TICKET-002-001', 'EPIC-002', 'Endpoints');
      writeTargetStage(
        'STAGE-002-001-001',
        'TICKET-002-001',
        'EPIC-002',
        'REST API',
        'Complete'
      );
      syncRepo({ repoPath: targetRepoDir, db, config: testConfig });

      // Sync the current repo with a cross-repo epic dep
      writeEpic('EPIC-001', 'Auth');
      writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
      writeStage(
        'STAGE-001-001-001',
        'TICKET-001-001',
        'EPIC-001',
        'Login Form',
        'Design',
        ['backend/EPIC-002']
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const depRepo = new DependencyRepository(db);
      const deps = depRepo.listByTarget('STAGE-001-001-001');
      expect(deps).toHaveLength(1);
      expect(deps[0].to_id).toBe('EPIC-002');
      expect(deps[0].target_repo_name).toBe('backend');
      expect(deps[0].resolved).toBe(1);
    });
  });
});
