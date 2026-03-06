import type { PipelineConfig } from '../types/pipeline.js';
import { DONE_TARGET } from '../types/pipeline.js';
import type { ValidationResult } from './config-validator.js';

/**
 * Layer 2: Graph Validation (traversal).
 *
 * Checks:
 * - All states reachable from entry_phase via transitions_to chains
 * - All states can reach Done via some path
 * - No dead ends (states with no path to Done)
 * - Cycles are allowed if at least one state in the cycle can reach Done
 */
export function validateGraph(config: PipelineConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { phases, entry_phase } = config.workflow;

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const phase of phases) {
    adjacency.set(phase.name, phase.transitions_to.filter((t) => t !== DONE_TARGET));
  }

  // Track which states can reach Done
  const canReachDone = new Set<string>();
  for (const phase of phases) {
    if (phase.transitions_to.includes(DONE_TARGET)) {
      canReachDone.add(phase.name);
    }
  }

  // BFS backward from Done-reaching states to find all states that can eventually reach Done
  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of phases) {
      if (canReachDone.has(phase.name)) continue;
      // If any of this phase's transitions_to targets can reach Done, so can this phase
      const targets = phase.transitions_to.filter((t) => t !== DONE_TARGET);
      if (targets.some((t) => canReachDone.has(t))) {
        canReachDone.add(phase.name);
        changed = true;
      }
    }
  }

  // Check all states can reach Done
  for (const phase of phases) {
    if (!canReachDone.has(phase.name)) {
      errors.push(
        `State "${phase.name}" cannot reach Done via any transition path`
      );
    }
  }

  // BFS forward from entry_phase to find reachable states
  const reachable = new Set<string>();
  const queue: string[] = [entry_phase];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const targets = adjacency.get(current) ?? [];
    for (const target of targets) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  // Check all states are reachable from entry
  for (const phase of phases) {
    if (!reachable.has(phase.name)) {
      errors.push(
        `State "${phase.name}" is not reachable from entry_phase "${entry_phase}"`
      );
    }
  }

  return { errors, warnings };
}
