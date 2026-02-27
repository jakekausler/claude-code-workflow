import { describe, it, expect } from 'vitest';
import { StreamParser, type StreamMessage } from '../src/stream-parser.js';

describe('StreamParser', () => {
  it('parses complete JSON lines and emits message events', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"type":"assistant","text":"hello"}\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'assistant', text: 'hello' });
  });

  it('extracts session_id and emits session-id event', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    const sessionIds: string[] = [];
    parser.on('message', (msg) => messages.push(msg));
    parser.on('session-id', (id) => sessionIds.push(id));

    parser.feed('{"type":"init","session_id":"sess-abc-123"}\n');

    expect(messages).toHaveLength(1);
    expect(sessionIds).toHaveLength(1);
    expect(sessionIds[0]).toBe('sess-abc-123');
  });

  it('handles partial lines across multiple feed() calls', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"type":"ass');
    expect(messages).toHaveLength(0);

    parser.feed('istant","text":"hi"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'assistant', text: 'hi' });
  });

  it('handles multiple lines in single feed()', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"type":"a"}\n{"type":"b"}\n');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'a' });
    expect(messages[1]).toEqual({ type: 'b' });
  });

  it('handles empty lines gracefully', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('\n\n{"type":"x"}\n\n\n{"type":"y"}\n\n');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'x' });
    expect(messages[1]).toEqual({ type: 'y' });
  });

  it('handles non-JSON lines gracefully', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    const errors: Error[] = [];
    parser.on('message', (msg) => messages.push(msg));
    parser.on('error', (err) => errors.push(err));

    parser.feed('this is not json\n');
    parser.feed('also not json\n');
    parser.feed('{"type":"valid"}\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'valid' });
    // Non-JSON lines are silently skipped, no error events
    expect(errors).toHaveLength(0);
  });

  it('flush() processes remaining buffer', () => {
    const parser = new StreamParser();
    const messages: StreamMessage[] = [];
    parser.on('message', (msg) => messages.push(msg));

    // Feed without trailing newline
    parser.feed('{"type":"final"}');
    expect(messages).toHaveLength(0);

    parser.flush();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'final' });
  });

  it('getSessionId() returns captured ID after session-id event', () => {
    const parser = new StreamParser();

    expect(parser.getSessionId()).toBeNull();

    parser.feed('{"type":"init","session_id":"sess-xyz"}\n');

    expect(parser.getSessionId()).toBe('sess-xyz');
  });

  it('only emits session-id once (first occurrence)', () => {
    const parser = new StreamParser();
    const sessionIds: string[] = [];
    parser.on('session-id', (id) => sessionIds.push(id));

    parser.feed('{"type":"a","session_id":"first"}\n');
    parser.feed('{"type":"b","session_id":"second"}\n');

    expect(sessionIds).toHaveLength(1);
    expect(sessionIds[0]).toBe('first');
    expect(parser.getSessionId()).toBe('first');
  });

  it('extracts sessionId from system type message', () => {
    const parser = new StreamParser();
    const sessionIds: string[] = [];
    parser.on('session-id', (id) => sessionIds.push(id));

    parser.feed('{"type":"system","sessionId":"sys-abc-456"}\n');

    expect(sessionIds).toHaveLength(1);
    expect(sessionIds[0]).toBe('sys-abc-456');
    expect(parser.getSessionId()).toBe('sys-abc-456');
  });
});
