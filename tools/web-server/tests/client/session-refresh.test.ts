import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scheduleSessionRefresh,
  cancelSessionRefresh,
} from '../../src/client/utils/session-refresh.js';

/**
 * Helper: create a deferred promise so tests can control when refreshFn resolves.
 */
function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('session-refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cancelSessionRefresh('test-key');
  });

  // ── Throttle ────────────────────────────────────────────────

  it('throttles: drops duplicate calls while timer is pending', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);

    scheduleSessionRefresh('test-key', refreshFn);
    scheduleSessionRefresh('test-key', refreshFn); // dropped
    scheduleSessionRefresh('test-key', refreshFn); // dropped

    await vi.advanceTimersByTimeAsync(150);

    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('allows a new call after the throttle window fires', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);

    scheduleSessionRefresh('test-key', refreshFn);
    await vi.advanceTimersByTimeAsync(150);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // Second call after first completed
    scheduleSessionRefresh('test-key', refreshFn);
    await vi.advanceTimersByTimeAsync(150);
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  // ── In-flight coalescing ────────────────────────────────────

  it('queues exactly one follow-up when called during in-flight refresh', async () => {
    const deferred = createDeferred();
    let callCount = 0;
    const refreshFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return deferred.promise;
      }
      return Promise.resolve();
    });

    // First call: schedule and fire the timer to start the in-flight refresh
    scheduleSessionRefresh('test-key', refreshFn);
    await vi.advanceTimersByTimeAsync(150);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // These calls arrive while refresh is in-flight.
    // The first queues a follow-up; the second is a separate schedule call
    // but both should result in at most one queued re-execution.
    scheduleSessionRefresh('test-key', refreshFn);
    scheduleSessionRefresh('test-key', refreshFn);

    // Resolve the in-flight refresh, which should trigger the queued follow-up
    deferred.resolve();
    await vi.advanceTimersByTimeAsync(150);
    // Let microtasks settle
    await vi.runAllTimersAsync();

    // Original call + one queued follow-up = 2
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  // ── Generation tracking ─────────────────────────────────────

  it('tracks generations across concurrent schedule calls for different keys', async () => {
    const refreshFnA = vi.fn().mockResolvedValue(undefined);
    const refreshFnB = vi.fn().mockResolvedValue(undefined);

    scheduleSessionRefresh('key-a', refreshFnA);
    scheduleSessionRefresh('key-b', refreshFnB);

    await vi.advanceTimersByTimeAsync(150);

    expect(refreshFnA).toHaveBeenCalledTimes(1);
    expect(refreshFnB).toHaveBeenCalledTimes(1);

    // Clean up both keys
    cancelSessionRefresh('key-a');
    cancelSessionRefresh('key-b');
  });

  // ── cancelSessionRefresh ────────────────────────────────────

  it('cancels a pending timer so refreshFn never fires', async () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);

    scheduleSessionRefresh('test-key', refreshFn);
    cancelSessionRefresh('test-key');

    await vi.advanceTimersByTimeAsync(150);

    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('clears all state so a new schedule works cleanly after cancel', async () => {
    const deferred = createDeferred();
    const refreshFn = vi.fn().mockImplementation(() => deferred.promise);

    // Start a refresh
    scheduleSessionRefresh('test-key', refreshFn);
    await vi.advanceTimersByTimeAsync(150);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // Cancel while in-flight (clears generation, in-flight, queued state)
    cancelSessionRefresh('test-key');

    // Resolve the old promise (should not cause issues)
    deferred.resolve();
    await Promise.resolve();

    // New schedule should work cleanly
    const freshFn = vi.fn().mockResolvedValue(undefined);
    scheduleSessionRefresh('test-key', freshFn);
    await vi.advanceTimersByTimeAsync(150);
    expect(freshFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when cancelling an unknown key', () => {
    expect(() => cancelSessionRefresh('nonexistent-key')).not.toThrow();
  });
});
