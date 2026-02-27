/**
 * Session refresh scheduler matching devtools' pattern:
 * - 150ms throttle (at most 1 pending per session, drops duplicates)
 * - Generation tracking to drop stale responses
 * - In-flight coalescing with queuing
 */

const SESSION_REFRESH_DEBOUNCE_MS = 150;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshGeneration = new Map<string, number>();
const refreshInFlight = new Set<string>();
const refreshQueued = new Set<string>();

export function scheduleSessionRefresh(
  key: string,
  refreshFn: () => Promise<void>,
): void {
  // Throttle: at most 1 pending refresh per session (drop duplicates)
  if (pendingTimers.has(key)) {
    return;
  }

  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void executeRefresh(key, refreshFn);
  }, SESSION_REFRESH_DEBOUNCE_MS);

  pendingTimers.set(key, timer);
}

async function executeRefresh(
  key: string,
  refreshFn: () => Promise<void>,
): Promise<void> {
  // In-flight coalescing: if already refreshing, queue instead
  if (refreshInFlight.has(key)) {
    refreshQueued.add(key);
    return;
  }

  const generation = (refreshGeneration.get(key) ?? 0) + 1;
  refreshGeneration.set(key, generation);
  refreshInFlight.add(key);

  try {
    await refreshFn();

    // Drop stale: if generation changed while we were fetching, discard
    if (refreshGeneration.get(key) !== generation) {
      return;
    }
  } finally {
    refreshInFlight.delete(key);

    // If queued during in-flight, re-run
    if (refreshQueued.has(key)) {
      refreshQueued.delete(key);
      void executeRefresh(key, refreshFn);
    }
  }
}

/** Clean up timers when component unmounts */
export function cancelSessionRefresh(key: string): void {
  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
}
