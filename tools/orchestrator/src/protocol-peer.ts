import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Writable, Readable } from 'node:stream';
import type { ProtocolHandler, PermissionResult, InboundControlRequest, ResultMessage } from './protocol-types.js';

/**
 * Wraps Claude Code's stdin/stdout for bidirectional stream-JSON communication.
 *
 * Outbound (to stdin): user messages, control requests, approval responses.
 * Inbound (from stdout): tool approval requests, cancel requests, result messages.
 */
export class ProtocolPeer {
  private stdin: Writable;
  private abortController = new AbortController();
  private readLoopPromise: Promise<void>;

  constructor(stdin: Writable, stdout: Readable, handler: ProtocolHandler) {
    this.stdin = stdin;
    this.readLoopPromise = this.startReadLoop(stdout, handler);
  }

  // ── Outbound methods ──────────────────────────────────────────

  async sendUserMessage(content: string): Promise<void> {
    this.sendJson({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  async sendApprovalResponse(requestId: string, response: PermissionResult): Promise<void> {
    this.sendJson({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response,
      },
    });
  }

  async interrupt(): Promise<void> {
    this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    });
  }

  async initialize(hooks?: unknown): Promise<void> {
    // Note: JSON.stringify omits undefined values, so hooks is excluded when not provided
    this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'initialize', hooks },
    });
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_permission_mode', mode },
    });
  }

  destroy(): void {
    this.abortController.abort();
  }

  /** Wait for the read loop to fully terminate (useful for graceful shutdown). */
  async waitForClose(): Promise<void> {
    await this.readLoopPromise;
  }

  // ── Internal ──────────────────────────────────────────────────

  private sendJson(message: unknown): void {
    const json = JSON.stringify(message);
    this.stdin.write(json + '\n');
  }

  private async startReadLoop(stdout: Readable, handler: ProtocolHandler): Promise<void> {
    const rl = createInterface({ input: stdout });
    const signal = this.abortController.signal;

    try {
      for await (const line of rl) {
        if (signal.aborted) break;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          // Skip non-JSON lines (progress messages, partial output, etc.)
          continue;
        }

        if (typeof msg.type !== 'string') continue;

        switch (msg.type) {
          case 'control_request': {
            const requestId = msg.request_id as string;
            const request = msg.request as Record<string, unknown>;
            if (requestId && request) {
              await handler.handleControlRequest(requestId, request as InboundControlRequest['request']);
            }
            break;
          }
          case 'control_cancel_request': {
            const requestId = msg.request_id as string;
            if (requestId) {
              handler.handleCancelRequest(requestId);
            }
            break;
          }
          case 'result': {
            handler.handleResult(msg as ResultMessage);
            break;
          }
          // All other message types (assistant, system, etc.) are streaming
          // log messages — ignored here. The existing StreamParser handles
          // session_id extraction from these.
          default:
            break;
        }
      }
    } catch (err) {
      // readline throws on abort — this is expected
      if (!signal.aborted) throw err;
    }
  }
}
