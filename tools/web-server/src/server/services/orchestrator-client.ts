import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

export interface SessionInfo {
  stageId: string;
  sessionId: string;
  processId: number;
  worktreePath: string;
  status: 'starting' | 'active' | 'ended';
  spawnedAt: number;
  lastActivity: number;
}

interface WsMessage {
  type: 'init' | 'session_registered' | 'session_status' | 'session_ended' | 'approval_requested' | 'question_requested' | 'approval_cancelled' | 'message_queued' | 'message_sent';
  data: SessionInfo | SessionInfo[] | unknown;
}

export interface OrchestratorClientOptions {
  /** Delay in ms before attempting reconnection (default: 3000) */
  reconnectDelay?: number;
}

export class OrchestratorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessions = new Map<string, SessionInfo>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private shouldConnect = false;
  private reconnectDelay: number;

  constructor(url: string, options?: OrchestratorClientOptions) {
    super();
    this.url = url;
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
  }

  connect(): void {
    this.shouldConnect = true;
    this.tryConnect();
  }

  disconnect(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getSession(stageId: string): SessionInfo | undefined {
    return this.sessions.get(stageId);
  }

  getSessionBySessionId(sessionId: string): SessionInfo | undefined {
    for (const s of this.sessions.values()) {
      if (s.sessionId === sessionId) return s;
    }
    return undefined;
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  sendMessage(stageId: string, message: string): void {
    this.send({ type: 'send_message', stageId, message });
  }

  approveTool(stageId: string, requestId: string, decision: 'allow' | 'deny', reason?: string): void {
    this.send({ type: 'approve_tool', stageId, requestId, decision, reason });
  }

  answerQuestion(stageId: string, requestId: string, answers: Record<string, string>): void {
    this.send({ type: 'answer_question', stageId, requestId, answers });
  }

  interruptSession(stageId: string): void {
    this.send({ type: 'interrupt', stageId });
  }

  getPendingForStage(_stageId: string): unknown[] {
    return [];
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private tryConnect(): void {
    if (!this.shouldConnect) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => this.emit('connected'));
      this.ws.on('message', (data) => this.handleMessage(data.toString()));
      this.ws.on('close', () => {
        this.ws = null;
        this.scheduleReconnect();
      });
      this.ws.on('error', () => {
        /* close event will fire */
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect) return;
    this.reconnectTimer = setTimeout(() => this.tryConnect(), this.reconnectDelay);
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as WsMessage;
      switch (msg.type) {
        case 'init':
          this.sessions.clear();
          for (const entry of msg.data as SessionInfo[]) {
            this.sessions.set(entry.stageId, entry);
          }
          this.emit('init', this.getAllSessions());
          break;
        case 'session_registered':
          this.sessions.set(
            (msg.data as SessionInfo).stageId,
            msg.data as SessionInfo,
          );
          this.emit('session-registered', msg.data);
          break;
        case 'session_status':
          this.sessions.set(
            (msg.data as SessionInfo).stageId,
            msg.data as SessionInfo,
          );
          this.emit('session-status', msg.data);
          break;
        case 'session_ended':
          this.sessions.delete((msg.data as SessionInfo).stageId);
          this.emit('session-ended', msg.data);
          break;
        case 'approval_requested':
          this.emit('approval-requested', msg.data);
          break;
        case 'question_requested':
          this.emit('question-requested', msg.data);
          break;
        case 'approval_cancelled':
          this.emit('approval-cancelled', msg.data);
          break;
        case 'message_queued':
          this.emit('message-queued', msg.data);
          break;
        case 'message_sent':
          this.emit('message-sent', msg.data);
          break;
      }
    } catch {
      /* ignore malformed messages */
    }
  }
}
