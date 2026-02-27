import type { SemanticStep, ParsedMessage } from '../types/session.js';
import type { LinkedToolItemData } from '../types/groups.js';
import { toDate } from './display-helpers.js';

/**
 * Match tool_call steps to their tool_result steps by toolCallId.
 * Returns a Map keyed by toolCallId.
 *
 * Builds input/result maps from the messages array for richer data than
 * what SemanticStep.content provides (which is just the tool name string).
 */
export function linkToolCallsToResults(
  steps: SemanticStep[],
  messages: ParsedMessage[],
): Map<string, LinkedToolItemData> {
  const linked = new Map<string, LinkedToolItemData>();

  // Build result lookup: toolCallId -> tool_result step
  const resultMap = new Map<string, SemanticStep>();
  for (const step of steps) {
    if (step.type === 'tool_result' && step.toolCallId) {
      resultMap.set(step.toolCallId, step);
    }
  }

  // Build input map from message toolCalls for actual tool input data
  const inputMap = new Map<string, { input: Record<string, unknown>; startTime: Date }>();
  for (const msg of messages) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        inputMap.set(tc.id, { input: tc.input, startTime: msg.timestamp });
      }
    }
  }

  // Build result content map from message toolResults for richer result data
  const resultContentMap = new Map<string, { content: string | unknown[]; isError: boolean; endTime: Date }>();
  for (const msg of messages) {
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        resultContentMap.set(tr.toolUseId, {
          content: tr.content,
          isError: tr.isError,
          endTime: msg.timestamp,
        });
      }
    }
  }

  // Build skill instructions lookup from isMeta messages with sourceToolUseID
  const skillInstructionsMap = new Map<string, { text: string; tokenCount: number }>();
  for (const msg of messages) {
    if (msg.isMeta && msg.sourceToolUseID) {
      const textContent = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text)
              .join('\n')
          : '';
      if (textContent.startsWith('Base directory for this skill:')) {
        skillInstructionsMap.set(msg.sourceToolUseID, {
          text: textContent,
          tokenCount: estimateTokens(textContent),
        });
      }
    }
  }

  // Link each tool_call to its result
  for (const step of steps) {
    if (step.type !== 'tool_call' || !step.toolCallId) continue;

    const resultStep = resultMap.get(step.toolCallId);
    const inputData = inputMap.get(step.toolCallId);
    const resultContentData = resultContentMap.get(step.toolCallId);
    const toolInput = inputData?.input ?? {};
    const callTokens = estimateTokens((step.toolName ?? '') + JSON.stringify(toolInput));
    const skillInfo = skillInstructionsMap.get(step.toolCallId);

    // Prefer richer result from resultContentMap, fall back to step data
    const resultContent = resultContentData?.content ?? resultStep?.content;
    const resultIsError = resultContentData?.isError ?? resultStep?.isError ?? false;

    const item: LinkedToolItemData = {
      id: step.toolCallId,
      name: step.toolName ?? 'unknown',
      input: toolInput,
      callTokens,
      result: (resultStep || resultContentData) ? {
        content: resultContent ?? '',
        isError: resultIsError,
        tokenCount: estimateTokens(
          typeof resultContent === 'string'
            ? resultContent
            : JSON.stringify(resultContent),
        ),
      } : undefined,
      inputPreview: JSON.stringify(toolInput).slice(0, 100),
      outputPreview: resultContent
        ? String(resultContent).slice(0, 200)
        : undefined,
      startTime: inputData?.startTime ?? new Date(),
      endTime: resultContentData?.endTime,
      isOrphaned: !resultStep && !resultContentData,
      skillInstructions: skillInfo?.text,
      skillInstructionsTokenCount: skillInfo?.tokenCount,
    };

    if (step.durationMs != null) {
      item.durationMs = step.durationMs;
    } else if (inputData?.startTime && resultContentData?.endTime) {
      item.durationMs = toDate(resultContentData.endTime).getTime() - toDate(inputData.startTime).getTime();
    }

    linked.set(step.toolCallId, item);
  }

  return linked;
}

/**
 * Estimate token count from text length.
 * Uses the standard approximation of ~4 characters per token.
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
