import type { OldFormatEpic, IdMapping } from './types.js';

/**
 * Build the default ticket ID for an epic.
 * In the simple migration, each epic gets one ticket: TICKET-{epicNum}-001.
 */
export function buildTicketId(epicNum: string): string {
  return `TICKET-${epicNum}-001`;
}

/**
 * Convert an old two-level stage ID (STAGE-XXX-YYY) to
 * a new three-level stage ID (STAGE-XXX-001-YYY).
 * The "001" is the default ticket number.
 */
export function mapStageId(oldId: string): string {
  const match = /^STAGE-(\d{3})-(\d{3})$/.exec(oldId);
  if (!match) {
    throw new Error(`Invalid old-format stage ID: ${oldId}`);
  }
  return `STAGE-${match[1]}-001-${match[2]}`;
}

/**
 * Generate ID mappings for all stages in an old-format epic.
 * Each epic gets one ticket (TICKET-{epicNum}-001) and all stages
 * are mapped from STAGE-XXX-YYY to STAGE-XXX-001-YYY.
 */
export function mapIds(epic: OldFormatEpic): IdMapping[] {
  const ticketId = buildTicketId(epic.epicNum);

  return epic.stages.map((stage) => ({
    oldStageId: stage.oldId,
    newStageId: mapStageId(stage.oldId),
    ticketId,
    epicId: epic.id,
  }));
}
