import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import matter from 'gray-matter';
import { KanbanDatabase } from '../../src/db/database.js';
import { syncRepo } from '../../src/sync/sync.js';
import { buildBoard } from '../../src/cli/logic/board.js';
import type { BoardTicketRow, BoardStageRow, BoardEpicRow, BoardDependencyRow, StageBoardItem } from '../../src/cli/logic/board.js';
import { validateWorkItems } from '../../src/cli/logic/validate.js';
import type { ValidateEpicRow, ValidateTicketRow, ValidateStageRow, ValidateDependencyRow } from '../../src/cli/logic/validate.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { EpicRepository } from '../../src/db/repositories/epic-repository.js';
import { TicketRepository } from '../../src/db/repositories/ticket-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';
import { RepoRepository } from '../../src/db/repositories/repo-repository.js';
import { StateMachine } from '../../src/engine/state-machine.js';
import { RESERVED_STATUSES } from '../../src/types/pipeline.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import type { PendingMergeParent } from '../../src/types/work-items.js';

/**
 * Pipeline config with Design, Build, Finalize, PR Created, Addressing Comments.
 * Matches production pipeline shape.
 */
const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Finalize'] },
      { name: 'Finalize', skill: 'phase-finalize', status: 'Finalize', transitions_to: ['Done', 'PR Created'] },
      { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
      { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeEpic(epicsDir: string, id: string, title: string, deps: string[] = []): string {
  const depsYaml = deps.length > 0
    ? deps.map((d) => `  - ${d}`).join('\n')
    : '[]';
  const filePath = path.join(epicsDir, `${id}.md`);
  fs.writeFileSync(
    filePath,
    `---
id: ${id}
title: ${title}
status: In Progress
jira_key: null
tickets:
  - TICKET-001-001
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
---

# ${title}
`
  );
  return filePath;
}

function writeTicket(
  epicsDir: string,
  id: string,
  epicId: string,
  title: string,
  stageIds: string[] = ['STAGE-001-001-001'],
  deps: string[] = []
): string {
  const depsYaml = deps.length > 0
    ? deps.map((d) => `  - ${d}`).join('\n')
    : '[]';
  const stagesYaml = stageIds.length > 0
    ? stageIds.map((s) => `  - ${s}`).join('\n')
    : '[]';
  const filePath = path.join(epicsDir, `${id}.md`);
  fs.writeFileSync(
    filePath,
    `---
id: ${id}
epic: ${epicId}
title: ${title}
status: In Progress
jira_key: null
source: local
stages:
${stageIds.length > 0 ? stagesYaml : '  []'}
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
---

# ${title}
`
  );
  return filePath;
}

function writeStage(
  epicsDir: string,
  id: string,
  ticketId: string,
  epicId: string,
  title: string,
  status: string,
  deps: string[] = [],
  extra: {
    worktree_branch?: string;
    pr_url?: string;
    pr_number?: number;
  } = {}
): string {
  const depsYaml = deps.length > 0
    ? deps.map((d) => `  - ${d}`).join('\n')
    : '[]';

  const worktreeLine = extra.worktree_branch
    ? `worktree_branch: ${extra.worktree_branch}`
    : 'worktree_branch: null';
  const prUrlLine = extra.pr_url
    ? `pr_url: ${extra.pr_url}`
    : 'pr_url: null';
  const prNumberLine = extra.pr_number != null
    ? `pr_number: ${extra.pr_number}`
    : 'pr_number: null';

  const filePath = path.join(epicsDir, `${id}.md`);
  fs.writeFileSync(
    filePath,
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
${worktreeLine}
${prUrlLine}
${prNumberLine}
priority: 0
due_date: null
---

# ${title}
`
  );
  return filePath;
}

/**
 * Build board output by querying DB after sync, following the same pattern
 * as the board CLI command.
 */
function buildBoardFromDb(
  db: KanbanDatabase,
  repoPath: string,
  config: PipelineConfig
): ReturnType<typeof buildBoard> {
  const repoRepo = new RepoRepository(db);
  const repo = repoRepo.findByPath(repoPath)!;
  const repoId = repo.id;

  const epicRows = new EpicRepository(db).listByRepo(repoId);
  const ticketRows = new TicketRepository(db).listByRepo(repoId);
  const stageRows = new StageRepository(db).listByRepo(repoId);
  const depRows = new DependencyRepository(db).listByRepo(repoId);

  const epics: BoardEpicRow[] = epicRows.map((e) => ({
    id: e.id,
    title: e.title ?? '',
    status: e.status ?? 'Not Started',
    file_path: e.file_path,
  }));

  const tickets: BoardTicketRow[] = ticketRows.map((t) => ({
    id: t.id,
    epic_id: t.epic_id ?? '',
    title: t.title ?? '',
    status: t.status ?? 'Not Started',
    jira_key: t.jira_key,
    source: t.source ?? 'local',
    has_stages: (t.has_stages ?? 0) === 1,
    file_path: t.file_path,
  }));

  const stages: BoardStageRow[] = stageRows.map((s) => ({
    id: s.id,
    ticket_id: s.ticket_id ?? '',
    epic_id: s.epic_id ?? '',
    title: s.title ?? '',
    status: s.status ?? 'Not Started',
    kanban_column: s.kanban_column ?? 'backlog',
    refinement_type: s.refinement_type ?? '[]',
    worktree_branch: s.worktree_branch ?? '',
    priority: s.priority,
    due_date: s.due_date,
    session_active: s.session_active === 1,
    pending_merge_parents: s.pending_merge_parents ?? undefined,
    file_path: s.file_path,
  }));

  const dependencies: BoardDependencyRow[] = depRows.map((d) => ({
    id: d.id,
    from_id: d.from_id,
    to_id: d.to_id,
    from_type: d.from_type,
    to_type: d.to_type,
    resolved: d.resolved === 1,
  }));

  return buildBoard({
    config,
    repoPath,
    epics,
    tickets,
    stages,
    dependencies,
  });
}

/**
 * Build validate input from DB after sync, following the same pattern
 * as the validate CLI command.
 */
function buildValidateInput(
  db: KanbanDatabase,
  repoPath: string,
  config: PipelineConfig
) {
  const repoRepo = new RepoRepository(db);
  const repo = repoRepo.findByPath(repoPath)!;
  const repoId = repo.id;

  const epicRows = new EpicRepository(db).listByRepo(repoId);
  const ticketRows = new TicketRepository(db).listByRepo(repoId);
  const stageRows = new StageRepository(db).listByRepo(repoId);
  const depRows = new DependencyRepository(db).listByRepo(repoId);

  const allIds = new Set<string>();
  for (const e of epicRows) allIds.add(e.id);
  for (const t of ticketRows) allIds.add(t.id);
  for (const s of stageRows) allIds.add(s.id);

  const sm = StateMachine.fromConfig(config);
  const validStatuses = new Set<string>([
    ...RESERVED_STATUSES,
    'Complete',
    'In Progress',
    'Skipped',
    ...sm.getAllStatuses(),
  ]);

  const depsByFromId = new Map<string, string[]>();
  for (const d of depRows) {
    const existing = depsByFromId.get(d.from_id) || [];
    existing.push(d.to_id);
    depsByFromId.set(d.from_id, existing);
  }

  const stagesByTicket = new Map<string, string[]>();
  for (const s of stageRows) {
    if (s.ticket_id) {
      const existing = stagesByTicket.get(s.ticket_id) || [];
      existing.push(s.id);
      stagesByTicket.set(s.ticket_id, existing);
    }
  }

  const ticketsByEpic = new Map<string, string[]>();
  for (const t of ticketRows) {
    if (t.epic_id) {
      const existing = ticketsByEpic.get(t.epic_id) || [];
      existing.push(t.id);
      ticketsByEpic.set(t.epic_id, existing);
    }
  }

  const epics: ValidateEpicRow[] = epicRows.map((e) => ({
    id: e.id,
    title: e.title ?? '',
    status: e.status ?? 'Not Started',
    jira_key: e.jira_key,
    tickets: ticketsByEpic.get(e.id) || [],
    depends_on: depsByFromId.get(e.id) || [],
    file_path: e.file_path,
  }));

  const tickets: ValidateTicketRow[] = ticketRows.map((t) => ({
    id: t.id,
    epic_id: t.epic_id ?? '',
    title: t.title ?? '',
    status: t.status ?? 'Not Started',
    jira_key: t.jira_key,
    source: t.source ?? 'local',
    stages: stagesByTicket.get(t.id) || [],
    depends_on: depsByFromId.get(t.id) || [],
    jira_links: [],
    file_path: t.file_path,
  }));

  const stages: ValidateStageRow[] = stageRows.map((s) => ({
    id: s.id,
    ticket_id: s.ticket_id ?? '',
    epic_id: s.epic_id ?? '',
    title: s.title ?? '',
    status: s.status ?? 'Not Started',
    refinement_type: s.refinement_type ?? '[]',
    worktree_branch: s.worktree_branch ?? '',
    priority: s.priority,
    due_date: s.due_date,
    session_active: s.session_active === 1,
    depends_on: depsByFromId.get(s.id) || [],
    pending_merge_parents: s.pending_merge_parents ? JSON.parse(s.pending_merge_parents) : [],
    is_draft: s.is_draft === 1,
    file_path: s.file_path,
  }));

  const dependencies: ValidateDependencyRow[] = depRows.map((d) => ({
    from_id: d.from_id,
    to_id: d.to_id,
    resolved: d.resolved === 1,
  }));

  return { epics, tickets, stages, dependencies, allIds, validStatuses };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('integration: soft-resolution end-to-end pipeline', () => {
  let tmpDir: string;
  let repoDir: string;
  let epicsDir: string;
  let db: KanbanDatabase;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-integration-'));
    repoDir = path.join(tmpDir, 'repo');
    epicsDir = path.join(repoDir, 'epics', 'auth');
    fs.mkdirSync(epicsDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Scenario 1: Soft-resolution end-to-end ────────────────────────────

  describe('Scenario 1: soft-resolution end-to-end', () => {
    it('full pipeline: sync -> column assignment -> frontmatter write -> board output', () => {
      // Set up: parent in PR Created with PR info, child depends on parent
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login', ['STAGE-001-001-001', 'STAGE-001-001-002']);
      const childPath = writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/parent-branch',
          pr_url: 'https://github.com/org/repo/pull/42',
          pr_number: 42,
        }
      );

      // Run sync
      const result = syncRepo({ repoPath: repoDir, db, config: testConfig });
      expect(result.errors).toHaveLength(0);
      expect(result.stages).toBe(2);

      // 1. Verify child moves to ready_for_work column
      const stages = new StageRepository(db);
      const child = stages.findById('STAGE-001-001-001');
      expect(child!.kanban_column).toBe('ready_for_work');

      // 2. Verify pending_merge_parents populated in SQLite with correct parent data
      expect(child!.pending_merge_parents).not.toBeNull();
      const parents: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
      expect(parents).toHaveLength(1);
      expect(parents[0].stage_id).toBe('STAGE-001-001-002');
      expect(parents[0].branch).toBe('feat/parent-branch');
      expect(parents[0].pr_url).toBe('https://github.com/org/repo/pull/42');
      expect(parents[0].pr_number).toBe(42);

      // 3. Verify pending_merge_parents written to child's frontmatter file
      const fileContent = fs.readFileSync(childPath, 'utf-8');
      const parsed = matter(fileContent);
      expect(parsed.data.pending_merge_parents).toBeDefined();
      expect(Array.isArray(parsed.data.pending_merge_parents)).toBe(true);
      expect(parsed.data.pending_merge_parents).toHaveLength(1);
      expect(parsed.data.pending_merge_parents[0].stage_id).toBe('STAGE-001-001-002');
      expect(parsed.data.pending_merge_parents[0].branch).toBe('feat/parent-branch');
      expect(parsed.data.pending_merge_parents[0].pr_number).toBe(42);
      expect(parsed.data.is_draft).toBe(true);

      // 4. Verify board output includes pending_merge_parents for the child
      const board = buildBoardFromDb(db, repoDir, testConfig);
      const readyItems = board.columns['ready_for_work'];
      const childBoardItem = readyItems.find((i) => i.id === 'STAGE-001-001-001') as StageBoardItem;
      expect(childBoardItem).toBeDefined();
      expect(childBoardItem.pending_merge_parents).toBeDefined();
      expect(childBoardItem.pending_merge_parents).toHaveLength(1);
      expect(childBoardItem.pending_merge_parents![0].stage_id).toBe('STAGE-001-001-002');
      expect(childBoardItem.pending_merge_parents![0].branch).toBe('feat/parent-branch');
    });
  });

  // ─── Scenario 2: Parent transitions to Complete ─────────────────────────

  describe('Scenario 2: parent transitions to Complete', () => {
    it('pending_merge_parents removed from SQLite and frontmatter when parent completes', () => {
      // Set up and first sync: parent in PR Created
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login', ['STAGE-001-001-001', 'STAGE-001-001-002']);
      const childPath = writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/parent-branch',
          pr_url: 'https://github.com/org/repo/pull/42',
          pr_number: 42,
        }
      );

      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // Verify initial state
      const stages = new StageRepository(db);
      let child = stages.findById('STAGE-001-001-001');
      expect(child!.pending_merge_parents).not.toBeNull();
      expect(child!.is_draft).toBe(1);

      // Second sync: parent status changes to Complete
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'Complete', [], {
          worktree_branch: 'feat/parent-branch',
          pr_url: 'https://github.com/org/repo/pull/42',
          pr_number: 42,
        }
      );
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // Verify SQLite: pending_merge_parents removed, is_draft cleared
      child = stages.findById('STAGE-001-001-001');
      expect(child!.pending_merge_parents).toBeNull();
      expect(child!.is_draft).toBe(0);

      // Verify frontmatter: pending_merge_parents cleared
      // updateStageFrontmatter sets pending_merge_parents = [] when empty (never removes the key)
      const fileContent = fs.readFileSync(childPath, 'utf-8');
      const parsed = matter(fileContent);
      expect(parsed.data.is_draft).toBe(false);
      expect(parsed.data.pending_merge_parents).toEqual([]);
    });
  });

  // ─── Scenario 3: Mixed resolution ──────────────────────────────────────

  describe('Scenario 3: mixed resolution (one Complete, one PR Created)', () => {
    it('child in ready_for_work with pending_merge_parents containing only PR Created parent', () => {
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002', 'STAGE-001-001-003']);
      const childPath = writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started',
        ['STAGE-001-001-002', 'STAGE-001-001-003']
      );
      // Parent A: Complete (hard-resolved)
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Complete Parent', 'Complete'
      );
      // Parent B: PR Created (soft-resolved)
      writeStage(
        epicsDir, 'STAGE-001-001-003', 'TICKET-001-001', 'EPIC-001',
        'PR Parent', 'PR Created', [], {
          worktree_branch: 'feat/pr-parent',
          pr_url: 'https://github.com/org/repo/pull/99',
          pr_number: 99,
        }
      );

      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // Verify child is in ready_for_work (all deps at least soft-resolved)
      const stages = new StageRepository(db);
      const child = stages.findById('STAGE-001-001-001');
      expect(child!.kanban_column).toBe('ready_for_work');

      // Verify pending_merge_parents contains only the PR Created parent
      const parents: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
      expect(parents).toHaveLength(1);
      expect(parents[0].stage_id).toBe('STAGE-001-001-003');
      expect(parents[0].branch).toBe('feat/pr-parent');
      expect(parents[0].pr_number).toBe(99);

      // Verify frontmatter
      const fileContent = fs.readFileSync(childPath, 'utf-8');
      const parsed = matter(fileContent);
      expect(parsed.data.pending_merge_parents).toHaveLength(1);
      expect(parsed.data.pending_merge_parents[0].stage_id).toBe('STAGE-001-001-003');
      expect(parsed.data.is_draft).toBe(true);

      // Verify board output
      const board = buildBoardFromDb(db, repoDir, testConfig);
      const childItem = board.columns['ready_for_work'].find(
        (i) => i.id === 'STAGE-001-001-001'
      ) as StageBoardItem;
      expect(childItem).toBeDefined();
      expect(childItem.pending_merge_parents).toHaveLength(1);
      expect(childItem.pending_merge_parents![0].stage_id).toBe('STAGE-001-001-003');
    });
  });

  // ─── Scenario 4: Backward compatibility ────────────────────────────────

  describe('Scenario 4: backward compatibility (no new fields)', () => {
    it('existing-style repo with no new fields syncs without errors', () => {
      // Write files WITHOUT worktree_branch, pr_url, pr_number, pending_merge_parents
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login', ['STAGE-001-001-001', 'STAGE-001-001-002']);
      writeStage(epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Design Stage', 'Design');
      writeStage(epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Build Stage', 'Build');

      // Sync
      const result = syncRepo({ repoPath: repoDir, db, config: testConfig });
      expect(result.errors).toHaveLength(0);
      expect(result.stages).toBe(2);

      // Verify stages are correctly placed
      const stages = new StageRepository(db);
      const designStage = stages.findById('STAGE-001-001-001');
      expect(designStage!.kanban_column).toBe('design');
      expect(designStage!.pending_merge_parents).toBeNull();
      expect(designStage!.is_draft).toBe(0);

      const buildStage = stages.findById('STAGE-001-001-002');
      expect(buildStage!.kanban_column).toBe('build');
      expect(buildStage!.pending_merge_parents).toBeNull();
      expect(buildStage!.is_draft).toBe(0);

      // No pending_merge_parents in board output
      const board = buildBoardFromDb(db, repoDir, testConfig);
      const designItem = board.columns['design'].find(
        (i) => i.id === 'STAGE-001-001-001'
      ) as StageBoardItem;
      expect(designItem).toBeDefined();
      expect(designItem.pending_merge_parents).toBeUndefined();

      // Validate produces no errors
      const validateInput = buildValidateInput(db, repoDir, testConfig);
      const validateResult = validateWorkItems(validateInput);
      expect(validateResult.valid).toBe(true);
      expect(validateResult.errors).toHaveLength(0);
    });

    it('backward compatible repo with dependencies (no soft-resolution) works correctly', () => {
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002']);
      // Stage depends on another stage that is NOT Complete and NOT in PR Created
      writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Blocked Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'In Progress Stage', 'Build'
      );

      const result = syncRepo({ repoPath: repoDir, db, config: testConfig });
      expect(result.errors).toHaveLength(0);

      // Child should be in backlog (dep not resolved)
      const stages = new StageRepository(db);
      const blocked = stages.findById('STAGE-001-001-001');
      expect(blocked!.kanban_column).toBe('backlog');
      expect(blocked!.pending_merge_parents).toBeNull();
      expect(blocked!.is_draft).toBe(0);

      // Validate produces no errors (only the normal stages warning for ticket w/ stages)
      const validateInput = buildValidateInput(db, repoDir, testConfig);
      const validateResult = validateWorkItems(validateInput);
      expect(validateResult.valid).toBe(true);
      expect(validateResult.errors).toHaveLength(0);
    });
  });

  // ─── Scenario 5: Validate with pending_merge_parents ───────────────────

  describe('Scenario 5: validate with pending_merge_parents', () => {
    it('valid pending_merge_parents references produce no errors', () => {
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002']);
      writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/validate-parent',
          pr_url: 'https://github.com/org/repo/pull/55',
          pr_number: 55,
        }
      );

      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const validateInput = buildValidateInput(db, repoDir, testConfig);
      const validateResult = validateWorkItems(validateInput);

      // No errors for valid pending_merge_parents references
      const pendingErrors = validateResult.errors.filter(
        (e) => e.field === 'pending_merge_parents'
      );
      expect(pendingErrors).toHaveLength(0);
      expect(validateResult.valid).toBe(true);
    });

    it('stale parent (status = Build) generates warning', () => {
      // Set up child with soft-resolved parent
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002']);
      writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/stale-parent',
          pr_url: 'https://github.com/org/repo/pull/77',
          pr_number: 77,
        }
      );

      // First sync: establishes soft-resolution
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // Manually tamper with the parent's status in DB to simulate stale state
      // (parent went from PR Created back to Build, but pending_merge_parents
      //  still references it). We do this by directly writing the parent file
      // with Build status but keeping the child's pending_merge_parents intact.
      // The simplest way: update parent file to Build, then manually set
      // the child's pending_merge_parents in the DB so it still references the parent.
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'Build', [], {
          worktree_branch: 'feat/stale-parent',
          pr_url: 'https://github.com/org/repo/pull/77',
          pr_number: 77,
        }
      );

      // Re-sync: the parent is now Build, so no soft resolution will happen.
      // The child's pending_merge_parents would normally be cleared by sync.
      // To test validate's warning for stale parent, we need to manually
      // inject the stale pending_merge_parents data.
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // After sync with parent at Build, child should be in backlog with no pending parents.
      // We need to manually inject a stale pending_merge_parents to test validation.
      const stageRepo = new StageRepository(db);
      const stalePendingParents: PendingMergeParent[] = [
        {
          stage_id: 'STAGE-001-001-002',
          branch: 'feat/stale-parent',
          pr_url: 'https://github.com/org/repo/pull/77',
          pr_number: 77,
        },
      ];
      stageRepo.updatePendingMergeParents('STAGE-001-001-001', stalePendingParents);

      // Now build validate input — the child has pending_merge_parents referencing
      // a parent whose status is Build (not PR Created or Complete)
      const validateInput = buildValidateInput(db, repoDir, testConfig);
      const validateResult = validateWorkItems(validateInput);

      // Should generate a warning about the stale parent
      const pendingWarnings = validateResult.warnings.filter(
        (w) => w.field === 'pending_merge_parents'
      );
      expect(pendingWarnings).toHaveLength(1);
      expect(pendingWarnings[0].warning).toContain('STAGE-001-001-002');
      expect(pendingWarnings[0].warning).toContain('Build');
    });

    it('invalid reference in pending_merge_parents produces validation error', () => {
      // Set up repo with stages synced normally
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002']);
      writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/invalid-ref',
          pr_url: 'https://github.com/org/repo/pull/88',
          pr_number: 88,
        }
      );

      // Sync to populate DB
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      // Inject a pending_merge_parents entry referencing a non-existent stage
      const stageRepo = new StageRepository(db);
      const invalidPendingParents: PendingMergeParent[] = [
        {
          stage_id: 'NONEXISTENT-STAGE',
          branch: 'feat/ghost-branch',
          pr_url: 'https://github.com/org/repo/pull/999',
          pr_number: 999,
        },
      ];
      stageRepo.updatePendingMergeParents('STAGE-001-001-001', invalidPendingParents);

      // Build validate input from DB and run validation
      const validateInput = buildValidateInput(db, repoDir, testConfig);
      const validateResult = validateWorkItems(validateInput);

      // Should produce an error for the non-existent stage reference
      const pendingErrors = validateResult.errors.filter(
        (e) => e.field === 'pending_merge_parents'
      );
      expect(pendingErrors).toHaveLength(1);
      expect(pendingErrors[0].error).toContain('NONEXISTENT-STAGE');
      expect(pendingErrors[0].error).toContain('does not exist');
    });
  });

  // ─── Idempotency: re-sync preserves correct state ──────────────────────

  describe('idempotency', () => {
    it('running sync twice with same files produces identical results', () => {
      writeEpic(epicsDir, 'EPIC-001', 'Auth');
      writeTicket(epicsDir, 'TICKET-001-001', 'EPIC-001', 'Login',
        ['STAGE-001-001-001', 'STAGE-001-001-002']);
      writeStage(
        epicsDir, 'STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001',
        'Child Stage', 'Not Started', ['STAGE-001-001-002']
      );
      writeStage(
        epicsDir, 'STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001',
        'Parent Stage', 'PR Created', [], {
          worktree_branch: 'feat/idempotent',
          pr_url: 'https://github.com/org/repo/pull/10',
          pr_number: 10,
        }
      );

      // First sync
      syncRepo({ repoPath: repoDir, db, config: testConfig });
      const stages1 = new StageRepository(db);
      const child1 = stages1.findById('STAGE-001-001-001');
      const parents1: PendingMergeParent[] = JSON.parse(child1!.pending_merge_parents!);

      // Second sync (reads back the file that was written with pending_merge_parents)
      syncRepo({ repoPath: repoDir, db, config: testConfig });
      const stages2 = new StageRepository(db);
      const child2 = stages2.findById('STAGE-001-001-001');
      const parents2: PendingMergeParent[] = JSON.parse(child2!.pending_merge_parents!);

      // Results should match
      expect(child2!.kanban_column).toBe(child1!.kanban_column);
      expect(child2!.is_draft).toBe(child1!.is_draft);
      expect(parents2).toEqual(parents1);
    });
  });
});
