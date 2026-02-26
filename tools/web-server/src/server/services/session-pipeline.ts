import { join } from 'path';
import type {
  ParsedSession,
  SessionMetrics,
  ParsedMessage,
  ToolExecution,
  Chunk,
  EnhancedAIChunk,
} from '../types/jsonl.js';
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
