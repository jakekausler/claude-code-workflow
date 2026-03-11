import { useEffect, useRef } from 'react';

export type SSEEventHandler = (channel: string, data: unknown) => void;

// ---------------------------------------------------------------------------
// Shared singleton EventSource – avoids hitting the browser's 6-connection-
// per-origin limit when multiple components each call useSSE().
// ---------------------------------------------------------------------------

let sharedSource: EventSource | null = null;
let refCount = 0;
const channelHandlers = new Map<string, (e: MessageEvent) => void>();
const channelListeners = new Map<string, Set<SSEEventHandler>>();

function ensureConnection(): EventSource {
  if (!sharedSource || sharedSource.readyState === EventSource.CLOSED) {
    sharedSource = new EventSource('/api/events');
    // EventSource auto-reconnects on error; nothing extra needed here.
  }
  return sharedSource;
}

function addChannelListener(
  channel: string,
  callback: SSEEventHandler,
): void {
  if (!channelListeners.has(channel)) {
    channelListeners.set(channel, new Set());

    const source = ensureConnection();
    const handler = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Malformed JSON – silently ignore the event
        return;
      }
      const cbs = channelListeners.get(channel);
      if (cbs) {
        for (const cb of cbs) cb(channel, data);
      }
    };
    source.addEventListener(channel, handler as EventListener);
    channelHandlers.set(channel, handler);
  }
  channelListeners.get(channel)!.add(callback);
}

function removeChannelListener(
  channel: string,
  callback: SSEEventHandler,
): void {
  const cbs = channelListeners.get(channel);
  if (!cbs) return;
  cbs.delete(callback);

  // If no listeners remain for this channel, remove the EventSource handler
  if (cbs.size === 0) {
    channelListeners.delete(channel);
    const handler = channelHandlers.get(channel);
    if (handler && sharedSource) {
      sharedSource.removeEventListener(channel, handler as EventListener);
    }
    channelHandlers.delete(channel);
  }
}

function releaseConnection(): void {
  refCount--;
  if (refCount <= 0 && sharedSource) {
    sharedSource.close();
    sharedSource = null;
    channelListeners.clear();
    channelHandlers.clear();
    refCount = 0;
  }
}

/**
 * Connect to SSE endpoint and subscribe to named channels.
 * Uses a shared singleton EventSource under the hood.
 * Returns a cleanup function that removes listeners and, if this was the last
 * consumer, closes the connection.
 */
export function connectSSE(
  channels: string[],
  onEvent: SSEEventHandler,
): () => void {
  refCount++;

  for (const channel of channels) {
    addChannelListener(channel, onEvent);
  }

  return () => {
    for (const channel of channels) {
      removeChannelListener(channel, onEvent);
    }
    releaseConnection();
  };
}

/**
 * React hook wrapping connectSSE with proper lifecycle management.
 * All hook instances share a single EventSource connection.
 */
export function useSSE(
  channels: string[],
  onEvent: SSEEventHandler,
  enabled = true,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Derive stable string key for dependency tracking (NUL separator avoids comma ambiguity)
  const channelsKey = channels.join('\0');

  useEffect(() => {
    if (!enabled || channelsKey === '') return;

    const activeChannels = channelsKey.split('\0');

    // Stable callback that always dispatches through the latest ref
    const stableCallback: SSEEventHandler = (channel, data) => {
      onEventRef.current(channel, data);
    };

    const cleanup = connectSSE(activeChannels, stableCallback);

    return cleanup;
  }, [channelsKey, enabled]);
}
