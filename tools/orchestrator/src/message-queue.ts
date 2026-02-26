import type { QueuedMessage } from './protocol-types.js';

/**
 * Buffers follow-up messages when Claude is busy processing.
 *
 * Only one message is buffered per stage (latest wins). When a session
 * completes, the orchestrator loop calls take() and, if a message exists,
 * spawns a new Claude process with --resume to deliver it.
 */
export class MessageQueue {
  private queued = new Map<string, QueuedMessage>();

  queue(stageId: string, message: string): void {
    this.queued.set(stageId, { message, queuedAt: Date.now() });
  }

  take(stageId: string): QueuedMessage | undefined {
    const msg = this.queued.get(stageId);
    this.queued.delete(stageId);
    return msg;
  }

  peek(stageId: string): QueuedMessage | undefined {
    return this.queued.get(stageId);
  }

  has(stageId: string): boolean {
    return this.queued.has(stageId);
  }

  clear(stageId: string): void {
    this.queued.delete(stageId);
  }
}
