import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { OrchestratorClient } from '../../src/server/services/orchestrator-client.js';

interface ReceivedMessage {
  type: string;
  [key: string]: unknown;
}

function startServer(): Promise<{ wss: WebSocketServer; port: number; getClients: () => WsWebSocket[]; getMessages: () => ReceivedMessage[] }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === 'object' ? addr.port : 0;
      const messages: ReceivedMessage[] = [];

      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ReceivedMessage;
          messages.push(msg);
        });
      });

      resolve({
        wss,
        port,
        getClients: () => Array.from(wss.clients),
        getMessages: () => messages,
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

describe('OrchestratorClient (bidirectional)', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: OrchestratorClient;
  let getMessages: () => ReceivedMessage[];

  beforeEach(async () => {
    const server = await startServer();
    wss = server.wss;
    port = server.port;
    client = new OrchestratorClient(`ws://localhost:${port}`);
    getMessages = server.getMessages;
  });

  afterEach(async () => {
    client.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('sendMessage sends correct JSON to WebSocket', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    client.sendMessage('stage-1', 'Hello from web');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'send_message',
      stageId: 'stage-1',
      message: 'Hello from web',
    });
  });

  it('approveTool sends correct JSON with allow', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    client.approveTool('stage-1', 'req-123', 'allow');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'approve_tool',
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'allow',
    });
  });

  it('approveTool sends correct JSON with deny and reason', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    client.approveTool('stage-1', 'req-123', 'deny', 'Too risky');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'approve_tool',
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'deny',
      reason: 'Too risky',
    });
  });

  it('answerQuestion sends correct JSON', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const answers = { name: 'John', age: '30' };
    client.answerQuestion('stage-1', 'req-456', answers);

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'answer_question',
      stageId: 'stage-1',
      requestId: 'req-456',
      answers,
    });
  });

  it('interruptSession sends correct JSON', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    client.interruptSession('stage-1');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'interrupt',
      stageId: 'stage-1',
    });
  });

  it('emits approval-requested event for inbound approval_requested message', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const eventPromise = waitForEvent(client, 'approval-requested');
    const approval = {
      type: 'approval',
      stageId: 'stage-1',
      requestId: 'req-789',
      toolName: 'bash',
      input: { command: 'ls' },
      createdAt: Date.now(),
    };
    sendToAll(wss, { type: 'approval_requested', data: approval });

    const data = await eventPromise;
    expect(data).toEqual(approval);
  });

  it('emits question-requested event for inbound question_requested message', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const eventPromise = waitForEvent(client, 'question-requested');
    const question = {
      type: 'question',
      stageId: 'stage-1',
      requestId: 'req-456',
      questions: [{ key: 'name', label: 'Your name' }],
      input: {},
      createdAt: Date.now(),
    };
    sendToAll(wss, { type: 'question_requested', data: question });

    const data = await eventPromise;
    expect(data).toEqual(question);
  });

  it('emits approval-cancelled event for inbound approval_cancelled message', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const eventPromise = waitForEvent(client, 'approval-cancelled');
    sendToAll(wss, { type: 'approval_cancelled', data: { requestId: 'req-999' } });

    const data = await eventPromise;
    expect(data).toEqual({ requestId: 'req-999' });
  });

  it('does not send when WebSocket is not connected', async () => {
    // Don't connect at all
    client.sendMessage('stage-1', 'Should not send');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(0);
  });

  it('does not send when WebSocket is closed', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    client.disconnect();
    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    client.sendMessage('stage-1', 'Should not send');

    // Real timer needed: WebSocket message delivery and JSON parsing require event loop ticks
    await new Promise(r => setTimeout(r, 50));

    const messages = getMessages();
    expect(messages).toHaveLength(0);
  });
});
