import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastAllSSE } from '../../../src/server/deployment/local/broadcast-all-sse.js';

describe('BroadcastAllSSE', () => {
  let broadcaster: BroadcastAllSSE;

  beforeEach(() => {
    broadcaster = new BroadcastAllSSE();
  });

  function createMockReply() {
    return {
      raw: {
        write: vi.fn().mockReturnValue(true),
        on: vi.fn(),
      },
      hijack: vi.fn(),
    } as any;
  }

  it('adds a client and broadcasts to it', () => {
    const reply = createMockReply();
    broadcaster.addClient(reply);
    broadcaster.broadcast('test', { msg: 'hello' });
    const eventWrites = reply.raw.write.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('event: test')
    );
    expect(eventWrites).toHaveLength(1);
  });

  it('removes a client', () => {
    const reply = createMockReply();
    broadcaster.addClient(reply);
    broadcaster.removeClient(reply);
    broadcaster.broadcast('test', { msg: 'hello' });
    const eventWrites = reply.raw.write.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('event: test')
    );
    expect(eventWrites).toHaveLength(0);
  });

  it('broadcasts to all connected clients', () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    broadcaster.addClient(reply1);
    broadcaster.addClient(reply2);
    broadcaster.broadcast('update', { data: 1 });

    const findEventWrite = (reply: any) =>
      reply.raw.write.mock.calls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('event: update')
      );
    expect(findEventWrite(reply1)).toBe(true);
    expect(findEventWrite(reply2)).toBe(true);
  });

  it('ignores scope parameter (broadcasts to all regardless)', () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    broadcaster.addClient(reply1, { userId: 'user-a' });
    broadcaster.addClient(reply2, { userId: 'user-b' });
    broadcaster.broadcast('update', { data: 1 }, { userId: 'user-a' });

    const findEventWrite = (reply: any) =>
      reply.raw.write.mock.calls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('event: update')
      );
    expect(findEventWrite(reply1)).toBe(true);
    expect(findEventWrite(reply2)).toBe(true);
  });

  it('cleans up dead clients on write failure', () => {
    const reply = createMockReply();
    reply.raw.write.mockReturnValue(false);
    broadcaster.addClient(reply);
    broadcaster.broadcast('test', { msg: 'hello' });
    reply.raw.write.mockClear();
    broadcaster.broadcast('test', { msg: 'world' });
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it('handles write exceptions gracefully', () => {
    const reply = createMockReply();
    reply.raw.write.mockImplementation(() => { throw new Error('socket closed'); });
    broadcaster.addClient(reply);
    expect(() => broadcaster.broadcast('test', { data: 1 })).not.toThrow();
  });

  it('formats SSE payload correctly', () => {
    const reply = createMockReply();
    broadcaster.addClient(reply);
    broadcaster.broadcast('my-event', { key: 'value' });
    const writeCall = reply.raw.write.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('event:')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall[0]).toBe('event: my-event\ndata: {"key":"value"}\n\n');
  });

  it('removes client on socket close', () => {
    const reply = createMockReply();
    broadcaster.addClient(reply);
    // Find and invoke the close handler
    const closeCall = reply.raw.on.mock.calls.find(
      (call: any[]) => call[0] === 'close'
    );
    expect(closeCall).toBeDefined();
    closeCall[1](); // invoke the close handler
    // Client should be removed — broadcast should not write
    reply.raw.write.mockClear();
    broadcaster.broadcast('test', { data: 1 });
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it('sanitizes newlines in event names', () => {
    const reply = createMockReply();
    broadcaster.addClient(reply);
    broadcaster.broadcast('bad\nevent\r', { data: 1 });
    const writeCall = reply.raw.write.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('event:')
    );
    expect(writeCall[0]).toBe('event: badevent\ndata: {"data":1}\n\n');
  });
});
