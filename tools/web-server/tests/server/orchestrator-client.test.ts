import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { OrchestratorClient, type SessionInfo } from '../../src/server/services/orchestrator-client.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    stageId: 'stage-1',
    sessionId: 'sess-abc',
    processId: 1234,
    worktreePath: '/tmp/worktree',
    status: 'active',
    spawnedAt: Date.now(),
    lastActivity: Date.now(),
    ...overrides,
  };
}

function startServer(): Promise<{ wss: WebSocketServer; port: number; getClients: () => WsWebSocket[] }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === 'object' ? addr.port : 0;
      resolve({
        wss,
        port,
        getClients: () => Array.from(wss.clients),
      });
    });
  });
}

function waitForEvent(emitter: { once: (event: string, fn: (...args: unknown[]) => void) => void }, event: string, timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeout);
    emitter.once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args[0]);
    });
  });
}

function sendToAll(wss: WebSocketServer, msg: object): void {
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    client.send(raw);
  }
}

describe('OrchestratorClient', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: OrchestratorClient;

  beforeEach(async () => {
    const server = await startServer();
    wss = server.wss;
    port = server.port;
    client = new OrchestratorClient(`ws://localhost:${port}`);
  });

  afterEach(async () => {
    client.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('handles init message and populates sessions map', async () => {
    const sessions = [
      makeSession({ stageId: 'stage-1', sessionId: 'sess-1' }),
      makeSession({ stageId: 'stage-2', sessionId: 'sess-2' }),
    ];

    client.connect();
    await waitForEvent(client, 'connected');

    const initPromise = waitForEvent(client, 'init');
    sendToAll(wss, { type: 'init', data: sessions });
    await initPromise;

    const all = client.getAllSessions();
    expect(all).toHaveLength(2);
    expect(client.getSession('stage-1')?.sessionId).toBe('sess-1');
    expect(client.getSession('stage-2')?.sessionId).toBe('sess-2');
  });

  it('handles session_registered and adds to map', async () => {
    const session = makeSession({ stageId: 'stage-new', sessionId: 'sess-new' });

    client.connect();
    await waitForEvent(client, 'connected');

    const regPromise = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: session });
    await regPromise;

    expect(client.getSession('stage-new')).toBeDefined();
    expect(client.getSession('stage-new')?.sessionId).toBe('sess-new');
  });

  it('handles session_status and updates map', async () => {
    const session = makeSession({ stageId: 'stage-x', status: 'starting' });

    client.connect();
    await waitForEvent(client, 'connected');

    const regPromise = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: session });
    await regPromise;

    expect(client.getSession('stage-x')?.status).toBe('starting');

    const statusPromise = waitForEvent(client, 'session-status');
    sendToAll(wss, {
      type: 'session_status',
      data: { ...session, status: 'active' },
    });
    await statusPromise;

    expect(client.getSession('stage-x')?.status).toBe('active');
  });

  it('handles session_ended and removes from map', async () => {
    const session = makeSession({ stageId: 'stage-del' });

    client.connect();
    await waitForEvent(client, 'connected');

    const regPromise = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: session });
    await regPromise;

    expect(client.getSession('stage-del')).toBeDefined();

    const endPromise = waitForEvent(client, 'session-ended');
    sendToAll(wss, { type: 'session_ended', data: session });
    await endPromise;

    expect(client.getSession('stage-del')).toBeUndefined();
  });

  it('getSession() returns undefined for unknown stageId', () => {
    expect(client.getSession('nonexistent')).toBeUndefined();
  });

  it('getSessionBySessionId() finds correct entry', async () => {
    const session = makeSession({ stageId: 'stage-find', sessionId: 'sess-target' });

    client.connect();
    await waitForEvent(client, 'connected');

    const initPromise = waitForEvent(client, 'init');
    sendToAll(wss, { type: 'init', data: [session] });
    await initPromise;

    const found = client.getSessionBySessionId('sess-target');
    expect(found).toBeDefined();
    expect(found?.stageId).toBe('stage-find');

    expect(client.getSessionBySessionId('nonexistent')).toBeUndefined();
  });

  it('auto-reconnects on disconnect', { timeout: 10000 }, async () => {
    // Use a client with a very short reconnect delay for this test
    client.disconnect(); // disconnect default client
    const fastClient = new OrchestratorClient(`ws://localhost:${port}`, {
      reconnectDelay: 100,
    });

    fastClient.connect();
    await waitForEvent(fastClient, 'connected');

    // Forcefully terminate all server-side client connections so the
    // client receives an immediate close event (rather than waiting for TCP)
    for (const ws of wss.clients) {
      ws.terminate();
    }

    // Close the server and wait for it to finish
    await new Promise<void>((resolve) => wss.close(() => resolve()));

    // Start a new server on the same port and wait until it's listening
    const newWss = await new Promise<WebSocketServer>((resolve) => {
      const s = new WebSocketServer({ port }, () => resolve(s));
    });
    wss = newWss; // so afterEach closes the correct one

    // Wait for reconnection (100ms delay + connection time)
    await waitForEvent(fastClient, 'connected', 8000);

    // Verify it's connected by sending a message
    const initPromise = waitForEvent(fastClient, 'init');
    sendToAll(newWss, { type: 'init', data: [] });
    await initPromise;

    expect(fastClient.getAllSessions()).toHaveLength(0);

    fastClient.disconnect();
  });

  it('disconnect() stops reconnection attempts', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Disconnect the client
    client.disconnect();

    // Close and restart the server
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    const newWss = new WebSocketServer({ port }, () => {});
    wss = newWss; // so afterEach closes the correct one

    // Wait a bit to verify no reconnection happens
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(newWss.clients.size).toBe(0);
  });

  it('init clears previous sessions before populating', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Send initial sessions
    const initPromise1 = waitForEvent(client, 'init');
    sendToAll(wss, {
      type: 'init',
      data: [
        makeSession({ stageId: 'old-1' }),
        makeSession({ stageId: 'old-2' }),
      ],
    });
    await initPromise1;
    expect(client.getAllSessions()).toHaveLength(2);

    // Send new init — should replace, not merge
    const initPromise2 = waitForEvent(client, 'init');
    sendToAll(wss, {
      type: 'init',
      data: [makeSession({ stageId: 'new-1' })],
    });
    await initPromise2;

    expect(client.getAllSessions()).toHaveLength(1);
    expect(client.getSession('new-1')).toBeDefined();
    expect(client.getSession('old-1')).toBeUndefined();
  });

  it('ignores malformed messages', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Send malformed JSON — should not throw
    for (const ws of wss.clients) {
      ws.send('not json at all');
    }

    // Send valid message after — should still work
    const regPromise = waitForEvent(client, 'session-registered');
    sendToAll(wss, {
      type: 'session_registered',
      data: makeSession({ stageId: 'after-malformed' }),
    });
    await regPromise;

    expect(client.getSession('after-malformed')).toBeDefined();
  });
});
