import { loadConfig } from '../../config/loader.js';
import { createJiraExecutor } from '../../jira/executor.js';
import type { JiraExecutor } from '../../jira/types.js';
import { KanbanDatabase } from '../../db/database.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { syncRepo } from '../../sync/sync.js';
import type { StageRow } from '../../db/repositories/types.js';
import type { JiraStatusMap } from '../../types/pipeline.js';

export interface JiraSyncOptions {
  ticketId: string;
  repoPath: string;
  dryRun?: boolean;
}

export interface JiraSyncAction {
  type: 'transition' | 'assign';
  description: string;
  executed: boolean;
  result?: unknown;
  error?: string;
}

export interface JiraSyncResult {
  ticket_id: string;
  jira_key: string;
  event: string | null;
  actions: JiraSyncAction[];
  dry_run: boolean;
  confirmation_needed: boolean;
}

/**
 * Workflow events in priority order (highest first).
 * Derived from JiraStatusMap keys to keep in sync with config schema.
 */
export type WorkflowEvent = keyof JiraStatusMap;

/**
 * Compute the workflow event from stages.
 *
 * Priority: all_stages_done > stage_pr_created > first_stage_design > null (no action)
 */
export function computeWorkflowEvent(stages: StageRow[]): WorkflowEvent | null {
  if (stages.length === 0) {
    return null;
  }

  const allComplete = stages.every((s) => s.status === 'Complete');
  if (allComplete) {
    return 'all_stages_done';
  }

  const anyHasPr = stages.some((s) => s.pr_url != null && s.pr_url !== '');
  if (anyHasPr) {
    return 'stage_pr_created';
  }

  const anyInProgress = stages.some(
    (s) => s.status != null && s.status !== 'Not Started' && s.status !== 'Complete'
  );
  if (anyInProgress) {
    return 'first_stage_design';
  }

  // All stages are "Not Started" — no transition needed
  return null;
}

/**
 * Sync a ticket's workflow state to Jira.
 *
 * @param options - Sync options
 * @param executor - Optional JiraExecutor for testing (if not provided, creates one from config)
 * @param db - Optional KanbanDatabase for testing (if not provided, creates a new one)
 */
export async function jiraSync(
  options: JiraSyncOptions,
  executor?: JiraExecutor,
  db?: KanbanDatabase,
): Promise<JiraSyncResult> {
  const { ticketId, repoPath, dryRun = false } = options;

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

  // Verify writing capability
  if (!executor.canWrite()) {
    throw new Error(
      'Jira writing not configured: writing_script is not set in pipeline config',
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

    // Load ticket from DB
    const ticketRepo = new TicketRepository(db);
    const ticket = ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found in database`);
    }

    if (!ticket.jira_key) {
      throw new Error(`Ticket ${ticketId} has no jira_key — cannot sync to Jira`);
    }

    const jiraKey = ticket.jira_key;

    // Load stages for the ticket, scoped to the same repo
    const stageRepo = new StageRepository(db);
    const stages = stageRepo.listByTicket(ticketId, ticket.repo_id);

    // Compute workflow event
    const event = computeWorkflowEvent(stages);

    // If no event, return empty actions
    if (event === null) {
      return {
        ticket_id: ticketId,
        jira_key: jiraKey,
        event: null,
        actions: [],
        dry_run: dryRun,
        confirmation_needed: false,
      };
    }

    // Look up target Jira status from config
    // config.jira may be null when executor is injected directly (e.g., in tests)
    const statusMap = config.jira?.status_map;
    const targetStatus = statusMap?.[event];

    // Build actions array
    const actions: JiraSyncAction[] = [];

    if (targetStatus) {
      actions.push({
        type: 'transition',
        description: `Transition to "${targetStatus}"`,
        executed: false,
      });
    } else {
      // No mapping for this event — add warning
      actions.push({
        type: 'transition',
        description: `No status_map entry for event "${event}" — skipping transition`,
        executed: false,
        error: `No Jira status mapping configured for event "${event}"`,
      });
    }

    // Assignment only on first_stage_design
    if (event === 'first_stage_design') {
      const assignee = config.jira?.assignee ?? null;
      actions.push({
        type: 'assign',
        description: assignee
          ? `Assign to "${assignee}"`
          : 'Assign to authenticated user (default)',
        executed: false,
      });
    }

    // Handle dry-run: return actions without executing
    if (dryRun) {
      return {
        ticket_id: ticketId,
        jira_key: jiraKey,
        event,
        actions,
        dry_run: true,
        confirmation_needed: false,
      };
    }

    // Handle WORKFLOW_JIRA_CONFIRM
    const envConfirm = process.env['WORKFLOW_JIRA_CONFIRM'];
    let confirmNeeded: boolean;
    if (envConfirm !== undefined) {
      confirmNeeded = envConfirm === 'true' || envConfirm === '1';
    } else {
      confirmNeeded = config.workflow.defaults?.WORKFLOW_JIRA_CONFIRM === true;
    }

    if (confirmNeeded) {
      return {
        ticket_id: ticketId,
        jira_key: jiraKey,
        event,
        actions,
        dry_run: false,
        confirmation_needed: true,
      };
    }

    // Execute actions
    for (const action of actions) {
      // Skip actions that already have errors (e.g., missing status_map warning)
      if (action.error) {
        continue;
      }

      try {
        if (action.type === 'transition' && targetStatus) {
          const result = await executor.transitionTicket(jiraKey, targetStatus);
          action.executed = true;
          action.result = result;
        } else if (action.type === 'assign') {
          const assignee = config.jira?.assignee ?? null;
          const result = await executor.assignTicket(jiraKey, assignee);
          action.executed = true;
          action.result = result;
        }
      } catch (err) {
        action.executed = false;
        action.error = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      ticket_id: ticketId,
      jira_key: jiraKey,
      event,
      actions,
      dry_run: false,
      confirmation_needed: false,
    };
  } finally {
    if (ownDb) {
      db.close();
    }
  }
}
