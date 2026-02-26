import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SSEEventHandler } from '../../src/client/api/use-sse.js';

// Mock EventSource since we're in Node (not browser)
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

  // Test helper: simulate a server event
  _emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

describe('connectSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('creates an EventSource connection to /api/events', async () => {
    const { connectSSE } = await import('../../src/client/api/use-sse.js');
    const handler = vi.fn();
    const cleanup = connectSSE(['test-channel'], handler);

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/events');

    cleanup();
  });

  it('subscribes to specified channels', async () => {
    const { connectSSE } = await import('../../src/client/api/use-sse.js');
    const handler = vi.fn();
    const cleanup = connectSSE(['channel-a', 'channel-b'], handler);

    const source = MockEventSource.instances[0];
    expect(source.listeners['channel-a']).toHaveLength(1);
    expect(source.listeners['channel-b']).toHaveLength(1);

    cleanup();
  });

  it('dispatches parsed JSON events to the handler', async () => {
    const { connectSSE } = await import('../../src/client/api/use-sse.js');
    const handler = vi.fn();
    const cleanup = connectSSE(['my-channel'], handler);

    const source = MockEventSource.instances[0];
    source._emit('my-channel', { foo: 'bar' });

    expect(handler).toHaveBeenCalledWith('my-channel', { foo: 'bar' });

    cleanup();
  });

  it('ignores malformed JSON without throwing', async () => {
    const { connectSSE } = await import('../../src/client/api/use-sse.js');
    const handler = vi.fn();
    const cleanup = connectSSE(['my-channel'], handler);

    const source = MockEventSource.instances[0];
    // Emit raw invalid JSON directly through the listener
    for (const listener of source.listeners['my-channel'] ?? []) {
      listener({ data: 'not-valid-json{{{' });
    }

    expect(handler).not.toHaveBeenCalled();

    cleanup();
  });

  it('cleanup removes listeners and closes the source', async () => {
    const { connectSSE } = await import('../../src/client/api/use-sse.js');
    const handler = vi.fn();
    const cleanup = connectSSE(['ch-1', 'ch-2'], handler);

    const source = MockEventSource.instances[0];
    cleanup();

    expect(source.close).toHaveBeenCalled();
    // After cleanup, listeners should be removed
    expect(source.listeners['ch-1']).toHaveLength(0);
    expect(source.listeners['ch-2']).toHaveLength(0);
  });
});

describe('useSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should be importable', async () => {
    const mod = await import('../../src/client/api/use-sse.js');
    expect(mod.useSSE).toBeDefined();
    expect(typeof mod.useSSE).toBe('function');
  });
});
