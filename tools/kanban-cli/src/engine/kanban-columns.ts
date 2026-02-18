import { COMPLETE_STATUS } from '../types/pipeline.js';
import type { KanbanColumn } from '../types/work-items.js';

/**
 * Convert a display name (e.g. "Ready for Work") to a snake_case column key.
 */
export function toColumnKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Input needed to compute a stage's kanban column.
 */
export interface KanbanColumnInput {
  /** The stage's current status from frontmatter */
  status: string;
  /** All status values defined in the pipeline config */
  pipelineStatuses: string[];
  /** Whether this stage has unresolved dependencies */
  hasUnresolvedDeps: boolean;
}

/**
 * Compute the kanban board column for a stage.
 *
 * Returns snake_case column keys for consistent storage and comparison.
 *
 * Column assignment rules (in priority order):
 * 1. Status is "Complete" → done
 * 2. Has unresolved dependencies → backlog
 * 3. Status is "Not Started" → ready_for_work
 * 4. Status matches a pipeline state → snake_case of that status
 * 5. Otherwise → backlog (unknown/unmapped status)
 *
 * Note: "to_convert" is for tickets with no stages — that is handled
 * at the ticket level, not the stage level, so it does not appear here.
 */
export function computeKanbanColumn(input: KanbanColumnInput): KanbanColumn {
  const { status, pipelineStatuses, hasUnresolvedDeps } = input;

  // 1. Complete → done (regardless of deps)
  if (status === COMPLETE_STATUS) {
    return 'done';
  }

  // 2. Unresolved deps → backlog
  if (hasUnresolvedDeps) {
    return 'backlog';
  }

  // 3. Not Started with resolved deps → ready_for_work
  if (status === 'Not Started') {
    return 'ready_for_work';
  }

  // 4. Pipeline status → snake_case column key
  if (pipelineStatuses.includes(status)) {
    return toColumnKey(status);
  }

  // 5. Unknown → backlog
  return 'backlog';
}
