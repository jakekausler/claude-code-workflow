import type { Chunk, SessionMetrics, Process, EnhancedAIChunk } from '../types/session.js';

// ─── SSE update payload shape ─────────────────────────────────────────────────

export interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
  type: 'incremental' | 'full-refresh' | 'subagent-update';
  /** Only present when type === 'incremental' */
  newChunks?: Chunk[];
  metrics?: SessionMetrics;
  isOngoing?: boolean;
  newOffset?: number;
}

// ─── Generic constraint for mergeable session data ────────────────────────────

export interface MergeableSession {
  chunks: Chunk[];
  metrics: SessionMetrics;
  isOngoing: boolean;
  subagents: Process[];
}

// ─── Metrics merge (additive) ─────────────────────────────────────────────────

function mergeMetrics(
  existing: SessionMetrics,
  incoming: SessionMetrics | undefined,
): SessionMetrics {
  if (!incoming) return existing;
  return {
    totalTokens: existing.totalTokens + incoming.totalTokens,
    inputTokens: existing.inputTokens + incoming.inputTokens,
    outputTokens: existing.outputTokens + incoming.outputTokens,
    cacheReadTokens: existing.cacheReadTokens + incoming.cacheReadTokens,
    cacheCreationTokens:
      existing.cacheCreationTokens + incoming.cacheCreationTokens,
    totalCost: existing.totalCost + incoming.totalCost,
    turnCount: existing.turnCount + incoming.turnCount,
    toolCallCount: existing.toolCallCount + incoming.toolCallCount,
    duration: existing.duration + incoming.duration,
  };
}

// ─── Date rehydration ────────────────────────────────────────────────────────

/**
 * After JSON.stringify → JSON.parse round-trip (SSE transport), Date objects
 * become ISO-8601 strings.  This function reconstructs the Date instances
 * that downstream code (grouping, sorting, display) relies on.
 */
function rehydrateChunkDates(chunks: Chunk[]): Chunk[] {
  return chunks.map((chunk) => {
    const timestamp =
      typeof chunk.timestamp === 'string'
        ? new Date(chunk.timestamp)
        : chunk.timestamp;

    if (chunk.type === 'ai' || chunk.type === 'system') {
      const messages = chunk.messages.map((msg) => {
        if (typeof msg.timestamp === 'string') {
          return { ...msg, timestamp: new Date(msg.timestamp) };
        }
        return msg;
      });
      return { ...chunk, timestamp, messages };
    }

    if (chunk.type === 'user') {
      const message =
        typeof chunk.message.timestamp === 'string'
          ? { ...chunk.message, timestamp: new Date(chunk.message.timestamp) }
          : chunk.message;
      return { ...chunk, timestamp, message };
    }

    // compact chunks — only top-level timestamp
    return { ...chunk, timestamp };
  });
}

// ─── Boundary chunk merging ───────────────────────────────────────────────────

/**
 * When the last existing chunk and the first incoming chunk are both AI chunks,
 * merge the first incoming chunk's messages into the last existing chunk
 * (extending the ongoing AI turn) and return the remaining new chunks separately.
 */
function mergeBoundaryChunks(
  existingChunks: Chunk[],
  newChunks: Chunk[],
): Chunk[] {
  if (existingChunks.length === 0) return newChunks;
  if (newChunks.length === 0) return existingChunks;

  const lastExisting = existingChunks[existingChunks.length - 1];
  const firstNew = newChunks[0];

  if (lastExisting.type === 'ai' && firstNew.type === 'ai') {
    // Merge the first new AI chunk into the last existing AI chunk.
    // Concatenate messages, semanticSteps, and subagents from both chunks
    // so that the merged chunk retains the full set of data from both halves.
    const existingEnhanced = lastExisting as Partial<EnhancedAIChunk>;
    const newEnhanced = firstNew as Partial<EnhancedAIChunk>;
    const mergedBoundaryChunk: Chunk = {
      ...lastExisting,
      messages: [...lastExisting.messages, ...firstNew.messages],
      ...((existingEnhanced.semanticSteps || newEnhanced.semanticSteps) && {
        semanticSteps: [
          ...(existingEnhanced.semanticSteps ?? []),
          ...(newEnhanced.semanticSteps ?? []),
        ],
      }),
      ...((existingEnhanced.subagents || newEnhanced.subagents) && {
        subagents: [
          ...(existingEnhanced.subagents ?? []),
          ...(newEnhanced.subagents ?? []),
        ],
      }),
    };

    return [
      ...existingChunks.slice(0, -1),
      mergedBoundaryChunk,
      ...newChunks.slice(1),
    ];
  }

  // No boundary merge needed — just concatenate
  return existingChunks.concat(newChunks);
}

// ─── Public merge function ────────────────────────────────────────────────────

/**
 * Merge an incremental SSE update into an existing parsed session.
 *
 * Returns the same reference if no merge is needed (non-incremental update
 * or no new chunks), so React Query's structural sharing can short-circuit.
 *
 * Uses immutable update pattern — never mutates the input.
 */
export function mergeIncrementalUpdate<T extends MergeableSession>(
  existing: T,
  update: SSESessionUpdate,
): T {
  if (update.type !== 'incremental' || !update.newChunks?.length) {
    return existing;
  }

  const rehydrated = rehydrateChunkDates(update.newChunks);
  const mergedChunks = mergeBoundaryChunks(existing.chunks, rehydrated);

  return {
    ...existing,
    chunks: mergedChunks,
    metrics: mergeMetrics(existing.metrics, update.metrics),
    isOngoing: update.isOngoing ?? existing.isOngoing,
  };
}
