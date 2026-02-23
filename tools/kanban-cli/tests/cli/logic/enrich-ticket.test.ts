import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { enrichTicket } from '../../../src/cli/logic/enrich-ticket.js';
import type { EnrichOptions } from '../../../src/cli/logic/enrich-ticket.js';
import type { JiraExecutor, JiraTicketData } from '../../../src/jira/types.js';

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
      links: [],
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

function createTicketData(overrides: Partial<JiraTicketData> = {}): JiraTicketData {
  return {
    key: 'PROJ-123',
    summary: 'Test ticket summary',
    description: 'This is the description body.',
    status: 'In Progress',
    type: 'Story',
    parent: null,
    assignee: 'alice',
    labels: ['backend', 'priority-high'],
    comments: [
      { author: 'bob', body: 'Looks good!', created: '2024-01-15T10:00:00Z' },
    ],
    links: [],
    ...overrides,
  };
}

// ─── Helper to write a ticket markdown file ─────────────────────────────────

function writeTicketFile(
  ticketPath: string,
  opts: {
    id?: string;
    epic?: string;
    title?: string;
    status?: string;
    jira_key?: string | null;
    source?: 'local' | 'jira';
    jira_links?: Array<Record<string, string | undefined>>;
  } = {},
): void {
  const {
    id = 'TICKET-001-001',
    epic = 'EPIC-001',
    title = 'Test Ticket',
    status = 'Not Started',
    jira_key = 'PROJ-123',
    source = 'jira',
    jira_links = [],
  } = opts;

  let jiraLinksBlock = '';
  if (jira_links.length > 0) {
    const items = jira_links.map((link) => {
      const entries = Object.entries(link)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join('\n');
      return `  -\n${entries}`;
    });
    jiraLinksBlock = `\njira_links:\n${items.join('\n')}`;
  }

  const content = `---
id: ${id}
epic: ${epic}
title: "${title}"
status: ${status}
jira_key: ${jira_key ?? 'null'}
source: ${source}
stages: []
depends_on: []${jiraLinksBlock}
---
Ticket body content.
`;

  fs.mkdirSync(path.dirname(ticketPath), { recursive: true });
  fs.writeFileSync(ticketPath, content);
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('enrichTicket', () => {
  let tmpDir: string;
  let repoDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-enrich-'));
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'epics', 'EPIC-001'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── Test 1: Ticket with jira_key → fresh Jira data fetched ────────────

  it('fetches fresh Jira data when ticket has jira_key', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: 'PROJ-123',
      jira_links: [
        { type: 'external', url: 'https://example.com/doc', title: 'Some doc' },
      ],
    });

    const jiraData = createTicketData({
      key: 'PROJ-123',
      status: 'In Progress',
      assignee: 'alice',
      labels: ['backend', 'priority-high'],
      description: 'Fresh description text',
      comments: [
        { author: 'bob', body: 'comment text here', created: '2024-01-15T10:00:00Z' },
      ],
    });

    const executor = createMockExecutor({
      getTicket: async (key: string) => {
        if (key === 'PROJ-123') return jiraData;
        throw new Error(`Unknown key: ${key}`);
      },
    });

    // Mock global fetch for the external link
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('External content', { status: 200 }),
    );

    const result = await enrichTicket({
      ticketPath,
      executor,
    });

    expect(result.freshJiraData).toBe(true);
    expect(result.enrichmentFilePath).not.toBeNull();

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('## Fresh Jira Data (PROJ-123)');
    expect(content).toContain('**Status**: In Progress');
    expect(content).toContain('**Assignee**: alice');
    expect(content).toContain('**Labels**: backend, priority-high');
    expect(content).toContain('### Description');
    expect(content).toContain('Fresh description text');
    expect(content).toContain('### Comments');
    expect(content).toContain('**bob** (2024-01-15T10:00:00Z): comment text here');

    fetchSpy.mockRestore();
  });

  // ─── Test 2: Ticket with confluence link ───────────────────────────────

  it('spawns confluence script for confluence links', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'confluence',
          url: 'https://company.atlassian.net/wiki/spaces/TEAM/pages/123',
          title: 'Design Doc',
        },
      ],
    });

    // Create a mock confluence script that just echoes content
    const mockScript = path.join(tmpDir, 'mock-confluence-get.ts');
    fs.writeFileSync(mockScript, `
const url = process.argv[2];
process.stdout.write('# Confluence Page Content\\n\\nThis is the fetched content from ' + url);
`);

    const result = await enrichTicket({
      ticketPath,
      confluenceScriptPath: mockScript,
    });

    expect(result.enrichmentFilePath).not.toBeNull();
    expect(result.linkResults).toHaveLength(1);
    expect(result.linkResults[0].success).toBe(true);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('### [Confluence] Design Doc');
    expect(content).toContain('*Source: https://company.atlassian.net/wiki/spaces/TEAM/pages/123*');
    expect(content).toContain('# Confluence Page Content');
  }, 15000);

  // ─── Test 3: Ticket with jira_issue link ───────────────────────────────

  it('calls executor.getTicket for jira_issue links', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'jira_issue',
          url: 'https://company.atlassian.net/browse/PROJ-999',
          title: 'SSO Integration',
          key: 'PROJ-999',
          relationship: 'blocks',
        },
      ],
    });

    const linkedIssue = createTicketData({
      key: 'PROJ-999',
      summary: 'SSO Integration',
      status: 'Done',
      description: 'Implement SSO for all services.',
    });

    const getTicketSpy = vi.fn(async (key: string) => {
      if (key === 'PROJ-999') return linkedIssue;
      throw new Error(`Unknown key: ${key}`);
    });

    const executor = createMockExecutor({
      getTicket: getTicketSpy,
    });

    const result = await enrichTicket({
      ticketPath,
      executor,
    });

    expect(getTicketSpy).toHaveBeenCalledWith('PROJ-999');
    expect(result.linkResults).toHaveLength(1);
    expect(result.linkResults[0].success).toBe(true);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('### [Jira Issue] PROJ-999: SSO Integration');
    expect(content).toContain('*Relationship: blocks*');
    expect(content).toContain('**Status**: Done');
    expect(content).toContain('**Description**: Implement SSO for all services.');
  });

  // ─── Test 4: Ticket with external link ─────────────────────────────────

  it('fetches external links via HTTP GET', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'external',
          url: 'https://docs.google.com/document/d/abc123',
          title: 'Design Spec',
        },
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('External document content here', { status: 200 }),
    );

    const result = await enrichTicket({
      ticketPath,
    });

    expect(fetchSpy).toHaveBeenCalledWith('https://docs.google.com/document/d/abc123', { signal: expect.any(AbortSignal) });
    expect(result.linkResults).toHaveLength(1);
    expect(result.linkResults[0].success).toBe(true);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('### [External] Design Spec');
    expect(content).toContain('*Source: https://docs.google.com/document/d/abc123*');
    expect(content).toContain('External document content here');

    fetchSpy.mockRestore();
  });

  // ─── Test 5: Ticket with attachment link ───────────────────────────────

  describe('attachment links', () => {
    it('downloads text-based attachments', async () => {
      const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
      writeTicketFile(ticketPath, {
        jira_key: null,
        jira_links: [
          {
            type: 'attachment',
            url: 'https://company.atlassian.net/secure/attachment/789/data.json',
            title: 'data.json',
            filename: 'data.json',
            mime_type: 'application/json',
          },
        ],
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"key": "value"}', { status: 200 }),
      );

      const result = await enrichTicket({
        ticketPath,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://company.atlassian.net/secure/attachment/789/data.json',
        { signal: expect.any(AbortSignal) },
      );
      expect(result.linkResults[0].success).toBe(true);

      const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
      expect(content).toContain('### [Attachment] data.json');
      expect(content).toContain('{"key": "value"}');

      fetchSpy.mockRestore();
    });

    it('notes PDF attachments as unsupported for text extraction', async () => {
      const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
      writeTicketFile(ticketPath, {
        jira_key: null,
        jira_links: [
          {
            type: 'attachment',
            url: 'https://company.atlassian.net/secure/attachment/456/spec.pdf',
            title: 'Spec PDF',
            filename: 'spec.pdf',
            mime_type: 'application/pdf',
          },
        ],
      });

      const result = await enrichTicket({
        ticketPath,
      });

      // PDF attachment doesn't try to fetch — it's noted as unsupported
      expect(result.linkResults).toHaveLength(1);
      expect(result.linkResults[0].success).toBe(true);

      const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
      expect(content).toContain('### [Attachment] spec.pdf');
      expect(content).toContain(
        '> Attachment type application/pdf cannot be extracted as text. Download manually from link above.',
      );
    });
  });

  // ─── Test 6: Link fetch failure → graceful degradation ─────────────────

  it('handles link fetch failure gracefully', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'external',
          url: 'https://failing-url.example.com/doc',
          title: 'Failing Doc',
        },
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
    );

    const result = await enrichTicket({
      ticketPath,
    });

    // Function does NOT throw
    expect(result.enrichmentFilePath).not.toBeNull();
    expect(result.linkResults).toHaveLength(1);
    expect(result.linkResults[0].success).toBe(false);
    expect(result.linkResults[0].error).toContain('403 Forbidden');

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('### [External] Failing Doc');
    expect(content).toContain('> Could not fetch: 403 Forbidden');

    fetchSpy.mockRestore();
  });

  // ─── Test 7: Empty jira_links and no jira_key → early return ───────────

  it('returns early with null enrichmentFilePath when no links and no jira_key', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      source: 'local',
    });

    const result = await enrichTicket({
      ticketPath,
    });

    expect(result.ticketId).toBe('TICKET-001-001');
    expect(result.enrichmentFilePath).toBeNull();
    expect(result.freshJiraData).toBe(false);
    expect(result.linkResults).toEqual([]);

    // Verify no enrichment file was created on disk
    const expectedEnrichmentPath = path.join(
      repoDir,
      'epics',
      'EPIC-001',
      'TICKET-001-001-enrichment.md',
    );
    expect(fs.existsSync(expectedEnrichmentPath)).toBe(false);
  });

  // ─── Test 8: Enrichment file format matches expected structure ─────────

  it('produces correctly formatted enrichment file', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: 'PROJ-123',
      jira_links: [
        {
          type: 'confluence',
          url: 'https://company.atlassian.net/wiki/pages/123',
          title: 'Design Doc',
        },
        {
          type: 'jira_issue',
          url: 'https://company.atlassian.net/browse/PROJ-999',
          title: 'SSO Integration',
          key: 'PROJ-999',
          relationship: 'blocks',
        },
        {
          type: 'attachment',
          url: 'https://company.atlassian.net/attach/spec.pdf',
          title: 'Spec PDF',
          filename: 'spec.pdf',
          mime_type: 'application/pdf',
        },
        {
          type: 'external',
          url: 'https://docs.google.com/doc/abc',
          title: 'Design Spec',
        },
      ],
    });

    const jiraData = createTicketData({
      key: 'PROJ-123',
      status: 'In Progress',
      assignee: 'alice',
      labels: ['backend', 'priority-high'],
      description: 'Fresh description text',
      comments: [
        { author: 'bob', body: 'comment text...', created: '2024-01-15T10:00:00Z' },
      ],
    });

    const linkedIssue = createTicketData({
      key: 'PROJ-999',
      summary: 'SSO Integration',
      status: 'Done',
      description: 'SSO impl details',
    });

    const executor = createMockExecutor({
      getTicket: async (key: string) => {
        if (key === 'PROJ-123') return jiraData;
        if (key === 'PROJ-999') return linkedIssue;
        throw new Error(`Unknown key: ${key}`);
      },
    });

    // Mock confluence script
    const mockScript = path.join(tmpDir, 'mock-confluence.ts');
    fs.writeFileSync(mockScript, `process.stdout.write('Confluence page content');`);

    // Mock HTTP fetch for external link
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('External doc content', { status: 200 }),
    );

    const result = await enrichTicket({
      ticketPath,
      executor,
      confluenceScriptPath: mockScript,
    });

    expect(result.enrichmentFilePath).not.toBeNull();

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');

    // Verify overall structure
    expect(content).toMatch(/^# Enrichment Context for TICKET-001-001$/m);
    expect(content).toContain('> Auto-generated by `kanban-cli enrich`. Do not edit manually.');
    expect(content).toMatch(/^> Generated: \d{4}-\d{2}-\d{2}T/m);

    // Verify fresh Jira data section
    expect(content).toContain('## Fresh Jira Data (PROJ-123)');
    expect(content).toContain('**Status**: In Progress');
    expect(content).toContain('**Assignee**: alice');
    expect(content).toContain('**Labels**: backend, priority-high');
    expect(content).toContain('### Description');
    expect(content).toContain('Fresh description text');
    expect(content).toContain('### Comments');
    expect(content).toContain('**bob** (2024-01-15T10:00:00Z): comment text...');

    // Verify linked content section
    expect(content).toContain('## Linked Content');
    expect(content).toContain('### [Confluence] Design Doc');
    expect(content).toContain('### [Jira Issue] PROJ-999: SSO Integration');
    expect(content).toContain('*Relationship: blocks*');
    expect(content).toContain('### [Attachment] spec.pdf');
    expect(content).toContain(
      '> Attachment type application/pdf cannot be extracted as text.',
    );
    expect(content).toContain('### [External] Design Spec');

    // Verify enrichment file path convention
    expect(result.enrichmentFilePath).toBe(
      path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001-enrichment.md'),
    );

    fetchSpy.mockRestore();
  }, 15000);

  // ─── Test 9: Multiple links → all fetched sequentially ────────────────

  it('fetches multiple links sequentially and records results', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'external',
          url: 'https://example.com/doc1',
          title: 'First Doc',
        },
        {
          type: 'external',
          url: 'https://example.com/doc2',
          title: 'Second Doc',
        },
        {
          type: 'external',
          url: 'https://example.com/doc3',
          title: 'Third Doc',
        },
      ],
    });

    const callOrder: string[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      callOrder.push(url);
      return new Response(`Content from ${url}`, { status: 200 });
    });

    const result = await enrichTicket({
      ticketPath,
    });

    // All 3 links processed
    expect(result.linkResults).toHaveLength(3);
    expect(result.linkResults.every((r) => r.success)).toBe(true);

    // Verify sequential call order
    expect(callOrder).toEqual([
      'https://example.com/doc1',
      'https://example.com/doc2',
      'https://example.com/doc3',
    ]);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('### [External] First Doc');
    expect(content).toContain('### [External] Second Doc');
    expect(content).toContain('### [External] Third Doc');
    expect(content).toContain('Content from https://example.com/doc1');
    expect(content).toContain('Content from https://example.com/doc2');
    expect(content).toContain('Content from https://example.com/doc3');

    fetchSpy.mockRestore();
  });

  // ─── Additional edge case tests ───────────────────────────────────────

  it('continues processing remaining links after one fails', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'external',
          url: 'https://example.com/failing',
          title: 'Failing Link',
        },
        {
          type: 'external',
          url: 'https://example.com/succeeding',
          title: 'Succeeding Link',
        },
      ],
    });

    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      callCount++;
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('failing')) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
      return new Response('Success content', { status: 200 });
    });

    const result = await enrichTicket({
      ticketPath,
    });

    // Both links were attempted
    expect(callCount).toBe(2);
    expect(result.linkResults).toHaveLength(2);
    expect(result.linkResults[0].success).toBe(false);
    expect(result.linkResults[0].error).toContain('404');
    expect(result.linkResults[1].success).toBe(true);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('> Could not fetch: 404 Not Found');
    expect(content).toContain('Success content');

    fetchSpy.mockRestore();
  });

  it('handles confluence script not available gracefully', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'confluence',
          url: 'https://company.atlassian.net/wiki/pages/123',
          title: 'Design Doc',
        },
      ],
    });

    // Don't provide confluenceScriptPath and ensure env var is not set.
    // Also override HOME to prevent resolving the real atlassian-tools plugin.
    const origEnv = process.env.CONFLUENCE_GET_SCRIPT;
    const origHome = process.env.HOME;
    delete process.env.CONFLUENCE_GET_SCRIPT;
    process.env.HOME = path.join(tmpDir, 'nonexistent-home');

    try {
      const result = await enrichTicket({
        ticketPath,
      });

      expect(result.linkResults).toHaveLength(1);
      expect(result.linkResults[0].success).toBe(false);
      expect(result.linkResults[0].error).toContain('Confluence reader not available');

      const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
      expect(content).toContain('> Could not fetch: Confluence reader not available');
    } finally {
      // Restore env
      if (origEnv !== undefined) {
        process.env.CONFLUENCE_GET_SCRIPT = origEnv;
      } else {
        delete process.env.CONFLUENCE_GET_SCRIPT;
      }
      if (origHome !== undefined) {
        process.env.HOME = origHome;
      }
    }
  });

  it('handles jira_issue link with no key gracefully', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    // Manually write a ticket with a jira_issue link missing the key field
    const content = `---
id: TICKET-001-001
epic: EPIC-001
title: "Test Ticket"
status: Not Started
jira_key: null
source: jira
stages: []
depends_on: []
jira_links:
  - type: jira_issue
    url: https://company.atlassian.net/browse/PROJ-999
    title: Missing Key Issue
---
Body.
`;
    fs.writeFileSync(ticketPath, content);

    const executor = createMockExecutor();

    const result = await enrichTicket({
      ticketPath,
      executor,
    });

    expect(result.linkResults).toHaveLength(1);
    expect(result.linkResults[0].success).toBe(false);
    expect(result.linkResults[0].error).toContain('No key available');
  });

  it('handles ticket with jira_key but no executor gracefully', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: 'PROJ-123',
      jira_links: [
        {
          type: 'external',
          url: 'https://example.com/doc',
          title: 'Some doc',
        },
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Content', { status: 200 }),
    );

    // No executor passed — fresh Jira data should be skipped
    const result = await enrichTicket({
      ticketPath,
    });

    // No fresh Jira data (no executor to fetch with)
    expect(result.freshJiraData).toBe(false);
    // But the file is still created because there are links
    expect(result.enrichmentFilePath).not.toBeNull();

    fetchSpy.mockRestore();
  });

  it('writes enrichment file even when all links fail', async () => {
    const ticketPath = path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md');
    writeTicketFile(ticketPath, {
      jira_key: null,
      jira_links: [
        {
          type: 'external',
          url: 'https://example.com/fail1',
          title: 'Fail 1',
        },
        {
          type: 'external',
          url: 'https://example.com/fail2',
          title: 'Fail 2',
        },
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('connection timeout'),
    );

    const result = await enrichTicket({
      ticketPath,
    });

    expect(result.enrichmentFilePath).not.toBeNull();
    expect(result.linkResults).toHaveLength(2);
    expect(result.linkResults.every((r) => !r.success)).toBe(true);

    const content = fs.readFileSync(result.enrichmentFilePath!, 'utf-8');
    expect(content).toContain('> Could not fetch: connection timeout');

    fetchSpy.mockRestore();
  });
});
