// ---------- Input data shapes ----------

export interface ValidateEpicRow {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  tickets: string[];
  depends_on: string[];
  file_path: string;
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
  file_path: string;
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
  file_path: string;
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
}

export interface ValidationWarning {
  file: string;
  field: string;
  warning: string;
}

export interface ValidateOutput {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidateInput {
  epics: ValidateEpicRow[];
  tickets: ValidateTicketRow[];
  stages: ValidateStageRow[];
  dependencies: ValidateDependencyRow[];
  allIds: Set<string>;
  validStatuses: Set<string>;
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
const VALID_DEP_PAIRS: Record<string, Set<string>> = {
  epic: new Set(['epic']),
  ticket: new Set(['ticket', 'epic']),
  stage: new Set(['stage', 'ticket', 'epic']),
};

// ---------- Core logic ----------

export function validateWorkItems(input: ValidateInput): ValidateOutput {
  const { epics, tickets, stages, dependencies, allIds, validStatuses } = input;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const ticketIds = new Set(tickets.map((t) => t.id));
  const stageIds = new Set(stages.map((s) => s.id));

  // --- Validate epics ---
  for (const epic of epics) {
    // Required fields
    if (!epic.title) {
      errors.push({ file: epic.file_path, field: 'title', error: 'Epic title is required' });
    }

    // Validate tickets array references
    for (const ticketId of epic.tickets) {
      if (!ticketIds.has(ticketId) && !allIds.has(ticketId)) {
        errors.push({
          file: epic.file_path,
          field: 'tickets',
          error: `Referenced ticket ${ticketId} does not exist`,
        });
      }
    }

    // Validate depends_on references
    for (const depId of epic.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: epic.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        // Check valid dependency type
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['epic'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: epic.file_path,
            field: 'depends_on',
            error: `Epic cannot depend on ${depType} (${depId}). Epics can only depend on other epics.`,
          });
        }
      }
    }

    // Validate status
    if (!validStatuses.has(epic.status)) {
      errors.push({
        file: epic.file_path,
        field: 'status',
        error: `Invalid status "${epic.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }
  }

  // --- Validate tickets ---
  for (const ticket of tickets) {
    // Required fields
    if (!ticket.title) {
      errors.push({ file: ticket.file_path, field: 'title', error: 'Ticket title is required' });
    }

    // Warning for tickets without stages
    if (ticket.stages.length === 0) {
      warnings.push({
        file: ticket.file_path,
        field: 'stages',
        warning: 'Ticket has no stages — needs conversion',
      });
    }

    // Validate stages array references
    for (const stageId of ticket.stages) {
      if (!stageIds.has(stageId) && !allIds.has(stageId)) {
        errors.push({
          file: ticket.file_path,
          field: 'stages',
          error: `Referenced stage ${stageId} does not exist`,
        });
      }
    }

    // Validate depends_on references
    for (const depId of ticket.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: ticket.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['ticket'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: ticket.file_path,
            field: 'depends_on',
            error: `Ticket cannot depend on ${depType} (${depId}). Tickets can depend on tickets and epics.`,
          });
        }
      }
    }

    // Validate status
    if (!validStatuses.has(ticket.status)) {
      errors.push({
        file: ticket.file_path,
        field: 'status',
        error: `Invalid status "${ticket.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }
  }

  // --- Validate stages ---
  const worktreeBranches = new Map<string, string>(); // branch -> stage file_path

  for (const stage of stages) {
    // Required fields
    if (!stage.title) {
      errors.push({ file: stage.file_path, field: 'title', error: 'Stage title is required' });
    }

    // Validate status
    if (!validStatuses.has(stage.status)) {
      errors.push({
        file: stage.file_path,
        field: 'status',
        error: `Invalid status "${stage.status}". Valid values: ${[...validStatuses].join(', ')}`,
      });
    }

    // Validate depends_on references
    for (const depId of stage.depends_on) {
      if (!allIds.has(depId)) {
        errors.push({
          file: stage.file_path,
          field: 'depends_on',
          error: `Reference ${depId} does not exist`,
        });
      } else {
        const depType = getEntityType(depId);
        const allowed = VALID_DEP_PAIRS['stage'];
        if (allowed && !allowed.has(depType)) {
          errors.push({
            file: stage.file_path,
            field: 'depends_on',
            error: `Stage cannot depend on ${depType} (${depId}). Invalid dependency type.`,
          });
        }
      }
    }

    // Check unique worktree_branch
    if (stage.worktree_branch) {
      const existingFile = worktreeBranches.get(stage.worktree_branch);
      if (existingFile) {
        errors.push({
          file: stage.file_path,
          field: 'worktree_branch',
          error: `Duplicate worktree_branch "${stage.worktree_branch}" — also used by ${existingFile}`,
        });
      } else {
        worktreeBranches.set(stage.worktree_branch, stage.file_path);
      }
    }
  }

  // --- Check for circular dependencies ---
  const circles = findCircularDeps(dependencies);
  for (const cycle of circles) {
    errors.push({
      file: '',
      field: 'depends_on',
      error: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
