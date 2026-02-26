import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  it('exports SSEEventHandler type', async () => {
    // Type-only export — just verify module loads
    const mod = await import('../../src/client/api/use-sse.js');
    expect(mod).toBeDefined();
  });
});
