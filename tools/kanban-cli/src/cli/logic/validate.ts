// ---------- Input data shapes ----------

export interface ValidateEpicRow {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  tickets: string[];
  depends_on: string[];
  file_path: string;
  repo?: string;
}

export interface ValidateJiraLinkRow {
  type?: string;
  url?: string;
  title?: string;
  [key: string]: unknown;
}

export interface ValidateTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: string;
  stages: string[];
  depends_on: string[];
  jira_links: ValidateJiraLinkRow[];
  file_path: string;
  repo?: string;
}

export interface ValidatePendingMergeParentRow {
  stage_id: string;
  branch: string;
  pr_url: string;
  pr_number: number;
}

export interface ValidateStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  refinement_type: string;
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
  depends_on: string[];
  pending_merge_parents: ValidatePendingMergeParentRow[];
  is_draft: boolean;
  file_path: string;
  repo?: string;
}

export interface ValidateDependencyRow {
  from_id: string;
  to_id: string;
  resolved: boolean;
}

// ---------- Output types ----------

export interface ValidationError {
  file: string;
  field: string;
  error: string;
  repo?: string;
}

export interface ValidationWarning {
  file: string;
  field: string;
  warning: string;
  repo?: string;
}

export interface ValidateOutput {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  repos?: string[];
}

export interface ValidateInput {
  epics: ValidateEpicRow[];
  tickets: ValidateTicketRow[];
  stages: ValidateStageRow[];
  dependencies: ValidateDependencyRow[];
  allIds: Set<string>;
  validStatuses: Set<string>;
  global?: boolean;
}

// ---------- Helpers ----------

function getEntityType(id: string): 'epic' | 'ticket' | 'stage' | 'unknown' {
  if (id.startsWith('EPIC-')) return 'epic';
  if (id.startsWith('TICKET-')) return 'ticket';
  if (id.startsWith('STAGE-')) return 'stage';
  return 'unknown';
}

/**
 * Check for circular dependencies using DFS cycle detection.
 */
function findCircularDeps(dependencies: ValidateDependencyRow[]): string[][] {
  const adjacency = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const dep of dependencies) {
    const neighbors = adjacency.get(dep.from_id) || [];
    neighbors.push(dep.to_id);
    adjacency.set(dep.from_id, neighbors);
    allNodes.add(dep.from_id);
    allNodes.add(dep.to_id);
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    onStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node) || [];
    for (const next of neighbors) {
      if (onStack.has(next)) {
        // Found a cycle — extract it
        const cycleStart = path.indexOf(next);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
      } else if (!visited.has(next)) {
        dfs(next, path);
      }
    }

    path.pop();
    onStack.delete(node);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

// Valid dependency type rules:
// Epic -> Epic: OK
// Ticket -> Ticket: OK
// Ticket -> Epic: OK
// Stage -> Stage: OK
// Stage -> Ticket: OK
// Stage -> Epic: OK
// Epic -> Ticket: NOT OK
// Epic -> Stage: NOT OK
// Ticket -> Stage: NOT OK
const VALID_JIRA_LINK_TYPES = ['confluence', 'jira_issue', 'attachment', 'external'] as const;

const ACCEPTABLE_PARENT_STATUSES = new Set(['PR Created', 'Addressing Comments', 'Complete']);

const VALID_DEP_PAIRS: Record<string, Set<string>> = {
  epic: new Set(['epic']),
  ticket: new Set(['ticket', 'epic']),
  stage: new Set(['stage', 'ticket', 'epic']),
};

// ---------- Core logic ----------

export function validateWorkItems(input: ValidateInput): ValidateOutput {
  const { epics, tickets, stages, dependencies, allIds, validStatuses, global } = input;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const ticketIds = new Set(tickets.map((t) => t.id));
  const stageIds = new Set(stages.map((s) => s.id));
  const stageStatusById = new Map(stages.map((s) => [s.id, s.status]));

  // --- Validate epics ---
  for (const epic of epics) {
    // Required fields
    if (!epic.title) {
      const err: ValidationError = { file: epic.file_path, field: 'title', error: 'Epic title is required' };
      if (global && epic.repo) err.repo = epic.repo;
      errors.push(err);
    }

    // Validate tickets array references
    for (const ticketId of epic.tickets) {
      if (!ticketIds.has(ticketId) && !allIds.has(ticketId)) {
        const err: ValidationError = {
          file: epic.file_path,
          field: 'tickets',
          error: `Referenced ticket ${ticketId} does not exist`,
        };
        if (global && epic.repo) err.repo = epic.repo;
        errors.push(err);
      }
    }

    // Validate depends_on references
    for (const depId of epic.depends_on) {
      if (!allIds.has(depId)) {
        const err: ValidationError = {
          file: epic.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        };
        if (global && epic.repo) err.repo = epic.repo;
        errors.push(err);
      } else {
        // Check valid dependency type
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['epic'];
        if (allowed && !allowed.has(depType)) {
          const err: ValidationError = {
            file: epic.file_path,
            field: 'depends_on',
            error: `Epic cannot depend on ${depType} (${depId}). Epics can only depend on other epics.`,
          };
          if (global && epic.repo) err.repo = epic.repo;
          errors.push(err);
        }
      }
    }

    // Validate status
    if (!validStatuses.has(epic.status)) {
      const err: ValidationError = {
        file: epic.file_path,
        field: 'status',
        error: `Invalid status "${epic.status}". Valid values: ${[...validStatuses].join(', ')}`,
      };
      if (global && epic.repo) err.repo = epic.repo;
      errors.push(err);
    }
  }

  // --- Validate tickets ---
  for (const ticket of tickets) {
    // Required fields
    if (!ticket.title) {
      const err: ValidationError = { file: ticket.file_path, field: 'title', error: 'Ticket title is required' };
      if (global && ticket.repo) err.repo = ticket.repo;
      errors.push(err);
    }

    // Warning for tickets without stages
    if (ticket.stages.length === 0) {
      const warn: ValidationWarning = {
        file: ticket.file_path,
        field: 'stages',
        warning: 'Ticket has no stages — needs conversion',
      };
      if (global && ticket.repo) warn.repo = ticket.repo;
      warnings.push(warn);
    }

    // Validate stages array references
    for (const stageId of ticket.stages) {
      if (!stageIds.has(stageId) && !allIds.has(stageId)) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'stages',
          error: `Referenced stage ${stageId} does not exist`,
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      }
    }

    // Validate depends_on references
    for (const depId of ticket.depends_on) {
      if (!allIds.has(depId)) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['ticket'];
        if (allowed && !allowed.has(depType)) {
          const err: ValidationError = {
            file: ticket.file_path,
            field: 'depends_on',
            error: `Ticket cannot depend on ${depType} (${depId}). Tickets can depend on tickets and epics.`,
          };
          if (global && ticket.repo) err.repo = ticket.repo;
          errors.push(err);
        }
      }
    }

    // Validate status
    if (!validStatuses.has(ticket.status)) {
      const err: ValidationError = {
        file: ticket.file_path,
        field: 'status',
        error: `Invalid status "${ticket.status}". Valid values: ${[...validStatuses].join(', ')}`,
      };
      if (global && ticket.repo) err.repo = ticket.repo;
      errors.push(err);
    }

    // Validate jira_links
    for (const link of ticket.jira_links) {
      if (!link.type) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'jira_links',
          error: 'Jira link is missing required field "type"',
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      } else if (!(VALID_JIRA_LINK_TYPES as readonly string[]).includes(link.type)) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'jira_links',
          error: `Invalid jira_links type "${link.type}". Valid values: ${VALID_JIRA_LINK_TYPES.join(', ')}`,
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      }
      if (!link.url) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'jira_links',
          error: 'Jira link is missing required field "url"',
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      }
      if (!link.title) {
        const err: ValidationError = {
          file: ticket.file_path,
          field: 'jira_links',
          error: 'Jira link is missing required field "title"',
        };
        if (global && ticket.repo) err.repo = ticket.repo;
        errors.push(err);
      }
    }
  }

  // --- Validate stages ---
  const worktreeBranches = new Map<string, string>(); // branch -> stage file_path

  for (const stage of stages) {
    // Required fields
    if (!stage.title) {
      const err: ValidationError = { file: stage.file_path, field: 'title', error: 'Stage title is required' };
      if (global && stage.repo) err.repo = stage.repo;
      errors.push(err);
    }

    // Validate status
    if (!validStatuses.has(stage.status)) {
      const err: ValidationError = {
        file: stage.file_path,
        field: 'status',
        error: `Invalid status "${stage.status}". Valid values: ${[...validStatuses].join(', ')}`,
      };
      if (global && stage.repo) err.repo = stage.repo;
      errors.push(err);
    }

    // Validate depends_on references
    for (const depId of stage.depends_on) {
      if (!allIds.has(depId)) {
        const err: ValidationError = {
          file: stage.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        };
        if (global && stage.repo) err.repo = stage.repo;
        errors.push(err);
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['stage'];
        if (allowed && !allowed.has(depType)) {
          const err: ValidationError = {
            file: stage.file_path,
            field: 'depends_on',
            error: `Stage cannot depend on ${depType} (${depId}). Invalid dependency type.`,
          };
          if (global && stage.repo) err.repo = stage.repo;
          errors.push(err);
        }
      }
    }

    // Check unique worktree_branch
    if (stage.worktree_branch) {
      const existingFile = worktreeBranches.get(stage.worktree_branch);
      if (existingFile) {
        const err: ValidationError = {
          file: stage.file_path,
          field: 'worktree_branch',
          error: `Duplicate worktree_branch "${stage.worktree_branch}" — also used by ${existingFile}`,
        };
        if (global && stage.repo) err.repo = stage.repo;
        errors.push(err);
      } else {
        worktreeBranches.set(stage.worktree_branch, stage.file_path);
      }
    }

    // Validate pending_merge_parents
    for (const parent of stage.pending_merge_parents) {
      if (!stageIds.has(parent.stage_id)) {
        const err: ValidationError = {
          file: stage.file_path,
          field: 'pending_merge_parents',
          error: `Referenced stage ${parent.stage_id} does not exist`,
        };
        if (global && stage.repo) err.repo = stage.repo;
        errors.push(err);
      } else {
        const parentStatus = stageStatusById.get(parent.stage_id);
        if (parentStatus && !ACCEPTABLE_PARENT_STATUSES.has(parentStatus)) {
          const warn: ValidationWarning = {
            file: stage.file_path,
            field: 'pending_merge_parents',
            warning: `Parent stage ${parent.stage_id} has status "${parentStatus}" — expected PR Created, Addressing Comments, or Complete`,
          };
          if (global && stage.repo) warn.repo = stage.repo;
          warnings.push(warn);
        }
      }
    }

    // is_draft: true with empty pending_merge_parents is inconsistent
    if (stage.is_draft && stage.pending_merge_parents.length === 0) {
      const warn: ValidationWarning = {
        file: stage.file_path,
        field: 'is_draft',
        warning: 'Stage is marked as draft but has no pending merge parents — inconsistent state',
      };
      if (global && stage.repo) warn.repo = stage.repo;
      warnings.push(warn);
    }
  }

  // --- Check for circular dependencies ---
  const circles = findCircularDeps(dependencies);
  for (const cycle of circles) {
    const err: ValidationError = {
      file: '',
      field: 'depends_on',
      error: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
    };
    if (global) {
      err.repo = 'cross-repo';
    }
    errors.push(err);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
