import type { PipelineConfig } from '../types/pipeline.js';
import { DONE_TARGET } from '../types/pipeline.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Layer 1: Config Validation (static parsing).
 *
 * Checks:
 * - entry_phase references an existing state name
 * - All transitions_to targets reference existing state names or "Done"
 * - No duplicate status values
 * - No duplicate state names
 * - Warns on states not reachable from any other state's transitions_to
 */
export function validateConfig(config: PipelineConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { phases, entry_phase } = config.workflow;

  const stateNames = new Set(phases.map((p) => p.name));
  const statusValues = new Map<string, string>(); // status → name

  // Check for duplicate names
  const namesSeen = new Set<string>();
  for (const phase of phases) {
    if (namesSeen.has(phase.name)) {
      errors.push(`Duplicate state name: "${phase.name}"`);
    }
    namesSeen.add(phase.name);
  }

  // Check for duplicate statuses
  for (const phase of phases) {
    const existing = statusValues.get(phase.status);
    if (existing) {
      errors.push(
        `Duplicate status value "${phase.status}" used by both "${existing}" and "${phase.name}"`
      );
    }
    statusValues.set(phase.status, phase.name);
  }

  // Check entry_phase exists
  if (!stateNames.has(entry_phase)) {
    errors.push(`entry_phase "${entry_phase}" does not reference an existing state name`);
  }

  // Check all transitions_to targets exist
  for (const phase of phases) {
    for (const target of phase.transitions_to) {
      if (target !== DONE_TARGET && !stateNames.has(target)) {
        errors.push(
          `State "${phase.name}": transitions_to target "${target}" does not exist in the pipeline`
        );
      }
    }
  }

  // Warn on unreachable states (not targeted by any transition and not the entry phase)
  const targetedStates = new Set<string>([entry_phase]);
  for (const phase of phases) {
    for (const target of phase.transitions_to) {
      if (target !== DONE_TARGET) {
        targetedStates.add(target);
      }
    }
  }
  for (const phase of phases) {
    if (!targetedStates.has(phase.name)) {
      warnings.push(
        `State "${phase.name}" is not reachable from any other state's transitions_to or entry_phase`
      );
    }
  }

  return { errors, warnings };
}
