import { describe, it, expect } from 'vitest';
import { validateWorkItems } from '../../../src/cli/logic/validate.js';
import type { ValidateEpicRow, ValidateTicketRow, ValidateStageRow, ValidateDependencyRow, ValidateJiraLinkRow } from '../../../src/cli/logic/validate.js';

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
    jira_links: [],
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
    pending_merge_parents: [],
    is_draft: false,
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

  // --- pending_merge_parents validation ---

  describe('pending_merge_parents', () => {
    it('no error when pending_merge_parents references valid stage_id', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({
            id: 'STAGE-001',
            status: 'PR Created',
            worktree_branch: 'branch-a',
            file_path: 'S1.md',
            pending_merge_parents: [],
          }),
          makeStage({
            id: 'STAGE-002',
            status: 'Build',
            worktree_branch: 'branch-b',
            file_path: 'S2.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-001', branch: 'branch-a', pr_url: 'https://example.com/pr/1', pr_number: 1 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001', 'STAGE-002']),
        validStatuses: new Set(['Not Started', 'In Progress', 'Build', 'PR Created', 'Complete']),
      });
      expect(result.errors.filter((e) => e.field === 'pending_merge_parents')).toHaveLength(0);
    });

    it('reports error when pending_merge_parents references non-existent stage_id', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({
            id: 'STAGE-001',
            worktree_branch: 'branch-a',
            file_path: 'S1.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-999', branch: 'branch-x', pr_url: 'https://example.com/pr/99', pr_number: 99 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001']),
        validStatuses: new Set(['Not Started']),
      });
      expect(result.errors.some((e) => e.field === 'pending_merge_parents' && e.error.includes('STAGE-999'))).toBe(true);
    });

    it('no warning when parent stage is in PR Created', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({ id: 'STAGE-001', status: 'PR Created', worktree_branch: 'b-1', file_path: 'S1.md' }),
          makeStage({
            id: 'STAGE-002',
            status: 'Build',
            worktree_branch: 'b-2',
            file_path: 'S2.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-001', branch: 'b-1', pr_url: 'https://example.com/pr/1', pr_number: 1 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001', 'STAGE-002']),
        validStatuses: new Set(['Not Started', 'Build', 'PR Created']),
      });
      expect(result.warnings.filter((w) => w.field === 'pending_merge_parents')).toHaveLength(0);
    });

    it('no warning when parent stage is in Addressing Comments', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({ id: 'STAGE-001', status: 'Addressing Comments', worktree_branch: 'b-1', file_path: 'S1.md' }),
          makeStage({
            id: 'STAGE-002',
            status: 'Build',
            worktree_branch: 'b-2',
            file_path: 'S2.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-001', branch: 'b-1', pr_url: 'https://example.com/pr/1', pr_number: 1 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001', 'STAGE-002']),
        validStatuses: new Set(['Not Started', 'Build', 'Addressing Comments']),
      });
      expect(result.warnings.filter((w) => w.field === 'pending_merge_parents')).toHaveLength(0);
    });

    it('warns when parent stage is in Build (stale entry)', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({ id: 'STAGE-001', status: 'Build', worktree_branch: 'b-1', file_path: 'S1.md' }),
          makeStage({
            id: 'STAGE-002',
            status: 'PR Created',
            worktree_branch: 'b-2',
            file_path: 'S2.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-001', branch: 'b-1', pr_url: 'https://example.com/pr/1', pr_number: 1 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001', 'STAGE-002']),
        validStatuses: new Set(['Not Started', 'Build', 'PR Created']),
      });
      const pmpWarnings = result.warnings.filter((w) => w.field === 'pending_merge_parents');
      expect(pmpWarnings).toHaveLength(1);
      expect(pmpWarnings[0].warning).toContain('STAGE-001');
      expect(pmpWarnings[0].warning).toContain('Build');
    });

    it('warns when is_draft is true with empty pending_merge_parents', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({
            id: 'STAGE-001',
            is_draft: true,
            pending_merge_parents: [],
            worktree_branch: 'b-1',
            file_path: 'S1.md',
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001']),
        validStatuses: new Set(['Not Started']),
      });
      const draftWarnings = result.warnings.filter((w) => w.field === 'is_draft');
      expect(draftWarnings).toHaveLength(1);
      expect(draftWarnings[0].warning).toContain('draft');
    });

    it('no warning when is_draft is false with non-empty pending_merge_parents', () => {
      const result = validateWorkItems({
        epics: [],
        tickets: [],
        stages: [
          makeStage({
            id: 'STAGE-001',
            status: 'PR Created',
            worktree_branch: 'b-1',
            file_path: 'S1.md',
          }),
          makeStage({
            id: 'STAGE-002',
            is_draft: false,
            worktree_branch: 'b-2',
            file_path: 'S2.md',
            pending_merge_parents: [
              { stage_id: 'STAGE-001', branch: 'b-1', pr_url: 'https://example.com/pr/1', pr_number: 1 },
            ],
          }),
        ],
        dependencies: [],
        allIds: new Set(['STAGE-001', 'STAGE-002']),
        validStatuses: new Set(['Not Started', 'PR Created']),
      });
      expect(result.warnings.filter((w) => w.field === 'is_draft')).toHaveLength(0);
    });
  });

  // --- jira_links validation ---

  describe('jira_links', () => {
    it('no error when jira_links has all required fields', () => {
      const result = validateWorkItems({
        epics: [makeEpic()],
        tickets: [
          makeTicket({
            jira_links: [
              { type: 'confluence', url: 'https://wiki.example.com/page', title: 'Design Doc' },
            ],
          }),
        ],
        stages: [makeStage()],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
      });
      expect(result.errors.filter((e) => e.field === 'jira_links')).toHaveLength(0);
    });

    it('reports error when jira_links entry is missing type', () => {
      const result = validateWorkItems({
        epics: [makeEpic()],
        tickets: [
          makeTicket({
            jira_links: [
              { url: 'https://wiki.example.com/page', title: 'Design Doc' } as ValidateJiraLinkRow,
            ],
          }),
        ],
        stages: [makeStage()],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
      });
      const linkErrors = result.errors.filter((e) => e.field === 'jira_links');
      expect(linkErrors.some((e) => e.error.includes('"type"'))).toBe(true);
    });

    it('reports error when jira_links entry has invalid type value', () => {
      const result = validateWorkItems({
        epics: [makeEpic()],
        tickets: [
          makeTicket({
            jira_links: [
              { type: 'invalid_type', url: 'https://example.com', title: 'Something' },
            ],
          }),
        ],
        stages: [makeStage()],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
      });
      const linkErrors = result.errors.filter((e) => e.field === 'jira_links');
      expect(linkErrors.some((e) => e.error.includes('invalid_type'))).toBe(true);
    });

    it('no error when jira_links is empty array', () => {
      const result = validateWorkItems({
        epics: [makeEpic()],
        tickets: [makeTicket({ jira_links: [] })],
        stages: [makeStage()],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
      });
      expect(result.errors.filter((e) => e.field === 'jira_links')).toHaveLength(0);
    });

    it('no error when jira_links field defaults to empty', () => {
      // The makeTicket helper defaults jira_links to []
      const result = validateWorkItems({
        epics: [makeEpic()],
        tickets: [makeTicket()],
        stages: [makeStage()],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'TICKET-001-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
      });
      expect(result.errors.filter((e) => e.field === 'jira_links')).toHaveLength(0);
    });
  });

  // --- Global mode tests ---

  describe('global mode', () => {
    it('global mode validates all repos', () => {
      const epic1 = makeEpic({ id: 'EPIC-REPO1', tickets: ['TICKET-REPO1-001'], repo: 'repo1' });
      const ticket1 = makeTicket({ id: 'TICKET-REPO1-001', epic_id: 'EPIC-REPO1', stages: ['STAGE-REPO1-001'], repo: 'repo1' });
      const stage1 = makeStage({ id: 'STAGE-REPO1-001', ticket_id: 'TICKET-REPO1-001', worktree_branch: 'branch-repo1', repo: 'repo1' });

      const epic2 = makeEpic({ id: 'EPIC-REPO2', title: 'Feature', tickets: ['TICKET-REPO2-001'], repo: 'repo2' });
      const ticket2 = makeTicket({ id: 'TICKET-REPO2-001', epic_id: 'EPIC-REPO2', stages: ['STAGE-REPO2-001'], repo: 'repo2' });
      const stage2 = makeStage({ id: 'STAGE-REPO2-001', ticket_id: 'TICKET-REPO2-001', worktree_branch: 'branch-repo2', repo: 'repo2' });

      const result = validateWorkItems({
        epics: [epic1, epic2],
        tickets: [ticket1, ticket2],
        stages: [stage1, stage2],
        dependencies: [],
        allIds: new Set(['EPIC-REPO1', 'TICKET-REPO1-001', 'STAGE-REPO1-001', 'EPIC-REPO2', 'TICKET-REPO2-001', 'STAGE-REPO2-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
        global: true,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('global mode reports error for reference to non-existent item', () => {
      const epic = makeEpic({ depends_on: ['MISSING-ID'], repo: 'repo1' });

      const result = validateWorkItems({
        epics: [epic],
        tickets: [],
        stages: [],
        dependencies: [],
        allIds: new Set(['EPIC-001']),
        validStatuses: new Set(['In Progress']),
        global: true,
      });
      expect(result.valid).toBe(false);
      const err = result.errors.find((e) => e.error.includes('MISSING-ID'));
      expect(err).toBeDefined();
      expect(err?.repo).toBe('repo1');
    });

    it('global mode detects cross-repo circular dependencies', () => {
      const ticket1 = makeTicket({ id: 'T1', depends_on: ['T2'], repo: 'repo1', file_path: 't1.md' });
      const ticket2 = makeTicket({ id: 'T2', depends_on: ['T1'], repo: 'repo2', file_path: 't2.md' });

      const result = validateWorkItems({
        epics: [],
        tickets: [ticket1, ticket2],
        stages: [],
        dependencies: [
          { from_id: 'T1', to_id: 'T2', resolved: false },
          { from_id: 'T2', to_id: 'T1', resolved: false },
        ],
        allIds: new Set(['T1', 'T2']),
        validStatuses: new Set(['In Progress']),
        global: true,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.error.toLowerCase().includes('circular'))).toBe(true);
    });

    it('global mode enforces type rules across repos', () => {
      const epic = makeEpic({ depends_on: ['STAGE-001-001-001'], repo: 'repo1' });
      const stage = makeStage({ id: 'STAGE-001-001-001', repo: 'repo2' });

      const result = validateWorkItems({
        epics: [epic],
        tickets: [],
        stages: [stage],
        dependencies: [],
        allIds: new Set(['EPIC-001', 'STAGE-001-001-001']),
        validStatuses: new Set(['Not Started', 'In Progress']),
        global: true,
      });
      expect(result.valid).toBe(false);
      const err = result.errors.find((e) => e.error.includes('cannot depend on'));
      expect(err).toBeDefined();
      expect(err?.repo).toBe('repo1');
    });

    it('global mode errors include repo field', () => {
      const ticket = makeTicket({ title: '', repo: 'repo1' });

      const result = validateWorkItems({
        epics: [],
        tickets: [ticket],
        stages: [],
        dependencies: [],
        allIds: new Set(['TICKET-001-001']),
        validStatuses: new Set(['In Progress']),
        global: true,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].repo).toBe('repo1');
    });

    it('global mode includes repos array in output', () => {
      const epic = makeEpic({ tickets: [], repo: 'repo1' });

      const result = validateWorkItems({
        epics: [epic],
        tickets: [],
        stages: [],
        dependencies: [],
        allIds: new Set(['EPIC-001']),
        validStatuses: new Set(['In Progress']),
        global: true,
      });
      expect(result.valid).toBe(true);
      // Note: repos array is added by the command, not by validateWorkItems
      // This test verifies the input accepts global: true
    });

    it('without --global, cross-repo deps produce errors for unresolvable refs', () => {
      const ticket = makeTicket({ depends_on: ['NONEXISTENT-ID'] });

      const result = validateWorkItems({
        epics: [],
        tickets: [ticket],
        stages: [],
        dependencies: [],
        allIds: new Set(['TICKET-001-001']),
        validStatuses: new Set(['In Progress']),
        global: false,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.error.includes('NONEXISTENT-ID'))).toBe(true);
      // Error should not have repo field when global: false or not set
      const err = result.errors.find((e) => e.error.includes('NONEXISTENT-ID'));
      expect(err?.repo).toBeUndefined();
    });
  });
});
