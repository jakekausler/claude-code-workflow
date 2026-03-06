/**
 * New Relic custom instrumentation helpers.
 *
 * All functions are safe to call regardless of whether the New Relic agent is
 * active — when the agent is disabled (no license key) the `newrelic` module
 * exports no-op stubs, so every call here is a no-op at runtime.
 */
import newrelic from 'newrelic';

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
  newrelic.recordCustomEvent('SessionLifecycle', {
    event,
    sessionId,
    ...extra,
  });
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
  newrelic.recordCustomEvent('SSEConnection', { event, ...extra });
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
