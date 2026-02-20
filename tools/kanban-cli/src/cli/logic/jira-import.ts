import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { createJiraExecutor } from '../../jira/executor.js';
import type { JiraExecutor } from '../../jira/types.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { EpicRepository } from '../../db/repositories/epic-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { syncRepo } from '../../sync/sync.js';

export interface JiraImportOptions {
  key: string;
  repoPath: string;
  epicOverride?: string;
}

export interface JiraImportResult {
  created_type: 'epic' | 'ticket';
  id: string;
  file_path: string;
  jira_key: string;
  parent_epic?: string;
  title: string;
  column: string;
}

/**
 * Scan existing epic directories in <repoPath>/epics/ to find the next EPIC-NNN ID.
 * Returns "EPIC-001" if no epics exist, otherwise increments the highest found.
 */
function nextEpicId(repoPath: string): string {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) {
    return 'EPIC-001';
  }

  const entries = fs.readdirSync(epicsDir, { withFileTypes: true });
  let maxNum = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const match = entry.name.match(/^EPIC-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  return `EPIC-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Scan existing ticket files in an epic directory to find the next TICKET-NNN-MMM ID.
 * Returns "TICKET-NNN-001" if no tickets exist for this epic, otherwise increments the highest found.
 */
function nextTicketId(repoPath: string, epicId: string): string {
  const epicMatch = epicId.match(/^EPIC-(\d+)$/);
  if (!epicMatch) {
    throw new Error(`Invalid epic ID format: ${epicId}`);
  }
  const epicNum = epicMatch[1];

  const epicDir = path.join(repoPath, 'epics', epicId);
  if (!fs.existsSync(epicDir)) {
    return `TICKET-${epicNum}-001`;
  }

  const entries = fs.readdirSync(epicDir);
  let maxNum = 0;
  const ticketPattern = new RegExp(`^TICKET-${epicNum}-(\\d+)\\.md$`);

  for (const entry of entries) {
    const match = entry.match(ticketPattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }

  return `TICKET-${epicNum}-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Import a Jira issue as a local epic or ticket file.
 *
 * @param options - Import options
 * @param executor - Optional JiraExecutor for testing (if not provided, creates one from config)
 * @param db - Optional KanbanDatabase for testing (if not provided, creates a new one)
 */
export async function jiraImport(
  options: JiraImportOptions,
  executor?: JiraExecutor,
  db?: KanbanDatabase,
): Promise<JiraImportResult> {
  const { key, repoPath, epicOverride } = options;

  // Load config
  const config = loadConfig({ repoPath });

  // Create executor if not provided
  if (!executor) {
    if (!config.jira) {
      throw new Error(
        "Jira integration not configured. Add a 'jira' section to .kanban-workflow.yaml",
      );
    }
    executor = createJiraExecutor(config.jira, repoPath);
  }

  // Verify reading capability
  if (!executor.canRead()) {
    throw new Error(
      'Jira reading not configured: reading_script is not set in pipeline config',
    );
  }

  // Initialize database
  const ownDb = !db;
  if (!db) {
    db = new KanbanDatabase();
  }

  try {
    // Sync repo to ensure DB is up to date
    syncRepo({ repoPath, db, config });

    // Get or register repo (syncRepo only registers if files are found)
    const repoRepo = new RepoRepository(db);
    let repo = repoRepo.findByPath(repoPath);
    if (!repo) {
      const repoName = path.basename(repoPath);
      repoRepo.upsert(repoPath, repoName);
      repo = repoRepo.findByPath(repoPath);
    }
    if (!repo) {
      throw new Error('Repository not found after sync');
    }
    const repoId = repo.id;

    // Check for duplicate import
    const epicRepo = new EpicRepository(db);
    const ticketRepo = new TicketRepository(db);

    const existingEpics = epicRepo.listByRepo(repoId);
    const existingTickets = ticketRepo.listByRepo(repoId);

    for (const epic of existingEpics) {
      if (epic.jira_key === key) {
        throw new Error(`Jira ticket ${key} already imported as ${epic.id}`);
      }
    }
    for (const ticket of existingTickets) {
      if (ticket.jira_key === key) {
        throw new Error(`Jira ticket ${key} already imported as ${ticket.id}`);
      }
    }

    // Fetch Jira ticket data
    const jiraData = await executor.getTicket(key);

    const description = jiraData.description ?? '';

    if (jiraData.type === 'Epic') {
      // ── Epic path ──
      const epicId = nextEpicId(repoPath);
      const epicDir = path.join(repoPath, 'epics', epicId);
      fs.mkdirSync(epicDir, { recursive: true });

      const filePath = path.join(epicDir, `${epicId}.md`);
      const content = `---
id: ${epicId}
title: "${jiraData.summary}"
status: Not Started
jira_key: ${key}
tickets: []
depends_on: []
---
${description}
`;

      fs.writeFileSync(filePath, content);

      // Re-sync to update DB with new file
      syncRepo({ repoPath, db, config });

      return {
        created_type: 'epic',
        id: epicId,
        file_path: filePath,
        jira_key: key,
        title: jiraData.summary,
        column: 'N/A',
      };
    } else {
      // ── Ticket path ──
      let parentEpicId: string;

      if (epicOverride) {
        // Validate that the epic directory exists
        const epicDir = path.join(repoPath, 'epics', epicOverride);
        if (!fs.existsSync(epicDir)) {
          throw new Error(
            `Epic ${epicOverride} not found. Ensure the epic directory exists at epics/${epicOverride}/`,
          );
        }
        parentEpicId = epicOverride;
      } else if (jiraData.parent) {
        // Look up the parent's local epic by jira_key
        const allEpics = epicRepo.listByRepo(repoId);
        const localEpic = allEpics.find((e) => e.jira_key === jiraData.parent);

        if (!localEpic) {
          throw new Error(
            `Parent epic ${jiraData.parent} not found locally. Import it first with \`kanban-cli jira-import ${jiraData.parent}\`, or specify \`--epic EPIC-XXX\``,
          );
        }
        parentEpicId = localEpic.id;
      } else {
        throw new Error(
          'No parent epic detected. Specify --epic EPIC-XXX',
        );
      }

      const ticketId = nextTicketId(repoPath, parentEpicId);
      const filePath = path.join(repoPath, 'epics', parentEpicId, `${ticketId}.md`);

      const content = `---
id: ${ticketId}
epic: ${parentEpicId}
title: "${jiraData.summary}"
status: Not Started
jira_key: ${key}
source: jira
stages: []
depends_on: []
---
${description}
`;

      fs.writeFileSync(filePath, content);

      // Re-sync to update DB with new file
      syncRepo({ repoPath, db, config });

      return {
        created_type: 'ticket',
        id: ticketId,
        file_path: filePath,
        jira_key: key,
        parent_epic: parentEpicId,
        title: jiraData.summary,
        column: 'To Convert',
      };
    }
  } finally {
    if (ownDb) {
      db.close();
    }
  }
}
