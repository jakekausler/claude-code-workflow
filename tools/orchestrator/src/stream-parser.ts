import { EventEmitter } from 'node:events';

export interface StreamMessage {
  type: string;
  [key: string]: unknown;
}

export interface StreamParserEvents {
  'session-id': (sessionId: string) => void;
  'message': (msg: StreamMessage) => void;
  'error': (err: Error) => void;
}

export declare interface StreamParser {
  on<K extends keyof StreamParserEvents>(event: K, listener: StreamParserEvents[K]): this;
  emit<K extends keyof StreamParserEvents>(event: K, ...args: Parameters<StreamParserEvents[K]>): boolean;
}

export class StreamParser extends EventEmitter {
  private buffer = '';
  private sessionId: string | null = null;

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Feed raw stdout data into the parser.
   * Splits on newlines, parses each complete line as JSON.
   */
  feed(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }

  /** Flush any remaining buffer content. */
  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (trimmed) {
      this.parseLine(trimmed);
    }
  }

  private parseLine(line: string): void {
    try {
      const msg = JSON.parse(line) as StreamMessage;
      this.emit('message', msg);

      // Extract session ID — Claude stream-json outputs session_id in messages
      if (msg.session_id && typeof msg.session_id === 'string' && !this.sessionId) {
        this.sessionId = msg.session_id;
        this.emit('session-id', msg.session_id);
      }
      // Also check nested sessionId field from system-type messages
      if (msg.type === 'system' && typeof msg.sessionId === 'string' && !this.sessionId) {
        this.sessionId = msg.sessionId;
        this.emit('session-id', msg.sessionId);
      }
    } catch {
      // Non-JSON lines — skip silently
    }
  }
}
