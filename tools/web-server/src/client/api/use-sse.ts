import { useEffect, useRef } from 'react';

export type SSEEventHandler = (channel: string, data: unknown) => void;

/**
 * Connect to SSE endpoint and subscribe to named channels.
 * Returns a cleanup function that removes listeners and closes the connection.
 */
export function connectSSE(
  channels: string[],
  onEvent: SSEEventHandler,
): () => void {
  const source = new EventSource('/api/events');
  const handlers: Array<{ channel: string; handler: (e: MessageEvent) => void }> = [];

  for (const channel of channels) {
    const handler = (event: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(event.data);
        onEvent(channel, data);
      } catch {
        // Ignore malformed JSON
      }
    };
    source.addEventListener(channel, handler as EventListener);
    handlers.push({ channel, handler });
  }

  return () => {
    for (const { channel, handler } of handlers) {
      source.removeEventListener(channel, handler as EventListener);
    }
    source.close();
  };
}

/**
 * React hook wrapping connectSSE with proper lifecycle management.
 * EventSource has built-in auto-reconnect — no manual retry needed.
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
    const cleanup = connectSSE(activeChannels, (channel, data) => {
      onEventRef.current(channel, data);
    });

    return cleanup;
  }, [channelsKey, enabled]);
}
