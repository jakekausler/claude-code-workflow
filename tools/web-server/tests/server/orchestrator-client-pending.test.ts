import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { OrchestratorClient, type SessionInfo, type PendingApprovalItem, type PendingQuestionItem } from '../../src/server/services/orchestrator-client.js';

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

function makeApproval(overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem {
  return {
    type: 'approval',
    requestId: 'req-001',
    stageId: 'stage-1',
    toolName: 'Bash',
    input: { command: 'ls' },
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<PendingQuestionItem> = {}): PendingQuestionItem {
  return {
    type: 'question',
    requestId: 'req-002',
    stageId: 'stage-1',
    questions: [{ key: 'name', label: 'Your name' }],
    input: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

function startServer(): Promise<{ wss: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === 'object' ? addr.port : 0;
      resolve({ wss, port });
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

describe('OrchestratorClient pending tracking', () => {
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

  it('returns empty array for unknown stage', () => {
    expect(client.getPendingForStage('nonexistent')).toEqual([]);
  });

  it('tracks pending approvals per stage', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const approval = makeApproval({ stageId: 'stage-A', requestId: 'req-100' });
    const eventPromise = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval });
    await eventPromise;

    const pending = client.getPendingForStage('stage-A');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: 'approval',
      requestId: 'req-100',
      stageId: 'stage-A',
      toolName: 'Bash',
    });
  });

  it('tracks pending questions per stage', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const question = makeQuestion({ stageId: 'stage-B', requestId: 'req-200' });
    const eventPromise = waitForEvent(client, 'question-requested');
    sendToAll(wss, { type: 'question_requested', data: question });
    await eventPromise;

    const pending = client.getPendingForStage('stage-B');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: 'question',
      requestId: 'req-200',
      stageId: 'stage-B',
    });
  });

  it('removes approval on cancellation', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Add an approval
    const approval = makeApproval({ stageId: 'stage-C', requestId: 'req-300' });
    const approvalPromise = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval });
    await approvalPromise;

    expect(client.getPendingForStage('stage-C')).toHaveLength(1);

    // Cancel it
    const cancelPromise = waitForEvent(client, 'approval-cancelled');
    sendToAll(wss, { type: 'approval_cancelled', data: { requestId: 'req-300' } });
    await cancelPromise;

    expect(client.getPendingForStage('stage-C')).toHaveLength(0);
  });

  it('removes approval when user approves via approveTool()', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Add an approval
    const approval = makeApproval({ stageId: 'stage-D', requestId: 'req-400' });
    const approvalPromise = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval });
    await approvalPromise;

    expect(client.getPendingForStage('stage-D')).toHaveLength(1);

    // User approves
    client.approveTool('stage-D', 'req-400', 'allow');
    expect(client.getPendingForStage('stage-D')).toHaveLength(0);
  });

  it('removes question when user answers via answerQuestion()', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Add a question
    const question = makeQuestion({ stageId: 'stage-E', requestId: 'req-500' });
    const questionPromise = waitForEvent(client, 'question-requested');
    sendToAll(wss, { type: 'question_requested', data: question });
    await questionPromise;

    expect(client.getPendingForStage('stage-E')).toHaveLength(1);

    // User answers
    client.answerQuestion('stage-E', 'req-500', { name: 'John' });
    expect(client.getPendingForStage('stage-E')).toHaveLength(0);
  });

  it('handles multiple pending items for same stage', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const approval1 = makeApproval({ stageId: 'stage-F', requestId: 'req-601' });
    const approval2 = makeApproval({ stageId: 'stage-F', requestId: 'req-602', toolName: 'Read' });
    const question1 = makeQuestion({ stageId: 'stage-F', requestId: 'req-603' });

    const p1 = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval1 });
    await p1;

    const p2 = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval2 });
    await p2;

    const p3 = waitForEvent(client, 'question-requested');
    sendToAll(wss, { type: 'question_requested', data: question1 });
    await p3;

    const pending = client.getPendingForStage('stage-F');
    expect(pending).toHaveLength(3);
    expect(pending.filter((p) => p.type === 'approval')).toHaveLength(2);
    expect(pending.filter((p) => p.type === 'question')).toHaveLength(1);
  });

  it('cancellation only removes the specific requestId', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    const approval1 = makeApproval({ stageId: 'stage-G', requestId: 'req-701' });
    const approval2 = makeApproval({ stageId: 'stage-G', requestId: 'req-702' });

    const p1 = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval1 });
    await p1;

    const p2 = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval2 });
    await p2;

    expect(client.getPendingForStage('stage-G')).toHaveLength(2);

    // Cancel only one
    const cancelPromise = waitForEvent(client, 'approval-cancelled');
    sendToAll(wss, { type: 'approval_cancelled', data: { requestId: 'req-701' } });
    await cancelPromise;

    const remaining = client.getPendingForStage('stage-G');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].requestId).toBe('req-702');
  });

  it('clears pending when session ends', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Register a session first
    const session = makeSession({ stageId: 'stage-H' });
    const regPromise = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: session });
    await regPromise;

    // Add pending items
    const approval = makeApproval({ stageId: 'stage-H', requestId: 'req-801' });
    const question = makeQuestion({ stageId: 'stage-H', requestId: 'req-802' });

    const ap = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approval });
    await ap;

    const qp = waitForEvent(client, 'question-requested');
    sendToAll(wss, { type: 'question_requested', data: question });
    await qp;

    expect(client.getPendingForStage('stage-H')).toHaveLength(2);

    // End the session
    const endPromise = waitForEvent(client, 'session-ended');
    sendToAll(wss, { type: 'session_ended', data: session });
    await endPromise;

    expect(client.getPendingForStage('stage-H')).toHaveLength(0);
  });

  it('does not affect other stages when clearing pending', async () => {
    client.connect();
    await waitForEvent(client, 'connected');

    // Register sessions
    const sessionI = makeSession({ stageId: 'stage-I' });
    const sessionJ = makeSession({ stageId: 'stage-J' });
    const r1 = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: sessionI });
    await r1;
    const r2 = waitForEvent(client, 'session-registered');
    sendToAll(wss, { type: 'session_registered', data: sessionJ });
    await r2;

    // Add pending for both
    const approvalI = makeApproval({ stageId: 'stage-I', requestId: 'req-901' });
    const approvalJ = makeApproval({ stageId: 'stage-J', requestId: 'req-902' });

    const ai = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approvalI });
    await ai;

    const aj = waitForEvent(client, 'approval-requested');
    sendToAll(wss, { type: 'approval_requested', data: approvalJ });
    await aj;

    // End stage-I
    const endPromise = waitForEvent(client, 'session-ended');
    sendToAll(wss, { type: 'session_ended', data: sessionI });
    await endPromise;

    // stage-I cleared, stage-J untouched
    expect(client.getPendingForStage('stage-I')).toHaveLength(0);
    expect(client.getPendingForStage('stage-J')).toHaveLength(1);
  });
});
