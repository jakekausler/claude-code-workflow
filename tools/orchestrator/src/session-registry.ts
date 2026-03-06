import { EventEmitter } from 'node:events';

export interface SessionEntry {
  stageId: string;
  sessionId: string;
  processId: number;
  worktreePath: string;
  status: 'starting' | 'active' | 'ended';
  spawnedAt: number; // epoch ms
  lastActivity: number; // epoch ms
}

export interface SessionRegistryEvents {
  'session-registered': (entry: SessionEntry) => void;
  'session-status': (entry: SessionEntry) => void;
  'session-ended': (entry: SessionEntry) => void;
}

export declare interface SessionRegistry {
  on<K extends keyof SessionRegistryEvents>(event: K, listener: SessionRegistryEvents[K]): this;
  emit<K extends keyof SessionRegistryEvents>(event: K, ...args: Parameters<SessionRegistryEvents[K]>): boolean;
}

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, SessionEntry>();

  register(entry: Omit<SessionEntry, 'status' | 'lastActivity'>): SessionEntry {
    const full: SessionEntry = {
      ...entry,
      status: 'starting',
      lastActivity: entry.spawnedAt,
    };
    this.sessions.set(entry.stageId, full);
    this.emit('session-registered', full);
    return full;
  }

  activate(stageId: string, sessionId: string): void {
    const entry = this.sessions.get(stageId);
    if (!entry) return;
    entry.status = 'active';
    entry.sessionId = sessionId;
    entry.lastActivity = Date.now();
    this.emit('session-status', entry);
  }

  end(stageId: string): void {
    const entry = this.sessions.get(stageId);
    if (!entry) return;
    entry.status = 'ended';
    entry.lastActivity = Date.now();
    this.emit('session-ended', entry);
    this.sessions.delete(stageId);
  }

  get(stageId: string): SessionEntry | undefined {
    return this.sessions.get(stageId);
  }

  getBySessionId(sessionId: string): SessionEntry | undefined {
    for (const entry of this.sessions.values()) {
      if (entry.sessionId === sessionId) return entry;
    }
    return undefined;
  }

  getAll(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  size(): number {
    return this.sessions.size;
  }
}
