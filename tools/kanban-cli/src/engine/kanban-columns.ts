import { COMPLETE_STATUS } from '../types/pipeline.js';
import type { KanbanColumn } from '../types/work-items.js';

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
 * Column assignment rules (in priority order):
 * 1. Status is "Complete" → Done
 * 2. Has unresolved dependencies → Backlog
 * 3. Status is "Not Started" → Ready for Work
 * 4. Status matches a pipeline state → that pipeline column name
 * 5. Otherwise → Backlog (unknown/unmapped status)
 *
 * Note: "To Convert" is for tickets with no stages — that is handled
 * at the ticket level, not the stage level, so it does not appear here.
 */
export function computeKanbanColumn(input: KanbanColumnInput): KanbanColumn {
  const { status, pipelineStatuses, hasUnresolvedDeps } = input;

  // 1. Complete → Done (regardless of deps)
  if (status === COMPLETE_STATUS) {
    return 'Done';
  }

  // 2. Unresolved deps → Backlog
  if (hasUnresolvedDeps) {
    return 'Backlog';
  }

  // 3. Not Started with resolved deps → Ready for Work
  if (status === 'Not Started') {
    return 'Ready for Work';
  }

  // 4. Pipeline status → pipeline column (status = column name by convention)
  if (pipelineStatuses.includes(status)) {
    return status;
  }

  // 5. Unknown → Backlog
  return 'Backlog';
}
