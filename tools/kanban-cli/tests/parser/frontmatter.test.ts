import { describe, it, expect } from 'vitest';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
  parseFrontmatter,
  parseFrontmatterRaw,
} from '../../src/parser/frontmatter.js';
import type { Epic, Ticket, Stage } from '../../src/types/work-items.js';

describe('parseEpicFrontmatter', () => {
  it('parses a valid epic markdown file', () => {
    const content = `---
id: EPIC-001
title: User Authentication
status: In Progress
jira_key: null
tickets:
  - TICKET-001-001
  - TICKET-001-002
depends_on: []
---

# User Authentication

Epic description here.
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.id).toBe('EPIC-001');
    expect(result.title).toBe('User Authentication');
    expect(result.status).toBe('In Progress');
    expect(result.jira_key).toBeNull();
    expect(result.tickets).toEqual(['TICKET-001-001', 'TICKET-001-002']);
    expect(result.depends_on).toEqual([]);
    expect(result.file_path).toBe('/repo/epics/EPIC-001.md');
  });

  it('throws on missing id field', () => {
    const content = `---
title: No ID Epic
status: In Progress
tickets: []
depends_on: []
---
`;
    expect(() => parseEpicFrontmatter(content, '/repo/epics/bad.md')).toThrow(/id/i);
  });

  it('throws on missing title field', () => {
    const content = `---
id: EPIC-001
status: In Progress
tickets: []
depends_on: []
---
`;
    expect(() => parseEpicFrontmatter(content, '/repo/epics/bad.md')).toThrow(/title/i);
  });

  it('defaults tickets to empty array when missing', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
depends_on: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.tickets).toEqual([]);
  });

  it('defaults depends_on to empty array when missing', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.depends_on).toEqual([]);
  });

  it('handles null jira_key correctly', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
jira_key: null
tickets: []
depends_on: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.jira_key).toBeNull();
  });

  it('handles depends_on as array with entries', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets: []
depends_on:
  - EPIC-002
  - EPIC-003
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.depends_on).toEqual(['EPIC-002', 'EPIC-003']);
  });

  it('handles empty depends_on', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets: []
depends_on: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.depends_on).toEqual([]);
  });

  it('defaults ticket_statuses to empty object when missing', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets: []
depends_on: []
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.ticket_statuses).toEqual({});
  });

  it('parses ticket_statuses when present', () => {
    const content = `---
id: EPIC-001
title: Test Epic
status: In Progress
tickets:
  - TICKET-001-001
  - TICKET-001-002
depends_on: []
ticket_statuses:
  TICKET-001-001: In Progress
  TICKET-001-002: Not Started
---
`;
    const result = parseEpicFrontmatter(content, '/repo/epics/EPIC-001.md');
    expect(result.ticket_statuses).toEqual({
      'TICKET-001-001': 'In Progress',
      'TICKET-001-002': 'Not Started',
    });
  });
});

describe('parseTicketFrontmatter', () => {
  it('parses a valid ticket markdown file', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login Flow
status: In Progress
jira_key: null
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
depends_on: []
---

# Login Flow

Ticket description here.
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.id).toBe('TICKET-001-001');
    expect(result.epic).toBe('EPIC-001');
    expect(result.title).toBe('Login Flow');
    expect(result.source).toBe('local');
    expect(result.stages).toEqual(['STAGE-001-001-001', 'STAGE-001-001-002']);
  });

  it('throws on missing epic field', () => {
    const content = `---
id: TICKET-001-001
title: Login
status: In Progress
source: local
stages: []
depends_on: []
---
`;
    expect(() => parseTicketFrontmatter(content, '/repo/epics/bad.md')).toThrow(/epic/i);
  });

  it('defaults source to local when missing', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
stages: []
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.source).toBe('local');
  });

  it('defaults stages to empty array when missing', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
source: local
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.stages).toEqual([]);
  });

  it('handles null jira_key correctly', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
jira_key: null
source: local
stages: []
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.jira_key).toBeNull();
  });

  it('handles depends_on as array with entries', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
source: local
stages: []
depends_on:
  - TICKET-001-002
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.depends_on).toEqual(['TICKET-001-002']);
  });

  it('defaults stage_statuses to empty object when missing', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
source: local
stages: []
depends_on: []
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.stage_statuses).toEqual({});
  });

  it('parses stage_statuses when present', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Login
status: In Progress
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
depends_on: []
stage_statuses:
  STAGE-001-001-001: Build
  STAGE-001-001-002: Not Started
---
`;
    const result = parseTicketFrontmatter(content, '/repo/epics/TICKET-001-001.md');
    expect(result.stage_statuses).toEqual({
      'STAGE-001-001-001': 'Build',
      'STAGE-001-001-002': 'Not Started',
    });
  });
});

describe('parseStageFrontmatter', () => {
  it('parses a valid stage markdown file', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-001-001-002
worktree_branch: epic-001/ticket-001-001/stage-001-001-001
priority: 0
due_date: null
---

# Login Form

Stage description here.
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.id).toBe('STAGE-001-001-001');
    expect(result.ticket).toBe('TICKET-001-001');
    expect(result.epic).toBe('EPIC-001');
    expect(result.title).toBe('Login Form');
    expect(result.status).toBe('Design');
    expect(result.session_active).toBe(false);
    expect(result.refinement_type).toEqual(['frontend']);
    expect(result.depends_on).toEqual(['STAGE-001-001-002']);
    expect(result.worktree_branch).toBe('epic-001/ticket-001-001/stage-001-001-001');
    expect(result.priority).toBe(0);
    expect(result.due_date).toBeNull();
    // New fields should have defaults when not in frontmatter
    expect(result.pending_merge_parents).toEqual([]);
    expect(result.is_draft).toBe(false);
    expect(result.mr_target_branch).toBeNull();
  });

  it('throws on missing ticket field', () => {
    const content = `---
id: STAGE-001-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    expect(() => parseStageFrontmatter(content, '/repo/epics/bad.md')).toThrow(/ticket/i);
  });

  it('defaults session_active to false when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.session_active).toBe(false);
  });

  it('defaults priority to 0 when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.priority).toBe(0);
  });

  it('defaults refinement_type to empty array when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.refinement_type).toEqual([]);
  });

  it('parses refinement_type as array with multiple entries', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type:
  - frontend
  - backend
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.refinement_type).toEqual(['frontend', 'backend']);
  });

  it('handles null due_date correctly', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
due_date: null
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.due_date).toBeNull();
  });

  it('handles null worktree_branch correctly', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
worktree_branch: null
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.worktree_branch).toBeNull();
  });

  it('defaults worktree_branch to null when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.worktree_branch).toBeNull();
  });

  it('parses pr_url when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pr_url: https://github.com/org/repo/pull/42
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_url).toBe('https://github.com/org/repo/pull/42');
  });

  it('defaults pr_url to null when absent', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Build
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_url).toBeNull();
  });

  it('parses pr_number when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pr_number: 42
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_number).toBe(42);
  });

  it('defaults pr_number to null when absent', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Build
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pr_number).toBeNull();
  });

  it('defaults due_date to null when missing', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseStageFrontmatter(content, '/repo/epics/STAGE-001-001-001.md');
    expect(result.due_date).toBeNull();
  });

  it('defaults pending_merge_parents to empty array when missing', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Design
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pending_merge_parents).toEqual([]);
  });

  it('defaults is_draft to false when missing', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Design
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.is_draft).toBe(false);
  });

  it('defaults mr_target_branch to null when missing', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: Design
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.mr_target_branch).toBeNull();
  });

  it('parses pending_merge_parents when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pending_merge_parents:
  - stage_id: STAGE-002
    branch: feature/parent
    pr_url: https://github.com/org/repo/pull/9
    pr_number: 9
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.pending_merge_parents).toHaveLength(1);
    expect(result.pending_merge_parents[0]).toEqual({
      stage_id: 'STAGE-002',
      branch: 'feature/parent',
      pr_url: 'https://github.com/org/repo/pull/9',
      pr_number: 9,
    });
  });

  it('parses is_draft when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
is_draft: true
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.is_draft).toBe(true);
  });

  it('parses mr_target_branch when present', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
mr_target_branch: develop
---
# Stage`;
    const result = parseStageFrontmatter(content, 'stage.md');
    expect(result.mr_target_branch).toBe('develop');
  });

  it('throws on invalid pending_merge_parents entry (missing required fields)', () => {
    const content = `---
id: STAGE-001
ticket: TICKET-001
epic: EPIC-001
title: Build feature
status: PR Created
pending_merge_parents:
  - stage_id: STAGE-002
---
# Stage`;
    expect(() => parseStageFrontmatter(content, 'stage.md')).toThrow();
  });
});

describe('parseTicketFrontmatter - jira_links', () => {
  it('defaults jira_links to empty array when missing', () => {
    const content = `---
id: TICKET-001
epic: EPIC-001
title: Login Flow
status: In Progress
source: local
stages: []
depends_on: []
---
# Ticket`;
    const result = parseTicketFrontmatter(content, 'ticket.md');
    expect(result.jira_links).toEqual([]);
  });

  it('parses jira_links when present', () => {
    const content = `---
id: TICKET-001
epic: EPIC-001
title: Login Flow
status: In Progress
source: local
stages: []
depends_on: []
jira_links:
  - type: confluence
    url: https://wiki.example.com/page/1
    title: Design Doc
    key: SPACE-1
  - type: attachment
    url: https://jira.example.com/attachment/100
    title: mockup.png
    filename: mockup.png
    mime_type: image/png
---
# Ticket`;
    const result = parseTicketFrontmatter(content, 'ticket.md');
    expect(result.jira_links).toHaveLength(2);
    expect(result.jira_links[0].type).toBe('confluence');
    expect(result.jira_links[0].key).toBe('SPACE-1');
    expect(result.jira_links[1].type).toBe('attachment');
    expect(result.jira_links[1].filename).toBe('mockup.png');
  });

  it('throws on invalid jira_links entry (invalid type)', () => {
    const content = `---
id: TICKET-001
epic: EPIC-001
title: Login Flow
status: In Progress
jira_links:
  - type: invalid_type
    url: https://example.com
    title: Bad Link
---
# Ticket`;
    expect(() => parseTicketFrontmatter(content, 'ticket.md')).toThrow();
  });

  it('throws on invalid jira_links entry (missing url)', () => {
    const content = `---
id: TICKET-001
epic: EPIC-001
title: Login Flow
status: In Progress
jira_links:
  - type: confluence
    title: No URL
---
# Ticket`;
    expect(() => parseTicketFrontmatter(content, 'ticket.md')).toThrow();
  });
});

describe('parseFrontmatter (generic dispatcher)', () => {
  it('parses an epic when type is epic', () => {
    const content = `---
id: EPIC-001
title: Test
status: In Progress
tickets: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/EPIC-001.md', 'epic');
    expect(result.id).toBe('EPIC-001');
  });

  it('parses a ticket when type is ticket', () => {
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: Test
status: In Progress
source: local
stages: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/TICKET-001-001.md', 'ticket');
    expect(result.id).toBe('TICKET-001-001');
  });

  it('parses a stage when type is stage', () => {
    const content = `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Test
status: Design
session_active: false
refinement_type: []
depends_on: []
---
`;
    const result = parseFrontmatter(content, '/repo/epics/STAGE-001-001-001.md', 'stage');
    expect(result.id).toBe('STAGE-001-001-001');
  });

  it('throws on content with no frontmatter', () => {
    const content = `# Just a heading\n\nNo frontmatter here.`;
    expect(() => parseFrontmatter(content, '/repo/epics/bad.md', 'epic')).toThrow(/frontmatter/i);
  });

  it('throws on empty frontmatter', () => {
    const content = `---\n---\n\nEmpty frontmatter.`;
    expect(() => parseFrontmatter(content, '/repo/epics/bad.md', 'epic')).toThrow();
  });
});

describe('parseFrontmatterRaw', () => {
  it('extracts raw frontmatter data as untyped record', () => {
    const content = `---
id: EPIC-001
title: Test
custom_field: hello
---
`;
    const data = parseFrontmatterRaw(content);
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('Test');
    expect(data.custom_field).toBe('hello');
  });

  it('returns empty object when no frontmatter present', () => {
    const content = `# Just a heading\n\nNo frontmatter here.`;
    const data = parseFrontmatterRaw(content);
    expect(Object.keys(data)).toHaveLength(0);
  });
});
