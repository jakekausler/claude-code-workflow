import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBoardStore } from '../store/board-store.js';
import type { SessionMapEntry } from '../store/board-store.js';
import { useSSE } from './use-sse.js';
import { apiFetch } from './client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of each session returned by GET /api/orchestrator/sessions. */
interface SessionStatusResponse {
  stageId: string;
  sessionId: string;
  status: 'starting' | 'active' | 'ended';
  waitingType: SessionMapEntry['waitingType'];
  spawnedAt: number;
  lastActivity: number;
}

/** Shape of the REST response envelope. */
interface SessionsEnvelope {
  sessions: SessionStatusResponse[];
  connected: boolean;
}

/** Shape of a session-status SSE event (may omit optional fields). */
export interface SessionStatusEvent {
  stageId: string;
  sessionId?: string;
  status: 'starting' | 'active' | 'ended';
  waitingType?: SessionMapEntry['waitingType'];
  spawnedAt?: number;
}

// ---------------------------------------------------------------------------
// Parsing helper (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Convert a raw SSE event payload into a SessionMapEntry, filling defaults
 * for optional fields.
 */
export function parseSessionStatusEvent(raw: unknown): {
  stageId: string;
  entry: SessionMapEntry;
} | null {
  if (raw == null || typeof raw !== 'object') return null;

  const event = raw as Record<string, unknown>;
  if (typeof event.stageId !== 'string' || typeof event.status !== 'string') {
    return null;
  }

  const status = event.status as SessionStatusEvent['status'];
  const waitingType = (event.waitingType as SessionMapEntry['waitingType']) ?? null;
  const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
  const spawnedAt = typeof event.spawnedAt === 'number' ? event.spawnedAt : Date.now();

  return {
    stageId: event.stageId as string,
    entry: { status, waitingType, sessionId, spawnedAt },
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch the full session map on mount (REST hydration) and subscribe to
 * `session-status` SSE events for real-time updates to the board store.
 *
 * Call this once near the app root (e.g. in App.tsx).
 */
export function useSessionMap(): void {
  const setSessionMap = useBoardStore((s) => s.setSessionMap);
  const updateSessionStatus = useBoardStore((s) => s.updateSessionStatus);
  const setOrchestratorConnected = useBoardStore((s) => s.setOrchestratorConnected);

  // ---- REST hydration on mount ----
  const { data, isError } = useQuery({
    queryKey: ['orchestrator-sessions'],
    queryFn: () => apiFetch<SessionsEnvelope>('/orchestrator/sessions'),
    refetchInterval: 30_000, // re-fetch every 30 s as fallback
  });

  useEffect(() => {
    if (isError) {
      // Any fetch error (network failure, 503, etc.) means we can't confirm orchestrator state
      setOrchestratorConnected(false);
      return;
    }
    if (data) {
      const connected = data.connected;
      setOrchestratorConnected(connected);

      const map = new Map<string, SessionMapEntry>();
      for (const s of data.sessions) {
        if (s.status !== 'ended') {
          map.set(s.stageId, {
            status: s.status,
            waitingType: s.waitingType ?? null,
            sessionId: s.sessionId,
            spawnedAt: s.spawnedAt,
          });
        }
      }
      setSessionMap(map);
    }
  }, [data, isError, setSessionMap, setOrchestratorConnected]);

  // ---- SSE subscription for real-time updates ----
  const clearSessionMap = useBoardStore((s) => s.clearSessionMap);

  useSSE(['session-status'], (_channel: string, rawData: unknown) => {
    // Handle orchestrator disconnection event
    if (
      rawData != null &&
      typeof rawData === 'object' &&
      (rawData as Record<string, unknown>).type === 'orchestrator_disconnected'
    ) {
      clearSessionMap();
      setOrchestratorConnected(false);
      return;
    }

    const parsed = parseSessionStatusEvent(rawData);
    if (parsed) {
      updateSessionStatus(parsed.stageId, parsed.entry);
    }
  });
}
