import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { jiraSync, computeWorkflowEvent } from '../../../src/cli/logic/jira-sync.js';
import type { JiraSyncOptions } from '../../../src/cli/logic/jira-sync.js';
import type { JiraExecutor } from '../../../src/jira/types.js';
import type { StageRow } from '../../../src/db/repositories/types.js';
import { KanbanDatabase } from '../../../src/db/database.js';
import { RepoRepository, EpicRepository, TicketRepository, StageRepository } from '../../../src/db/repositories/index.js';
import { syncRepo } from '../../../src/sync/sync.js';
import type { PipelineConfig } from '../../../src/types/pipeline.js';

// ─── Test config ────────────────────────────────────────────────────────────

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
      { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
    ],
  },
  jira: {
    reading_script: '/fake/read-script.ts',
    writing_script: '/fake/write-script.ts',
    project: 'TEST',
    assignee: 'testuser',
    status_map: {
      first_stage_design: 'In Progress',
      stage_pr_created: 'In Review',
      all_stages_done: 'Done',
    },
  },
};

const testConfigYaml = `
workflow:
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
        - Done
jira:
  reading_script: /fake/read-script.ts
  writing_script: /fake/write-script.ts
  project: TEST
  assignee: testuser
  status_map:
    first_stage_design: In Progress
    stage_pr_created: In Review
    all_stages_done: Done
`;

// ─── Mock executor factory ──────────────────────────────────────────────────

function createMockExecutor(overrides: Partial<JiraExecutor> = {}): JiraExecutor {
  return {
    getTicket: async () => ({
      key: 'TEST-1',
      summary: 'Default ticket',
      description: null,
      status: 'To Do',
      type: 'Story',
      parent: null,
      assignee: null,
      labels: [],
      comments: [],
    }),
    searchTickets: async () => ({ tickets: [] }),
    transitionTicket: async () => ({
      key: 'TEST-1',
      success: true,
      previous_status: 'To Do',
      new_status: 'In Progress',
    }),
    assignTicket: async () => ({ key: 'TEST-1', success: true }),
    addComment: async () => ({ key: 'TEST-1', success: true, comment_id: '1' }),
    canRead: () => true,
    canWrite: () => true,
    ...overrides,
  };
}

// ─── Helpers for creating filesystem fixtures ───────────────────────────────

function createEpic(repoDir: string, epicId: string): void {
  const epicDir = path.join(repoDir, 'epics', epicId);
  fs.mkdirSync(epicDir, { recursive: true });
  fs.writeFileSync(
    path.join(epicDir, `${epicId}.md`),
    `---
id: ${epicId}
title: "Test Epic"
status: Not Started
jira_key: null
tickets: []
depends_on: []
---
Epic body.
`,
  );
}

function createTicket(
  repoDir: string,
  epicId: string,
  ticketId: string,
  jiraKey: string | null = 'PROJ-1234',
): void {
  const epicDir = path.join(repoDir, 'epics', epicId);
  fs.mkdirSync(epicDir, { recursive: true });
  fs.writeFileSync(
    path.join(epicDir, `${ticketId}.md`),
    `---
id: ${ticketId}
epic: ${epicId}
title: "Test Ticket"
status: Not Started
jira_key: ${jiraKey ?? 'null'}
source: jira
stages: []
depends_on: []
---
Ticket body.
`,
  );
}

function createStage(
  repoDir: string,
  epicId: string,
  ticketId: string,
  stageId: string,
  status: string = 'Not Started',
  prUrl: string | null = null,
  prNumber: number | null = null,
): void {
  const epicDir = path.join(repoDir, 'epics', epicId);
  fs.mkdirSync(epicDir, { recursive: true });
  fs.writeFileSync(
    path.join(epicDir, `${stageId}.md`),
    `---
id: ${stageId}
ticket: ${ticketId}
epic: ${epicId}
title: "Test Stage"
status: ${status}
session_active: false
refinement_type: []
depends_on: []
worktree_branch: null
pr_url: ${prUrl ?? 'null'}
pr_number: ${prNumber ?? 'null'}
priority: 0
due_date: null
---
Stage body.
`,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeWorkflowEvent', () => {
  function makeStageRow(overrides: Partial<StageRow> = {}): StageRow {
    return {
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: 1,
      title: 'Test Stage',
      status: 'Not Started',
      kanban_column: 'backlog',
      refinement_type: null,
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      file_path: '/fake/path.md',
      last_synced: new Date().toISOString(),
      ...overrides,
    };
  }

  it('returns null for empty stages array', () => {
    expect(computeWorkflowEvent([])).toBeNull();
  });

  it('returns null when all stages are Not Started', () => {
    const stages = [
      makeStageRow({ status: 'Not Started' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Not Started' }),
    ];
    expect(computeWorkflowEvent(stages)).toBeNull();
  });

  it('returns all_stages_done when all stages are Complete', () => {
    const stages = [
      makeStageRow({ status: 'Complete' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Complete' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('all_stages_done');
  });

  it('returns stage_pr_created when any stage has pr_url', () => {
    const stages = [
      makeStageRow({ status: 'Build', pr_url: 'https://github.com/pr/1' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Not Started' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('stage_pr_created');
  });

  it('returns first_stage_design when any stage is in progress', () => {
    const stages = [
      makeStageRow({ status: 'Design' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Not Started' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('first_stage_design');
  });

  it('prioritizes all_stages_done over stage_pr_created', () => {
    // All complete, one has a PR URL (leftover from when it was in progress)
    const stages = [
      makeStageRow({ status: 'Complete', pr_url: 'https://github.com/pr/1' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Complete' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('all_stages_done');
  });

  it('prioritizes stage_pr_created over first_stage_design', () => {
    const stages = [
      makeStageRow({ status: 'Design' }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Build', pr_url: 'https://pr/2' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('stage_pr_created');
  });

  it('ignores empty string pr_url', () => {
    const stages = [
      makeStageRow({ status: 'Design', pr_url: '' }),
    ];
    expect(computeWorkflowEvent(stages)).toBe('first_stage_design');
  });

  it('does not treat null status as in-progress', () => {
    const stages = [
      makeStageRow({ status: null }),
      makeStageRow({ id: 'STAGE-001-001-002', status: 'Not Started' }),
    ];
    expect(computeWorkflowEvent(stages)).toBeNull();
  });
});

describe('jiraSync', () => {
  let tmpDir: string;
  let repoDir: string;
  let dbPath: string;
  let db: KanbanDatabase;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-jira-sync-'));
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'epics'), { recursive: true });

    // Write config file
    fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), testConfigYaml);

    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);

    // Save and clear WORKFLOW_JIRA_CONFIRM env var
    savedEnv = process.env['WORKFLOW_JIRA_CONFIRM'];
    delete process.env['WORKFLOW_JIRA_CONFIRM'];
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Restore env var
    if (savedEnv !== undefined) {
      process.env['WORKFLOW_JIRA_CONFIRM'] = savedEnv;
    } else {
      delete process.env['WORKFLOW_JIRA_CONFIRM'];
    }
  });

  // ─── Event computation via full integration ────────────────────────────

  describe('all stages complete', () => {
    it('transitions to all_stages_done status', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Complete');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('all_stages_done');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].description).toBe('Transition to "Done"');
      expect(result.actions[0].executed).toBe(true);
    });
  });

  describe('any stage has PR', () => {
    it('transitions to stage_pr_created status', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Build', 'https://github.com/pr/1', 1);
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Not Started');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('stage_pr_created');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].description).toBe('Transition to "In Review"');
      expect(result.actions[0].executed).toBe(true);
    });
  });

  describe('any stage in progress', () => {
    it('transitions to first_stage_design status and assigns', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Not Started');

      const transitionSpy = vi.fn(async () => ({
        key: 'PROJ-1234',
        success: true,
        previous_status: 'To Do',
        new_status: 'In Progress',
      }));
      const assignSpy = vi.fn(async () => ({
        key: 'PROJ-1234',
        success: true,
      }));

      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
        assignTicket: assignSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('first_stage_design');
      expect(result.actions).toHaveLength(2);

      // Transition action
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].description).toBe('Transition to "In Progress"');
      expect(result.actions[0].executed).toBe(true);
      expect(transitionSpy).toHaveBeenCalledWith('PROJ-1234', 'In Progress');

      // Assign action
      expect(result.actions[1].type).toBe('assign');
      expect(result.actions[1].description).toBe('Assign to "testuser"');
      expect(result.actions[1].executed).toBe(true);
      expect(assignSpy).toHaveBeenCalledWith('PROJ-1234', 'testuser');
    });
  });

  describe('all stages Not Started', () => {
    it('returns no actions', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Not Started');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Not Started');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBeNull();
      expect(result.actions).toHaveLength(0);
    });
  });

  describe('ticket with no stages', () => {
    it('returns no actions', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      // No stages created

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBeNull();
      expect(result.actions).toHaveLength(0);
    });
  });

  // ─── Error cases ──────────────────────────────────────────────────────

  describe('error cases', () => {
    it('throws when ticket has no jira_key', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', null);

      const executor = createMockExecutor();

      await expect(
        jiraSync({ ticketId: 'TICKET-001-001', repoPath: repoDir }, executor, db),
      ).rejects.toThrow('Ticket TICKET-001-001 has no jira_key');
    });

    it('throws when writing_script is not configured', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');

      const executor = createMockExecutor({
        canWrite: () => false,
      });

      await expect(
        jiraSync({ ticketId: 'TICKET-001-001', repoPath: repoDir }, executor, db),
      ).rejects.toThrow('Jira writing not configured');
    });

    it('throws when jira is not configured', async () => {
      // Write config without jira section
      const noJiraConfig = `
workflow:
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
        - Done
`;
      fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), noJiraConfig);

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');

      // Do NOT pass an executor — let it try to create one from config
      await expect(
        jiraSync({ ticketId: 'TICKET-001-001', repoPath: repoDir }, undefined, db),
      ).rejects.toThrow("Jira integration not configured");
    });

    it('throws when ticket not found in database', async () => {
      createEpic(repoDir, 'EPIC-001');
      // Don't create the ticket

      const executor = createMockExecutor();

      await expect(
        jiraSync({ ticketId: 'TICKET-999-999', repoPath: repoDir }, executor, db),
      ).rejects.toThrow('Ticket TICKET-999-999 not found in database');
    });
  });

  // ─── Dry run ──────────────────────────────────────────────────────────

  describe('dry run', () => {
    it('lists actions but does not execute them', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const transitionSpy = vi.fn();
      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir, dryRun: true },
        executor,
        db,
      );

      expect(result.dry_run).toBe(true);
      expect(result.event).toBe('all_stages_done');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].executed).toBe(false);
      expect(transitionSpy).not.toHaveBeenCalled();
    });
  });

  // ─── WORKFLOW_JIRA_CONFIRM ────────────────────────────────────────────

  describe('WORKFLOW_JIRA_CONFIRM', () => {
    it('sets confirmation_needed when env var is true', async () => {
      process.env['WORKFLOW_JIRA_CONFIRM'] = 'true';

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const transitionSpy = vi.fn();
      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.confirmation_needed).toBe(true);
      expect(result.dry_run).toBe(false);
      expect(result.actions[0].executed).toBe(false);
      expect(transitionSpy).not.toHaveBeenCalled();
    });

    it('sets confirmation_needed when config default is true', async () => {
      // Write config with WORKFLOW_JIRA_CONFIRM default
      const confirmConfig = `
workflow:
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
        - Done
  defaults:
    WORKFLOW_JIRA_CONFIRM: true
jira:
  reading_script: /fake/read-script.ts
  writing_script: /fake/write-script.ts
  project: TEST
  status_map:
    all_stages_done: Done
`;
      fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), confirmConfig);

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const transitionSpy = vi.fn();
      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.confirmation_needed).toBe(true);
      expect(result.actions[0].executed).toBe(false);
      expect(transitionSpy).not.toHaveBeenCalled();
    });

    it('env var overrides config default (env false, config true)', async () => {
      process.env['WORKFLOW_JIRA_CONFIRM'] = 'false';

      const confirmConfig = `
workflow:
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
        - Done
  defaults:
    WORKFLOW_JIRA_CONFIRM: true
jira:
  reading_script: /fake/read-script.ts
  writing_script: /fake/write-script.ts
  project: TEST
  status_map:
    all_stages_done: Done
`;
      fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), confirmConfig);

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const transitionSpy = vi.fn(async () => ({
        key: 'PROJ-1234',
        success: true,
        previous_status: 'To Do',
        new_status: 'Done',
      }));
      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.confirmation_needed).toBe(false);
      expect(result.actions[0].executed).toBe(true);
      expect(transitionSpy).toHaveBeenCalled();
    });
  });

  // ─── Status map missing key ───────────────────────────────────────────

  describe('status map missing key', () => {
    it('skips transition with warning when no mapping for event', async () => {
      // Config with incomplete status_map (missing first_stage_design)
      const partialMapConfig = `
workflow:
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
        - Done
jira:
  reading_script: /fake/read-script.ts
  writing_script: /fake/write-script.ts
  project: TEST
  assignee: testuser
  status_map:
    stage_pr_created: In Review
    all_stages_done: Done
`;
      fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), partialMapConfig);

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');

      const transitionSpy = vi.fn();
      const assignSpy = vi.fn(async () => ({ key: 'PROJ-1234', success: true }));
      const executor = createMockExecutor({
        transitionTicket: transitionSpy,
        assignTicket: assignSpy,
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('first_stage_design');
      // First action: transition warning (skipped)
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].error).toContain('No Jira status mapping configured');
      expect(result.actions[0].executed).toBe(false);
      expect(transitionSpy).not.toHaveBeenCalled();

      // Second action: assign (should still execute)
      expect(result.actions[1].type).toBe('assign');
      expect(result.actions[1].executed).toBe(true);
      expect(assignSpy).toHaveBeenCalled();
    });
  });

  // ─── Assignment behavior ──────────────────────────────────────────────

  describe('assignment behavior', () => {
    it('triggers assignment on first_stage_design', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');

      const assignSpy = vi.fn(async () => ({ key: 'PROJ-1234', success: true }));
      const executor = createMockExecutor({ assignTicket: assignSpy });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      const assignAction = result.actions.find((a) => a.type === 'assign');
      expect(assignAction).toBeDefined();
      expect(assignAction!.executed).toBe(true);
      expect(assignSpy).toHaveBeenCalledWith('PROJ-1234', 'testuser');
    });

    it('does NOT trigger assignment on stage_pr_created', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Build', 'https://github.com/pr/1', 1);

      const assignSpy = vi.fn();
      const executor = createMockExecutor({ assignTicket: assignSpy });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      const assignAction = result.actions.find((a) => a.type === 'assign');
      expect(assignAction).toBeUndefined();
      expect(assignSpy).not.toHaveBeenCalled();
    });

    it('does NOT trigger assignment on all_stages_done', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const assignSpy = vi.fn();
      const executor = createMockExecutor({ assignTicket: assignSpy });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      const assignAction = result.actions.find((a) => a.type === 'assign');
      expect(assignAction).toBeUndefined();
      expect(assignSpy).not.toHaveBeenCalled();
    });

    it('uses null assignee when config has no assignee', async () => {
      const noAssigneeConfig = `
workflow:
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
        - Done
jira:
  reading_script: /fake/read-script.ts
  writing_script: /fake/write-script.ts
  project: TEST
  status_map:
    first_stage_design: In Progress
`;
      fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), noAssigneeConfig);

      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');

      const assignSpy = vi.fn(async () => ({ key: 'PROJ-1234', success: true }));
      const executor = createMockExecutor({ assignTicket: assignSpy });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      const assignAction = result.actions.find((a) => a.type === 'assign');
      expect(assignAction).toBeDefined();
      expect(assignAction!.description).toBe('Assign to authenticated user (default)');
      expect(assignSpy).toHaveBeenCalledWith('PROJ-1234', null);
    });
  });

  // ─── Error handling per-action ────────────────────────────────────────

  describe('error handling per-action', () => {
    it('captures transition error without throwing', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');

      const executor = createMockExecutor({
        transitionTicket: async () => {
          throw new Error('Jira API error: transition not allowed');
        },
        assignTicket: async () => ({ key: 'PROJ-1234', success: true }),
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      // Transition should have error
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].executed).toBe(false);
      expect(result.actions[0].error).toBe('Jira API error: transition not allowed');

      // Assign should still succeed
      expect(result.actions[1].type).toBe('assign');
      expect(result.actions[1].executed).toBe(true);
      expect(result.actions[1].error).toBeUndefined();
    });

    it('captures assign error without throwing', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');

      const executor = createMockExecutor({
        transitionTicket: async () => ({
          key: 'PROJ-1234',
          success: true,
          previous_status: 'To Do',
          new_status: 'In Progress',
        }),
        assignTicket: async () => {
          throw new Error('Assignment forbidden');
        },
      });

      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      // Transition should succeed
      expect(result.actions[0].type).toBe('transition');
      expect(result.actions[0].executed).toBe(true);

      // Assign should have error
      expect(result.actions[1].type).toBe('assign');
      expect(result.actions[1].executed).toBe(false);
      expect(result.actions[1].error).toBe('Assignment forbidden');
    });
  });

  // ─── Multiple stages: highest event wins ──────────────────────────────

  describe('multiple stages event priority', () => {
    it('all_stages_done wins even when some had PRs', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete', 'https://pr/1', 1);
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Complete');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('all_stages_done');
    });

    it('stage_pr_created wins over first_stage_design', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Design');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Build', 'https://pr/2', 2);
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-003', 'Not Started');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('stage_pr_created');
    });

    it('first_stage_design when mixed in-progress and not-started, no PRs', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Build');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-002', 'Not Started');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.event).toBe('first_stage_design');
    });
  });

  // ─── Cross-repo stage isolation ──────────────────────────────────

  describe('cross-repo stage isolation', () => {
    it('only considers stages from the correct repo, ignoring same ticket ID in other repos', async () => {
      // Set up the primary repo with a ticket whose stages are all "Not Started"
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-1234');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Not Started');

      // Sync the primary repo into the DB so it gets a repo_id
      const config = {
        workflow: testConfig.workflow,
        jira: testConfig.jira,
      };
      syncRepo({ repoPath: repoDir, db, config });

      // Now insert a "different repo" with a stage that has the same ticket_id
      // but status "Complete" -- if cross-repo leaks, jiraSync would see all_stages_done
      const repoRepo = new RepoRepository(db);
      const otherRepoId = repoRepo.upsert('/other/repo', 'other-repo');

      const epicRepo = new EpicRepository(db);
      epicRepo.upsert({
        id: 'EPIC-001',
        repo_id: otherRepoId,
        title: 'Other Epic',
        status: 'Not Started',
        jira_key: null,
        file_path: '/other/repo/epics/EPIC-001/EPIC-001.md',
        last_synced: new Date().toISOString(),
      });

      const ticketRepo = new TicketRepository(db);
      ticketRepo.upsert({
        id: 'TICKET-001-001',
        epic_id: 'EPIC-001',
        repo_id: otherRepoId,
        title: 'Other Ticket',
        status: 'Not Started',
        jira_key: 'OTHER-999',
        source: 'jira',
        has_stages: 1,
        file_path: '/other/repo/epics/EPIC-001/TICKET-001-001.md',
        last_synced: new Date().toISOString(),
      });

      const stageRepo = new StageRepository(db);
      stageRepo.upsert({
        id: 'STAGE-OTHER-001',
        ticket_id: 'TICKET-001-001',
        epic_id: 'EPIC-001',
        repo_id: otherRepoId,
        title: 'Other Stage',
        status: 'Complete',
        kanban_column: 'done',
        refinement_type: null,
        worktree_branch: null,
        pr_url: null,
        pr_number: null,
        priority: 0,
        due_date: null,
        session_active: 0,
        locked_at: null,
        locked_by: null,
        file_path: '/other/repo/epics/EPIC-001/STAGE-OTHER-001.md',
        last_synced: new Date().toISOString(),
      });

      // Verify the cross-repo stage exists in the DB
      const allStagesForTicket = stageRepo.listByTicket('TICKET-001-001');
      expect(allStagesForTicket).toHaveLength(2); // one from each repo

      // Run jiraSync for the primary repo -- should only see the "Not Started" stage
      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      // The primary repo's stage is "Not Started", so event should be null (no action)
      // If the bug were present, it would see the other repo's "Complete" stage too
      // and compute all_stages_done
      expect(result.event).toBeNull();
      expect(result.actions).toHaveLength(0);
    });
  });

  // ─── Result structure ─────────────────────────────────────────────────

  describe('result structure', () => {
    it('includes ticket_id and jira_key in result', async () => {
      createEpic(repoDir, 'EPIC-001');
      createTicket(repoDir, 'EPIC-001', 'TICKET-001-001', 'PROJ-5678');
      createStage(repoDir, 'EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001', 'Complete');

      const executor = createMockExecutor();
      const result = await jiraSync(
        { ticketId: 'TICKET-001-001', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.ticket_id).toBe('TICKET-001-001');
      expect(result.jira_key).toBe('PROJ-5678');
    });
  });
});
