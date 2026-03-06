import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../../src/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
} from '../../../src/db/repositories/index.js';
import { buildSummary } from '../../../src/cli/logic/summary.js';
import type { BuildSummaryInput, SummaryOutput } from '../../../src/cli/logic/summary.js';
import type { ClaudeExecutor } from '../../../src/utils/claude-executor.js';

// ---------- Test helpers ----------

function createMockExecutor(
  response = 'Mock LLM summary.'
): ClaudeExecutor & { calls: Array<{ prompt: string; model: string }> } {
  const calls: Array<{ prompt: string; model: string }> = [];
  return {
    calls,
    execute(prompt: string, model: string): string {
      calls.push({ prompt, model });
      return response;
    },
  };
}

describe('buildSummary', () => {
  let tmpDir: string;
  let repoDir: string;
  let db: KanbanDatabase;
  let repoId: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-summary-logic-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);

    // Create a fake repo directory with stage files
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'epics/EPIC-001/TICKET-001-001'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'epics/EPIC-001/TICKET-001-002'), { recursive: true });

    // Write stage files
    fs.writeFileSync(
      path.join(repoDir, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'),
      '---\nid: STAGE-001-001-001\ntitle: Login Form UI\nstatus: Complete\n---\n## Overview\nBuild login form.\n'
    );
    fs.writeFileSync(
      path.join(repoDir, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'),
      '---\nid: STAGE-001-001-002\ntitle: Auth API\nstatus: Not Started\n---\n## Overview\nAuth API endpoints.\n'
    );
    fs.writeFileSync(
      path.join(repoDir, 'epics/EPIC-001/TICKET-001-002/STAGE-001-002-001.md'),
      '---\nid: STAGE-001-002-001\ntitle: Signup Form\nstatus: Design\n---\n## Overview\nCreate signup form.\n'
    );

    // Seed database
    const repoRepo = new RepoRepository(db);
    repoId = repoRepo.upsert(repoDir, 'test-repo');

    const epicRepo = new EpicRepository(db);
    epicRepo.upsert({
      id: 'EPIC-001',
      repo_id: repoId,
      title: 'User Authentication',
      status: 'In Progress',
      jira_key: null,
      file_path: path.join(repoDir, 'epics/EPIC-001/EPIC-001.md'),
      last_synced: new Date().toISOString(),
    });

    const ticketRepo = new TicketRepository(db);
    ticketRepo.upsert({
      id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Flow',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      has_stages: 1,
      file_path: path.join(repoDir, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'),
      last_synced: new Date().toISOString(),
    });
    ticketRepo.upsert({
      id: 'TICKET-001-002',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Registration Flow',
      status: 'Not Started',
      jira_key: null,
      source: 'local',
      has_stages: 1,
      file_path: path.join(repoDir, 'epics/EPIC-001/TICKET-001-002/TICKET-001-002.md'),
      last_synced: new Date().toISOString(),
    });

    const stageRepo = new StageRepository(db);
    stageRepo.upsert({
      id: 'STAGE-001-001-001',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Login Form UI',
      status: 'Complete',
      kanban_column: 'done',
      refinement_type: 'frontend',
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      file_path: path.join(repoDir, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'),
      last_synced: new Date().toISOString(),
    });
    stageRepo.upsert({
      id: 'STAGE-001-001-002',
      ticket_id: 'TICKET-001-001',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Auth API',
      status: 'Not Started',
      kanban_column: 'backlog',
      refinement_type: 'backend',
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      file_path: path.join(repoDir, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'),
      last_synced: new Date().toISOString(),
    });
    stageRepo.upsert({
      id: 'STAGE-001-002-001',
      ticket_id: 'TICKET-001-002',
      epic_id: 'EPIC-001',
      repo_id: repoId,
      title: 'Signup Form',
      status: 'Design',
      kanban_column: 'ready_for_work',
      refinement_type: 'frontend',
      worktree_branch: null,
      pr_url: null,
      pr_number: null,
      priority: 0,
      due_date: null,
      session_active: 0,
      locked_at: null,
      locked_by: null,
      file_path: path.join(repoDir, 'epics/EPIC-001/TICKET-001-002/STAGE-001-002-001.md'),
      last_synced: new Date().toISOString(),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('summarizes a single stage by ID', () => {
    const executor = createMockExecutor('Stage completed login form.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-001-001-001'],
      executor,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STAGE-001-001-001');
    expect(result.items[0].type).toBe('stage');
    expect(result.items[0].title).toBe('Login Form UI');
    expect(result.items[0].summary).toBe('Stage completed login form.');
    expect(executor.calls).toHaveLength(1);
  });

  it('summarizes all stages and the ticket when given a ticket ID', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['TICKET-001-001'],
      executor,
    });

    // 2 stages + 1 ticket = 3 items
    expect(result.items).toHaveLength(3);

    const types = result.items.map((i) => i.type);
    expect(types.filter((t) => t === 'stage')).toHaveLength(2);
    expect(types.filter((t) => t === 'ticket')).toHaveLength(1);

    const ticketItem = result.items.find((i) => i.type === 'ticket');
    expect(ticketItem!.id).toBe('TICKET-001-001');
  });

  it('summarizes entire epic hierarchy when given an epic ID', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['EPIC-001'],
      executor,
    });

    // 3 stages + 2 tickets + 1 epic = 6 items
    expect(result.items).toHaveLength(6);

    const types = result.items.map((i) => i.type);
    expect(types.filter((t) => t === 'stage')).toHaveLength(3);
    expect(types.filter((t) => t === 'ticket')).toHaveLength(2);
    expect(types.filter((t) => t === 'epic')).toHaveLength(1);
  });

  it('handles multiple IDs in one call', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-001-001-001', 'STAGE-001-002-001'],
      executor,
    });

    expect(result.items).toHaveLength(2);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('STAGE-001-001-001');
    expect(ids).toContain('STAGE-001-002-001');
  });

  it('deduplicates IDs', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-001-001-001', 'STAGE-001-001-001'],
      executor,
    });

    expect(result.items).toHaveLength(1);
  });

  it('skips unknown IDs with warning', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['UNKNOWN-123'],
      executor,
    });

    expect(result.items).toHaveLength(0);
  });

  it('skips stage not found in database', () => {
    const executor = createMockExecutor('Summary text.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-999-999-999'],
      executor,
    });

    expect(result.items).toHaveLength(0);
  });

  it('passes model option through to executor', () => {
    const executor = createMockExecutor('Summary text.');
    buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-001-001-001'],
      executor,
      model: 'sonnet',
    });

    expect(executor.calls[0].model).toBe('sonnet');
  });

  it('returns empty items for empty ids array', () => {
    const executor = createMockExecutor();
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: [],
      executor,
    });

    expect(result.items).toHaveLength(0);
    expect(executor.calls).toHaveLength(0);
  });

  it('output items have summary and type fields (new format)', () => {
    const executor = createMockExecutor('New format summary.');
    const result = buildSummary({
      db,
      repoId,
      repoPath: repoDir,
      ids: ['STAGE-001-001-001'],
      executor,
    });

    const item = result.items[0];
    // New format: summary (string) + type (stage/ticket/epic)
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('cached');
    // Old format fields should NOT be present
    expect(item).not.toHaveProperty('design_decision');
    expect(item).not.toHaveProperty('what_was_built');
    expect(item).not.toHaveProperty('issues_encountered');
    expect(item).not.toHaveProperty('commit_hash');
    expect(item).not.toHaveProperty('mr_pr_url');
    expect(item).not.toHaveProperty('status');
  });
});
