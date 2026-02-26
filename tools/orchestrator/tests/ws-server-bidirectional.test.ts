import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createWsServer, type WsServerHandle } from '../src/ws-server.js';
import { SessionRegistry } from '../src/session-registry.js';
import { ApprovalService } from '../src/approval-service.js';
import { MessageQueue } from '../src/message-queue.js';
import type { PendingApproval, PendingQuestion } from '../src/protocol-types.js';

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

interface TestClient {
  ws: WebSocket;
  nextMessage: () => Promise<unknown>;
  waitForClose: () => Promise<void>;
}

function createTestClient(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const buffer: unknown[] = [];
    let waiting: ((msg: unknown) => void) | null = null;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (waiting) {
        const cb = waiting;
        waiting = null;
        cb(msg);
      } else {
        buffer.push(msg);
      }
    });

    function nextMessage(): Promise<unknown> {
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

describe('WebSocket server (bidirectional)', () => {
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

  it('broadcasts approval_requested event from ApprovalService', async () => {
    const registry = new SessionRegistry();
    const approvalService = new ApprovalService();
    server = createWsServer({ port: 0, registry, approvalService });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    // Set up message listener before emitting
    const msgPromise = tc.nextMessage();

    // Simulate approval request from ApprovalService
    const approval: PendingApproval & { type: 'approval' } = {
      type: 'approval',
      stageId: 'stage-1',
      requestId: 'req-123',
      toolName: 'bash',
      input: { command: 'ls' },
      createdAt: Date.now(),
    };
    approvalService.emit('approval-requested', approval);

    const msg = await msgPromise;
    expect((msg as any).type).toBe('approval_requested');
    expect((msg as any).data).toEqual(approval);
  });

  it('broadcasts question_requested event from ApprovalService', async () => {
    const registry = new SessionRegistry();
    const approvalService = new ApprovalService();
    server = createWsServer({ port: 0, registry, approvalService });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    const msgPromise = tc.nextMessage();

    const question: PendingQuestion & { type: 'question' } = {
      type: 'question',
      stageId: 'stage-1',
      requestId: 'req-456',
      questions: [{ key: 'name', label: 'Your name' }],
      input: {},
      createdAt: Date.now(),
    };
    approvalService.emit('question-requested', question);

    const msg = await msgPromise;
    expect((msg as any).type).toBe('question_requested');
    expect((msg as any).data).toEqual(question);
  });

  it('broadcasts approval_cancelled event from ApprovalService', async () => {
    const registry = new SessionRegistry();
    const approvalService = new ApprovalService();
    server = createWsServer({ port: 0, registry, approvalService });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    const msgPromise = tc.nextMessage();

    approvalService.emit('approval-cancelled', 'req-789');

    const msg = await msgPromise;
    expect((msg as any).type).toBe('approval_cancelled');
    expect((msg as any).data).toEqual({ requestId: 'req-789' });
  });

  it('handles send_message from web server client', async () => {
    const registry = new SessionRegistry();
    const sendMessageCalls: Array<{ stageId: string; message: string }> = [];
    const onSendMessage = (stageId: string, message: string) => {
      sendMessageCalls.push({ stageId, message });
    };
    server = createWsServer({ port: 0, registry, onSendMessage });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    tc.ws.send(JSON.stringify({
      type: 'send_message',
      stageId: 'stage-1',
      message: 'Hello from web',
    }));

    // Give handler time to process
    await new Promise(r => setTimeout(r, 100));

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]).toEqual({
      stageId: 'stage-1',
      message: 'Hello from web',
    });
  });

  it('handles approve_tool from web server client', async () => {
    const registry = new SessionRegistry();
    const approveToolCalls: Array<{ stageId: string; requestId: string; decision: string; reason?: string }> = [];
    const onApproveTool = (stageId: string, requestId: string, decision: 'allow' | 'deny', reason?: string) => {
      approveToolCalls.push({ stageId, requestId, decision, reason });
    };
    server = createWsServer({ port: 0, registry, onApproveTool });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    tc.ws.send(JSON.stringify({
      type: 'approve_tool',
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'allow',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(approveToolCalls).toHaveLength(1);
    expect(approveToolCalls[0]).toEqual({
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'allow',
    });
  });

  it('handles approve_tool with reason', async () => {
    const registry = new SessionRegistry();
    const approveToolCalls: Array<{ stageId: string; requestId: string; decision: string; reason?: string }> = [];
    const onApproveTool = (stageId: string, requestId: string, decision: 'allow' | 'deny', reason?: string) => {
      approveToolCalls.push({ stageId, requestId, decision, reason });
    };
    server = createWsServer({ port: 0, registry, onApproveTool });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    tc.ws.send(JSON.stringify({
      type: 'approve_tool',
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'deny',
      reason: 'Too dangerous',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(approveToolCalls).toHaveLength(1);
    expect(approveToolCalls[0]).toEqual({
      stageId: 'stage-1',
      requestId: 'req-123',
      decision: 'deny',
      reason: 'Too dangerous',
    });
  });

  it('handles answer_question from web server client', async () => {
    const registry = new SessionRegistry();
    const answerQuestionCalls: Array<{ stageId: string; requestId: string; answers: Record<string, string> }> = [];
    const onAnswerQuestion = (stageId: string, requestId: string, answers: Record<string, string>) => {
      answerQuestionCalls.push({ stageId, requestId, answers });
    };
    server = createWsServer({ port: 0, registry, onAnswerQuestion });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    tc.ws.send(JSON.stringify({
      type: 'answer_question',
      stageId: 'stage-1',
      requestId: 'req-456',
      answers: { name: 'John', age: '30' },
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(answerQuestionCalls).toHaveLength(1);
    expect(answerQuestionCalls[0]).toEqual({
      stageId: 'stage-1',
      requestId: 'req-456',
      answers: { name: 'John', age: '30' },
    });
  });

  it('handles interrupt from web server client', async () => {
    const registry = new SessionRegistry();
    const interruptCalls: Array<{ stageId: string }> = [];
    const onInterrupt = (stageId: string) => {
      interruptCalls.push({ stageId });
    };
    server = createWsServer({ port: 0, registry, onInterrupt });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    tc.ws.send(JSON.stringify({
      type: 'interrupt',
      stageId: 'stage-1',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(interruptCalls).toHaveLength(1);
    expect(interruptCalls[0]).toEqual({ stageId: 'stage-1' });
  });

  it('ignores unknown message types', async () => {
    const registry = new SessionRegistry();
    const sendMessageCalls: Array<{ stageId: string; message: string }> = [];
    const onSendMessage = (stageId: string, message: string) => {
      sendMessageCalls.push({ stageId, message });
    };
    server = createWsServer({ port: 0, registry, onSendMessage });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    // Send unknown message type
    tc.ws.send(JSON.stringify({
      type: 'unknown_type',
      stageId: 'stage-1',
    }));

    // Send valid message to verify server still works
    tc.ws.send(JSON.stringify({
      type: 'send_message',
      stageId: 'stage-1',
      message: 'Still works',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].message).toBe('Still works');
  });

  it('handles malformed inbound messages gracefully', async () => {
    const registry = new SessionRegistry();
    const sendMessageCalls: Array<{ stageId: string; message: string }> = [];
    const onSendMessage = (stageId: string, message: string) => {
      sendMessageCalls.push({ stageId, message });
    };
    server = createWsServer({ port: 0, registry, onSendMessage });
    const { port } = await server.start();

    const tc = await createTestClient(port);
    testClients.push(tc);
    await tc.nextMessage(); // consume init

    // Send malformed JSON
    tc.ws.send('not json at all');

    // Send valid message after
    tc.ws.send(JSON.stringify({
      type: 'send_message',
      stageId: 'stage-1',
      message: 'After malformed',
    }));

    await new Promise(r => setTimeout(r, 100));

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].message).toBe('After malformed');
  });
});
