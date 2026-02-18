import { describe, it, expect } from 'vitest';
import { validateWorkItems } from '../../../src/cli/logic/validate.js';
import type { ValidateEpicRow, ValidateTicketRow, ValidateStageRow, ValidateDependencyRow } from '../../../src/cli/logic/validate.js';

function makeEpic(overrides: Partial<ValidateEpicRow> = {}): ValidateEpicRow {
  return {
    id: 'EPIC-001',
    title: 'Auth',
    status: 'In Progress',
    jira_key: null,
    tickets: ['TICKET-001-001'],
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/EPIC-001.md',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<ValidateTicketRow> = {}): ValidateTicketRow {
  return {
    id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Login',
    status: 'In Progress',
    jira_key: null,
    source: 'local',
    stages: ['STAGE-001-001-001'],
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/TICKET-001-001-login/TICKET-001-001.md',
    ...overrides,
  };
}

function makeStage(overrides: Partial<ValidateStageRow> = {}): ValidateStageRow {
  return {
    id: 'STAGE-001-001-001',
    ticket_id: 'TICKET-001-001',
    epic_id: 'EPIC-001',
    title: 'Login Form',
    status: 'Not Started',
    refinement_type: '["frontend"]',
    worktree_branch: 'epic-001/ticket-001-001/stage-001-001-001',
    priority: 0,
    due_date: null,
    session_active: false,
    depends_on: [],
    file_path: 'epics/EPIC-001-auth/TICKET-001-001-login/STAGE-001-001-001.md',
    ...overrides,
  };
}

describe('validateWorkItems', () => {
  it('returns valid when everything is consistent', () => {
    const result = validateWorkItems({
      epics: [makeEpic()],
      tickets: [makeTicket()],
      stages: [makeStage()],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete', 'Design', 'Build']),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error for depends_on referencing non-existent ID', () => {
    const result = validateWorkItems({
      epics: [makeEpic()],
      tickets: [makeTicket()],
      stages: [makeStage({ depends_on: ['STAGE-999-999-999'] })],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toContain('STAGE-999-999-999');
    expect(result.errors[0].field).toBe('depends_on');
  });

  it('reports error for circular dependencies', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [
        makeStage({ id: 'S1', depends_on: ['S2'], file_path: 'S1.md' }),
        makeStage({ id: 'S2', depends_on: ['S1'], file_path: 'S2.md' }),
      ],
      dependencies: [
        { from_id: 'S1', to_id: 'S2', resolved: false },
        { from_id: 'S2', to_id: 'S1', resolved: false },
      ],
      allIds: new Set(['S1', 'S2']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.toLowerCase().includes('circular'))).toBe(true);
  });

  it('reports warning for tickets without stages', () => {
    const result = validateWorkItems({
      epics: [makeEpic({ tickets: ['TICKET-001-001'] })],
      tickets: [makeTicket({ stages: [] })],
      stages: [],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'TICKET-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].warning).toContain('no stages');
  });

  it('reports error for invalid status values', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [makeStage({ status: 'InvalidStatus' })],
      dependencies: [],
      allIds: new Set(['STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress', 'Complete', 'Design', 'Build']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('InvalidStatus'))).toBe(true);
  });

  it('reports error for duplicate worktree_branch values', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [
        makeStage({ id: 'S1', worktree_branch: 'branch-1', file_path: 'S1.md' }),
        makeStage({ id: 'S2', worktree_branch: 'branch-1', file_path: 'S2.md' }),
      ],
      dependencies: [],
      allIds: new Set(['S1', 'S2']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('worktree_branch'))).toBe(true);
  });

  it('reports error when epic tickets array references non-existent ticket', () => {
    const result = validateWorkItems({
      epics: [makeEpic({ tickets: ['TICKET-999-999'] })],
      tickets: [],
      stages: [],
      dependencies: [],
      allIds: new Set(['EPIC-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('TICKET-999-999'))).toBe(true);
  });

  it('reports error when ticket stages array references non-existent stage', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [makeTicket({ stages: ['STAGE-999-999-999'] })],
      stages: [],
      dependencies: [],
      allIds: new Set(['TICKET-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('STAGE-999-999-999'))).toBe(true);
  });

  it('reports error for invalid cross-entity dependency types', () => {
    // Epics can only depend on epics. Stages can depend on stages/tickets/epics.
    // Tickets can depend on tickets/epics.
    const result = validateWorkItems({
      epics: [makeEpic({ depends_on: ['STAGE-001-001-001'] })],
      tickets: [],
      stages: [makeStage()],
      dependencies: [],
      allIds: new Set(['EPIC-001', 'STAGE-001-001-001']),
      validStatuses: new Set(['Not Started', 'In Progress']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.toLowerCase().includes('invalid dependency type') || e.error.toLowerCase().includes('cannot depend on'))).toBe(true);
  });

  it('reports missing required fields as errors', () => {
    const result = validateWorkItems({
      epics: [],
      tickets: [],
      stages: [makeStage({ title: '' })],
      dependencies: [],
      allIds: new Set(['STAGE-001-001-001']),
      validStatuses: new Set(['Not Started']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'title')).toBe(true);
  });
});
