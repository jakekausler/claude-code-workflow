import { useEffect, useRef } from 'react';

export type SSEEventHandler = (channel: string, data: unknown) => void;

/**
 * Subscribe to Server-Sent Events on named channels.
 * EventSource has built-in auto-reconnect — no manual retry needed.
 */
export function useSSE(
  channels: string[],
  onEvent: SSEEventHandler,
  enabled = true,
): void {
  // Stable ref for the callback to avoid reconnecting on every render
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Stable ref for channels to allow array comparison
  const channelsKey = channels.join(',');

  useEffect(() => {
    if (!enabled || channels.length === 0) return;

    const source = new EventSource('/api/events');
    const handlers: Array<{ channel: string; handler: (e: MessageEvent) => void }> = [];

    for (const channel of channels) {
      const handler = (event: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(event.data);
          onEventRef.current(channel, data);
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
  }, [channelsKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
