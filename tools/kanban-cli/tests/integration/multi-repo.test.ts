import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import matter from 'gray-matter';
import { KanbanDatabase } from '../../src/db/database.js';
import { createRegistry } from '../../src/repos/registry.js';
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
  } as const;

  /**
   * Sync both repos and aggregate their data ready for logic functions.
   * Returns epics, tickets, stages, and dependencies with proper type mapping.
   */
  function syncAndLoadAll(repoAPath: string, repoBPath: string) {
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    const repoRepo = new RepoRepository(db);
    const epicRepo = new EpicRepository(db);
    const ticketRepo = new TicketRepository(db);
    const stageRepo = new StageRepository(db);
    const depRepo = new DependencyRepository(db);

    const repoA = repoRepo.findByPath(repoAPath)!;
    const repoB = repoRepo.findByPath(repoBPath)!;

    // Aggregate data from both repos with proper type mapping
    const epics = [
      ...epicRepo.listByRepo(repoA.id).map((e) => ({ ...e, repo: 'repo-a' })),
      ...epicRepo.listByRepo(repoB.id).map((e) => ({ ...e, repo: 'repo-b' })),
    ];

    const tickets = [
      ...ticketRepo.listByRepo(repoA.id).map((t) => ({
        ...t,
        repo: 'repo-a',
        has_stages: (t.has_stages ?? 0) === 1,
      })),
      ...ticketRepo.listByRepo(repoB.id).map((t) => ({
        ...t,
        repo: 'repo-b',
        has_stages: (t.has_stages ?? 0) === 1,
      })),
    ];

    const stages = [
      ...stageRepo.listByRepo(repoA.id).map((s) => ({
        ...s,
        repo: 'repo-a',
        session_active: (s.session_active ?? 0) === 1,
        kanban_column: s.kanban_column ?? 'backlog',
        status: s.status ?? 'Not Started',
      })),
      ...stageRepo.listByRepo(repoB.id).map((s) => ({
        ...s,
        repo: 'repo-b',
        session_active: (s.session_active ?? 0) === 1,
        kanban_column: s.kanban_column ?? 'backlog',
        status: s.status ?? 'Not Started',
      })),
    ];

    const deps = [
      ...depRepo.listByRepo(repoA.id).map((d) => ({
        ...d,
        repo: 'repo-a',
        resolved: d.resolved === 1,
      })),
      ...depRepo.listByRepo(repoB.id).map((d) => ({
        ...d,
        repo: 'repo-b',
        resolved: d.resolved === 1,
      })),
    ];

    return { epics, tickets, stages, deps, repoA, repoB };
  }

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
    const { epics, tickets, stages, deps } = syncAndLoadAll(repoAPath, repoBPath);

    // Build global board
    const board = buildBoard({
      config: pipelineConfig,
      repoPath: 'global',
      epics,
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
    const { tickets, stages, deps } = syncAndLoadAll(repoAPath, repoBPath);

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

  it('cross-repo dependency resolves when target stage completes', () => {
    // Initial sync
    const { deps: depsBefore, repoA, repoB } = syncAndLoadAll(repoAPath, repoBPath);

    // Verify cross-repo dependency exists and is unresolved initially
    const crossRepoDepBefore = depsBefore.find(
      (d) => d.from_id === 'STAGE-002-001-001' && d.to_id === 'STAGE-001-001-001',
    );
    expect(crossRepoDepBefore).toBeDefined();
    expect(crossRepoDepBefore?.resolved).toBe(false);

    // Update repo A's stage file to mark it as Complete
    const stageAPath = path.join(repoAPath, 'epics', 'EPIC-001-auth-system', 'TICKET-001-001-login-feature', 'STAGE-001-001-001.md');
    const stageAContent = fs.readFileSync(stageAPath, 'utf-8');
    const parsed = matter(stageAContent);
    parsed.data.status = 'Complete';
    const updated = matter.stringify(parsed.content, parsed.data);
    fs.writeFileSync(stageAPath, updated, 'utf-8');

    // Re-sync both repos to apply the change and resolve dependencies
    const configA = loadConfig({ repoPath: repoAPath });
    syncRepo({ repoPath: repoAPath, db, config: configA });

    const configB = loadConfig({ repoPath: repoBPath });
    syncRepo({ repoPath: repoBPath, db, config: configB });

    // Query updated dependencies
    const depRepo = new DependencyRepository(db);
    const stageRepo = new StageRepository(db);

    const depsAfter = [
      ...depRepo.listByRepo(repoA.id).map((d) => ({
        ...d,
        resolved: d.resolved === 1,
      })),
      ...depRepo.listByRepo(repoB.id).map((d) => ({
        ...d,
        resolved: d.resolved === 1,
      })),
    ];

    // Verify dependency is now resolved
    const crossRepoDepAfter = depsAfter.find(
      (d) => d.from_id === 'STAGE-002-001-001' && d.to_id === 'STAGE-001-001-001',
    );
    expect(crossRepoDepAfter?.resolved).toBe(true);

    // Verify repo A's stage is now Complete
    const stageA = stageRepo.findById('STAGE-001-001-001');
    expect(stageA?.status).toBe('Complete');
  });

  it('global graph includes cross-repo edges', () => {
    const { epics, tickets, stages, deps } = syncAndLoadAll(repoAPath, repoBPath);

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
