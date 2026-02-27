import { randomUUID } from 'crypto';
import type {
  ParsedMessage,
  MessageCategory,
  Chunk,
  AIChunk,
  SemanticStep,
  ToolExecution,
} from '../types/jsonl.js';

/** Regex to detect teammate messages: <teammate-message teammate_id="..." */
const TEAMMATE_MESSAGE_REGEX = /^<teammate-message\s+teammate_id="/;

/**
 * Classify a ParsedMessage into one of four categories:
 * - 'hardNoise': filtered out entirely (system entries, synthetic messages, reminders,
 *    interruption messages, empty stdout/stderr, etc.)
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

  // 3. String content checks for noise markers
  if (typeof msg.content === 'string') {
    const trimmedContent = msg.content.trim();

    // Hard noise tags (startsWith for precision)
    if (
      trimmedContent.startsWith('<local-command-caveat>') ||
      trimmedContent.startsWith('<system-reminder>')
    ) {
      return 'hardNoise';
    }

    // Interruption messages → hardNoise (filtered out entirely)
    if (trimmedContent.startsWith('[Request interrupted by user')) {
      return 'hardNoise';
    }

    // Empty stdout/stderr → hardNoise
    if (
      trimmedContent === '<local-command-stdout></local-command-stdout>' ||
      trimmedContent === '<local-command-stderr></local-command-stderr>'
    ) {
      return 'hardNoise';
    }

    // System command output
    if (msg.type === 'user' && trimmedContent.startsWith('<local-command-stdout>')) {
      return 'system';
    }
  }

  // 4. Array content checks for noise markers
  if (Array.isArray(msg.content)) {
    const blocks = msg.content as Array<{ type: string; text?: string }>;

    // Single text block with interruption → hardNoise
    if (
      blocks.length === 1 &&
      blocks[0].type === 'text' &&
      typeof blocks[0].text === 'string' &&
      blocks[0].text.startsWith('[Request interrupted by user')
    ) {
      return 'hardNoise';
    }

    // Check text blocks for noise tags
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const trimmedText = block.text.trim();
        if (
          trimmedText.startsWith('<local-command-caveat>') ||
          trimmedText.startsWith('<system-reminder>')
        ) {
          return 'hardNoise';
        }
      }
    }
  }

  // 5. Real user input — must contain text or image blocks
  //    Tool result messages are type="user" but only have tool_result blocks;
  //    they should stay in the AI buffer, not start a new user chunk.
  //    Teammate messages are excluded — they're injected into the AI buffer.
  if (msg.type === 'user' && !msg.isMeta) {
    if (typeof msg.content === 'string') {
      // Teammate messages → ai (they are responses injected into conversation)
      if (TEAMMATE_MESSAGE_REGEX.test(msg.content.trim())) {
        return 'ai';
      }
      return 'user';
    }
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type: string; text?: string }>;

      // Check for teammate message in text blocks
      const isTeammate = blocks.some(
        (block) =>
          block.type === 'text' &&
          typeof block.text === 'string' &&
          TEAMMATE_MESSAGE_REGEX.test(block.text.trim()),
      );
      if (isTeammate) {
        return 'ai';
      }

      const hasUserContent = blocks.some(
        (block) => block.type === 'text' || block.type === 'image',
      );
      if (hasUserContent) {
        return 'user';
      }
      // tool_result-only content → treat as part of AI turn
      return 'ai';
    }
    return 'user';
  }

  // 6. Everything else → ai
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
      const id = `ai-${aiBuffer[0]?.uuid ?? randomUUID()}`;
      chunks.push({ type: 'ai', id, messages: [...aiBuffer], timestamp: aiBuffer[0].timestamp });
      aiBuffer = [];
    }
  }

  for (const msg of messages) {
    // Handle compact summaries before classification
    if (msg.isCompactSummary) {
      flushAiBuffer();
      const summary = typeof msg.content === 'string' ? msg.content : '';
      const id = `compact-${msg.uuid ?? randomUUID()}`;
      chunks.push({ type: 'compact', id, summary, timestamp: msg.timestamp });
      continue;
    }

    const category = classifyMessage(msg);

    switch (category) {
      case 'hardNoise':
        // Filter out entirely
        break;
      case 'user':
        flushAiBuffer();
        chunks.push({ type: 'user', id: `user-${msg.uuid}`, message: msg, timestamp: msg.timestamp });
        break;
      case 'system':
        flushAiBuffer();
        chunks.push({ type: 'system', id: `system-${msg.uuid}`, messages: [msg], timestamp: msg.timestamp });
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
    // Skip isMeta messages with sourceToolUseID — these are tool results/instructions
    // consumed by the tool-linking-engine, not standalone conversation output
    if (msg.isMeta && msg.sourceToolUseID) {
      continue;
    }

    // String content in an AI chunk
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
