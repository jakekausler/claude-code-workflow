import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createWsServer, type WsMessage, type WsServerHandle } from '../src/ws-server.js';
import { SessionRegistry } from '../src/session-registry.js';

// ---------- Helpers ----------

function makeRegistryEntry(overrides: Partial<{
  stageId: string;
  sessionId: string;
  processId: number;
  worktreePath: string;
  spawnedAt: number;
}> = {}) {
  return {
    stageId: overrides.stageId ?? 'stage-1',
    sessionId: overrides.sessionId ?? '',
    processId: overrides.processId ?? 1234,
    worktreePath: overrides.worktreePath ?? '/tmp/wt-1',
    spawnedAt: overrides.spawnedAt ?? 1000,
  };
}

/**
 * A test WebSocket client that buffers all incoming messages into a queue.
 * This avoids race conditions where a message arrives before a listener is set up.
 */
interface TestClient {
  ws: WebSocket;
  /** Returns the next message, waiting if none is buffered yet. */
  nextMessage: () => Promise<WsMessage>;
  /** Returns a promise that resolves when the socket closes. */
  waitForClose: () => Promise<void>;
}

function createTestClient(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const buffer: WsMessage[] = [];
    let waiting: ((msg: WsMessage) => void) | null = null;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as WsMessage;
      if (waiting) {
        const cb = waiting;
        waiting = null;
        cb(msg);
      } else {
        buffer.push(msg);
      }
    });

    function nextMessage(): Promise<WsMessage> {
      if (buffer.length > 0) {
        return Promise.resolve(buffer.shift()!);
      }
      return new Promise((res) => {
        waiting = res;
      });
    }

    function waitForClose(): Promise<void> {
      if (ws.readyState === WebSocket.CLOSED) {
        return Promise.resolve();
      }
      return new Promise((res) => {
        ws.once('close', () => res());
      });
    }

    ws.on('open', () => resolve({ ws, nextMessage, waitForClose }));
    ws.on('error', reject);
  });
}

// ---------- Tests ----------

describe('WebSocket server', () => {
  let server: WsServerHandle | null = null;
  let testClients: TestClient[] = [];

  afterEach(async () => {
    // Close all clients
    for (const tc of testClients) {
      if (tc.ws.readyState === WebSocket.OPEN || tc.ws.readyState === WebSocket.CONNECTING) {
        tc.ws.close();
      }
    }
    testClients = [];

    // Stop the server
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and accepts WebSocket connections', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);

    expect(tc.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('new clients receive init message with current registry state', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    // Register a session before client connects
    registry.register(makeRegistryEntry({ stageId: 'pre-existing' }));

    const tc = await createTestClient(port);
    testClients.push(tc);
    const msg = await tc.nextMessage();

    expect(msg.type).toBe('init');
    expect(Array.isArray(msg.data)).toBe(true);
    const entries = msg.data as Array<{ stageId: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].stageId).toBe('pre-existing');
  });

  it('broadcasts session_registered to all connected clients', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    // Connect two clients and consume their init messages
    const tc1 = await createTestClient(port);
    testClients.push(tc1);
    await tc1.nextMessage(); // consume init

    const tc2 = await createTestClient(port);
    testClients.push(tc2);
    await tc2.nextMessage(); // consume init

    // Set up message listeners before the event
    const p1 = tc1.nextMessage();
    const p2 = tc2.nextMessage();

    // Register a session — should broadcast to both
    registry.register(makeRegistryEntry({ stageId: 'new-stage' }));

    const [msg1, msg2] = await Promise.all([p1, p2]);

    expect(msg1.type).toBe('session_registered');
    expect((msg1.data as { stageId: string }).stageId).toBe('new-stage');

    expect(msg2.type).toBe('session_registered');
    expect((msg2.data as { stageId: string }).stageId).toBe('new-stage');
  });

  it('broadcasts session_status when session activates', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    // Register first, consume that broadcast
    registry.register(makeRegistryEntry({ stageId: 'activating-stage' }));
    await tc.nextMessage(); // consume session_registered

    // Now activate — expect session_status
    registry.activate('activating-stage', 'sess-abc');
    const msg = await tc.nextMessage();

    expect(msg.type).toBe('session_status');
    const entry = msg.data as { stageId: string; status: string; sessionId: string };
    expect(entry.stageId).toBe('activating-stage');
    expect(entry.status).toBe('active');
    expect(entry.sessionId).toBe('sess-abc');
  });

  it('broadcasts session_ended when session ends', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    // Register and consume
    registry.register(makeRegistryEntry({ stageId: 'ending-stage' }));
    await tc.nextMessage(); // consume session_registered

    // End — expect session_ended
    registry.end('ending-stage');
    const msg = await tc.nextMessage();

    expect(msg.type).toBe('session_ended');
    const entry = msg.data as { stageId: string; status: string };
    expect(entry.stageId).toBe('ending-stage');
    expect(entry.status).toBe('ended');
  });

  it('stop() closes the server and disconnects clients', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    const closePromise = tc.waitForClose();
    await server.stop();
    server = null; // prevent double-stop in afterEach

    await closePromise;
    expect(tc.ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('stop() removes registry event listeners so no broadcasts after stop', async () => {
    const registry = new SessionRegistry();
    server = createWsServer({ port: 0, registry });
    await server.start();

    await server.stop();
    server = null;

    // This should not throw or attempt to broadcast — listeners have been removed
    registry.register(makeRegistryEntry({ stageId: 'after-stop' }));

    // Verify by checking no listeners remain for the events
    expect(registry.listenerCount('session-registered')).toBe(0);
    expect(registry.listenerCount('session-status')).toBe(0);
    expect(registry.listenerCount('session-ended')).toBe(0);
  });
});
