/**
 * New Relic custom instrumentation helpers.
 *
 * All functions are safe to call regardless of whether the New Relic agent is
 * active — each call guards against missing API methods so the instrumentation
 * is a no-op when the agent is disabled.
 */
import * as newrelic from 'newrelic';

// ---------------------------------------------------------------------------
// Session lifecycle events
// ---------------------------------------------------------------------------

export type SessionLifecycleEvent =
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'crash';

/**
 * Record a custom New Relic event for a session lifecycle transition.
 *
 * Example NRQL: SELECT count(*) FROM SessionLifecycle FACET event TIMESERIES
 */
export function recordSessionLifecycle(
  event: SessionLifecycleEvent,
  sessionId: string,
  extra?: Record<string, string | number | boolean>,
): void {
  if (typeof newrelic.recordCustomEvent === 'function') {
    newrelic.recordCustomEvent('SessionLifecycle', {
      event,
      sessionId,
      ...extra,
    });
  }
}

// ---------------------------------------------------------------------------
// SSE connection events
// ---------------------------------------------------------------------------

export type SSEConnectionEvent = 'connect' | 'drop' | 'reconnect';

/**
 * Record a custom New Relic event for an SSE connection state change.
 *
 * Example NRQL: SELECT count(*) FROM SSEConnection FACET event TIMESERIES
 */
export function recordSSEConnection(
  event: SSEConnectionEvent,
  extra?: Record<string, string | number | boolean>,
): void {
  if (typeof newrelic.recordCustomEvent === 'function') {
    newrelic.recordCustomEvent('SSEConnection', { event, ...extra });
  }
}

// ---------------------------------------------------------------------------
// External API segments
// ---------------------------------------------------------------------------

/**
 * Wrap an async external-API call in a New Relic segment so latency is
 * captured in traces.
 *
 * @param name   Segment name, e.g. "JiraAPI:createIssue"
 * @param fn     Async function to execute inside the segment
 */
export async function withApiSegment<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof newrelic.startSegment !== 'function') {
    return fn();
  }
  return new Promise<T>((resolve, reject) => {
    newrelic.startSegment(name, true, async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    });
  });
}
