import { describe, it, expect } from 'vitest';
import type {
  Epic,
  Ticket,
  Stage,
  Dependency,
  WorkItemType,
  RepoRecord,
} from '../../src/types/work-items.js';
import {
  SYSTEM_COLUMNS,
  type KanbanColumn,
} from '../../src/types/work-items.js';

describe('Work Item Types', () => {
  it('SYSTEM_COLUMNS contains the four fixed columns', () => {
    expect(SYSTEM_COLUMNS).toEqual([
      'To Convert',
      'Backlog',
      'Ready for Work',
      'Done',
    ]);
  });

  it('Epic interface has required fields', () => {
    const epic: Epic = {
      id: 'EPIC-001',
      title: 'User Authentication',
      status: 'In Progress',
      jira_key: null,
      tickets: ['TICKET-001-001'],
      depends_on: [],
      file_path: '/repo/epics/EPIC-001.md',
    };
    expect(epic.id).toBe('EPIC-001');
    expect(epic.tickets).toHaveLength(1);
  });

  it('Ticket interface has required fields', () => {
    const ticket: Ticket = {
      id: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Flow',
      status: 'In Progress',
      jira_key: null,
      source: 'local',
      stages: ['STAGE-001-001-001'],
      depends_on: [],
      file_path: '/repo/epics/TICKET-001-001.md',
    };
    expect(ticket.id).toBe('TICKET-001-001');
    expect(ticket.source).toBe('local');
  });

  it('Stage interface has required fields including session_active', () => {
    const stage: Stage = {
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form',
      status: 'Design',
      session_active: false,
      refinement_type: ['frontend'],
      depends_on: ['STAGE-001-001-002'],
      worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
      priority: 0,
      due_date: null,
      file_path: '/repo/epics/STAGE-001-001-001.md',
    };
    expect(stage.session_active).toBe(false);
    expect(stage.refinement_type).toContain('frontend');
  });

  it('Dependency interface has required fields', () => {
    const dep: Dependency = {
      from_id: 'STAGE-001-001-001',
      to_id: 'STAGE-001-001-002',
      from_type: 'stage',
      to_type: 'stage',
    };
    expect(dep.from_type).toBe('stage');
  });

  it('WorkItemType is a union of epic, ticket, stage', () => {
    const types: WorkItemType[] = ['epic', 'ticket', 'stage'];
    expect(types).toHaveLength(3);
  });

  it('KanbanColumn accepts system columns and string pipeline columns', () => {
    const col1: KanbanColumn = 'Backlog';
    const col2: KanbanColumn = 'Design';
    expect(col1).toBe('Backlog');
    expect(col2).toBe('Design');
  });

  it('RepoRecord interface has required fields', () => {
    const repo: RepoRecord = {
      id: 1,
      path: '/home/user/project',
      name: 'project',
      registered_at: '2026-01-01T00:00:00.000Z',
    };
    expect(repo.id).toBe(1);
    expect(repo.path).toBe('/home/user/project');
  });
});
