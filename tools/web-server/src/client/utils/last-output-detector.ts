import type { SemanticStep } from '../types/session.js';

export type LastOutputType = 'text' | 'tool_result' | 'interruption' | 'ongoing';

export interface LastOutput {
  type: LastOutputType;
  content?: string;
  toolName?: string;
  isError?: boolean;
}

/**
 * Find the last visible output in an array of semantic steps.
 *
 * Priority:
 * 1. Any step with type === 'interruption' → { type: 'interruption' }
 * 2. If isOngoing is true → { type: 'ongoing' }
 * 3. Reverse scan for last type === 'output' → { type: 'text', content }
 * 4. Reverse scan for last type === 'tool_result' → { type: 'tool_result', toolName, isError }
 * 5. null
 */
export function findLastOutput(
  semanticSteps: SemanticStep[],
  isOngoing?: boolean,
): LastOutput | null {
  // 1. Check for any interruption step
  for (let i = semanticSteps.length - 1; i >= 0; i--) {
    if (semanticSteps[i].type === 'interruption') {
      return { type: 'interruption' };
    }
  }

  // 2. If ongoing, return ongoing type
  if (isOngoing) {
    return { type: 'ongoing' };
  }

  // 3. Reverse scan for last output step
  for (let i = semanticSteps.length - 1; i >= 0; i--) {
    const step = semanticSteps[i];
    if (step.type === 'output' && step.content) {
      return { type: 'text', content: step.content };
    }
  }

  // 4. Reverse scan for last tool_result step
  for (let i = semanticSteps.length - 1; i >= 0; i--) {
    const step = semanticSteps[i];
    if (step.type === 'tool_result') {
      return {
        type: 'tool_result',
        toolName: step.toolName,
        isError: step.isError,
      };
    }
  }

  // 5. Nothing found
  return null;
}
