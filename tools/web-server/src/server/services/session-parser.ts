import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { stat } from 'fs/promises';
import type {
  ParsedMessage,
  ToolCall,
  ToolResult,
  ContentBlock,
  EntryType,
  ToolUseContent,
  ToolResultContent,
} from '../types/jsonl.js';

const KNOWN_ENTRY_TYPES = new Set<string>([
  'user', 'assistant', 'system', 'summary', 'file-history-snapshot', 'queue-operation',
]);

export interface ParseOptions {
  /**
   * Byte offset to start reading from (for incremental parsing).
   * IMPORTANT: Must be a value returned from a previous `bytesRead` result
   * to ensure alignment with line boundaries. Arbitrary byte offsets may
   * split multi-byte UTF-8 characters or land mid-line, corrupting the first entry.
   */
  startOffset?: number;
}

export interface ParseResult {
  messages: ParsedMessage[];
  bytesRead: number;
}

/**
 * Parse a JSONL session file line-by-line into ParsedMessage[].
 *
 * Handles missing files gracefully (returns empty result).
 * Skips invalid JSON lines, empty lines, and entries without uuid.
 */
export async function parseSessionFile(
  filePath: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const startOffset = options?.startOffset ?? 0;

  let fileSize: number;
  try {
    const fileStat = await stat(filePath);
    fileSize = fileStat.size;
  } catch {
    // File not found or inaccessible — return empty
    return { messages: [], bytesRead: 0 };
  }

  if (fileSize === 0 || startOffset >= fileSize) {
    return { messages: [], bytesRead: 0 };
  }

  const messages: ParsedMessage[] = [];

  const stream = createReadStream(filePath, { start: startOffset });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const parsed = parseJsonlLine(line);
    if (parsed !== null) {
      messages.push(parsed);
    }
  }

  return { messages, bytesRead: fileSize - startOffset };
}

/**
 * Parse a single JSONL line into a ParsedMessage.
 *
 * Returns null for:
 * - Empty lines
 * - Invalid JSON
 * - Entries without a uuid field (e.g. progress entries)
 */
export function parseJsonlLine(line: string): ParsedMessage | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;

  // Must have a uuid to be a valid parseable entry
  if (typeof raw.uuid !== 'string') return null;

  const typeStr = raw.type;
  if (typeof typeStr !== 'string' || !KNOWN_ENTRY_TYPES.has(typeStr)) {
    return null;
  }
  const type = typeStr as EntryType;
  const uuid = raw.uuid as string;
  const parentUuid = (raw.parentUuid as string | null) ?? null;
  const timestamp = raw.timestamp ? new Date(raw.timestamp as string) : new Date();
  const isSidechain = (raw.isSidechain as boolean) ?? false;
  const cwd = raw.cwd as string | undefined;
  const gitBranch = raw.gitBranch as string | undefined;
  const agentId = raw.agentId as string | undefined;
  const userType = raw.userType as string | undefined;
  const sourceToolUseID = raw.sourceToolUseID as string | undefined;
  const sourceToolAssistantUUID = raw.sourceToolAssistantUUID as string | undefined;
  const toolUseResult = raw.toolUseResult as Record<string, unknown> | undefined;
  const requestId = raw.requestId as string | undefined;

  // Determine isMeta
  let isMeta = (raw.isMeta as boolean) ?? false;
  if (type === 'system') {
    isMeta = true;
  }

  // Handle summary entries — no message field
  if (type === 'summary') {
    return {
      uuid,
      parentUuid,
      type,
      timestamp,
      content: (raw.summary as string) ?? '',
      isSidechain,
      isMeta,
      userType,
      cwd,
      gitBranch,
      agentId,
      toolCalls: [],
      toolResults: [],
      isCompactSummary: true,
    };
  }

  // Handle file-history-snapshot entries
  if (type === 'file-history-snapshot') {
    return {
      uuid,
      parentUuid,
      type,
      timestamp,
      content: '',
      isSidechain,
      isMeta: true,
      userType,
      cwd,
      gitBranch,
      agentId,
      toolCalls: [],
      toolResults: [],
    };
  }

  // Handle queue-operation entries
  if (type === 'queue-operation') {
    return {
      uuid,
      parentUuid,
      type,
      timestamp,
      content: (raw.content as string) ?? '',
      isSidechain,
      isMeta: true,
      userType,
      cwd,
      gitBranch,
      agentId,
      toolCalls: [],
      toolResults: [],
    };
  }

  // Conversational entries (user, assistant, system) have a message field
  const message = raw.message as Record<string, unknown> | undefined;
  const role = message?.role as string | undefined;

  // Extract content
  let content: ContentBlock[] | string = '';
  if (message?.content !== undefined) {
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content as ContentBlock[];
    }
  }

  // Extract usage and model from assistant entries
  const usage = message?.usage as ParsedMessage['usage'];
  const model = message?.model as string | undefined;

  // Extract tool calls and results from content blocks
  let toolCalls: ToolCall[] = [];
  let toolResults: ToolResult[] = [];
  if (Array.isArray(content)) {
    toolCalls = extractToolCalls(content);
    toolResults = extractToolResults(content);
  }

  // Detect isCompactSummary from raw entry field
  const isCompactSummary = raw.isCompactSummary as boolean | undefined;

  return {
    uuid,
    parentUuid,
    type,
    timestamp,
    role,
    content,
    usage,
    model,
    cwd,
    gitBranch,
    agentId,
    isSidechain,
    isMeta,
    userType,
    toolCalls,
    toolResults,
    sourceToolUseID,
    sourceToolAssistantUUID,
    toolUseResult,
    isCompactSummary,
    requestId,
  };
}

/**
 * Deduplicate messages by requestId, keeping only the last occurrence.
 *
 * Claude Code writes multiple JSONL entries per API response during streaming.
 * Each successive entry with the same requestId is a superset of the previous
 * (contains the full content so far). This mirrors devtools' deduplication
 * strategy: keep only the final (most complete) entry for each requestId.
 *
 * Messages without a requestId are always kept.
 */
export function deduplicateByRequestId(messages: ParsedMessage[]): ParsedMessage[] {
  const lastIndexByRequestId = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const rid = messages[i].requestId;
    if (rid) {
      lastIndexByRequestId.set(rid, i);
    }
  }

  return messages.filter((msg, i) => {
    if (!msg.requestId) return true;
    return lastIndexByRequestId.get(msg.requestId) === i;
  });
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      const toolUse = block as ToolUseContent;
      const isTask = toolUse.name === 'Task';
      calls.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        isTask,
        ...(isTask && toolUse.input.description
          ? { taskDescription: toolUse.input.description as string }
          : {}),
        ...(isTask && toolUse.input.subagent_type
          ? { taskSubagentType: toolUse.input.subagent_type as string }
          : {}),
      });
    }
  }
  return calls;
}

function extractToolResults(content: ContentBlock[]): ToolResult[] {
  const results: ToolResult[] = [];
  for (const block of content) {
    if (block.type === 'tool_result') {
      const toolResult = block as ToolResultContent;
      results.push({
        toolUseId: toolResult.tool_use_id,
        content: toolResult.content as string | unknown[],
        isError: toolResult.is_error ?? false,
      });
    }
  }
  return results;
}
