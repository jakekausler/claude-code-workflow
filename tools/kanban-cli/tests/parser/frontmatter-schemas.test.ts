import { describe, it, expect } from 'vitest';
import {
  pendingMergeParentSchema,
  jiraLinkSchema,
  stageFrontmatterSchema,
  ticketFrontmatterSchema,
  epicFrontmatterSchema,
} from '../../src/parser/frontmatter-schemas.js';

describe('pendingMergeParentSchema', () => {
  it('parses a valid pending merge parent', () => {
    const input = {
      stage_id: 'STAGE-001',
      branch: 'feature/login',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it('rejects entry missing stage_id', () => {
    const input = {
      branch: 'feature/login',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry missing branch', () => {
    const input = {
      stage_id: 'STAGE-001',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry missing pr_url', () => {
    const input = {
      stage_id: 'STAGE-001',
      branch: 'feature/login',
      pr_number: 42,
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry missing pr_number', () => {
    const input = {
      stage_id: 'STAGE-001',
      branch: 'feature/login',
      pr_url: 'https://github.com/org/repo/pull/42',
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry with pr_number as string', () => {
    const input = {
      stage_id: 'STAGE-001',
      branch: 'feature/login',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: '42',
    };
    const result = pendingMergeParentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('jiraLinkSchema', () => {
  it('parses a valid confluence link', () => {
    const input = {
      type: 'confluence',
      url: 'https://wiki.example.com/page/123',
      title: 'Design Doc',
      key: 'SPACE-123',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('confluence');
      expect(result.data.key).toBe('SPACE-123');
    }
  });

  it('parses a valid jira_issue link', () => {
    const input = {
      type: 'jira_issue',
      url: 'https://jira.example.com/browse/PROJ-456',
      title: 'Related Issue',
      key: 'PROJ-456',
      relationship: 'blocks',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relationship).toBe('blocks');
    }
  });

  it('parses a valid attachment link', () => {
    const input = {
      type: 'attachment',
      url: 'https://jira.example.com/attachment/10001',
      title: 'screenshot.png',
      filename: 'screenshot.png',
      mime_type: 'image/png',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe('screenshot.png');
      expect(result.data.mime_type).toBe('image/png');
    }
  });

  it('parses a valid external link', () => {
    const input = {
      type: 'external',
      url: 'https://docs.google.com/doc/123',
      title: 'External Doc',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('parses a minimal link (only required fields)', () => {
    const input = {
      type: 'confluence',
      url: 'https://wiki.example.com/page/1',
      title: 'Page',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toBeUndefined();
      expect(result.data.relationship).toBeUndefined();
      expect(result.data.filename).toBeUndefined();
      expect(result.data.mime_type).toBeUndefined();
    }
  });

  it('rejects entry missing type', () => {
    const input = {
      url: 'https://example.com',
      title: 'No Type',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry missing url', () => {
    const input = {
      type: 'confluence',
      title: 'No URL',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects entry missing title', () => {
    const input = {
      type: 'confluence',
      url: 'https://example.com',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid type value', () => {
    const input = {
      type: 'invalid_type',
      url: 'https://example.com',
      title: 'Bad Type',
    };
    const result = jiraLinkSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('stageFrontmatterSchema', () => {
  const minimalStage = {
    id: 'STAGE-001',
    ticket: 'TICKET-001',
    epic: 'EPIC-001',
    title: 'Build feature',
    status: 'Design',
  };

  it('parses stage without new fields and applies defaults', () => {
    const result = stageFrontmatterSchema.safeParse(minimalStage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pending_merge_parents).toEqual([]);
      expect(result.data.is_draft).toBe(false);
      expect(result.data.mr_target_branch).toBeNull();
      // Also check existing defaults
      expect(result.data.session_active).toBe(false);
      expect(result.data.refinement_type).toEqual([]);
      expect(result.data.depends_on).toEqual([]);
      expect(result.data.worktree_branch).toBeNull();
      expect(result.data.pr_url).toBeNull();
      expect(result.data.pr_number).toBeNull();
      expect(result.data.priority).toBe(0);
      expect(result.data.due_date).toBeNull();
    }
  });

  it('parses stage with all new fields populated', () => {
    const input = {
      ...minimalStage,
      session_active: true,
      refinement_type: ['frontend'],
      depends_on: ['STAGE-002'],
      worktree_branch: 'feature/branch',
      pr_url: 'https://github.com/org/repo/pull/10',
      pr_number: 10,
      priority: 5,
      due_date: '2026-03-01',
      pending_merge_parents: [
        {
          stage_id: 'STAGE-002',
          branch: 'feature/parent',
          pr_url: 'https://github.com/org/repo/pull/9',
          pr_number: 9,
        },
      ],
      is_draft: true,
      mr_target_branch: 'main',
    };
    const result = stageFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pending_merge_parents).toHaveLength(1);
      expect(result.data.pending_merge_parents[0].stage_id).toBe('STAGE-002');
      expect(result.data.pending_merge_parents[0].pr_number).toBe(9);
      expect(result.data.is_draft).toBe(true);
      expect(result.data.mr_target_branch).toBe('main');
    }
  });

  it('rejects invalid pending_merge_parents entries (missing required fields)', () => {
    const input = {
      ...minimalStage,
      pending_merge_parents: [
        {
          stage_id: 'STAGE-002',
          // missing branch, pr_url, pr_number
        },
      ],
    };
    const result = stageFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects when required stage fields are missing', () => {
    const result = stageFrontmatterSchema.safeParse({
      id: 'STAGE-001',
      // missing ticket, epic, title, status
    });
    expect(result.success).toBe(false);
  });
});

describe('ticketFrontmatterSchema', () => {
  const minimalTicket = {
    id: 'TICKET-001',
    epic: 'EPIC-001',
    title: 'Login Flow',
    status: 'In Progress',
  };

  it('parses ticket without jira_links and defaults to empty array', () => {
    const result = ticketFrontmatterSchema.safeParse(minimalTicket);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jira_links).toEqual([]);
      // Also check existing defaults
      expect(result.data.jira_key).toBeNull();
      expect(result.data.source).toBe('local');
      expect(result.data.stages).toEqual([]);
      expect(result.data.depends_on).toEqual([]);
    }
  });

  it('parses ticket with valid jira_links', () => {
    const input = {
      ...minimalTicket,
      jira_links: [
        {
          type: 'confluence',
          url: 'https://wiki.example.com/page/1',
          title: 'Design Page',
          key: 'SPACE-1',
        },
        {
          type: 'attachment',
          url: 'https://jira.example.com/attachment/100',
          title: 'mockup.png',
          filename: 'mockup.png',
          mime_type: 'image/png',
        },
      ],
    };
    const result = ticketFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jira_links).toHaveLength(2);
      expect(result.data.jira_links[0].type).toBe('confluence');
      expect(result.data.jira_links[1].filename).toBe('mockup.png');
    }
  });

  it('rejects invalid jira_links entries (missing type/url/title)', () => {
    const input = {
      ...minimalTicket,
      jira_links: [
        {
          url: 'https://example.com',
          title: 'Missing type',
        },
      ],
    };
    const result = ticketFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid jira_links entries (invalid type value)', () => {
    const input = {
      ...minimalTicket,
      jira_links: [
        {
          type: 'unknown_type',
          url: 'https://example.com',
          title: 'Bad Type',
        },
      ],
    };
    const result = ticketFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('epicFrontmatterSchema', () => {
  it('parses a minimal epic with defaults', () => {
    const input = {
      id: 'EPIC-001',
      title: 'Auth System',
      status: 'In Progress',
    };
    const result = epicFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jira_key).toBeNull();
      expect(result.data.tickets).toEqual([]);
      expect(result.data.depends_on).toEqual([]);
    }
  });

  it('parses epic with all fields', () => {
    const input = {
      id: 'EPIC-001',
      title: 'Auth System',
      status: 'In Progress',
      jira_key: 'PROJ-100',
      tickets: ['TICKET-001', 'TICKET-002'],
      depends_on: ['EPIC-002'],
    };
    const result = epicFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jira_key).toBe('PROJ-100');
      expect(result.data.tickets).toHaveLength(2);
    }
  });
});
