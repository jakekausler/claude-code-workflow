import { describe, it, expect, vi } from 'vitest';
import { MessageQueue } from '../src/message-queue.js';

describe('MessageQueue', () => {
  it('queue() stores a message for a stage', () => {
    const queue = new MessageQueue();

    queue.queue('stage-1', 'hello world');

    const msg = queue.peek('stage-1');
    expect(msg).toBeDefined();
    expect(msg!.message).toBe('hello world');
  });

  it('take() removes and returns the message', () => {
    const queue = new MessageQueue();
    queue.queue('stage-1', 'test message');

    const msg = queue.take('stage-1');
    expect(msg).toBeDefined();
    expect(msg!.message).toBe('test message');

    // Message should be gone
    const second = queue.take('stage-1');
    expect(second).toBeUndefined();
  });

  it('latest message overwrites previous for same stage', () => {
    const queue = new MessageQueue();

    queue.queue('stage-1', 'first');
    queue.queue('stage-1', 'second');
    queue.queue('stage-1', 'third');

    const msg = queue.take('stage-1');
    expect(msg!.message).toBe('third');
  });

  it('returns undefined for empty/unknown stage', () => {
    const queue = new MessageQueue();

    const msg = queue.take('nonexistent');
    expect(msg).toBeUndefined();

    const peeked = queue.peek('nonexistent');
    expect(peeked).toBeUndefined();
  });

  it('independent queues per stage', () => {
    const queue = new MessageQueue();

    queue.queue('stage-a', 'message-a');
    queue.queue('stage-b', 'message-b');
    queue.queue('stage-c', 'message-c');

    expect(queue.take('stage-a')!.message).toBe('message-a');
    expect(queue.take('stage-b')!.message).toBe('message-b');
    expect(queue.take('stage-c')!.message).toBe('message-c');

    // All should be gone
    expect(queue.take('stage-a')).toBeUndefined();
    expect(queue.take('stage-b')).toBeUndefined();
    expect(queue.take('stage-c')).toBeUndefined();
  });

  it('has() returns true/false correctly', () => {
    const queue = new MessageQueue();

    expect(queue.has('stage-1')).toBe(false);

    queue.queue('stage-1', 'message');
    expect(queue.has('stage-1')).toBe(true);

    queue.take('stage-1');
    expect(queue.has('stage-1')).toBe(false);
  });

  it('clear() removes the queue for a stage', () => {
    const queue = new MessageQueue();

    queue.queue('stage-1', 'message');
    queue.queue('stage-2', 'message');

    expect(queue.has('stage-1')).toBe(true);
    expect(queue.has('stage-2')).toBe(true);

    queue.clear('stage-1');

    expect(queue.has('stage-1')).toBe(false);
    expect(queue.has('stage-2')).toBe(true);
  });

  it('queuedAt timestamp is set correctly', () => {
    const queue = new MessageQueue();
    const before = Date.now();

    queue.queue('stage-1', 'message');

    const msg = queue.peek('stage-1');
    const after = Date.now();

    expect(msg!.queuedAt).toBeGreaterThanOrEqual(before);
    expect(msg!.queuedAt).toBeLessThanOrEqual(after);
  });

  it('peek() returns without removing', () => {
    const queue = new MessageQueue();

    queue.queue('stage-1', 'message');

    const first = queue.peek('stage-1');
    expect(first).toBeDefined();
    expect(first!.message).toBe('message');

    const second = queue.peek('stage-1');
    expect(second).toBeDefined();
    expect(second!.message).toBe('message');

    // Still there
    expect(queue.has('stage-1')).toBe(true);
  });
});
