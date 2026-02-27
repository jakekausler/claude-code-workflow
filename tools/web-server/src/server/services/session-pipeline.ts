import { join } from 'path';
import { stat } from 'fs/promises';
import type {
  ParsedSession,
  SessionMetrics,
  ParsedMessage,
  ToolExecution,
  Chunk,
  EnhancedAIChunk,
  Process,
} from '../types/jsonl.js';
import { parseSessionFile } from './session-parser.js';
import { buildToolExecutions } from './tool-execution-builder.js';
import { buildChunks, extractSemanticSteps } from './chunk-builder.js';
import { resolveSubagents } from './subagent-resolver.js';
import { calculateSessionCost } from './pricing.js';
import { DataCache } from './data-cache.js';
import { discoverClaudeMdFiles, decodeProjectRoot } from './claude-md-reader.js';
import { readMentionedFiles } from './mentioned-file-reader.js';

export interface IncrementalUpdate {
  /** Newly parsed messages since the last offset */
  newMessages: ParsedMessage[];
  /** New chunks built from the new messages, with AI chunks enhanced */
  newChunks: Chunk[];
  /** Updated byte offset — store this and pass it back on the next incremental call */
  newOffset: number;
  /** Whether this update came from a subagent session file */
  isSubagent: boolean;
  /** When true, client should discard cached state and do a full session re-parse */
  requiresFullRefresh: boolean;
  /** Metrics computed from the new messages only (additive — client merges with existing) */
  metrics: SessionMetrics;
  /** Whether the session appears ongoing (last message is from user) */
  isOngoing: boolean;
}

export interface SessionPipelineOptions {
  cacheSizeMB?: number;
}

export class SessionPipeline {
  private cache: DataCache<ParsedSession>;

  constructor(options?: SessionPipelineOptions) {
    const parsed = parseInt(process.env.CACHE_SIZE_MB ?? '50', 10);
    const sizeMB = options?.cacheSizeMB ?? (Number.isNaN(parsed) ? 50 : parsed);
    this.cache = new DataCache<ParsedSession>(sizeMB);
  }

  async parseSession(projectDir: string, sessionId: string): Promise<ParsedSession> {
    const cacheKey = `${projectDir}/${sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const { messages } = await parseSessionFile(filePath);
    const toolExecutions = buildToolExecutions(messages);
    const chunks = buildChunks(messages);

    // Enhance AI chunks with semantic steps
    enhanceAIChunks(chunks, toolExecutions);

    const subagents = await resolveSubagents(messages, { projectDir, sessionId });

    // Link subagents to their corresponding AI chunks so downstream consumers
    // (group transformer, display item builder) can access them per-chunk.
    linkSubagentsToChunks(chunks, subagents);

    const { totalCost } = calculateSessionCost(messages);
    const metrics = computeMetrics(messages, toolExecutions, totalCost);

    // Discover CLAUDE.md files on disk. Claude Code injects these at API time
    // but does NOT store them in the session JSONL, so we read the actual files.
    // Extract the project root from the first message's cwd field, falling back
    // to decoding the project directory name (e.g., '-storage-programs-my-project'
    // → '/storage/programs/my-project') for sessions without parseable messages.
    const projectRoot = messages.find(m => m.cwd)?.cwd ?? decodeProjectRoot(projectDir);
    const claudeMdFiles = await discoverClaudeMdFiles(projectRoot);

    // Read @-mentioned files from disk to get accurate token estimates.
    // Without this, the client can only estimate tokens from the file path
    // string (~87 tokens) instead of the actual content (~4.9k tokens).
    const mentionedFileTokens = projectRoot
      ? await readMentionedFiles(messages, projectRoot)
      : [];

    const session: ParsedSession = {
      chunks,
      metrics,
      subagents,
      isOngoing: detectOngoing(messages),
      claudeMdFiles: claudeMdFiles.length > 0 ? claudeMdFiles : undefined,
      mentionedFileTokens: mentionedFileTokens.length > 0 ? mentionedFileTokens : undefined,
    };

    // Estimate size for cache (rough: JSON.stringify length * 2 for UTF-16)
    // TODO: For large sessions, this synchronous JSON.stringify can be expensive.
    // Consider a cheaper heuristic (e.g., message count * average size) if this
    // becomes a bottleneck.
    const sizeEstimate = JSON.stringify(session).length * 2;
    this.cache.set(cacheKey, session, sizeEstimate);
    return session;
  }

  async getMetrics(projectDir: string, sessionId: string): Promise<SessionMetrics> {
    const session = await this.parseSession(projectDir, sessionId);
    return session.metrics;
  }

  invalidateSession(projectDir: string, sessionId: string): void {
    this.cache.invalidate(`${projectDir}/${sessionId}`);
  }

  /**
   * Parse only new bytes appended to a session file since `lastOffset`.
   *
   * Returns an IncrementalUpdate with the new messages, chunks, and metrics.
   * If the file has been truncated (size < lastOffset), sets requiresFullRefresh
   * so the caller knows to discard cached state and re-parse from scratch.
   */
  async parseIncremental(
    projectDir: string,
    sessionId: string,
    lastOffset: number,
  ): Promise<IncrementalUpdate> {
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const isSubagent = sessionId.startsWith('agent-');

    // Stat the file to check size
    // Note: File may grow between this stat() and the parseSessionFile() call below.
    // This is safe because newOffset is derived from bytesRead (actual bytes consumed),
    // not from fileSize (which is only used for truncation/no-change detection).
    let fileSize: number;
    try {
      const fileStat = await stat(filePath);
      fileSize = fileStat.size;
    } catch {
      // File not found — return empty update
      return emptyIncrementalUpdate(lastOffset, isSubagent);
    }

    // File truncated (e.g., session reset) — caller must do a full refresh
    if (fileSize < lastOffset) {
      return {
        ...emptyIncrementalUpdate(fileSize, isSubagent),
        requiresFullRefresh: true,
      };
    }

    // No new data
    if (fileSize === lastOffset) {
      return emptyIncrementalUpdate(lastOffset, isSubagent);
    }

    // Parse only the new bytes
    const { messages: newMessages, bytesRead } = await parseSessionFile(filePath, {
      startOffset: lastOffset,
    });

    const newOffset = lastOffset + bytesRead;

    if (newMessages.length === 0) {
      return emptyIncrementalUpdate(newOffset, isSubagent);
    }

    const toolExecutions = buildToolExecutions(newMessages);
    const newChunks = buildChunks(newMessages);

    // Enhance AI chunks with semantic steps
    enhanceAIChunks(newChunks, toolExecutions);

    // Resolve subagents for new messages and link to chunks
    const subagents = await resolveSubagents(newMessages, { projectDir, sessionId });
    if (subagents.length > 0) {
      linkSubagentsToChunks(newChunks, subagents);
    }

    const { totalCost } = calculateSessionCost(newMessages);
    const metrics = computeMetrics(newMessages, toolExecutions, totalCost);
    const isOngoing = detectOngoing(newMessages);

    return {
      newMessages,
      newChunks,
      newOffset,
      isSubagent,
      requiresFullRefresh: false,
      metrics,
      isOngoing,
    };
  }
}

/**
 * Walk chunks and attach semantic steps to AI chunks in-place.
 */
function enhanceAIChunks(chunks: Chunk[], toolExecutions: ToolExecution[]): void {
  for (const chunk of chunks) {
    if (chunk.type === 'ai') {
      // Attach semanticSteps to the chunk object for downstream consumers.
      // This mutates the chunk, which is intentional — the chunks array is
      // freshly built and owned by this pipeline invocation.
      (chunk as EnhancedAIChunk).semanticSteps =
        extractSemanticSteps(chunk, toolExecutions);
    }
  }
}

/**
 * Link resolved subagent Process objects to their corresponding AI chunks.
 *
 * Uses a two-tier linking strategy (matching devtools ProcessLinker):
 * 1. Primary: parentTaskId matching — links subagents to chunks containing the
 *    Task tool call that spawned them.
 * 2. Fallback: Timing-based — for orphaned subagents without parentTaskId, falls
 *    back to checking if the subagent's startTime falls within the chunk's time range.
 */
function linkSubagentsToChunks(chunks: Chunk[], subagents: Process[]): void {
  if (subagents.length === 0) return;

  const linkedSubagentIds = new Set<string>();

  for (const chunk of chunks) {
    if (chunk.type !== 'ai') continue;

    const enhanced = chunk as EnhancedAIChunk;
    if (!enhanced.subagents) {
      enhanced.subagents = [];
    }

    // Build set of Task tool call IDs in this chunk's messages
    const chunkTaskIds = new Set<string>();
    for (const msg of chunk.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.isTask) {
          chunkTaskIds.add(tc.id);
        }
      }
    }

    // Primary linking: match by parentTaskId
    for (const subagent of subagents) {
      if (subagent.parentTaskId && chunkTaskIds.has(subagent.parentTaskId)) {
        enhanced.subagents.push(subagent);
        linkedSubagentIds.add(subagent.id);
      }
    }
  }

  // Fallback: timing-based linking for orphaned subagents (no parentTaskId)
  for (const subagent of subagents) {
    if (linkedSubagentIds.has(subagent.id)) continue;
    if (subagent.parentTaskId) continue; // Has parentTaskId but didn't match — belongs elsewhere

    for (const chunk of chunks) {
      if (chunk.type !== 'ai') continue;

      const startTime = chunk.messages[0]?.timestamp;
      const endTime = chunk.messages[chunk.messages.length - 1]?.timestamp;
      if (!startTime || !endTime) continue;

      if (subagent.startTime >= startTime && subagent.startTime <= endTime) {
        const enhanced = chunk as EnhancedAIChunk;
        if (!enhanced.subagents) enhanced.subagents = [];
        enhanced.subagents.push(subagent);
        linkedSubagentIds.add(subagent.id);
        break; // Only link to one chunk
      }
    }
  }

  // Sort subagents by start time within each chunk
  for (const chunk of chunks) {
    if (chunk.type !== 'ai') continue;
    const enhanced = chunk as EnhancedAIChunk;
    if (enhanced.subagents && enhanced.subagents.length > 1) {
      enhanced.subagents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    }
  }
}

/**
 * Compute aggregate session metrics from parsed messages.
 */
function computeMetrics(
  messages: ParsedMessage[],
  toolExecutions: ToolExecution[],
  totalCost: number,
): SessionMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let turnCount = 0;

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.usage) {
      inputTokens += msg.usage.input_tokens ?? 0;
      outputTokens += msg.usage.output_tokens ?? 0;
      cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
      cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
      turnCount++;
    }
  }

  const startTime = messages[0]?.timestamp?.getTime() ?? 0;
  const endTime = messages[messages.length - 1]?.timestamp?.getTime() ?? 0;

  return {
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalCost,
    turnCount,
    toolCallCount: toolExecutions.length,
    duration: startTime && endTime ? endTime - startTime : 0,
  };
}

/**
 * Detect whether a session is still ongoing.
 *
 * A session is ongoing if the last message is from the user (waiting for
 * assistant response). An empty session is not considered ongoing.
 */
function detectOngoing(messages: ParsedMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return last.type === 'user';
}

/**
 * Return a no-op IncrementalUpdate (no new messages, zero metrics).
 */
function emptyIncrementalUpdate(offset: number, isSubagent: boolean): IncrementalUpdate {
  return {
    newMessages: [],
    newChunks: [],
    newOffset: offset,
    isSubagent,
    requiresFullRefresh: false,
    metrics: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCost: 0,
      turnCount: 0,
      toolCallCount: 0,
      duration: 0,
    },
    isOngoing: false,
  };
}
