import { WebSocketServer, WebSocket } from 'ws';
import type { SessionRegistry, SessionEntry } from './session-registry.js';

export interface WsMessage {
  type: 'init' | 'session_registered' | 'session_status' | 'session_ended';
  data: SessionEntry | SessionEntry[];
}

export interface WsServerOptions {
  port: number;
  registry: SessionRegistry;
}

export interface WsServerHandle {
  start: () => Promise<{ port: number }>;
  stop: () => Promise<void>;
}

export function createWsServer(options: WsServerOptions): WsServerHandle {
  const { port, registry } = options;
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
    });

    // Forward registry events as broadcasts
    registry.on('session-registered', listeners.registered);
    registry.on('session-status', listeners.status);
    registry.on('session-ended', listeners.ended);

    const addr = wss.address();
    const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
    return { port: actualPort };
  }

  async function stop(): Promise<void> {
    // Remove listeners first
    registry.removeListener('session-registered', listeners.registered);
    registry.removeListener('session-status', listeners.status);
    registry.removeListener('session-ended', listeners.ended);

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
