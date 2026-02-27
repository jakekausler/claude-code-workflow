import type { Chunk, SessionMetrics, Process } from '../types/session.js';

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
    // Merge the first new AI chunk into the last existing AI chunk
    // Only merge messages — semanticSteps from the incoming chunk are intentionally
    // omitted because transformChunksToConversation() re-derives display items
    // from the full chunk array on every render cycle.
    const mergedBoundaryChunk = {
      ...lastExisting,
      messages: [...lastExisting.messages, ...firstNew.messages],
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

  const mergedChunks = mergeBoundaryChunks(existing.chunks, update.newChunks);

  return {
    ...existing,
    chunks: mergedChunks,
    metrics: mergeMetrics(existing.metrics, update.metrics),
    isOngoing: update.isOngoing ?? existing.isOngoing,
  };
}
