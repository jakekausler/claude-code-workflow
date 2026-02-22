import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';
import { syncRepo } from '../../src/sync/sync.js';
import { StageRepository } from '../../src/db/repositories/stage-repository.js';
import { DependencyRepository } from '../../src/db/repositories/dependency-repository.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import type { PendingMergeParent } from '../../src/types/work-items.js';

/**
 * Pipeline config that includes PR Created and Addressing Comments phases,
 * matching the default production pipeline.
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

describe('sync soft-resolution', () => {
  let tmpDir: string;
  let repoDir: string;
  let epicsDir: string;
  let db: KanbanDatabase;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-soft-resolve-'));
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

  function writeEpic(id: string, title: string, deps: string[] = []): void {
    const depsYaml = deps.length > 0
      ? deps.map((d) => `  - ${d}`).join('\n')
      : '[]';
    fs.writeFileSync(
      path.join(epicsDir, `${id}.md`),
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
  }

  function writeTicket(id: string, epicId: string, title: string, deps: string[] = []): void {
    const depsYaml = deps.length > 0
      ? deps.map((d) => `  - ${d}`).join('\n')
      : '[]';
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
depends_on:
${deps.length > 0 ? depsYaml : '  []'}
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

  // ─── Preserved existing behavior ───────────────────────────────────────

  it('stage with all hard-resolved deps → ready_for_work (existing behavior preserved)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Login API', 'Complete');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('ready_for_work');
  });

  it('stage with no dependencies → no pending_merge_parents (unchanged)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Design');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('design');
    expect(stage!.pending_merge_parents).toBeNull();
    expect(stage!.is_draft).toBe(0);
  });

  it('backward compatibility: stages without new fields sync correctly', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Login Form', 'Build');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const stage = stages.findById('STAGE-001-001-001');
    expect(stage!.kanban_column).toBe('build');
    expect(stage!.pending_merge_parents).toBeNull();
    expect(stage!.is_draft).toBe(0);
  });

  // ─── Soft-resolution: stage→stage ─────────────────────────────────────

  it('stage with soft-resolved parent (PR Created) → ready_for_work', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    expect(child!.kanban_column).toBe('ready_for_work');
  });

  it('stage with soft-resolved parent (Addressing Comments) → ready_for_work', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'Addressing Comments', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    expect(child!.kanban_column).toBe('ready_for_work');
  });

  it('stage with unresolved parent (Build status) → backlog (unchanged)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'Build');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    expect(child!.kanban_column).toBe('backlog');
  });

  // ─── Hard-only: stage→ticket, stage→epic ──────────────────────────────

  it('stage→ticket dependency → hard-resolve only (Complete required)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeEpic('EPIC-002', 'Setup');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeTicket('TICKET-002-001', 'EPIC-002', 'DB Setup');
    // Stage depends on a ticket (not a stage)
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['TICKET-002-001']);
    // The ticket's stage is in PR Created (soft-resolved for stage→stage, but NOT for stage→ticket)
    writeStage('STAGE-002-001-001', 'TICKET-002-001', 'EPIC-002', 'Setup Stage', 'PR Created', [], {
      worktree_branch: 'feat/setup',
      pr_url: 'https://github.com/org/repo/pull/99',
      pr_number: 99,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    // Ticket dep is NOT soft-resolved → stays in backlog
    expect(child!.kanban_column).toBe('backlog');
  });

  it('stage→epic dependency → hard-resolve only (Complete required)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeEpic('EPIC-002', 'Setup');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeTicket('TICKET-002-001', 'EPIC-002', 'DB Setup');
    // Stage depends on an epic (not a stage)
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['EPIC-002']);
    // The epic's ticket's stage is in PR Created
    writeStage('STAGE-002-001-001', 'TICKET-002-001', 'EPIC-002', 'Setup Stage', 'PR Created', [], {
      worktree_branch: 'feat/setup',
      pr_url: 'https://github.com/org/repo/pull/99',
      pr_number: 99,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    // Epic dep is NOT soft-resolved → stays in backlog
    expect(child!.kanban_column).toBe('backlog');
  });

  // ─── pending_merge_parents population ─────────────────────────────────

  it('populates pending_merge_parents when stage is soft-unblocked', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');

    expect(child!.pending_merge_parents).not.toBeNull();
    const parents: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
    expect(parents).toHaveLength(1);
    expect(parents[0].stage_id).toBe('STAGE-001-001-002');
    expect(parents[0].branch).toBe('feat/parent');
    expect(parents[0].pr_url).toBe('https://github.com/org/repo/pull/42');
    expect(parents[0].pr_number).toBe(42);
  });

  it('sets is_draft when pending_merge_parents is populated', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    expect(child!.is_draft).toBe(1);
  });

  // ─── Cleanup: hard-resolution removes pending parents ─────────────────

  it('pending_merge_parents entry removed when parent reaches Complete', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');

    // First sync: parent is PR Created → soft-resolved
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    let child = stages.findById('STAGE-001-001-001');
    expect(child!.pending_merge_parents).not.toBeNull();
    expect(child!.is_draft).toBe(1);

    // Second sync: parent is now Complete → hard-resolved, pending parents cleaned up
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'Complete', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    child = stages.findById('STAGE-001-001-001');
    expect(child!.pending_merge_parents).toBeNull();
    expect(child!.is_draft).toBe(0);
  });

  it('is_draft cleared when all pending_merge_parents entries removed', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');

    // Two soft-resolved parents
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child', 'Not Started',
      ['STAGE-001-001-002', 'STAGE-001-001-003']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent A', 'PR Created', [], {
      worktree_branch: 'feat/a', pr_url: 'https://github.com/org/repo/pull/1', pr_number: 1,
    });
    writeStage('STAGE-001-001-003', 'TICKET-001-001', 'EPIC-001', 'Parent B', 'PR Created', [], {
      worktree_branch: 'feat/b', pr_url: 'https://github.com/org/repo/pull/2', pr_number: 2,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    let child = stages.findById('STAGE-001-001-001');
    const parents: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
    expect(parents).toHaveLength(2);
    expect(child!.is_draft).toBe(1);

    // Complete parent A, parent B still soft
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent A', 'Complete', [], {
      worktree_branch: 'feat/a', pr_url: 'https://github.com/org/repo/pull/1', pr_number: 1,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    child = stages.findById('STAGE-001-001-001');
    const parentsAfter: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
    expect(parentsAfter).toHaveLength(1);
    expect(parentsAfter[0].stage_id).toBe('STAGE-001-001-003');
    expect(child!.is_draft).toBe(1); // Still has one pending parent

    // Complete parent B too
    writeStage('STAGE-001-001-003', 'TICKET-001-001', 'EPIC-001', 'Parent B', 'Complete', [], {
      worktree_branch: 'feat/b', pr_url: 'https://github.com/org/repo/pull/2', pr_number: 2,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    child = stages.findById('STAGE-001-001-001');
    expect(child!.pending_merge_parents).toBeNull();
    expect(child!.is_draft).toBe(0);
  });

  // ─── Frontmatter file updates ─────────────────────────────────────────

  it('updates frontmatter file with pending_merge_parents', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    const childPath = writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    // Read back the file and check frontmatter
    const content = fs.readFileSync(childPath, 'utf-8');
    // Verify the raw file content contains the expected data
    expect(content).toContain('pending_merge_parents:');
    expect(content).toContain('stage_id: STAGE-001-001-002');
    expect(content).toContain('branch: feat/parent');
    expect(content).toContain('pr_number: 42');
    expect(content).toContain('is_draft: true');
    // Verify via re-parsing the frontmatter to confirm YAML round-trip
    expect(content).toContain("pr_url: 'https://github.com/org/repo/pull/42'");
    // Also verify the re-read sync picks up the data correctly
    // (second sync will parse the updated file)
    syncRepo({ repoPath: repoDir, db, config: testConfig });
    const stagesAfter = new StageRepository(db);
    const childAfter = stagesAfter.findById('STAGE-001-001-001');
    expect(childAfter!.pending_merge_parents).not.toBeNull();
    const parentsList: PendingMergeParent[] = JSON.parse(childAfter!.pending_merge_parents!);
    expect(parentsList).toHaveLength(1);
    expect(parentsList[0].stage_id).toBe('STAGE-001-001-002');
    expect(parentsList[0].branch).toBe('feat/parent');
    expect(parentsList[0].pr_url).toBe('https://github.com/org/repo/pull/42');
    expect(parentsList[0].pr_number).toBe(42);
  });

  it('clears frontmatter pending_merge_parents when parent completes', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    const childPath = writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    // First sync: soft-resolved
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    // Now parent completes
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'Complete', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });
    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const content = fs.readFileSync(childPath, 'utf-8');
    expect(content).toContain('pending_merge_parents: []');
    expect(content).toContain('is_draft: false');
  });

  // ─── Mixed dependencies ──────────────────────────────────────────────

  it('mixed deps: some hard-resolved, some soft-resolved → ready_for_work with pending parents for soft ones only', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    // Child depends on two parents: one Complete, one PR Created
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started',
      ['STAGE-001-001-002', 'STAGE-001-001-003']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Complete Parent', 'Complete');
    writeStage('STAGE-001-001-003', 'TICKET-001-001', 'EPIC-001', 'Soft Parent', 'PR Created', [], {
      worktree_branch: 'feat/soft',
      pr_url: 'https://github.com/org/repo/pull/10',
      pr_number: 10,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');

    // Unblocked because both deps are at least soft-or-hard resolved
    expect(child!.kanban_column).toBe('ready_for_work');

    // Only the soft-resolved parent appears in pending_merge_parents
    const parents: PendingMergeParent[] = JSON.parse(child!.pending_merge_parents!);
    expect(parents).toHaveLength(1);
    expect(parents[0].stage_id).toBe('STAGE-001-001-003');
    expect(child!.is_draft).toBe(1);
  });

  it('mixed deps: one hard stage dep + one unresolved ticket dep → backlog', () => {
    writeEpic('EPIC-001', 'Auth');
    writeEpic('EPIC-002', 'Setup');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeTicket('TICKET-002-001', 'EPIC-002', 'DB Setup');

    // Stage depends on both a complete stage and an incomplete ticket
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started',
      ['STAGE-001-001-002', 'TICKET-002-001']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'Complete');
    writeStage('STAGE-002-001-001', 'TICKET-002-001', 'EPIC-002', 'Setup Stage', 'Build');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    // Ticket dep not resolved → backlog
    expect(child!.kanban_column).toBe('backlog');
    expect(child!.pending_merge_parents).toBeNull();
  });

  // ─── dependency.resolved flag stays hard-only ─────────────────────────

  it('dependency.resolved stays false for soft-resolved deps (only set for hard-resolution)', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created', [], {
      worktree_branch: 'feat/parent',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const deps = new DependencyRepository(db);
    // The in-DB dependency is NOT resolved (it's only soft-resolved)
    expect(deps.allResolved('STAGE-001-001-001')).toBe(false);
    // But the child is unblocked via soft-resolution
    const stages = new StageRepository(db);
    expect(stages.findById('STAGE-001-001-001')!.kanban_column).toBe('ready_for_work');
  });

  // ─── Edge case: soft-resolved parent without PR info ─────────────────

  it('soft-resolved parent without worktree_branch/pr_url → no pending parent entry', () => {
    writeEpic('EPIC-001', 'Auth');
    writeTicket('TICKET-001-001', 'EPIC-001', 'Login');
    writeStage('STAGE-001-001-001', 'TICKET-001-001', 'EPIC-001', 'Child Stage', 'Not Started', ['STAGE-001-001-002']);
    // Parent is in PR Created but has no branch/pr info
    writeStage('STAGE-001-001-002', 'TICKET-001-001', 'EPIC-001', 'Parent Stage', 'PR Created');

    syncRepo({ repoPath: repoDir, db, config: testConfig });

    const stages = new StageRepository(db);
    const child = stages.findById('STAGE-001-001-001');
    // Still unblocked (soft-resolved)
    expect(child!.kanban_column).toBe('ready_for_work');
    // But no pending parent entry since parent lacks PR info
    expect(child!.pending_merge_parents).toBeNull();
    expect(child!.is_draft).toBe(0);
  });
});
