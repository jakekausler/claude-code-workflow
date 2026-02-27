import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectSSE } from '../../src/client/api/use-sse.js';
import {
  scheduleSessionRefresh,
  cancelSessionRefresh,
} from '../../src/client/utils/session-refresh.js';
import type { SSESessionUpdate } from '../../src/client/utils/session-merger.js';

// ── Mock EventSource ────────────────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  url: string;
  readyState = 1; // OPEN

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: { data: string }) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  close = vi.fn();

  /** Test helper: simulate a server-sent event */
  _emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

// ── Reproduce the handler logic from SessionDetail ──────────────────
// This mirrors the handleSSE callback in SessionDetail.tsx (lines 30-43)
// so we can test it in isolation without React rendering.

function createSessionSSEHandler(
  projectId: string,
  sessionId: string,
  refreshFn: () => Promise<void>,
) {
  const refreshKey = `${projectId}/${sessionId}`;

  const handler = (_channel: string, data: unknown) => {
    const event = data as SSESessionUpdate;
    if (event.sessionId !== sessionId || event.projectId !== projectId) return;
    scheduleSessionRefresh(refreshKey, refreshFn);
  };

  const cleanup = () => cancelSessionRefresh(refreshKey);

  return { handler, cleanup, refreshKey };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SessionDetail SSE integration', () => {
  const PROJECT_ID = 'proj-123';
  const SESSION_ID = 'sess-456';

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    cancelSessionRefresh(`${PROJECT_ID}/${SESSION_ID}`);
    delete (globalThis as Record<string, unknown>).EventSource;
  });

  // ── Filtering ──────────────────────────────────────────────────

  it('invokes refresh when SSE event matches projectId and sessionId', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'session-change',
    };
    source._emit('session-update', event);

    // Let throttle timer fire
    await vi.advanceTimersByTimeAsync(200);

    expect(refreshFn).toHaveBeenCalledTimes(1);

    cleanup();
    disconnect();
  });

  it('ignores SSE events for a different sessionId', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: PROJECT_ID,
      sessionId: 'other-session',
      type: 'session-change',
    };
    source._emit('session-update', event);

    await vi.advanceTimersByTimeAsync(200);

    expect(refreshFn).not.toHaveBeenCalled();

    cleanup();
    disconnect();
  });

  it('ignores SSE events for a different projectId', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: 'other-project',
      sessionId: SESSION_ID,
      type: 'session-change',
    };
    source._emit('session-update', event);

    await vi.advanceTimersByTimeAsync(200);

    expect(refreshFn).not.toHaveBeenCalled();

    cleanup();
    disconnect();
  });

  // ── Throttling via SSE ─────────────────────────────────────────

  it('throttles multiple rapid SSE events into a single refresh', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'session-change',
    };

    // Simulate 5 rapid events
    source._emit('session-update', event);
    source._emit('session-update', event);
    source._emit('session-update', event);
    source._emit('session-update', event);
    source._emit('session-update', event);

    await vi.advanceTimersByTimeAsync(200);

    // scheduleSessionRefresh throttles to at most 1 per window
    expect(refreshFn).toHaveBeenCalledTimes(1);

    cleanup();
    disconnect();
  });

  // ── Cleanup ────────────────────────────────────────────────────

  it('cancelSessionRefresh prevents pending refresh from firing', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'session-change',
    };
    source._emit('session-update', event);

    // Cancel before throttle window fires
    cleanup();

    await vi.advanceTimersByTimeAsync(200);

    expect(refreshFn).not.toHaveBeenCalled();

    disconnect();
  });

  it('connectSSE cleanup closes EventSource and removes listeners', () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    expect(source.listeners['session-update']).toHaveLength(1);

    disconnect();

    expect(source.close).toHaveBeenCalled();
    expect(source.listeners['session-update']).toHaveLength(0);

    cleanup();
  });

  // ── End-to-end: SSE → refresh → new events after window ───────

  it('allows new refresh after previous throttle window completes', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    const event: SSESessionUpdate = {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'session-change',
    };

    // First event batch
    source._emit('session-update', event);
    await vi.advanceTimersByTimeAsync(200);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // Second event after first completes
    source._emit('session-update', event);
    await vi.advanceTimersByTimeAsync(200);
    expect(refreshFn).toHaveBeenCalledTimes(2);

    cleanup();
    disconnect();
  });

  it('handles both session-change and subagent-change event types', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const { handler, cleanup } = createSessionSSEHandler(PROJECT_ID, SESSION_ID, refreshFn);

    const disconnect = connectSSE(['session-update'], handler);
    const source = MockEventSource.instances[0];

    // session-change type
    source._emit('session-update', {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'session-change',
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // subagent-change type
    source._emit('session-update', {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      type: 'subagent-change',
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(refreshFn).toHaveBeenCalledTimes(2);

    cleanup();
    disconnect();
  });
});
