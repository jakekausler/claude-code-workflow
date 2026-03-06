/**
 * Formatting helpers for the Dashboard activity feed.
 *
 * These pure functions convert raw SSE event payloads from the
 * `stage-transition` and `session-status` channels into human-readable
 * activity feed entries.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Union of SSE payloads we handle in the activity feed. */
export interface StageTransitionEvent {
  stageId: string;
  sessionId?: string;
  type: 'session_started' | 'session_ended';
  timestamp?: number;
}

export interface SessionStatusSSEEvent {
  stageId: string;
  sessionId?: string;
  status: 'starting' | 'active' | 'ended';
  waitingType?: 'user_input' | 'permission' | 'idle' | null;
  spawnedAt?: number;
}

/** A single rendered activity feed item. */
export interface ActivityFeedItem {
  id: string;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Convert a `stage-transition` SSE payload into a human-readable message.
 * Returns `null` if the payload is unrecognised.
 */
export function formatStageTransitionEvent(raw: unknown): ActivityFeedItem | null {
  if (raw == null || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  if (typeof event.stageId !== 'string' || typeof event.type !== 'string') return null;

  const stageId = event.stageId as string;
  const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();

  let message: string;
  switch (event.type) {
    case 'session_started':
      message = `Session started for ${stageId}`;
      break;
    case 'session_ended':
      message = `Session completed for ${stageId}`;
      break;
    default:
      return null;
  }

  return {
    id: `st-${stageId}-${event.type}-${ts}`,
    message,
    timestamp: ts,
  };
}

/**
 * Convert a `session-status` SSE payload into a human-readable message
 * when it carries a `waitingType`.
 * Returns `null` for payloads without an interesting waitingType.
 */
export function formatSessionStatusEvent(raw: unknown): ActivityFeedItem | null {
  if (raw == null || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  if (typeof event.stageId !== 'string') return null;

  const stageId = event.stageId as string;
  const waitingType = event.waitingType as string | null | undefined;
  const ts = typeof event.spawnedAt === 'number' ? event.spawnedAt : Date.now();

  let message: string;
  switch (waitingType) {
    case 'user_input':
      message = `Waiting for user input on ${stageId}`;
      break;
    case 'permission':
      message = `Waiting for approval on ${stageId}`;
      break;
    default:
      // No interesting waiting state — skip
      return null;
  }

  return {
    id: `ss-${stageId}-${waitingType}-${ts}`,
    message,
    timestamp: ts,
  };
}

/**
 * Unified formatter: tries both event types and returns a feed item or null.
 */
export function formatSessionEvent(
  channel: string,
  raw: unknown,
): ActivityFeedItem | null {
  if (channel === 'stage-transition') {
    return formatStageTransitionEvent(raw);
  }
  if (channel === 'session-status') {
    return formatSessionStatusEvent(raw);
  }
  return null;
}
