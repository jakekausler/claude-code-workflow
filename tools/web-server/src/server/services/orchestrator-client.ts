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
  type: 'init' | 'session_registered' | 'session_status' | 'session_ended';
  data: SessionInfo | SessionInfo[];
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
      }
    } catch {
      /* ignore malformed messages */
    }
  }
}
