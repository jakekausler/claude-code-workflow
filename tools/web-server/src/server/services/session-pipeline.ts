import { join } from 'path';
import type {
  ParsedSession,
  SessionMetrics,
  ParsedMessage,
  ToolExecution,
  Chunk,
  EnhancedAIChunk,
  Process,
} from '../types/jsonl.js';
import type { FileSystemProvider } from '../deployment/types.js';
import { DirectFileSystemProvider } from '../deployment/local/direct-fs-provider.js';
import { parseSessionFile } from './session-parser.js';
import { buildToolExecutions } from './tool-execution-builder.js';
import { buildChunks, extractSemanticSteps } from './chunk-builder.js';
import { resolveSubagents } from './subagent-resolver.js';
import { calculateSessionCost } from './pricing.js';
import { DataCache } from './data-cache.js';
import { discoverClaudeMdFiles, decodeProjectRoot } from './claude-md-reader.js';
import { readMentionedFiles } from './mentioned-file-reader.js';

export interface SessionPipelineOptions {
  cacheSizeMB?: number;
  fileSystem?: FileSystemProvider;
}

export class SessionPipeline {
  private cache: DataCache<ParsedSession>;
  /** Tracks the file mtimeMs at the time each session was last cached, keyed by cacheKey. */
  private cacheMtimes = new Map<string, number>();
  private fileSystem: FileSystemProvider;

  constructor(options?: SessionPipelineOptions) {
    const parsed = parseInt(process.env.CACHE_SIZE_MB ?? '50', 10);
    const sizeMB = options?.cacheSizeMB ?? (Number.isNaN(parsed) ? 50 : parsed);
    this.cache = new DataCache<ParsedSession>(sizeMB);
    this.fileSystem = options?.fileSystem ?? new DirectFileSystemProvider();
  }

  async parseSession(projectDir: string, sessionId: string): Promise<ParsedSession> {
    const cacheKey = `${projectDir}/${sessionId}`;
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Auto-invalidate if the underlying JSONL file has changed since the last parse.
      // This ensures re-parses after new lines arrive return fresh data without requiring
      // an explicit invalidateSession() call from the caller.
      try {
        const { mtimeMs } = await this.fileSystem.stat(filePath);
        const cachedMtime = this.cacheMtimes.get(cacheKey);
        if (cachedMtime !== undefined && mtimeMs > cachedMtime) {
          this.cache.invalidate(cacheKey);
          this.cacheMtimes.delete(cacheKey);
        } else {
          return cached;
        }
      } catch {
        // File may not exist (e.g. for non-existent sessions); return the cached empty result.
        return cached;
      }
    }

    const { messages } = await parseSessionFile(filePath, { fileSystem: this.fileSystem });
    const toolExecutions = buildToolExecutions(messages);
    const chunks = buildChunks(messages);

    // Enhance AI chunks with semantic steps
    enhanceAIChunks(chunks, toolExecutions);

    const subagents = await resolveSubagents(messages, {
      projectDir,
      sessionId,
      fileSystem: this.fileSystem,
    });

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
    const projectRoot = messages.find(m => m.cwd)?.cwd ?? await decodeProjectRoot(projectDir, this.fileSystem);
    const claudeMdFiles = await discoverClaudeMdFiles(projectRoot, this.fileSystem);

    // Read @-mentioned files from disk to get accurate token estimates.
    // Without this, the client can only estimate tokens from the file path
    // string (~87 tokens) instead of the actual content (~4.9k tokens).
    const mentionedFileTokens = projectRoot
      ? await readMentionedFiles(messages, projectRoot, this.fileSystem)
      : [];

    const session: ParsedSession = {
      chunks,
      metrics,
      subagents,
      isOngoing: detectOngoing(messages),
      claudeMdFiles: claudeMdFiles.length > 0 ? claudeMdFiles : undefined,
      mentionedFileTokens: mentionedFileTokens.length > 0 ? mentionedFileTokens : undefined,
    };

    // Fast heuristic for cache size estimation — avoids the cost of a full
    // synchronous JSON.stringify on large sessions. Each chunk is ~50 KB on
    // average (messages + tool calls), each subagent record ~200 KB (its own
    // messages array), plus a fixed 100 KB base for metrics and other fields.
    // This is intentionally approximate; the cache evicts by byte budget so
    // a modest over- or under-estimate has no correctness impact.
    const sizeEstimate = (session.chunks.length * 50_000) + (session.subagents.length * 200_000) + 100_000;
    this.cache.set(cacheKey, session, sizeEstimate);

    // Record the file's mtime at parse time so future parseSession() calls can
    // detect whether the file has grown and self-invalidate accordingly.
    try {
      const { mtimeMs } = await this.fileSystem.stat(filePath);
      this.cacheMtimes.set(cacheKey, mtimeMs);
    } catch {
      // File may not exist (non-existent session); skip mtime tracking.
    }

    return session;
  }

  async getMetrics(projectDir: string, sessionId: string): Promise<SessionMetrics> {
    const session = await this.parseSession(projectDir, sessionId);
    return session.metrics;
  }

  invalidateSession(projectDir: string, sessionId: string): void {
    const cacheKey = `${projectDir}/${sessionId}`;
    this.cache.invalidate(cacheKey);
    this.cacheMtimes.delete(cacheKey);
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
  const orphanedSubagents: Process[] = [];

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
      if (linkedSubagentIds.has(subagent.id)) {
        orphanedSubagents.push(subagent);
        continue;
      }
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
      if (!startTime || !endTime) {
        console.warn(
          '[session-pipeline] chunk missing timestamp — skipping timing-based subagent link for chunk',
          { chunkType: chunk.type, messageCount: chunk.messages.length },
        );
        continue;
      }

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
