import type {
  ParsedMessage,
  MessageCategory,
  Chunk,
  AIChunk,
  SemanticStep,
  ToolExecution,
} from '../types/jsonl.js';

/**
 * Classify a ParsedMessage into one of four categories:
 * - 'hardNoise': filtered out entirely (system entries, synthetic messages, reminders, etc.)
 * - 'system': system command output (local-command-stdout)
 * - 'user': real user input
 * - 'ai': assistant messages and tool results (isMeta user messages)
 */
export function classifyMessage(msg: ParsedMessage): MessageCategory {
  // 1. Non-conversational entry types → hardNoise
  if (
    msg.type === 'system' ||
    msg.type === 'file-history-snapshot' ||
    msg.type === 'queue-operation' ||
    msg.type === 'summary'
  ) {
    return 'hardNoise';
  }

  // 2. Synthetic assistant messages → hardNoise
  if (msg.type === 'assistant' && msg.model === '<synthetic>') {
    return 'hardNoise';
  }

  // TODO: Also check TextContent blocks within array content for noise markers.
  // Currently only string content is checked. In practice, noise markers always appear
  // in string content, but array content could theoretically contain them.

  // 3-4. String content checks for noise markers
  if (typeof msg.content === 'string') {
    if (
      msg.content.includes('<local-command-caveat>') ||
      msg.content.includes('<system-reminder>')
    ) {
      return 'hardNoise';
    }
    // TODO: Consider producing 'interruption' SemanticStep instead of filtering as hardNoise.
    // Currently interruptions are dropped entirely. If 9F needs to display interruption
    // markers in the session timeline, this should be changed to pass through and let
    // extractSemanticSteps produce an 'interruption' step.
    if (msg.content.includes('[Request interrupted by user]')) {
      return 'hardNoise';
    }

    // 5. System command output
    if (msg.type === 'user' && msg.content.includes('<local-command-stdout>')) {
      return 'system';
    }
  }

  // 6. Real user input (not meta / tool result)
  if (msg.type === 'user' && !msg.isMeta) {
    return 'user';
  }

  // 7. Everything else → ai
  return 'ai';
}

/**
 * Group a flat list of ParsedMessages into visualization chunks.
 *
 * - Consecutive AI-category messages are merged into a single AIChunk.
 * - User messages each produce a UserChunk.
 * - System command outputs produce SystemChunks.
 * - Compact summaries produce CompactChunks.
 * - Hard noise is dropped entirely.
 */
export function buildChunks(messages: ParsedMessage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let aiBuffer: ParsedMessage[] = [];

  function flushAiBuffer(): void {
    if (aiBuffer.length > 0) {
      chunks.push({ type: 'ai', messages: [...aiBuffer], timestamp: aiBuffer[0].timestamp });
      aiBuffer = [];
    }
  }

  for (const msg of messages) {
    // Handle compact summaries before classification
    if (msg.isCompactSummary) {
      flushAiBuffer();
      const summary = typeof msg.content === 'string' ? msg.content : '';
      chunks.push({ type: 'compact', summary, timestamp: msg.timestamp });
      continue;
    }

    const category = classifyMessage(msg);

    switch (category) {
      case 'hardNoise':
        // Filter out entirely
        break;
      case 'user':
        flushAiBuffer();
        chunks.push({ type: 'user', message: msg, timestamp: msg.timestamp });
        break;
      case 'system':
        flushAiBuffer();
        chunks.push({ type: 'system', messages: [msg], timestamp: msg.timestamp });
        break;
      case 'ai':
        aiBuffer.push(msg);
        break;
    }
  }

  // Final flush for trailing AI messages
  flushAiBuffer();

  return chunks;
}

/**
 * Extract semantic steps from an AIChunk's messages.
 *
 * Walks each message's content blocks and produces a flat list of
 * SemanticStep records representing thinking, tool calls, tool results,
 * subagent dispatches, and text output.
 */
export function extractSemanticSteps(
  chunk: AIChunk,
  toolExecutions: ToolExecution[],
): SemanticStep[] {
  const steps: SemanticStep[] = [];
  const execMap = new Map(toolExecutions.map((e) => [e.toolCallId, e]));

  for (const msg of chunk.messages) {
    // String content in an AI chunk — treat as output
    if (typeof msg.content === 'string') {
      if (msg.content.trim()) {
        steps.push({ type: 'output', content: msg.content });
      }
      continue;
    }

    // Walk content blocks
    for (const block of msg.content) {
      switch (block.type) {
        case 'thinking':
          steps.push({ type: 'thinking', content: block.thinking });
          break;

        case 'tool_use': {
          const exec = execMap.get(block.id);
          const step: SemanticStep = {
            type: block.name === 'Task' ? 'subagent' : 'tool_call',
            content:
              block.name === 'Task'
                ? (block.input.description as string | undefined) ?? block.name
                : block.name,
            toolName: block.name,
            toolCallId: block.id,
            durationMs: exec?.durationMs,
          };
          if (block.name === 'Task') {
            step.subagentId = block.id;
          }
          steps.push(step);
          break;
        }

        case 'tool_result': {
          const exec = execMap.get(block.tool_use_id);
          steps.push({
            type: 'tool_result',
            content:
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            toolCallId: block.tool_use_id,
            toolName: exec?.toolName,
            isError: block.is_error ?? false,
          });
          break;
        }

        case 'text':
          if (block.text.trim()) {
            steps.push({ type: 'output', content: block.text });
          }
          break;

        // image blocks: skip (no semantic step type for images)
      }
    }
  }

  return steps;
}
