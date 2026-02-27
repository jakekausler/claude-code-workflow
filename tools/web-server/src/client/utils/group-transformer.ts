import type {
  Chunk, AIChunk, UserChunk, SystemChunk, CompactChunk,
  EnhancedAIChunk, SemanticStep, ParsedMessage, UsageMetadata,
} from '../types/session.js';
import type {
  SessionConversation, ChatItem, UserGroup, UserGroupContent,
  SystemGroup, AIGroup, AIGroupTokens, AIGroupStatus,
  CompactGroup, CompactionTokenDelta, CommandInfo, ImageData, FileReference,
} from '../types/groups.js';
import { sanitizeDisplayContent, extractTextContent, toDate, isCommandContent } from './display-helpers.js';

export function transformChunksToConversation(
  chunks: Chunk[],
  isOngoing: boolean,
  sessionId: string = '',
): SessionConversation {
  const items: ChatItem[] = [];
  let userIndex = 0;
  let aiTurnIndex = 0;

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'user':
        items.push({ type: 'user', group: createUserGroup(chunk, userIndex++) });
        break;
      case 'system':
        items.push({ type: 'system', group: createSystemGroup(chunk) });
        break;
      case 'ai':
        items.push({ type: 'ai', group: createAIGroup(chunk, aiTurnIndex++) });
        break;
      case 'compact':
        items.push({ type: 'compact', group: createCompactGroup(chunk) });
        break;
    }
  }

  // Post-pass: enrich CompactGroups with tokenDelta and phaseNumber,
  // and assign phaseNumber to each AIGroup
  const totalPhases = enrichGroupPhases(items);

  // Post-pass: mark last AI group as ongoing if session is ongoing
  if (isOngoing) {
    markLastAIGroupOngoing(items);
  }

  return {
    sessionId,
    items,
    totalUserGroups: items.filter((i) => i.type === 'user').length,
    totalSystemGroups: items.filter((i) => i.type === 'system').length,
    totalAIGroups: items.filter((i) => i.type === 'ai').length,
    totalCompactGroups: items.filter((i) => i.type === 'compact').length,
    totalPhases,
  };
}

/**
 * Create a UserGroup from a UserChunk.
 * Extracts text, commands, file references, and images from the message content.
 */
function createUserGroup(chunk: UserChunk, index: number): UserGroup {
  const msg = chunk.message;
  const rawContent = extractTextContent(msg.content);
  const sanitized = sanitizeDisplayContent(rawContent);

  const isCommand = isCommandContent(rawContent);
  const commands = isCommand ? [] : extractCommands(sanitized);
  const fileReferences = extractFileReferences(sanitized);
  const images = extractImages(msg.content);

  // Remove extracted commands from display text
  let displayText = sanitized;
  for (const cmd of commands) {
    const cmdPattern = new RegExp(`\\/${escapeRegex(cmd.name)}(?:\\s+${cmd.args ? escapeRegex(cmd.args) : ''})?`, 'g');
    displayText = displayText.replace(cmdPattern, '').trim();
  }

  return {
    id: chunk.id,
    message: msg,
    timestamp: msg.timestamp,
    content: {
      text: displayText || undefined,
      rawText: sanitized || undefined,
      commands,
      images,
      fileReferences,
    },
    index,
  };
}

/**
 * Create a SystemGroup from a SystemChunk.
 */
function createSystemGroup(chunk: SystemChunk): SystemGroup {
  const firstMsg = chunk.messages[0];
  const rawContent = extractTextContent(firstMsg.content);

  // Strip local-command XML wrappers
  let commandOutput = rawContent;
  commandOutput = commandOutput.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '$1');
  commandOutput = commandOutput.replace(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/g, '$1');
  commandOutput = commandOutput.trim();

  return {
    id: chunk.id,
    message: firstMsg,
    timestamp: firstMsg.timestamp,
    commandOutput,
  };
}

/**
 * Create an AIGroup from an AIChunk (or EnhancedAIChunk).
 */
function createAIGroup(chunk: AIChunk, turnIndex: number): AIGroup {
  const messages = chunk.messages;
  const isEnhanced = isEnhancedAIChunk(chunk);
  const steps: SemanticStep[] = isEnhanced ? ((chunk as EnhancedAIChunk).semanticSteps ?? []) : [];
  const subagents = isEnhanced ? ((chunk as EnhancedAIChunk).subagents ?? []) : [];

  // Calculate timing from message timestamps
  const startTime = messages.length > 0 ? messages[0].timestamp : chunk.timestamp;
  const endTime = messages.length > 0 ? messages[messages.length - 1].timestamp : chunk.timestamp;
  const durationMs = toDate(endTime).getTime() - toDate(startTime).getTime();

  // Calculate tokens from last assistant message usage (context window snapshot)
  const tokens = calculateTokens(messages);

  // Determine status
  const status = determineStatus(steps);

  // Compute summary
  const thinkingStep = steps.find((s) => s.type === 'thinking');
  const thinkingPreview = thinkingStep?.content
    ? thinkingStep.content.slice(0, 100)
    : undefined;
  const toolCallCount = steps.filter((s) => s.type === 'tool_call').length;
  const outputMessageCount = steps.filter((s) => s.type === 'output').length;
  const subagentCount = subagents.length;

  return {
    id: chunk.id,
    turnIndex,
    startTime,
    endTime,
    durationMs,
    steps,
    tokens,
    summary: {
      thinkingPreview,
      toolCallCount,
      outputMessageCount,
      subagentCount,
      totalDurationMs: durationMs,
      totalTokens: tokens.total,
      outputTokens: tokens.output,
      cachedTokens: tokens.cacheRead,
    },
    status,
    processes: subagents,
    chunkId: `chunk-${turnIndex}`,
    responses: messages,
    isOngoing: false,
  };
}

/**
 * Create a CompactGroup from a CompactChunk.
 * CompactChunk does not have a `message` field, so we synthesize a minimal ParsedMessage.
 */
function createCompactGroup(chunk: CompactChunk): CompactGroup {
  const syntheticMessage: ParsedMessage = {
    uuid: `compact-${toDate(chunk.timestamp).getTime()}`,
    parentUuid: null,
    type: 'summary',
    timestamp: chunk.timestamp,
    content: chunk.summary,
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    isCompactSummary: true,
  };

  return {
    id: chunk.id,
    timestamp: chunk.timestamp,
    summary: chunk.summary,
    message: syntheticMessage,
  };
}

/**
 * Enrich CompactGroups with tokenDelta and startingPhaseNumber,
 * and assign phaseNumber to each AIGroup.
 *
 * Phase 1 = items before the first CompactGroup.
 * Each CompactGroup increments the phase for subsequent items.
 *
 * Returns the total number of phases.
 */
function enrichGroupPhases(items: ChatItem[]): number {
  let currentPhase = 1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.type === 'ai') {
      item.group.phaseNumber = currentPhase;
    }

    if (item.type === 'compact') {
      item.group.startingPhaseNumber = currentPhase;
      currentPhase++;

      // Find last AI group before this compact
      const preTokens = findLastAIGroupTokensBefore(items, i);

      // Find first AI group after this compact
      const postTokens = findFirstAIGroupTokensAfter(items, i);

      if (preTokens !== null && postTokens !== null) {
        item.group.tokenDelta = {
          preCompactionTokens: preTokens,
          postCompactionTokens: postTokens,
          delta: postTokens - preTokens,
        };
      }
    }
  }

  return currentPhase;
}

/**
 * Mark the last AI group as ongoing.
 */
function markLastAIGroupOngoing(items: ChatItem[]): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'ai') {
      const group = (items[i] as { type: 'ai'; group: AIGroup }).group;
      group.isOngoing = true;
      group.status = 'in_progress';
      return;
    }
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getLastAssistantUsage(messages: ParsedMessage[]): UsageMetadata | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'assistant' && messages[i].usage) {
      return messages[i].usage;
    }
  }
  return undefined;
}

function calculateTokens(messages: ParsedMessage[]): AIGroupTokens {
  const usage = getLastAssistantUsage(messages);
  if (!usage) {
    return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  return { input, output, cacheRead, cacheCreation, total: input + output + cacheRead + cacheCreation };
}

function determineStatus(steps: SemanticStep[]): AIGroupStatus {
  // Check for error steps
  if (steps.some((s) => s.isError)) return 'error';

  return 'complete';
}

function isEnhancedAIChunk(chunk: AIChunk): chunk is EnhancedAIChunk {
  return 'semanticSteps' in chunk && Array.isArray((chunk as EnhancedAIChunk).semanticSteps);
}

function extractCommands(text: string): CommandInfo[] {
  const commands: CommandInfo[] = [];
  const regex = /^\/([a-z][a-z_-]{0,50})(?:\s+(.*))?$/gim;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    commands.push({
      name: match[1],
      args: match[2]?.trim() || undefined,
    });
  }
  return commands;
}

function extractFileReferences(text: string): FileReference[] {
  const refs: FileReference[] = [];
  const regex = /@([~a-zA-Z0-9._/-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ path: match[1] });
  }
  return refs;
}

function extractImages(content: string | unknown[]): ImageData[] {
  if (typeof content === 'string' || !Array.isArray(content)) return [];
  return content
    .filter((block): block is { type: 'image'; source: { media_type: string } } => {
      if (block == null || typeof block !== 'object') return false;
      const b = block as Record<string, unknown>;
      if (b.type !== 'image') return false;
      const source = b.source;
      if (source == null || typeof source !== 'object') return false;
      const s = source as Record<string, unknown>;
      return typeof s.media_type === 'string';
    })
    .map((block) => ({ mediaType: block.source.media_type }));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLastAIGroupTokensBefore(items: ChatItem[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].type === 'ai') {
      return (items[i] as { type: 'ai'; group: AIGroup }).group.tokens.total;
    }
  }
  return null;
}

function findFirstAIGroupTokensAfter(items: ChatItem[], index: number): number | null {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].type === 'ai') {
      return (items[i] as { type: 'ai'; group: AIGroup }).group.tokens.total;
    }
  }
  return null;
}
