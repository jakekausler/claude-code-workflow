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
  /** Only present when type === 'subagent-update' — the parsed Process for the changed subagent file */
  subagentProcess?: Process;
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

// ─── Process date rehydration ────────────────────────────────────────────────

/**
 * Rehydrate Date fields on a Process object after JSON round-trip.
 * Converts ISO-8601 strings back to Date instances for startTime, endTime,
 * and each message's timestamp.
 */
function rehydrateProcessDates(process: Process): Process {
  const startTime =
    typeof process.startTime === 'string'
      ? new Date(process.startTime)
      : process.startTime;
  const endTime =
    typeof process.endTime === 'string'
      ? new Date(process.endTime)
      : process.endTime;
  const messages = process.messages.map((msg) => {
    if (typeof msg.timestamp === 'string') {
      return { ...msg, timestamp: new Date(msg.timestamp) };
    }
    return msg;
  });
  return { ...process, startTime, endTime, messages };
}

// ─── Process deduplication ───────────────────────────────────────────────────

/**
 * Deduplicate Process arrays by id, keeping the last occurrence (most recent data).
 * This prevents key collisions when boundary-merging AI chunks that both contain
 * the same subagent (e.g., incremental updates re-resolving an existing agent).
 */
function deduplicateProcesses(processes: Process[]): Process[] {
  const seen = new Map<string, Process>();
  for (const p of processes) {
    seen.set(p.id, p); // later entries overwrite earlier — keeps freshest data
  }
  return Array.from(seen.values());
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
        subagents: deduplicateProcesses([
          ...(existingEnhanced.subagents ?? []),
          ...(newEnhanced.subagents ?? []),
        ]),
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

// ─── Subagent update merge ──────────────────────────────────────────────────

/**
 * Merge a subagent-update SSE event into an existing parsed session.
 *
 * Updates the Process in:
 *   1. The chunk-level `subagents` array (on the AI chunk that spawned the subagent)
 *   2. The session-level `subagents` array
 *
 * Returns the same reference if no subagentProcess is present.
 * Uses immutable update pattern — never mutates the input.
 */
export function mergeSubagentUpdate<T extends MergeableSession>(
  existing: T,
  update: SSESessionUpdate,
): T {
  const process = update.subagentProcess;
  if (!process) return existing;

  const rehydrated = rehydrateProcessDates(process);

  console.log('[SSE-DEBUG] mergeSubagentUpdate:', {
    processId: rehydrated.id,
    numMessages: rehydrated.messages?.length ?? 0,
    existingChunkSubagents: existing.chunks
      .filter(c => c.type === 'ai' && 'subagents' in c)
      .map(c => (c as any).subagents?.map((s: any) => ({ id: s.id, numMsgs: s.messages?.length })))
      .flat(),
  });

  // 1. Update chunk-level subagents — find the AI chunk containing this subagent
  let chunksChanged = false;
  const updatedChunks = existing.chunks.map((chunk) => {
    if (chunk.type !== 'ai') return chunk;

    const enhanced = chunk as Partial<EnhancedAIChunk>;
    if (!enhanced.subagents?.length) return chunk;

    const idx = enhanced.subagents.findIndex((s) => s.id === rehydrated.id);
    if (idx < 0) return chunk;

    // Found the chunk — replace the subagent at this index
    chunksChanged = true;
    const newSubagents = [...enhanced.subagents];
    newSubagents[idx] = rehydrated;
    return { ...chunk, subagents: newSubagents };
  });

  // 2. Update session-level subagents array (update existing or append)
  const existingIdx = existing.subagents.findIndex((s) => s.id === rehydrated.id);
  let updatedSubagents: Process[];
  if (existingIdx >= 0) {
    updatedSubagents = [...existing.subagents];
    updatedSubagents[existingIdx] = rehydrated;
  } else {
    updatedSubagents = [...existing.subagents, rehydrated];
  }

  return {
    ...existing,
    chunks: chunksChanged ? updatedChunks : existing.chunks,
    subagents: updatedSubagents,
  };
}
