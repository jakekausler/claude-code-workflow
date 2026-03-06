import type { StateMachine } from './state-machine.js';
import { DONE_TARGET, COMPLETE_STATUS } from '../types/pipeline.js';

export interface TransitionResult {
  valid: boolean;
  error?: string;
}

export class TransitionValidator {
  constructor(private stateMachine: StateMachine) {}

  /**
   * Check if transitioning from one status to a target name is valid.
   *
   * @param fromStatus - Current status value (from frontmatter)
   * @param toName - Target state name (from transitions_to list)
   */
  validate(fromStatus: string, toName: string): TransitionResult {
    const fromState = this.stateMachine.getStateByStatus(fromStatus);
    if (!fromState) {
      return { valid: false, error: `Source status "${fromStatus}" not found in pipeline` };
    }

    if (!fromState.transitions_to.includes(toName)) {
      return {
        valid: false,
        error: `"${toName}" is not a valid transition from "${fromState.name}". Valid targets: ${fromState.transitions_to.join(', ')}`,
      };
    }

    // Verify target exists (or is Done)
    if (toName !== DONE_TARGET) {
      const toState = this.stateMachine.getStateByName(toName);
      if (!toState) {
        return {
          valid: false,
          error: `Target state "${toName}" not found in pipeline`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Resolve a transition target name to the status value that should be
   * written to frontmatter.
   *
   * @param fromStatus - Current status value
   * @param toName - Target state name
   * @returns The status string to write, or null if invalid
   */
  resolveTransitionTarget(fromStatus: string, toName: string): string | null {
    const result = this.validate(fromStatus, toName);
    if (!result.valid) return null;

    if (toName === DONE_TARGET) return COMPLETE_STATUS;

    const toState = this.stateMachine.getStateByName(toName);
    return toState?.status ?? null;
  }
}
