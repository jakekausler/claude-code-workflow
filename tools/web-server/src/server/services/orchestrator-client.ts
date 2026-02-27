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

// Discriminated union for inbound messages from orchestrator ws-server
type InboundWsMessage =
  | { type: 'init'; data: SessionInfo[] }
  | { type: 'session_registered'; data: SessionInfo }
  | { type: 'session_status'; data: SessionInfo }
  | { type: 'session_ended'; data: SessionInfo }
  | { type: 'approval_requested'; data: PendingApprovalItem }
  | { type: 'question_requested'; data: PendingQuestionItem }
  | { type: 'approval_cancelled'; data: { requestId: string } }
  | { type: 'message_queued'; data: unknown }
  | { type: 'message_sent'; data: unknown };

export interface PendingApprovalItem {
  type: 'approval';
  requestId: string;
  stageId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PendingQuestionItem {
  type: 'question';
  requestId: string;
  stageId: string;
  questions: unknown[];
  /** Raw input data from the AskUserQuestion tool call */
  input: unknown;
  createdAt: number;
}

export type PendingItem = PendingApprovalItem | PendingQuestionItem;

export interface OrchestratorClientOptions {
  /** Delay in ms before attempting reconnection (default: 3000) */
  reconnectDelay?: number;
}

export class OrchestratorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessions = new Map<string, SessionInfo>();
  private pendingApprovals = new Map<string, PendingApprovalItem[]>();
  private pendingQuestions = new Map<string, PendingQuestionItem[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private shouldConnect = false;
  private reconnectDelay: number;
  private _connected = false;

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
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
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
    this.removePendingApproval(stageId, requestId);
  }

  answerQuestion(stageId: string, requestId: string, answers: Record<string, string>): void {
    this.send({ type: 'answer_question', stageId, requestId, answers });
    this.removePendingQuestion(stageId, requestId);
  }

  interruptSession(stageId: string): void {
    this.send({ type: 'interrupt', stageId });
  }

  getPendingForStage(stageId: string): PendingItem[] {
    const approvals = this.pendingApprovals.get(stageId) ?? [];
    const questions = this.pendingQuestions.get(stageId) ?? [];
    return [...approvals, ...questions];
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
      this.ws.on('open', () => {
        this._connected = true;
        this.emit('connected');
      });
      this.ws.on('message', (data) => this.handleMessage(data.toString()));
      this.ws.on('close', () => {
        this._connected = false;
        this.ws = null;
        this.emit('disconnected');
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

  private trackApproval(item: PendingApprovalItem): void {
    const list = this.pendingApprovals.get(item.stageId) ?? [];
    if (list.some(a => a.requestId === item.requestId)) return;
    list.push(item);
    this.pendingApprovals.set(item.stageId, list);
  }

  private trackQuestion(item: PendingQuestionItem): void {
    const list = this.pendingQuestions.get(item.stageId) ?? [];
    if (list.some(q => q.requestId === item.requestId)) return;
    list.push(item);
    this.pendingQuestions.set(item.stageId, list);
  }

  private removePendingApproval(stageId: string, requestId: string): void {
    const list = this.pendingApprovals.get(stageId);
    if (!list) return;
    const filtered = list.filter((a) => a.requestId !== requestId);
    if (filtered.length === 0) {
      this.pendingApprovals.delete(stageId);
    } else {
      this.pendingApprovals.set(stageId, filtered);
    }
  }

  private removePendingQuestion(stageId: string, requestId: string): void {
    const list = this.pendingQuestions.get(stageId);
    if (!list) return;
    const filtered = list.filter((q) => q.requestId !== requestId);
    if (filtered.length === 0) {
      this.pendingQuestions.delete(stageId);
    } else {
      this.pendingQuestions.set(stageId, filtered);
    }
  }

  /**
   * Remove a pending approval by requestId across all stages.
   * Used for approval_cancelled events which don't include stageId.
   */
  private removePendingApprovalByRequestId(requestId: string): void {
    for (const [stageId, list] of this.pendingApprovals) {
      const filtered = list.filter((a) => a.requestId !== requestId);
      if (filtered.length === 0) {
        this.pendingApprovals.delete(stageId);
      } else if (filtered.length !== list.length) {
        this.pendingApprovals.set(stageId, filtered);
      }
    }
  }

  private clearPendingForStage(stageId: string): void {
    this.pendingApprovals.delete(stageId);
    this.pendingQuestions.delete(stageId);
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as InboundWsMessage;
      switch (msg.type) {
        case 'init':
          this.sessions.clear();
          this.pendingApprovals.clear();
          this.pendingQuestions.clear();
          for (const entry of msg.data) {
            this.sessions.set(entry.stageId, entry);
          }
          this.emit('init', this.getAllSessions());
          break;
        case 'session_registered':
          this.sessions.set(msg.data.stageId, msg.data);
          this.emit('session-registered', msg.data);
          break;
        case 'session_status':
          this.sessions.set(msg.data.stageId, msg.data);
          this.emit('session-status', msg.data);
          break;
        case 'session_ended':
          this.sessions.delete(msg.data.stageId);
          this.clearPendingForStage(msg.data.stageId);
          this.emit('session-ended', msg.data);
          break;
        case 'approval_requested':
          this.trackApproval(msg.data);
          this.emit('approval-requested', msg.data);
          break;
        case 'question_requested':
          this.trackQuestion(msg.data);
          this.emit('question-requested', msg.data);
          break;
        case 'approval_cancelled':
          this.removePendingApprovalByRequestId(msg.data.requestId);
          this.emit('approval-cancelled', msg.data);
          break;
        case 'message_queued':
          // TODO: Forward-looking stub - will be wired when orchestrator emits message_queued events
          this.emit('message-queued', msg.data);
          break;
        case 'message_sent':
          // TODO: Forward-looking stub - will be wired when orchestrator emits message_sent events
          this.emit('message-sent', msg.data);
          break;
      }
    } catch {
      // Silently ignore malformed messages from the orchestrator ws-server.
      // This prevents a single bad message from breaking the message handler.
    }
  }
}
