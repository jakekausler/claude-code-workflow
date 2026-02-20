import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import matter from 'gray-matter';
import { jiraImport } from '../../../src/cli/logic/jira-import.js';
import type { JiraImportOptions } from '../../../src/cli/logic/jira-import.js';
import type { JiraExecutor, JiraTicketData } from '../../../src/jira/types.js';
import { KanbanDatabase } from '../../../src/db/database.js';
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
  },
};

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

function createTicketData(overrides: Partial<JiraTicketData> = {}): JiraTicketData {
  return {
    key: 'TEST-100',
    summary: 'Test ticket summary',
    description: 'This is the description body.',
    status: 'To Do',
    type: 'Story',
    parent: null,
    assignee: null,
    labels: [],
    comments: [],
    ...overrides,
  };
}

// ─── Test setup helpers ─────────────────────────────────────────────────────

describe('jiraImport', () => {
  let tmpDir: string;
  let repoDir: string;
  let dbPath: string;
  let db: KanbanDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-jira-import-'));
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'epics'), { recursive: true });

    // Write a minimal config file
    const configContent = `
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
`;
    fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), configContent);

    dbPath = path.join(tmpDir, 'test.db');
    db = new KanbanDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Epic import ───────────────────────────────────────────────────────

  describe('epic import', () => {
    it('creates epic file with correct frontmatter and body', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-1234',
        type: 'Epic',
        summary: 'Authentication System',
        description: 'Build a complete auth system.',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-1234', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.created_type).toBe('epic');
      expect(result.id).toBe('EPIC-001');
      expect(result.jira_key).toBe('PROJ-1234');
      expect(result.title).toBe('Authentication System');
      expect(result.column).toBe('N/A');

      // Verify file exists and has correct content
      const filePath = result.file_path;
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);

      expect(parsed.data.id).toBe('EPIC-001');
      expect(parsed.data.title).toBe('Authentication System');
      expect(parsed.data.status).toBe('Not Started');
      expect(parsed.data.jira_key).toBe('PROJ-1234');
      expect(parsed.data.tickets).toEqual([]);
      expect(parsed.data.depends_on).toEqual([]);
      expect(parsed.content.trim()).toBe('Build a complete auth system.');
    });

    it('increments epic ID correctly when epics already exist', async () => {
      // Create existing epic directories
      fs.mkdirSync(path.join(repoDir, 'epics', 'EPIC-001'), { recursive: true });
      fs.mkdirSync(path.join(repoDir, 'epics', 'EPIC-002'), { recursive: true });

      const ticketData = createTicketData({
        key: 'PROJ-5',
        type: 'Epic',
        summary: 'Third epic',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-5', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.id).toBe('EPIC-003');
    });

    it('ignores --epic flag for epic imports', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-10',
        type: 'Epic',
        summary: 'An epic',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-10', repoPath: repoDir, epicOverride: 'EPIC-999' },
        executor,
        db,
      );

      expect(result.created_type).toBe('epic');
      expect(result.id).toBe('EPIC-001');
      expect(result.parent_epic).toBeUndefined();
    });

    it('handles epic with null description', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-20',
        type: 'Epic',
        summary: 'Epic no desc',
        description: null,
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-20', repoPath: repoDir },
        executor,
        db,
      );

      const content = fs.readFileSync(result.file_path, 'utf-8');
      const parsed = matter(content);
      expect(parsed.content.trim()).toBe('');
    });
  });

  // ─── Ticket import ─────────────────────────────────────────────────────

  describe('ticket import', () => {
    function createEpicLocally(epicId: string, jiraKey?: string): void {
      const epicDir = path.join(repoDir, 'epics', epicId);
      fs.mkdirSync(epicDir, { recursive: true });
      const content = `---
id: ${epicId}
title: "Test Epic"
status: Not Started
jira_key: ${jiraKey ?? 'null'}
tickets: []
depends_on: []
---
Epic body.
`;
      fs.writeFileSync(path.join(epicDir, `${epicId}.md`), content);
    }

    it('creates ticket file under specified epic with --epic flag', async () => {
      createEpicLocally('EPIC-001');

      const ticketData = createTicketData({
        key: 'PROJ-42',
        type: 'Story',
        summary: 'Add user authentication',
        description: 'Implement login/logout flow.',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-42', repoPath: repoDir, epicOverride: 'EPIC-001' },
        executor,
        db,
      );

      expect(result.created_type).toBe('ticket');
      expect(result.id).toBe('TICKET-001-001');
      expect(result.jira_key).toBe('PROJ-42');
      expect(result.parent_epic).toBe('EPIC-001');
      expect(result.title).toBe('Add user authentication');
      expect(result.column).toBe('To Convert');

      // Verify file content
      const content = fs.readFileSync(result.file_path, 'utf-8');
      const parsed = matter(content);

      expect(parsed.data.id).toBe('TICKET-001-001');
      expect(parsed.data.epic).toBe('EPIC-001');
      expect(parsed.data.title).toBe('Add user authentication');
      expect(parsed.data.status).toBe('Not Started');
      expect(parsed.data.jira_key).toBe('PROJ-42');
      expect(parsed.data.source).toBe('jira');
      expect(parsed.data.stages).toEqual([]);
      expect(parsed.data.depends_on).toEqual([]);
      expect(parsed.content.trim()).toBe('Implement login/logout flow.');
    });

    it('auto-resolves parent epic via jira_key in database', async () => {
      // Create local epic with a jira_key
      createEpicLocally('EPIC-001', 'PROJ-PARENT');

      // Sync so DB has the epic with jira_key
      const config = testConfig;
      syncRepo({ repoPath: repoDir, db, config });

      const ticketData = createTicketData({
        key: 'PROJ-CHILD',
        type: 'Story',
        summary: 'Child ticket',
        parent: 'PROJ-PARENT',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-CHILD', repoPath: repoDir },
        executor,
        db,
      );

      expect(result.created_type).toBe('ticket');
      expect(result.parent_epic).toBe('EPIC-001');
    });

    it('throws error when Jira parent not found locally', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-ORPHAN',
        type: 'Story',
        summary: 'Orphan ticket',
        parent: 'PROJ-MISSING-PARENT',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      await expect(
        jiraImport({ key: 'PROJ-ORPHAN', repoPath: repoDir }, executor, db),
      ).rejects.toThrow(
        'Parent epic PROJ-MISSING-PARENT not found locally',
      );
    });

    it('throws error when no parent and no --epic flag', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-NOPE',
        type: 'Story',
        summary: 'No parent',
        parent: null,
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      await expect(
        jiraImport({ key: 'PROJ-NOPE', repoPath: repoDir }, executor, db),
      ).rejects.toThrow('No parent epic detected. Specify --epic EPIC-XXX');
    });

    it('throws error when --epic refers to nonexistent epic', async () => {
      const ticketData = createTicketData({
        key: 'PROJ-BAD-EPIC',
        type: 'Story',
        summary: 'Bad epic ref',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      await expect(
        jiraImport(
          { key: 'PROJ-BAD-EPIC', repoPath: repoDir, epicOverride: 'EPIC-999' },
          executor,
          db,
        ),
      ).rejects.toThrow('Epic EPIC-999 not found in database');
    });

    it('increments ticket ID within epic correctly', async () => {
      createEpicLocally('EPIC-001');

      // Create existing ticket file
      fs.writeFileSync(
        path.join(repoDir, 'epics', 'EPIC-001', 'TICKET-001-001.md'),
        `---
id: TICKET-001-001
epic: EPIC-001
title: "Existing ticket"
status: Not Started
jira_key: null
source: local
stages: []
depends_on: []
---
Existing.
`,
      );

      const ticketData = createTicketData({
        key: 'PROJ-NEXT',
        type: 'Task',
        summary: 'Next ticket',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-NEXT', repoPath: repoDir, epicOverride: 'EPIC-001' },
        executor,
        db,
      );

      expect(result.id).toBe('TICKET-001-002');
    });

    it('handles ticket with null description', async () => {
      createEpicLocally('EPIC-001');

      const ticketData = createTicketData({
        key: 'PROJ-NO-DESC',
        type: 'Story',
        summary: 'No description',
        description: null,
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      const result = await jiraImport(
        { key: 'PROJ-NO-DESC', repoPath: repoDir, epicOverride: 'EPIC-001' },
        executor,
        db,
      );

      const content = fs.readFileSync(result.file_path, 'utf-8');
      const parsed = matter(content);
      expect(parsed.content.trim()).toBe('');
    });
  });

  // ─── Error cases ───────────────────────────────────────────────────────

  describe('error cases', () => {
    it('throws when jira is not configured', async () => {
      // Write a config without jira section
      const configContent = `
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
      fs.writeFileSync(
        path.join(repoDir, '.kanban-workflow.yaml'),
        configContent,
      );

      // Do NOT pass an executor — let it try to create one from config
      await expect(
        jiraImport({ key: 'TEST-1', repoPath: repoDir }, undefined, db),
      ).rejects.toThrow(
        "Jira integration not configured. Add a 'jira' section to .kanban-workflow.yaml",
      );
    });

    it('throws when reading_script is not configured', async () => {
      const executor = createMockExecutor({
        canRead: () => false,
      });

      await expect(
        jiraImport({ key: 'TEST-1', repoPath: repoDir }, executor, db),
      ).rejects.toThrow(
        'Jira reading not configured: reading_script is not set in pipeline config',
      );
    });

    it('throws on duplicate epic import', async () => {
      // Create an existing epic with jira_key
      const epicDir = path.join(repoDir, 'epics', 'EPIC-001');
      fs.mkdirSync(epicDir, { recursive: true });
      fs.writeFileSync(
        path.join(epicDir, 'EPIC-001.md'),
        `---
id: EPIC-001
title: "Existing Epic"
status: Not Started
jira_key: PROJ-DUP
tickets: []
depends_on: []
---
Body.
`,
      );

      // Sync to populate DB
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const ticketData = createTicketData({
        key: 'PROJ-DUP',
        type: 'Epic',
        summary: 'Duplicate import',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      await expect(
        jiraImport({ key: 'PROJ-DUP', repoPath: repoDir }, executor, db),
      ).rejects.toThrow('Jira ticket PROJ-DUP already imported as EPIC-001');
    });

    it('throws on duplicate ticket import', async () => {
      // Create an existing epic and ticket with jira_key
      const epicDir = path.join(repoDir, 'epics', 'EPIC-001');
      fs.mkdirSync(epicDir, { recursive: true });
      fs.writeFileSync(
        path.join(epicDir, 'EPIC-001.md'),
        `---
id: EPIC-001
title: "Existing Epic"
status: Not Started
jira_key: null
tickets: []
depends_on: []
---
Body.
`,
      );
      fs.writeFileSync(
        path.join(epicDir, 'TICKET-001-001.md'),
        `---
id: TICKET-001-001
epic: EPIC-001
title: "Existing Ticket"
status: Not Started
jira_key: PROJ-DUP-TICKET
source: jira
stages: []
depends_on: []
---
Body.
`,
      );

      // Sync to populate DB
      syncRepo({ repoPath: repoDir, db, config: testConfig });

      const ticketData = createTicketData({
        key: 'PROJ-DUP-TICKET',
        type: 'Story',
        summary: 'Duplicate ticket import',
      });

      const executor = createMockExecutor({
        getTicket: async () => ticketData,
      });

      await expect(
        jiraImport(
          { key: 'PROJ-DUP-TICKET', repoPath: repoDir },
          executor,
          db,
        ),
      ).rejects.toThrow(
        'Jira ticket PROJ-DUP-TICKET already imported as TICKET-001-001',
      );
    });
  });
});
