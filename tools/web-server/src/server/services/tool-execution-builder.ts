import type { ParsedMessage, ToolExecution, ToolResult } from '../types/jsonl.js';

/**
 * Build a flat list of ToolExecution records by matching tool_use content
 * blocks (from assistant messages) to their corresponding tool_result content
 * blocks (from user/meta messages).
 *
 * Matching strategy:
 *  1. Primary: sourceToolUseID on the result message (most reliable).
 *  2. Fallback: toolResult.toolUseId field inside the content block.
 *  3. Any unmatched tool calls are marked as orphaned.
 *
 * Results are sorted by startTime ascending.
 */
export function buildToolExecutions(messages: ParsedMessage[]): ToolExecution[] {
  const executions: ToolExecution[] = [];

  // Pass 1: Collect all tool calls into a Map keyed by toolCallId
  const callMap = new Map<
    string,
    { toolName: string; input: Record<string, unknown>; startTime: Date }
  >();

  for (const msg of messages) {
    for (const call of msg.toolCalls) {
      callMap.set(call.id, {
        toolName: call.name,
        input: call.input,
        startTime: msg.timestamp,
      });
    }
  }

  // Pass 2: Match tool results to calls
  const matchedCallIds = new Set<string>();

  for (const msg of messages) {
    // Check sourceToolUseID first (most reliable)
    if (msg.sourceToolUseID && callMap.has(msg.sourceToolUseID)) {
      const call = callMap.get(msg.sourceToolUseID)!;
      const result: ToolResult | undefined = msg.toolResults[0] ?? undefined;
      matchedCallIds.add(msg.sourceToolUseID);
      executions.push({
        toolCallId: msg.sourceToolUseID,
        toolName: call.toolName,
        input: call.input,
        result,
        startTime: call.startTime,
        endTime: msg.timestamp,
        durationMs: msg.timestamp.getTime() - call.startTime.getTime(),
        isOrphaned: false,
      });
      // A sourceToolUseID message corresponds to exactly one tool call; skip fallback matching.
      continue;
    }

    // Fallback: match via toolResult.toolUseId
    for (const result of msg.toolResults) {
      if (callMap.has(result.toolUseId) && !matchedCallIds.has(result.toolUseId)) {
        const call = callMap.get(result.toolUseId)!;
        matchedCallIds.add(result.toolUseId);
        executions.push({
          toolCallId: result.toolUseId,
          toolName: call.toolName,
          input: call.input,
          result,
          startTime: call.startTime,
          endTime: msg.timestamp,
          durationMs: msg.timestamp.getTime() - call.startTime.getTime(),
          isOrphaned: false,
        });
      }
    }
  }

  // Pass 3: Mark orphaned tool calls (calls with no result)
  for (const [callId, call] of callMap) {
    if (!matchedCallIds.has(callId)) {
      executions.push({
        toolCallId: callId,
        toolName: call.toolName,
        input: call.input,
        result: undefined,
        startTime: call.startTime,
        endTime: undefined,
        durationMs: undefined,
        isOrphaned: true,
      });
    }
  }

  // Sort by start time
  executions.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return executions;
}
