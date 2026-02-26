import type { SemanticStep } from '../types/session.js';
import type { AIGroupLastOutput } from '../types/groups.js';

// Keep legacy types for backward compatibility
export type LastOutputType = 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';

export interface LastOutput {
  type: LastOutputType;
  content?: string;
  toolName?: string;
  isError?: boolean;
}

/**
 * Find the last visible output for an AI group.
 *
 * Priority:
 * 1. Any interruption step (reverse scan)
 * 2. If isOngoing (and no interruption)
 * 3. Last tool_call with toolName === 'ExitPlanMode' AND no later output/tool_result
 * 4. Last output step with content
 * 5. Last tool_result step
 * 6. null
 */
export function findLastOutput(
  steps: SemanticStep[],
  isOngoing?: boolean,
  now?: Date,
): AIGroupLastOutput | null {
  const timestamp = now ?? new Date();

  // 1. Check for interruption
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'interruption') {
      return {
        type: 'interruption',
        interruptionMessage: steps[i].content,
        timestamp: timestamp,
      };
    }
  }

  // 2. Ongoing
  if (isOngoing) {
    return { type: 'ongoing', timestamp: timestamp };
  }

  // 3. Plan exit: last ExitPlanMode tool_call with no later output or tool_result
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'tool_call' && step.toolName === 'ExitPlanMode') {
      // Check no later output or tool_result
      const hasLaterContent = steps.slice(i + 1).some(
        (s) => s.type === 'output' || s.type === 'tool_result',
      );
      if (!hasLaterContent) {
        // Find preceding output step as preamble
        let planPreamble: string | undefined;
        for (let j = i - 1; j >= 0; j--) {
          if (steps[j].type === 'output' && steps[j].content) {
            planPreamble = steps[j].content;
            break;
          }
        }
        return {
          type: 'plan_exit',
          planContent: step.content,
          planPreamble,
          timestamp: timestamp,
        };
      }
    }
  }

  // 4. Last output step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'output' && steps[i].content) {
      return { type: 'text', text: steps[i].content, timestamp: timestamp };
    }
  }

  // 5. Last tool_result
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'tool_result') {
      return {
        type: 'tool_result',
        toolName: steps[i].toolName,
        toolResult: steps[i].content,
        isError: steps[i].isError,
        timestamp: timestamp,
      };
    }
  }

  return null;
}
