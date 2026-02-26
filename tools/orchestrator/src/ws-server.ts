import { WebSocketServer, WebSocket } from 'ws';
import type { SessionRegistry, SessionEntry } from './session-registry.js';
import type { ApprovalService } from './approval-service.js';
import type { MessageQueue } from './message-queue.js';

export interface WsMessage {
  type: 'init' | 'session_registered' | 'session_status' | 'session_ended' | 'approval_requested' | 'question_requested' | 'approval_cancelled';
  data: SessionEntry | SessionEntry[] | unknown;
}

export interface WsServerOptions {
  port: number;
  registry: SessionRegistry;
  approvalService?: ApprovalService;
  messageQueue?: MessageQueue;
  onSendMessage?: (stageId: string, message: string) => void;
  onApproveTool?: (stageId: string, requestId: string, decision: 'allow' | 'deny', reason?: string) => void;
  onAnswerQuestion?: (stageId: string, requestId: string, answers: Record<string, string>) => void;
  onInterrupt?: (stageId: string) => void;
}

export interface WsServerHandle {
  start: () => Promise<{ port: number }>;
  stop: () => Promise<void>;
}

export function createWsServer(options: WsServerOptions): WsServerHandle {
  const { port, registry, approvalService, onSendMessage, onApproveTool, onAnswerQuestion, onInterrupt } = options;
  let wss: WebSocketServer | null = null;

  function broadcast(msg: WsMessage): void {
    if (!wss) return;
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // Store listener references for cleanup
  const listeners = {
    registered: (entry: SessionEntry) =>
      broadcast({ type: 'session_registered', data: entry }),
    status: (entry: SessionEntry) =>
      broadcast({ type: 'session_status', data: entry }),
    ended: (entry: SessionEntry) =>
      broadcast({ type: 'session_ended', data: entry }),
    approvalRequested: (entry: unknown) =>
      broadcast({ type: 'approval_requested', data: entry }),
    questionRequested: (entry: unknown) =>
      broadcast({ type: 'question_requested', data: entry }),
    approvalCancelled: (requestId: string) =>
      broadcast({ type: 'approval_cancelled', data: { requestId } }),
  };

  async function start(): Promise<{ port: number }> {
    wss = new WebSocketServer({ port });

    await new Promise<void>((resolve) => {
      wss!.on('listening', () => resolve());
    });

    wss.on('connection', (ws) => {
      // Send current state on connect
      const initMsg: WsMessage = {
        type: 'init',
        data: registry.getAll(),
      };
      ws.send(JSON.stringify(initMsg));

      // Handle inbound messages from web server clients
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          switch (msg.type) {
            case 'send_message':
              onSendMessage?.(msg.stageId as string, msg.message as string);
              break;
            case 'approve_tool':
              onApproveTool?.(
                msg.stageId as string,
                msg.requestId as string,
                msg.decision as 'allow' | 'deny',
                msg.reason as string | undefined,
              );
              break;
            case 'answer_question':
              onAnswerQuestion?.(
                msg.stageId as string,
                msg.requestId as string,
                msg.answers as Record<string, string>,
              );
              break;
            case 'interrupt':
              onInterrupt?.(msg.stageId as string);
              break;
          }
        } catch {
          /* ignore malformed messages */
        }
      });
    });

    // Forward registry events as broadcasts
    registry.on('session-registered', listeners.registered);
    registry.on('session-status', listeners.status);
    registry.on('session-ended', listeners.ended);

    // Forward ApprovalService events as broadcasts
    if (approvalService) {
      approvalService.on('approval-requested', listeners.approvalRequested);
      approvalService.on('question-requested', listeners.questionRequested);
      approvalService.on('approval-cancelled', listeners.approvalCancelled);
    }

    const addr = wss.address();
    const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
    return { port: actualPort };
  }

  async function stop(): Promise<void> {
    // Remove listeners first
    registry.removeListener('session-registered', listeners.registered);
    registry.removeListener('session-status', listeners.status);
    registry.removeListener('session-ended', listeners.ended);

    if (approvalService) {
      approvalService.removeListener('approval-requested', listeners.approvalRequested);
      approvalService.removeListener('question-requested', listeners.questionRequested);
      approvalService.removeListener('approval-cancelled', listeners.approvalCancelled);
    }

    if (!wss) return;
    // Close all connected clients
    for (const client of wss.clients) {
      client.close();
    }
    const server = wss;
    wss = null;
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { start, stop };
}
