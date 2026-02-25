import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import { createRegistry } from '../../src/repos/registry.js';
import { createMultiRepoHelper } from '../../src/repos/multi-repo.js';
import { syncRepo } from '../../src/sync/sync.js';
import { loadConfig } from '../../src/config/loader.js';
import { buildBoard } from '../../src/cli/logic/board.js';
import { buildNext } from '../../src/cli/logic/next.js';
import { buildGraph } from '../../src/cli/logic/graph.js';
import { validateWorkItems } from '../../src/cli/logic/validate.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { EpicRepository } from '../../src/db/repositories/epic-repository.js';
import { TicketRepository } from '../../src/db/repositories/ticket-repository.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';
import { StateMachine } from '../../src/engine/state-machine.js';

// Test fixtures
let tmpDir: string;
let repoAPath: string;
let repoBPath: string;
let registryPath: string;
let dbPath: string;
let db: KanbanDatabase;

const pipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Finalize'] },
      { name: 'Finalize', skill: 'phase-finalize', status: 'Finalize', transitions_to: ['PR Created', 'Done'] },
      { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
      { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
    ],
  },
};

/**
 * Create a temporary directory structure for a repo
 */
function createRepoStructure(repoPath: string, repoName: string): void {
  const epicsDir = path.join(repoPath, 'epics');
  fs.mkdirSync(epicsDir, { recursive: true });

  // Create config file
  const configContent = `workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to:
        - Build
    - name: Build
      skill: phase-build
      status: Build
      transitions_to:
        - Finalize
    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to:
        - PR Created
        - Done
    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to:
        - Done
        - Addressing Comments
    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to:
        - PR Created
`;

  fs.writeFileSync(path.join(repoPath, '.kanban-workflow.yaml'), configContent);

  // Initialize git repo (required by sync)
  try {
    require('child_process').execSync('git init -q && git commit -q --allow-empty -m "init"', { cwd: repoPath });
  } catch {
    // Ignore if git is not available
  }
}

/**
 * Create an epic file
 */
function createEpic(repoPath: string, epicId: string, title: string, status: string, dependencies: string[] = []): string {
  const epicDir = path.join(repoPath, 'epics', `${epicId}-${title.toLowerCase().replace(/ /g, '-')}`);
  fs.mkdirSync(epicDir, { recursive: true });

  const content = `---
id: ${epicId}
title: ${title}
status: ${status}
tickets: []
depends_on: ${JSON.stringify(dependencies)}
---
## Overview
${title} epic description.
`;

  const filePath = path.join(epicDir, `${epicId}.md`);
  fs.writeFileSync(filePath, content);
  return epicDir;
}

/**
 * Create a ticket file
 */
function createTicket(
  epicDir: string,
  ticketId: string,
  title: string,
  status: string,
  epicId: string,
  stageIds: string[] = [],
  dependencies: string[] = [],
): string {
  const ticketDir = path.join(epicDir, `${ticketId}-${title.toLowerCase().replace(/ /g, '-')}`);
  fs.mkdirSync(ticketDir, { recursive: true });

  const content = `---
id: ${ticketId}
epic: ${epicId}
title: ${title}
status: ${status}
source: local
stages: ${JSON.stringify(stageIds)}
depends_on: ${JSON.stringify(dependencies)}
---
## Overview
${title} ticket description.
`;

  const filePath = path.join(ticketDir, `${ticketId}.md`);
  fs.writeFileSync(filePath, content);
  return ticketDir;
}

/**
 * Create a stage file
 */
function createStage(
  ticketDir: string,
  stageId: string,
  title: string,
  status: string,
  ticketId: string,
  epicId: string,
  dependencies: string[] = [],
): string {
  const content = `---
id: ${stageId}
ticket: ${ticketId}
epic: ${epicId}
title: ${title}
status: ${status}
session_active: false
refinement_type:
  - frontend
depends_on: ${JSON.stringify(dependencies)}
priority: 0
---
## Overview
${title} stage description.
`;

  const filePath = path.join(ticketDir, `${stageId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('multi-repo integration', () => {
  beforeEach(() => {
    // Create temp directories
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-multi-repo-test-'));
    repoAPath = path.join(tmpDir, 'repo-a');
    repoBPath = path.join(tmpDir, 'repo-b');
    registryPath = path.join(tmpDir, 'repos.yaml');
    dbPath = path.join(tmpDir, 'kanban.db');

    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);

    // Create database
    db = new KanbanDatabase(dbPath);

    // Setup repo A: Auth system with 1 epic, 1 ticket, 1 stage
    createRepoStructure(repoAPath, 'repo-a');
    const epicADir = createEpic(repoAPath, 'EPIC-001', 'Auth System', 'Design');
    const ticketADir = createTicket(epicADir, 'TICKET-001-001', 'Login Feature', 'Design', 'EPIC-001', ['STAGE-001-001-001']);
    createStage(ticketADir, 'STAGE-001-001-001', 'Login Form UI', 'Design', 'TICKET-001-001', 'EPIC-001');

    // Setup repo B: API system with 1 epic, 1 ticket, 1 stage that depends on repo A stage
    createRepoStructure(repoBPath, 'repo-b');
    const epicBDir = createEpic(repoBPath, 'EPIC-002', 'API Endpoints', 'Design');
    const ticketBDir = createTicket(epicBDir, 'TICKET-002-001', 'User Endpoints', 'Design', 'EPIC-002', ['STAGE-002-001-001']);
    // Cross-repo dependency: repo B's stage depends on repo A's stage (format: repoName/itemId)
    createStage(ticketBDir, 'STAGE-002-001-001', 'GET /users endpoint', 'Design', 'TICKET-002-001', 'EPIC-002', ['repo-a/STAGE-001-001-001']);

    // Register both repos
    const registry = createRegistry({
      registryPath,
      readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
      writeFile: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
      existsSync: (p: string) => fs.existsSync(p),
      mkdirSync: (p: string, opts?: { recursive: boolean }) => fs.mkdirSync(p, opts),
    });

    registry.registerRepo({ path: repoAPath, name: 'repo-a' });
    registry.registerRepo({ path: repoBPath, name: 'repo-b' });
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('registers and syncs two repos successfully', () => {
    const configA = loadConfig({ repoPath: repoAPath });
    const resultA = syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    const resultB = syncRepo({ repoPath: repoBPath, db, config: configB });

    // Verify sync results
    expect(resultA.epics).toBe(1);
    expect(resultA.tickets).toBe(1);
    expect(resultA.stages).toBe(1);
    expect(resultA.errors).toEqual([]);

    expect(resultB.epics).toBe(1);
    expect(resultB.tickets).toBe(1);
    expect(resultB.stages).toBe(1);
    expect(resultB.errors).toEqual([]);

    // Verify repos are in database
    const repoRepo = new RepoRepository(db);
    const repoA = repoRepo.findByPath(repoAPath);
    const repoB = repoRepo.findByPath(repoBPath);

    expect(repoA).not.toBeNull();
    expect(repoB).not.toBeNull();
    expect(repoA!.name).toBe('repo-a');
    expect(repoB!.name).toBe('repo-b');
  });

  it('global board shows stages from both repos', () => {
    // Sync both repos
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query data
    const repoRepo = new RepoRepository(db);
    const epicRepo = new EpicRepository(db);
    const ticketRepo = new TicketRepository(db);
    const stageRepo = new StageRepository(db);
    const depRepo = new DependencyRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Aggregate data from both repos
    const epics = [
      ...epicRepo.listByRepo(repoA.id).map((e) => ({ ...e, repo: 'repo-a' })),
      ...epicRepo.listByRepo(repoB.id).map((e) => ({ ...e, repo: 'repo-b' })),
    ];
    const tickets = [
      ...ticketRepo.listByRepo(repoA.id).map((t) => ({ ...t, repo: 'repo-a' })),
      ...ticketRepo.listByRepo(repoB.id).map((t) => ({ ...t, repo: 'repo-b' })),
    ];
    const stages = [
      ...stageRepo.listByRepo(repoA.id).map((s) => ({ ...s, repo: 'repo-a' })),
      ...stageRepo.listByRepo(repoB.id).map((s) => ({ ...s, repo: 'repo-b' })),
    ];
    const deps = [
      ...depRepo.listByRepo(repoA.id).map((d) => ({ ...d, repo: 'repo-a' })),
      ...depRepo.listByRepo(repoB.id).map((d) => ({ ...d, repo: 'repo-b' })),
    ];

    // Build global board
    const board = buildBoard({
      config: pipelineConfig,
      repoPath: 'global',
      epics: [],
      tickets,
      stages,
      dependencies: deps,
      global: true,
      repos: ['repo-a', 'repo-b'],
    });

    // Verify both repos' stages appear
    const allStages = Object.values(board.columns).flat().filter((item) => item.type === 'stage');
    expect(allStages).toHaveLength(2);

    const stageIds = allStages.map((s) => s.id);
    expect(stageIds).toContain('STAGE-001-001-001');
    expect(stageIds).toContain('STAGE-002-001-001');

    // Verify repo field is set
    const stageA = allStages.find((s) => s.id === 'STAGE-001-001-001') as any;
    const stageB = allStages.find((s) => s.id === 'STAGE-002-001-001') as any;
    expect(stageA.repo).toBe('repo-a');
    expect(stageB.repo).toBe('repo-b');

    // Verify global metadata
    expect(board.repos).toEqual(['repo-a', 'repo-b']);
  });

  it('global next excludes cross-repo blocked stages', () => {
    // Sync both repos
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query data
    const repoRepo = new RepoRepository(db);
    const stageRepo = new StageRepository(db);
    const ticketRepo = new TicketRepository(db);
    const depRepo = new DependencyRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Get stages and dependencies
    const stages = [
      ...stageRepo.listByRepo(repoA.id).map((s) => ({ ...s, repo: 'repo-a' })),
      ...stageRepo.listByRepo(repoB.id).map((s) => ({ ...s, repo: 'repo-b' })),
    ];

    const tickets = [
      ...ticketRepo.listByRepo(repoA.id),
      ...ticketRepo.listByRepo(repoB.id),
    ];

    const deps = [
      ...depRepo.listByRepo(repoA.id).map((d) => ({ ...d, repo: 'repo-a' })),
      ...depRepo.listByRepo(repoB.id).map((d) => ({ ...d, repo: 'repo-b' })),
    ];

    // Build next (repo B's stage should be blocked by unresolved dep on repo A's stage)
    const next = buildNext({
      config: pipelineConfig,
      stages,
      dependencies: deps,
      tickets,
      max: 10,
    });

    // Repo A's stage (STAGE-001-001-001) should be ready (no unresolved deps)
    // Repo B's stage (STAGE-002-001-001) should be blocked
    expect(next.ready_stages.map((s) => s.id)).toContain('STAGE-001-001-001');
    expect(next.ready_stages.map((s) => s.id)).not.toContain('STAGE-002-001-001');
    expect(next.blocked_count).toBeGreaterThan(0);
  });

  it('global reflects cross-repo dependency resolution', () => {
    // Sync both repos
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query data
    const repoRepo = new RepoRepository(db);
    const depRepo = new DependencyRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Get initial state
    const depsBefore = [
      ...depRepo.listByRepo(repoA.id),
      ...depRepo.listByRepo(repoB.id),
    ];

    // Verify cross-repo dependency exists and is unresolved initially
    const crossRepoDepBefore = depsBefore.find(
      (d) => d.from_id === 'STAGE-002-001-001' && d.to_id === 'STAGE-001-001-001',
    );
    expect(crossRepoDepBefore).toBeDefined();
    expect(!crossRepoDepBefore?.resolved).toBe(true); // resolved is 0 (falsy)

    // Now mark it as resolved by updating the dependency
    db.raw().prepare(`
      UPDATE dependencies
      SET resolved = 1
      WHERE from_id = ? AND to_id = ?
    `).run('STAGE-002-001-001', 'STAGE-001-001-001');

    // Query updated data
    const depsAfter = [
      ...depRepo.listByRepo(repoA.id),
      ...depRepo.listByRepo(repoB.id),
    ];

    // Verify dependency is now resolved in database
    const crossRepoDepAfter = depsAfter.find(
      (d) => d.from_id === 'STAGE-002-001-001' && d.to_id === 'STAGE-001-001-001',
    );
    expect(crossRepoDepAfter?.resolved).toBeTruthy();

    // Verify both repos have accessible data
    expect(depsAfter.length).toBeGreaterThan(0);
    expect(depsAfter.some((d) => d.from_id === 'STAGE-002-001-001')).toBe(true);
  });

  it('global graph includes cross-repo edges', () => {
    // Sync both repos
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query data
    const repoRepo = new RepoRepository(db);
    const epicRepo = new EpicRepository(db);
    const ticketRepo = new TicketRepository(db);
    const stageRepo = new StageRepository(db);
    const depRepo = new DependencyRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Aggregate data with repo field
    const epics = [
      ...epicRepo.listByRepo(repoA.id).map((e) => ({ ...e, repo: 'repo-a' })),
      ...epicRepo.listByRepo(repoB.id).map((e) => ({ ...e, repo: 'repo-b' })),
    ];
    const tickets = [
      ...ticketRepo.listByRepo(repoA.id).map((t) => ({ ...t, repo: 'repo-a' })),
      ...ticketRepo.listByRepo(repoB.id).map((t) => ({ ...t, repo: 'repo-b' })),
    ];
    const stages = [
      ...stageRepo.listByRepo(repoA.id).map((s) => ({ ...s, repo: 'repo-a' })),
      ...stageRepo.listByRepo(repoB.id).map((s) => ({ ...s, repo: 'repo-b' })),
    ];
    const deps = [
      ...depRepo.listByRepo(repoA.id).map((d) => ({ ...d, repo: 'repo-a' })),
      ...depRepo.listByRepo(repoB.id).map((d) => ({ ...d, repo: 'repo-b' })),
    ];

    // Build graph
    const graph = buildGraph({
      epics,
      tickets,
      stages,
      dependencies: deps,
      global: true,
      repos: ['repo-a', 'repo-b'],
    });

    // Verify nodes from both repos
    expect(graph.nodes).toHaveLength(6); // 2 epics + 2 tickets + 2 stages

    const epicsInGraph = graph.nodes.filter((n) => n.type === 'epic');
    expect(epicsInGraph.some((e) => e.repo === 'repo-a')).toBe(true);
    expect(epicsInGraph.some((e) => e.repo === 'repo-b')).toBe(true);

    // Verify cross-repo edge exists (from B's stage to A's stage)
    const crossRepoEdges = graph.edges.filter((e) => e.cross_repo);
    expect(crossRepoEdges.length).toBeGreaterThan(0);

    // The dependency is: STAGE-002-001-001 depends_on STAGE-001-001-001
    // So the edge should be from STAGE-002-001-001 to STAGE-001-001-001
    const stageDep = graph.edges.find(
      (e) => e.from === 'STAGE-002-001-001' && e.to === 'STAGE-001-001-001',
    );
    expect(stageDep).toBeDefined();
    expect(stageDep?.cross_repo).toBe(true);

    // Verify repos field
    expect(graph.repos).toEqual(['repo-a', 'repo-b']);
  });

  it('global validate detects cross-repo reference errors', () => {
    // Sync both repos
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query data
    const repoRepo = new RepoRepository(db);
    const epicRepo = new EpicRepository(db);
    const ticketRepo = new TicketRepository(db);
    const stageRepo = new StageRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Create validate input
    const epics = [
      ...epicRepo.listByRepo(repoA.id).map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        jira_key: e.jira_key,
        tickets: [],
        depends_on: [],
        file_path: e.file_path,
        repo: 'repo-a',
      })),
      ...epicRepo.listByRepo(repoB.id).map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        jira_key: e.jira_key,
        tickets: [],
        depends_on: [],
        file_path: e.file_path,
        repo: 'repo-b',
      })),
    ];

    const tickets = [
      ...ticketRepo.listByRepo(repoA.id).map((t) => ({
        id: t.id,
        epic_id: t.epic_id,
        title: t.title,
        status: t.status,
        jira_key: t.jira_key,
        source: t.source,
        stages: t.id === 'TICKET-001-001' ? ['STAGE-001-001-001'] : [],
        depends_on: [],
        jira_links: [],
        file_path: t.file_path,
        repo: 'repo-a',
      })),
      ...ticketRepo.listByRepo(repoB.id).map((t) => ({
        id: t.id,
        epic_id: t.epic_id,
        title: t.title,
        status: t.status,
        jira_key: t.jira_key,
        source: t.source,
        stages: t.id === 'TICKET-002-001' ? ['STAGE-002-001-001'] : [],
        depends_on: [],
        jira_links: [],
        file_path: t.file_path,
        repo: 'repo-b',
      })),
    ];

    const stages = [
      ...stageRepo.listByRepo(repoA.id).map((s) => ({
        id: s.id,
        ticket_id: s.ticket_id,
        epic_id: s.epic_id,
        title: s.title,
        status: s.status,
        refinement_type: s.refinement_type,
        worktree_branch: s.worktree_branch || '',
        priority: s.priority,
        due_date: s.due_date,
        session_active: s.session_active,
        depends_on: [],
        pending_merge_parents: [],
        is_draft: s.is_draft === 1,
        file_path: s.file_path,
        repo: 'repo-a',
      })),
      ...stageRepo.listByRepo(repoB.id).map((s) => ({
        id: s.id,
        ticket_id: s.ticket_id,
        epic_id: s.epic_id,
        title: s.title,
        status: s.status,
        refinement_type: s.refinement_type,
        worktree_branch: s.worktree_branch || '',
        priority: s.priority,
        due_date: s.due_date,
        session_active: s.session_active,
        depends_on: [],
        pending_merge_parents: [],
        is_draft: s.is_draft === 1,
        file_path: s.file_path,
        repo: 'repo-b',
      })),
    ];

    // Build set of all IDs and valid statuses
    const allIds = new Set<string>();
    for (const e of epics) allIds.add(e.id);
    for (const t of tickets) allIds.add(t.id);
    for (const s of stages) allIds.add(s.id);

    const sm = StateMachine.fromConfig(pipelineConfig);
    const validStatuses = new Set(sm.getAllStatuses());

    // Test with valid data
    const result = validateWorkItems({
      epics,
      tickets,
      stages,
      dependencies: [],
      allIds,
      validStatuses,
      global: true,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Now test with invalid cross-repo reference
    const epicWithBadDep = { ...epics[0], depends_on: ['NONEXISTENT-999'] };
    const invalidResult = validateWorkItems({
      epics: [epicWithBadDep, ...epics.slice(1)],
      tickets,
      stages,
      dependencies: [],
      allIds,
      validStatuses,
      global: true,
    });

    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some((e) => e.error.includes('does not exist'))).toBe(true);
  });
});
