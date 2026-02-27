# Stage 10B: Bidirectional Interaction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Users can send messages, approve/deny tool calls, and answer AskUserQuestion prompts from the browser, flowing through the web server → orchestrator → Claude Code stdin/stdout protocol.

**Architecture:** The orchestrator's `SessionExecutor` is refactored to use a `ProtocolPeer` that wraps Claude Code's stdin/stdout when spawned with `--permission-prompt-tool=stdio`. An `ApprovalService` queues tool approval requests from Claude and waits for web UI responses relayed through the existing WebSocket channel (extended to be bidirectional). A `MessageQueue` buffers follow-up messages when Claude is busy. The web server exposes REST endpoints for message/approve/answer/interrupt actions. The browser gets a message input, approval dialog, and question answer form.

**Tech Stack:** TypeScript, Node.js streams (Writable/Readable), readline, uuid, ws (WebSocket — already installed), Fastify (already installed), React + Zustand (client), Vitest (tests)

**Parent stage plan:** `docs/plans/stage-9-10-substages/stage-10b-bidirectional-interaction.md`
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md` §14

---

## Dependency Map

```
Task 1 (Protocol types) ──────────────────────────────────────┐
Task 2 (ProtocolPeer) ← Task 1                                │
Task 3 (ApprovalService) ← Task 1                             │
Task 4 (MessageQueue) ← Task 1                                │
Task 5 (Refactor SessionExecutor) ← Task 2, Task 3, Task 4    │
Task 6 (Extend WS protocol) ← Task 3                          │
Task 7 (Web server REST endpoints) ← Task 6                   │
Task 8 (Client interaction store) ← Task 1                    │
Task 9 (MessageInput component) ← Task 7, Task 8              │
Task 10 (ApprovalDialog component) ← Task 7, Task 8           │
Task 11 (QuestionAnswerForm component) ← Task 7, Task 8       │
Task 12 (Pending indicators) ← Task 8                         │
Task 13 (Integration wiring) ← all above                      │
```

---

## Task 1: Protocol Type Definitions

**Files:**
- Create: `tools/orchestrator/src/protocol-types.ts`
- Test: `tools/orchestrator/tests/protocol-types.test.ts`

These types define the stream-JSON protocol messages exchanged between our orchestrator and Claude Code's stdin/stdout. They are derived from the vibe-kanban reference implementation and Claude Code's `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio` flags.

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/protocol-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  OutboundMessage,
  UserMessage,
  ControlRequest,
  ControlResponse,
  InboundMessage,
  CanUseToolRequest,
  HookCallbackRequest,
  ControlCancelRequest,
  ResultMessage,
  PermissionResult,
  PendingApproval,
  PendingQuestion,
  QueuedMessage,
} from '../src/protocol-types.js';

describe('protocol-types', () => {
  it('UserMessage satisfies OutboundMessage shape', () => {
    const msg: UserMessage = {
      type: 'user',
      message: { role: 'user', content: 'Fix the login bug' },
    };
    // Type-level assertion: OutboundMessage union includes UserMessage
    const outbound: OutboundMessage = msg;
    expect(outbound.type).toBe('user');
  });

  it('ControlRequest satisfies OutboundMessage shape', () => {
    const msg: ControlRequest = {
      type: 'control_request',
      request_id: 'req-001',
      request: { subtype: 'initialize' },
    };
    const outbound: OutboundMessage = msg;
    expect(outbound.type).toBe('control_request');
  });

  it('ControlResponse satisfies OutboundMessage shape', () => {
    const msg: ControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-001',
        response: { behavior: 'allow' },
      },
    };
    const outbound: OutboundMessage = msg;
    expect(outbound.type).toBe('control_response');
  });

  it('CanUseToolRequest satisfies InboundMessage shape', () => {
    const msg: CanUseToolRequest = {
      type: 'control_request',
      request_id: 'req-001',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'npm test' },
      },
    };
    const inbound: InboundMessage = msg;
    expect(inbound.type).toBe('control_request');
  });

  it('HookCallbackRequest satisfies InboundMessage shape', () => {
    const msg: HookCallbackRequest = {
      type: 'control_request',
      request_id: 'req-002',
      request: {
        subtype: 'hook_callback',
        callback_id: 'hook-1',
        input: { question: 'Proceed?' },
      },
    };
    const inbound: InboundMessage = msg;
    expect(inbound.type).toBe('control_request');
  });

  it('ControlCancelRequest satisfies InboundMessage shape', () => {
    const msg: ControlCancelRequest = {
      type: 'control_cancel_request',
      request_id: 'req-001',
    };
    const inbound: InboundMessage = msg;
    expect(inbound.type).toBe('control_cancel_request');
  });

  it('ResultMessage satisfies InboundMessage shape', () => {
    const msg: ResultMessage = {
      type: 'result',
      result: { status: 'success' },
    };
    const inbound: InboundMessage = msg;
    expect(inbound.type).toBe('result');
  });

  it('PermissionResult allow shape is valid', () => {
    const allow: PermissionResult = { behavior: 'allow' };
    expect(allow.behavior).toBe('allow');

    const allowWithInput: PermissionResult = {
      behavior: 'allow',
      updatedInput: { answers: { q1: 'yes' } },
    };
    expect(allowWithInput.behavior).toBe('allow');
  });

  it('PermissionResult deny shape is valid', () => {
    const deny: PermissionResult = { behavior: 'deny', message: 'Not allowed' };
    expect(deny.behavior).toBe('deny');
  });

  it('PendingApproval shape includes required fields', () => {
    const approval: PendingApproval = {
      stageId: 'STAGE-001-001-001',
      requestId: 'req-001',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
      createdAt: Date.now(),
    };
    expect(approval.stageId).toBe('STAGE-001-001-001');
    expect(approval.toolName).toBe('Bash');
  });

  it('PendingQuestion shape includes required fields', () => {
    const question: PendingQuestion = {
      stageId: 'STAGE-001-001-001',
      requestId: 'req-002',
      questions: [{ question: 'Which DB?', options: [{ label: 'Postgres' }, { label: 'MySQL' }] }],
      input: {},
      createdAt: Date.now(),
    };
    expect(question.questions).toHaveLength(1);
  });

  it('QueuedMessage shape includes required fields', () => {
    const queued: QueuedMessage = {
      message: 'Please also fix the signup form',
      queuedAt: Date.now(),
    };
    expect(queued.message).toBeTruthy();
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/protocol-types.test.ts`
Expected: FAIL — module `../src/protocol-types.js` not found

### Step 3: Write minimal implementation

```typescript
// tools/orchestrator/src/protocol-types.ts

// ─── Outbound messages (to Claude Code stdin) ─────────────────────

/** Send a follow-up user message to Claude */
export interface UserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
}

/** Send a control request (initialize, interrupt, set_permission_mode) */
export interface ControlRequest {
  type: 'control_request';
  request_id: string;
  request:
    | { subtype: 'initialize'; hooks?: unknown }
    | { subtype: 'interrupt' }
    | { subtype: 'set_permission_mode'; mode: string };
}

/** Respond to a control request from Claude (tool approval) */
export interface ControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success';
    request_id: string;
    response: PermissionResult;
  };
}

export type OutboundMessage = UserMessage | ControlRequest | ControlResponse;

// ─── Inbound messages (from Claude Code stdout) ───────────────────

/** Claude requests tool approval */
export interface CanUseToolRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    input: unknown;
    tool_use_id?: string;
    permission_suggestions?: unknown[];
    blocked_paths?: string | null;
  };
}

/** Claude requests hook callback */
export interface HookCallbackRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'hook_callback';
    callback_id: string;
    input: unknown;
    tool_use_id?: string;
  };
}

/** Claude cancels a pending approval request */
export interface ControlCancelRequest {
  type: 'control_cancel_request';
  request_id: string;
}

/** Session complete */
export interface ResultMessage {
  type: 'result';
  result: unknown;
}

export type InboundControlRequest = CanUseToolRequest | HookCallbackRequest;

export type InboundMessage =
  | InboundControlRequest
  | ControlCancelRequest
  | ResultMessage;

// ─── Permission result ────────────────────────────────────────────

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message?: string };

// ─── Approval / question / queue state ────────────────────────────

export interface PendingApproval {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PendingQuestion {
  stageId: string;
  requestId: string;
  questions: unknown[];
  input: unknown;
  createdAt: number;
}

export interface QueuedMessage {
  message: string;
  queuedAt: number;
}

// ─── Protocol handler interface ───────────────────────────────────

export interface ProtocolHandler {
  handleControlRequest(
    requestId: string,
    request: InboundControlRequest['request'],
  ): Promise<void>;
  handleCancelRequest(requestId: string): void;
  handleResult(msg: ResultMessage): void;
}
```

### Step 4: Run test to verify it passes

Run: `cd tools/orchestrator && npx vitest run tests/protocol-types.test.ts`
Expected: PASS — all 12 type-shape assertions succeed

### Step 5: Commit

```bash
git add tools/orchestrator/src/protocol-types.ts tools/orchestrator/tests/protocol-types.test.ts
git commit -m "feat(orchestrator): add stream-JSON protocol type definitions for 10B"
```

---

## Task 2: ProtocolPeer

**Files:**
- Create: `tools/orchestrator/src/protocol-peer.ts`
- Test: `tools/orchestrator/tests/protocol-peer.test.ts`

The ProtocolPeer wraps Claude Code's stdin/stdout when spawned with `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio`. It handles sending JSON lines to stdin and parsing JSON lines from stdout, dispatching inbound messages to a `ProtocolHandler`.

**Key design decisions:**
- Uses Node.js `readline` for stdout line parsing (same pattern as existing `StreamParser`)
- The peer does NOT own the child process — it receives stdin/stdout references
- Exposes high-level methods: `sendUserMessage()`, `sendApprovalResponse()`, `interrupt()`
- Delegates all inbound control requests to the handler (separation of concerns)

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/protocol-peer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { ProtocolPeer } from '../src/protocol-peer.js';
import type { ProtocolHandler, InboundControlRequest, ResultMessage } from '../src/protocol-types.js';

function createMockHandler(): ProtocolHandler {
  return {
    handleControlRequest: vi.fn().mockResolvedValue(undefined),
    handleCancelRequest: vi.fn(),
    handleResult: vi.fn(),
  };
}

describe('ProtocolPeer', () => {
  let stdin: PassThrough;
  let stdout: PassThrough;
  let handler: ProtocolHandler;
  let peer: ProtocolPeer;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    handler = createMockHandler();
    peer = new ProtocolPeer(stdin, stdout, handler);
  });

  describe('sendUserMessage', () => {
    it('writes JSON line to stdin', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.sendUserMessage('Fix the login bug');

      const written = Buffer.concat(chunks).toString();
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({
        type: 'user',
        message: { role: 'user', content: 'Fix the login bug' },
      });
    });

    it('terminates message with newline', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.sendUserMessage('hello');

      const written = Buffer.concat(chunks).toString();
      expect(written.endsWith('\n')).toBe(true);
    });
  });

  describe('sendApprovalResponse', () => {
    it('sends allow response', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.sendApprovalResponse('req-001', { behavior: 'allow' });

      const written = Buffer.concat(chunks).toString();
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-001',
          response: { behavior: 'allow' },
        },
      });
    });

    it('sends deny response with message', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.sendApprovalResponse('req-002', { behavior: 'deny', message: 'Blocked' });

      const written = Buffer.concat(chunks).toString();
      const parsed = JSON.parse(written.trim());
      expect(parsed.response.response).toEqual({
        behavior: 'deny',
        message: 'Blocked',
      });
    });

    it('sends allow response with updatedInput for AskUserQuestion', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.sendApprovalResponse('req-003', {
        behavior: 'allow',
        updatedInput: { answers: { q1: 'yes' } },
      });

      const written = Buffer.concat(chunks).toString();
      const parsed = JSON.parse(written.trim());
      expect(parsed.response.response.updatedInput).toEqual({
        answers: { q1: 'yes' },
      });
    });
  });

  describe('interrupt', () => {
    it('sends interrupt control request', async () => {
      const chunks: Buffer[] = [];
      stdin.on('data', (chunk) => chunks.push(chunk));

      await peer.interrupt();

      const written = Buffer.concat(chunks).toString();
      const parsed = JSON.parse(written.trim());
      expect(parsed.type).toBe('control_request');
      expect(parsed.request.subtype).toBe('interrupt');
      expect(parsed.request_id).toBeDefined();
    });
  });

  describe('read loop — inbound messages', () => {
    it('dispatches can_use_tool request to handler', async () => {
      const msg = JSON.stringify({
        type: 'control_request',
        request_id: 'req-100',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'npm test' },
        },
      });

      stdout.write(msg + '\n');

      // Give the readline async iteration a tick to process
      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).toHaveBeenCalledWith(
        'req-100',
        expect.objectContaining({ subtype: 'can_use_tool', tool_name: 'Bash' }),
      );
    });

    it('dispatches control_cancel_request to handler', async () => {
      const msg = JSON.stringify({
        type: 'control_cancel_request',
        request_id: 'req-100',
      });

      stdout.write(msg + '\n');
      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleCancelRequest).toHaveBeenCalledWith('req-100');
    });

    it('dispatches result message to handler', async () => {
      const msg = JSON.stringify({
        type: 'result',
        result: { status: 'success' },
      });

      stdout.write(msg + '\n');
      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleResult).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'result' }),
      );
    });

    it('ignores non-JSON lines gracefully', async () => {
      stdout.write('not json at all\n');
      await new Promise((r) => setTimeout(r, 50));

      // No handler calls and no crash
      expect(handler.handleControlRequest).not.toHaveBeenCalled();
      expect(handler.handleResult).not.toHaveBeenCalled();
    });

    it('ignores JSON lines without recognized type', async () => {
      stdout.write(JSON.stringify({ type: 'assistant', content: 'hi' }) + '\n');
      await new Promise((r) => setTimeout(r, 50));

      // Ignored — these are streaming log messages, not control messages
      expect(handler.handleControlRequest).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('stops the read loop', async () => {
      peer.destroy();

      // Writing after destroy should not dispatch
      stdout.write(JSON.stringify({ type: 'result', result: {} }) + '\n');
      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleResult).not.toHaveBeenCalled();
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/protocol-peer.test.ts`
Expected: FAIL — module `../src/protocol-peer.js` not found

### Step 3: Write minimal implementation

```typescript
// tools/orchestrator/src/protocol-peer.ts
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Writable, Readable } from 'node:stream';
import type { ProtocolHandler, PermissionResult } from './protocol-types.js';

/**
 * Wraps Claude Code's stdin/stdout for bidirectional stream-JSON communication.
 *
 * Outbound (to stdin): user messages, control requests, approval responses.
 * Inbound (from stdout): tool approval requests, cancel requests, result messages.
 *
 * Reference: vibe-kanban crates/executors/src/executors/claude/protocol.rs
 */
export class ProtocolPeer {
  private stdin: Writable;
  private abortController = new AbortController();
  private readLoopPromise: Promise<void>;

  constructor(stdin: Writable, stdout: Readable, handler: ProtocolHandler) {
    this.stdin = stdin;
    this.readLoopPromise = this.startReadLoop(stdout, handler);
  }

  // ── Outbound methods ──────────────────────────────────────────

  async sendUserMessage(content: string): Promise<void> {
    await this.sendJson({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  async sendApprovalResponse(requestId: string, response: PermissionResult): Promise<void> {
    await this.sendJson({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response,
      },
    });
  }

  async interrupt(): Promise<void> {
    await this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    });
  }

  async initialize(hooks?: unknown): Promise<void> {
    await this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'initialize', hooks },
    });
  }

  async setPermissionMode(mode: string): Promise<void> {
    await this.sendJson({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_permission_mode', mode },
    });
  }

  destroy(): void {
    this.abortController.abort();
  }

  // ── Internal ──────────────────────────────────────────────────

  private async sendJson(message: unknown): Promise<void> {
    const json = JSON.stringify(message);
    this.stdin.write(json + '\n');
  }

  private async startReadLoop(stdout: Readable, handler: ProtocolHandler): Promise<void> {
    const rl = createInterface({ input: stdout });
    const signal = this.abortController.signal;

    try {
      for await (const line of rl) {
        if (signal.aborted) break;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          // Skip non-JSON lines (progress messages, partial output, etc.)
          continue;
        }

        if (typeof msg.type !== 'string') continue;

        switch (msg.type) {
          case 'control_request': {
            const requestId = msg.request_id as string;
            const request = msg.request as Record<string, unknown>;
            if (requestId && request) {
              await handler.handleControlRequest(requestId, request as any);
            }
            break;
          }
          case 'control_cancel_request': {
            const requestId = msg.request_id as string;
            if (requestId) {
              handler.handleCancelRequest(requestId);
            }
            break;
          }
          case 'result': {
            handler.handleResult(msg as any);
            break;
          }
          // All other message types (assistant, system, etc.) are streaming
          // log messages — we ignore them here. The existing StreamParser
          // handles session_id extraction from these.
          default:
            break;
        }
      }
    } catch (err) {
      // readline throws on abort — this is expected
      if (!signal.aborted) throw err;
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `cd tools/orchestrator && npx vitest run tests/protocol-peer.test.ts`
Expected: PASS — all 11 tests pass

### Step 5: Commit

```bash
git add tools/orchestrator/src/protocol-peer.ts tools/orchestrator/tests/protocol-peer.test.ts
git commit -m "feat(orchestrator): add ProtocolPeer for stdin/stdout stream-JSON communication"
```

---

## Task 3: ApprovalService

**Files:**
- Create: `tools/orchestrator/src/approval-service.ts`
- Test: `tools/orchestrator/tests/approval-service.test.ts`

The ApprovalService manages the lifecycle of pending tool approval requests and AskUserQuestion prompts. When Claude requests tool permission, the service queues the request and broadcasts it (via a callback). When the web UI sends a decision, the service resolves the pending request and returns the `PermissionResult` for the `ProtocolPeer` to send back to Claude.

**Key design decisions:**
- Implements `ProtocolHandler` interface — plugs directly into ProtocolPeer
- Emits events for `approval-requested`, `question-requested`, `approval-cancelled`, `result`
- Detects AskUserQuestion by checking `tool_name === 'AskUserQuestion'` in can_use_tool requests
- Stores stageId context so web UI can identify which session an approval belongs to

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/approval-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalService } from '../src/approval-service.js';
import type { PendingApproval, PendingQuestion } from '../src/protocol-types.js';

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
  });

  describe('handleControlRequest — tool approval', () => {
    it('emits approval-requested for can_use_tool', async () => {
      const listener = vi.fn();
      service.on('approval-requested', listener);

      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-001', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'npm test' },
        tool_use_id: 'tool-1',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: 'STAGE-001-001-001',
          requestId: 'req-001',
          toolName: 'Bash',
          input: { command: 'npm test' },
        }),
      );
    });

    it('stores pending approval retrievable by getPending', async () => {
      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-001', {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        input: { file_path: '/foo.ts' },
      });

      const pending = service.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe('req-001');
    });
  });

  describe('handleControlRequest — AskUserQuestion', () => {
    it('emits question-requested for AskUserQuestion tool', async () => {
      const listener = vi.fn();
      service.on('question-requested', listener);

      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-002', {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: {
          questions: [{ question: 'Which DB?', options: [{ label: 'PG' }, { label: 'MySQL' }] }],
        },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: 'STAGE-001-001-001',
          requestId: 'req-002',
          questions: expect.any(Array),
        }),
      );
    });
  });

  describe('resolveApproval', () => {
    it('returns allow PermissionResult and removes from pending', async () => {
      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-001', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
      });

      const result = service.resolveApproval('req-001', 'allow');
      expect(result).toEqual({ behavior: 'allow' });
      expect(service.getPending()).toHaveLength(0);
    });

    it('returns deny PermissionResult with reason', async () => {
      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-001', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'rm -rf /' },
      });

      const result = service.resolveApproval('req-001', 'deny', 'Too dangerous');
      expect(result).toEqual({ behavior: 'deny', message: 'Too dangerous' });
    });

    it('throws for unknown requestId', () => {
      expect(() => service.resolveApproval('no-such-id', 'allow')).toThrow('Unknown approval request');
    });
  });

  describe('resolveQuestion', () => {
    it('returns allow with updatedInput containing answers', async () => {
      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-002', {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: {
          questions: [{ question: 'Which DB?' }],
        },
      });

      const result = service.resolveQuestion('req-002', { 'Which DB?': 'Postgres' });
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: {
          questions: [{ question: 'Which DB?' }],
          answers: { 'Which DB?': 'Postgres' },
        },
      });
      expect(service.getPending()).toHaveLength(0);
    });
  });

  describe('handleCancelRequest', () => {
    it('removes pending approval and emits approval-cancelled', async () => {
      const listener = vi.fn();
      service.on('approval-cancelled', listener);

      service.setCurrentStageId('STAGE-001-001-001');
      await service.handleControlRequest('req-001', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: {},
      });

      service.handleCancelRequest('req-001');
      expect(service.getPending()).toHaveLength(0);
      expect(listener).toHaveBeenCalledWith('req-001');
    });

    it('no-op for unknown requestId', () => {
      // Should not throw
      service.handleCancelRequest('no-such-id');
    });
  });

  describe('handleResult', () => {
    it('emits result event', () => {
      const listener = vi.fn();
      service.on('result', listener);

      service.handleResult({ type: 'result', result: { status: 'success' } });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }));
    });
  });

  describe('getPendingForStage', () => {
    it('filters pending by stageId', async () => {
      service.setCurrentStageId('STAGE-A');
      await service.handleControlRequest('req-a', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: {},
      });

      service.setCurrentStageId('STAGE-B');
      await service.handleControlRequest('req-b', {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        input: {},
      });

      const stageA = service.getPendingForStage('STAGE-A');
      expect(stageA).toHaveLength(1);
      expect(stageA[0].requestId).toBe('req-a');
    });
  });

  describe('clearForStage', () => {
    it('removes all pending for a given stageId', async () => {
      service.setCurrentStageId('STAGE-A');
      await service.handleControlRequest('req-a1', {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: {},
      });
      await service.handleControlRequest('req-a2', {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        input: {},
      });

      service.clearForStage('STAGE-A');
      expect(service.getPending()).toHaveLength(0);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/approval-service.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// tools/orchestrator/src/approval-service.ts
import { EventEmitter } from 'node:events';
import type {
  ProtocolHandler,
  InboundControlRequest,
  ResultMessage,
  PermissionResult,
  PendingApproval,
  PendingQuestion,
} from './protocol-types.js';

type PendingEntry = (PendingApproval | PendingQuestion) & { type: 'approval' | 'question' };

/**
 * Manages pending tool approval requests and AskUserQuestion prompts.
 *
 * Implements ProtocolHandler so it can be plugged directly into ProtocolPeer.
 * When Claude requests tool permission, the service queues the request and
 * emits an event for the WebSocket/SSE layer to broadcast to connected clients.
 *
 * Events emitted:
 *  - 'approval-requested' (PendingApproval)
 *  - 'question-requested' (PendingQuestion)
 *  - 'approval-cancelled' (requestId: string)
 *  - 'result' (ResultMessage)
 */
export class ApprovalService extends EventEmitter implements ProtocolHandler {
  private pending = new Map<string, PendingEntry>();
  private currentStageId = '';

  setCurrentStageId(stageId: string): void {
    this.currentStageId = stageId;
  }

  // ── ProtocolHandler implementation ──────────────────────────

  async handleControlRequest(
    requestId: string,
    request: InboundControlRequest['request'],
  ): Promise<void> {
    if (request.subtype !== 'can_use_tool') return;

    const isQuestion = request.tool_name === 'AskUserQuestion';

    if (isQuestion) {
      const questions = (request.input as Record<string, unknown>)?.questions as unknown[] ?? [];
      const entry: PendingEntry = {
        type: 'question',
        stageId: this.currentStageId,
        requestId,
        questions,
        input: request.input,
        createdAt: Date.now(),
      };
      this.pending.set(requestId, entry);
      this.emit('question-requested', entry);
    } else {
      const entry: PendingEntry = {
        type: 'approval',
        stageId: this.currentStageId,
        requestId,
        toolName: request.tool_name,
        input: request.input,
        createdAt: Date.now(),
      };
      this.pending.set(requestId, entry);
      this.emit('approval-requested', entry);
    }
  }

  handleCancelRequest(requestId: string): void {
    if (this.pending.has(requestId)) {
      this.pending.delete(requestId);
      this.emit('approval-cancelled', requestId);
    }
  }

  handleResult(msg: ResultMessage): void {
    this.emit('result', msg);
  }

  // ── Resolution methods (called when web UI responds) ────────

  resolveApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    reason?: string,
  ): PermissionResult {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error('Unknown approval request');
    this.pending.delete(requestId);

    return decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: reason };
  }

  resolveQuestion(
    requestId: string,
    answers: Record<string, string>,
  ): PermissionResult {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error('Unknown approval request');
    this.pending.delete(requestId);

    return {
      behavior: 'allow',
      updatedInput: { ...(entry.input as object), answers },
    };
  }

  // ── Query methods ───────────────────────────────────────────

  getPending(): Array<PendingApproval | PendingQuestion> {
    return [...this.pending.values()];
  }

  getPendingForStage(stageId: string): Array<PendingApproval | PendingQuestion> {
    return [...this.pending.values()].filter((e) => e.stageId === stageId);
  }

  clearForStage(stageId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.stageId === stageId) this.pending.delete(id);
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `cd tools/orchestrator && npx vitest run tests/approval-service.test.ts`
Expected: PASS — all 11 tests pass

### Step 5: Commit

```bash
git add tools/orchestrator/src/approval-service.ts tools/orchestrator/tests/approval-service.test.ts
git commit -m "feat(orchestrator): add ApprovalService for tool approval and question handling"
```

---

## Task 4: MessageQueue

**Files:**
- Create: `tools/orchestrator/src/message-queue.ts`
- Test: `tools/orchestrator/tests/message-queue.test.ts`

The MessageQueue buffers follow-up messages when Claude is busy processing. Only one message is buffered per stage (latest wins — overwrites any previous queued message). When the session completes, the orchestrator checks the queue and spawns a new Claude process with `--resume` to deliver the queued message.

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/message-queue.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageQueue } from '../src/message-queue.js';

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  it('queues a message for a stage', () => {
    queue.queue('STAGE-A', 'Fix the bug');
    const msg = queue.peek('STAGE-A');
    expect(msg).toBeDefined();
    expect(msg!.message).toBe('Fix the bug');
  });

  it('take() removes and returns the queued message', () => {
    queue.queue('STAGE-A', 'Fix the bug');
    const msg = queue.take('STAGE-A');
    expect(msg!.message).toBe('Fix the bug');
    expect(queue.peek('STAGE-A')).toBeUndefined();
  });

  it('latest message overwrites previous for same stage', () => {
    queue.queue('STAGE-A', 'First message');
    queue.queue('STAGE-A', 'Second message');
    const msg = queue.take('STAGE-A');
    expect(msg!.message).toBe('Second message');
  });

  it('returns undefined for empty stage', () => {
    expect(queue.take('STAGE-A')).toBeUndefined();
    expect(queue.peek('STAGE-A')).toBeUndefined();
  });

  it('independent queues per stage', () => {
    queue.queue('STAGE-A', 'Message A');
    queue.queue('STAGE-B', 'Message B');
    expect(queue.take('STAGE-A')!.message).toBe('Message A');
    expect(queue.take('STAGE-B')!.message).toBe('Message B');
  });

  it('has() returns true when message exists', () => {
    queue.queue('STAGE-A', 'msg');
    expect(queue.has('STAGE-A')).toBe(true);
    expect(queue.has('STAGE-B')).toBe(false);
  });

  it('clear() removes queue for stage', () => {
    queue.queue('STAGE-A', 'msg');
    queue.clear('STAGE-A');
    expect(queue.has('STAGE-A')).toBe(false);
  });

  it('queuedAt timestamp is set', () => {
    const before = Date.now();
    queue.queue('STAGE-A', 'msg');
    const after = Date.now();
    const msg = queue.peek('STAGE-A')!;
    expect(msg.queuedAt).toBeGreaterThanOrEqual(before);
    expect(msg.queuedAt).toBeLessThanOrEqual(after);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/message-queue.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// tools/orchestrator/src/message-queue.ts
import type { QueuedMessage } from './protocol-types.js';

/**
 * Buffers follow-up messages when Claude is busy processing.
 *
 * Only one message is buffered per stage (latest wins). When a session
 * completes, the orchestrator loop calls take() and, if a message exists,
 * spawns a new Claude process with --resume to deliver it.
 */
export class MessageQueue {
  private queued = new Map<string, QueuedMessage>();

  queue(stageId: string, message: string): void {
    this.queued.set(stageId, { message, queuedAt: Date.now() });
  }

  take(stageId: string): QueuedMessage | undefined {
    const msg = this.queued.get(stageId);
    this.queued.delete(stageId);
    return msg;
  }

  peek(stageId: string): QueuedMessage | undefined {
    return this.queued.get(stageId);
  }

  has(stageId: string): boolean {
    return this.queued.has(stageId);
  }

  clear(stageId: string): void {
    this.queued.delete(stageId);
  }
}
```

### Step 4: Run test to verify it passes

Run: `cd tools/orchestrator && npx vitest run tests/message-queue.test.ts`
Expected: PASS — all 8 tests pass

### Step 5: Commit

```bash
git add tools/orchestrator/src/message-queue.ts tools/orchestrator/tests/message-queue.test.ts
git commit -m "feat(orchestrator): add MessageQueue for follow-up message buffering"
```

---

## Task 5: Refactor SessionExecutor to use ProtocolPeer

**Files:**
- Modify: `tools/orchestrator/src/session.ts`
- Modify: `tools/orchestrator/src/loop.ts`
- Test: `tools/orchestrator/tests/session-protocol.test.ts`

This is the most critical task. The current `SessionExecutor.spawn()` fires off a Claude process and only reads stdout via `StreamParser` for session ID extraction. We refactor it to:

1. Add `--permission-prompt-tool=stdio` to spawn flags
2. Create a `ProtocolPeer` wrapping the child's stdin/stdout
3. Store the peer reference per active session so the orchestrator can relay messages and approvals
4. Integrate `ApprovalService` as the `ProtocolHandler`
5. On session end, check `MessageQueue` for follow-up and spawn with `--resume`

**Important:** The existing `StreamParser` continues to work alongside `ProtocolPeer`. `StreamParser` handles session_id extraction from all stdout messages. `ProtocolPeer` only handles control_request/control_cancel_request/result messages. They both read from the same stdout stream — `ProtocolPeer` ignores non-control messages, and `StreamParser` ignores control messages.

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/session-protocol.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProtocolPeer } from '../src/protocol-peer.js';

// Test that the SessionExecutor correctly creates a ProtocolPeer and
// stores it so external callers can send messages/approvals.

describe('SessionExecutor protocol integration', () => {
  it('exposes getPeer(stageId) to retrieve active ProtocolPeer', async () => {
    // This test verifies the public interface change.
    // Full integration is tested via the mock session executor.
    const { SessionExecutor } = await import('../src/session.js');

    // The spawn method is complex (needs real claude binary), so we test
    // the interface: getPeer should exist and return undefined for unknown stages
    const executor = new SessionExecutor();
    expect(executor.getPeer('STAGE-nonexistent')).toBeUndefined();
  });

  it('exposes getApprovalService() to access shared approval service', async () => {
    const { SessionExecutor } = await import('../src/session.js');
    const executor = new SessionExecutor();
    const service = executor.getApprovalService();
    expect(service).toBeDefined();
    expect(typeof service.getPending).toBe('function');
    expect(typeof service.resolveApproval).toBe('function');
  });

  it('exposes getMessageQueue() to access shared message queue', async () => {
    const { SessionExecutor } = await import('../src/session.js');
    const executor = new SessionExecutor();
    const queue = executor.getMessageQueue();
    expect(queue).toBeDefined();
    expect(typeof queue.queue).toBe('function');
    expect(typeof queue.take).toBe('function');
  });

  it('spawn options include --permission-prompt-tool=stdio flag', async () => {
    // Verify the flag is part of the spawn args by checking the build method.
    // We cannot spawn a real Claude process in tests, so we verify the args list.
    const { SessionExecutor } = await import('../src/session.js');
    const executor = new SessionExecutor();

    // Access the internal build args method (we'll add this for testability)
    const args = executor.buildSpawnArgs({ model: 'sonnet' });
    expect(args).toContain('--permission-prompt-tool=stdio');
    expect(args).toContain('--input-format=stream-json');
    expect(args).toContain('--output-format=stream-json');
  });

  it('buildResumeArgs includes --resume flag', async () => {
    const { SessionExecutor } = await import('../src/session.js');
    const executor = new SessionExecutor();

    const args = executor.buildSpawnArgs({ model: 'sonnet', resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args).toContain('sess-123');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/session-protocol.test.ts`
Expected: FAIL — `getPeer`, `getApprovalService`, `getMessageQueue`, `buildSpawnArgs` not found on SessionExecutor

### Step 3: Modify SessionExecutor

Modify `tools/orchestrator/src/session.ts`:

**Changes needed:**

1. Import `ProtocolPeer`, `ApprovalService`, `MessageQueue`
2. Add instance fields: `peers: Map<string, ProtocolPeer>`, `approvalService: ApprovalService`, `messageQueue: MessageQueue`
3. Add `--permission-prompt-tool=stdio` to spawn flags
4. After spawning, create `ProtocolPeer(child.stdin, child.stdout, approvalService)` and store in `peers` map
5. Call `approvalService.setCurrentStageId(stageId)` before spawn
6. On session exit: destroy peer, remove from map, check message queue
7. Add public methods: `getPeer(stageId)`, `getApprovalService()`, `getMessageQueue()`, `buildSpawnArgs(opts)`

**The exact edits depend on the current file content** — the implementing agent should read `session.ts` and make the minimal changes needed. Key constraints:

- The existing `StreamParser` must continue to work (it reads the same stdout)
- The `ProtocolPeer` read loop and `StreamParser.feed()` both need stdout data. Pipe stdout to both by reading from the child.stdout stream and feeding to both. The simplest approach: `ProtocolPeer` reads from stdout via readline (already does), and `StreamParser` is fed manually from the same readline events. **However**, since `ProtocolPeer` already consumes the readline iterator, an alternative is to use a `PassThrough` to tee the stdout to both consumers. The implementing agent should choose the simplest approach.
- `approvalService.setCurrentStageId()` must be called before each spawn so that pending approvals are tagged with the correct stageId

**Also modify `tools/orchestrator/src/loop.ts`:**

- After session end (in the cleanup block), check `messageQueue.take(stageId)`. If a message exists, log it and spawn a new session with `--resume <sessionId>` and deliver the queued message.
- Pass the `sessionExecutor.getApprovalService()` to the WebSocket server so it can broadcast approval events.

### Step 4: Run tests to verify

Run: `cd tools/orchestrator && npx vitest run tests/session-protocol.test.ts`
Expected: PASS

Also run existing tests to ensure no regressions:
Run: `cd tools/orchestrator && npx vitest run`
Expected: All existing tests pass

### Step 5: Commit

```bash
git add tools/orchestrator/src/session.ts tools/orchestrator/src/loop.ts tools/orchestrator/tests/session-protocol.test.ts
git commit -m "feat(orchestrator): integrate ProtocolPeer into SessionExecutor for bidirectional communication"
```

---

## Task 6: Extend WebSocket Protocol for Bidirectional Communication

**Files:**
- Modify: `tools/orchestrator/src/ws-server.ts`
- Modify: `tools/web-server/src/server/services/orchestrator-client.ts`
- Test: `tools/orchestrator/tests/ws-server-bidirectional.test.ts`
- Test: `tools/web-server/tests/server/orchestrator-client-bidirectional.test.ts`

The current WebSocket protocol is unidirectional: orchestrator → web server. We extend it to be bidirectional so the web server can relay user actions (send message, approve tool, answer question, interrupt) back to the orchestrator.

**New inbound WS message types (web server → orchestrator):**
- `{ type: 'send_message', stageId, message }` — relay follow-up message
- `{ type: 'approve_tool', stageId, requestId, decision, reason? }` — relay approval decision
- `{ type: 'answer_question', stageId, requestId, answers }` — relay question answer
- `{ type: 'interrupt', stageId }` — interrupt session

**New outbound WS message types (orchestrator → web server):**
- `{ type: 'approval_requested', data: PendingApproval }` — tool approval needed
- `{ type: 'question_requested', data: PendingQuestion }` — question answer needed
- `{ type: 'approval_cancelled', data: { requestId } }` — approval retracted by Claude
- `{ type: 'message_queued', data: { stageId, message } }` — message was queued (Claude busy)
- `{ type: 'message_sent', data: { stageId } }` — message delivered to Claude

### Step 1: Write the failing test

```typescript
// tools/orchestrator/tests/ws-server-bidirectional.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createWsServer } from '../src/ws-server.js';
import { SessionRegistry } from '../src/session-registry.js';
import { ApprovalService } from '../src/approval-service.js';
import { MessageQueue } from '../src/message-queue.js';

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

describe('WsServer bidirectional', () => {
  let registry: SessionRegistry;
  let approvalService: ApprovalService;
  let messageQueue: MessageQueue;
  let server: ReturnType<typeof createWsServer>;
  const PORT = 13202; // Use different port from other tests

  beforeEach(async () => {
    registry = new SessionRegistry();
    approvalService = new ApprovalService();
    messageQueue = new MessageQueue();
    server = createWsServer({
      port: PORT,
      registry,
      approvalService,
      messageQueue,
      onSendMessage: vi.fn(),
      onApproveTool: vi.fn(),
      onAnswerQuestion: vi.fn(),
      onInterrupt: vi.fn(),
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('broadcasts approval_requested events from ApprovalService', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise<void>((r) => ws.on('open', r));

    // Skip init message
    await waitForMessage(ws);

    // Trigger an approval request
    approvalService.setCurrentStageId('STAGE-A');
    await approvalService.handleControlRequest('req-001', {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'ls' },
    });

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('approval_requested');
    expect((msg.data as Record<string, unknown>).requestId).toBe('req-001');

    ws.close();
  });

  it('broadcasts question_requested events from ApprovalService', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise<void>((r) => ws.on('open', r));
    await waitForMessage(ws); // skip init

    approvalService.setCurrentStageId('STAGE-A');
    await approvalService.handleControlRequest('req-002', {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [{ question: 'DB?' }] },
    });

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('question_requested');

    ws.close();
  });

  it('handles send_message from web server client', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise<void>((r) => ws.on('open', r));
    await waitForMessage(ws); // skip init

    ws.send(JSON.stringify({
      type: 'send_message',
      stageId: 'STAGE-A',
      message: 'Fix the bug',
    }));

    // Give a tick for the handler
    await new Promise((r) => setTimeout(r, 50));

    expect(server.handlers.onSendMessage).toHaveBeenCalledWith('STAGE-A', 'Fix the bug');

    ws.close();
  });

  it('handles approve_tool from web server client', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise<void>((r) => ws.on('open', r));
    await waitForMessage(ws); // skip init

    ws.send(JSON.stringify({
      type: 'approve_tool',
      stageId: 'STAGE-A',
      requestId: 'req-001',
      decision: 'allow',
    }));

    await new Promise((r) => setTimeout(r, 50));

    expect(server.handlers.onApproveTool).toHaveBeenCalledWith('STAGE-A', 'req-001', 'allow', undefined);

    ws.close();
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/orchestrator && npx vitest run tests/ws-server-bidirectional.test.ts`
Expected: FAIL — `createWsServer` doesn't accept `approvalService`, `messageQueue`, or handler options

### Step 3: Modify ws-server.ts and orchestrator-client.ts

**Modify `tools/orchestrator/src/ws-server.ts`:**

1. Extend `WsServerOptions` to accept `approvalService`, `messageQueue`, and handler callbacks (`onSendMessage`, `onApproveTool`, `onAnswerQuestion`, `onInterrupt`)
2. Forward `ApprovalService` events as broadcasts: `approval-requested` → `approval_requested`, `question-requested` → `question_requested`, `approval-cancelled` → `approval_cancelled`
3. Add inbound message handler: parse client messages and dispatch to handler callbacks
4. Expose `handlers` property for test assertions

**Modify `tools/web-server/src/server/services/orchestrator-client.ts`:**

1. Add methods: `sendMessage(stageId, message)`, `approveTool(stageId, requestId, decision, reason?)`, `answerQuestion(stageId, requestId, answers)`, `interruptSession(stageId)`
2. Handle new inbound message types: `approval_requested`, `question_requested`, `approval_cancelled`, `message_queued`, `message_sent`
3. Emit corresponding events for the web server to broadcast via SSE

Also write a test for the client side:

```typescript
// tools/web-server/tests/server/orchestrator-client-bidirectional.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { OrchestratorClient } from '../../src/server/services/orchestrator-client.js';

describe('OrchestratorClient bidirectional', () => {
  let wss: WebSocketServer;
  let client: OrchestratorClient;
  const PORT = 13203;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: PORT });
    client = new OrchestratorClient(`ws://127.0.0.1:${PORT}`);

    // Wait for connection
    await new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'init', data: [] }));
        resolve();
      });
      client.connect();
    });
  });

  afterEach(async () => {
    client.disconnect();
    await new Promise<void>((r) => wss.close(r));
  });

  it('sends send_message via WebSocket', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      wss.clients.forEach((ws) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });
    });

    client.sendMessage('STAGE-A', 'Fix the bug');
    const msg = await received;
    expect(msg).toEqual({
      type: 'send_message',
      stageId: 'STAGE-A',
      message: 'Fix the bug',
    });
  });

  it('sends approve_tool via WebSocket', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      wss.clients.forEach((ws) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });
    });

    client.approveTool('STAGE-A', 'req-001', 'deny', 'Unsafe');
    const msg = await received;
    expect(msg).toEqual({
      type: 'approve_tool',
      stageId: 'STAGE-A',
      requestId: 'req-001',
      decision: 'deny',
      reason: 'Unsafe',
    });
  });

  it('emits approval-requested event for inbound approval', async () => {
    const listener = vi.fn();
    client.on('approval-requested', listener);

    wss.clients.forEach((ws) => {
      ws.send(JSON.stringify({
        type: 'approval_requested',
        data: { stageId: 'STAGE-A', requestId: 'req-001', toolName: 'Bash', input: {} },
      }));
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(listener).toHaveBeenCalled();
  });
});
```

### Step 4: Run tests

Run: `cd tools/orchestrator && npx vitest run tests/ws-server-bidirectional.test.ts`
Run: `cd tools/web-server && npx vitest run tests/server/orchestrator-client-bidirectional.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/orchestrator/src/ws-server.ts tools/orchestrator/tests/ws-server-bidirectional.test.ts \
        tools/web-server/src/server/services/orchestrator-client.ts tools/web-server/tests/server/orchestrator-client-bidirectional.test.ts
git commit -m "feat(orchestrator,web-server): extend WebSocket protocol for bidirectional interaction"
```

---

## Task 7: Web Server REST Endpoints for Interaction

**Files:**
- Create: `tools/web-server/src/server/routes/interaction.ts`
- Modify: `tools/web-server/src/server/app.ts` (register routes)
- Test: `tools/web-server/tests/server/interaction-routes.test.ts`

Four new REST endpoints that relay user actions from the browser to the orchestrator via the WebSocket client. Plus a GET endpoint for pending approvals.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/server/interaction-routes.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerInteractionRoutes } from '../../src/server/routes/interaction.js';

function createMockOrchestratorClient() {
  return {
    sendMessage: vi.fn(),
    approveTool: vi.fn(),
    answerQuestion: vi.fn(),
    interruptSession: vi.fn(),
    getSession: vi.fn(),
    getPendingForStage: vi.fn().mockReturnValue([]),
    isSessionBusy: vi.fn().mockReturnValue(false),
    on: vi.fn(),
  };
}

describe('Interaction routes', () => {
  let app: ReturnType<typeof Fastify>;
  let orchestratorClient: ReturnType<typeof createMockOrchestratorClient>;

  beforeEach(async () => {
    app = Fastify();
    orchestratorClient = createMockOrchestratorClient();
    registerInteractionRoutes(app, orchestratorClient as any);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/sessions/:stageId/message', () => {
    it('returns 200 when session is idle', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/message',
        payload: { message: 'Fix the bug' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.sendMessage).toHaveBeenCalledWith('STAGE-A', 'Fix the bug');
    });

    it('returns 404 when no session exists', async () => {
      orchestratorClient.getSession.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-X/message',
        payload: { message: 'hello' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when message is empty', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/message',
        payload: { message: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/sessions/:stageId/approve', () => {
    it('returns 200 on successful approval', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'allow' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.approveTool).toHaveBeenCalledWith(
        'STAGE-A', 'req-001', 'allow', undefined,
      );
    });

    it('passes reason for deny decisions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'deny', reason: 'Unsafe' },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.approveTool).toHaveBeenCalledWith(
        'STAGE-A', 'req-001', 'deny', 'Unsafe',
      );
    });

    it('returns 400 for invalid decision', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/approve',
        payload: { requestId: 'req-001', decision: 'maybe' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/sessions/:stageId/answer', () => {
    it('returns 200 on successful answer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/answer',
        payload: { requestId: 'req-002', answers: { q1: 'yes' } },
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.answerQuestion).toHaveBeenCalledWith(
        'STAGE-A', 'req-002', { q1: 'yes' },
      );
    });
  });

  describe('POST /api/sessions/:stageId/interrupt', () => {
    it('returns 200 on interrupt', async () => {
      orchestratorClient.getSession.mockReturnValue({ status: 'active' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/STAGE-A/interrupt',
      });

      expect(res.statusCode).toBe(200);
      expect(orchestratorClient.interruptSession).toHaveBeenCalledWith('STAGE-A');
    });
  });

  describe('GET /api/sessions/:stageId/pending', () => {
    it('returns pending approvals/questions', async () => {
      orchestratorClient.getPendingForStage.mockReturnValue([
        { requestId: 'req-001', toolName: 'Bash', input: {}, stageId: 'STAGE-A', createdAt: 123 },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/STAGE-A/pending',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.pending).toHaveLength(1);
      expect(body.pending[0].requestId).toBe('req-001');
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/server/interaction-routes.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// tools/web-server/src/server/routes/interaction.ts
import type { FastifyInstance } from 'fastify';
import type { OrchestratorClient } from '../services/orchestrator-client.js';

/**
 * REST endpoints for bidirectional session interaction.
 *
 * These relay user actions from the browser to the orchestrator
 * via the WebSocket connection.
 */
export function registerInteractionRoutes(
  app: FastifyInstance,
  orchestratorClient: OrchestratorClient,
): void {

  // Send follow-up message to active session
  app.post<{
    Params: { stageId: string };
    Body: { message: string };
  }>('/api/sessions/:stageId/message', async (req, reply) => {
    const { stageId } = req.params;
    const { message } = req.body ?? {};

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return reply.status(400).send({ error: 'message is required' });
    }

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.sendMessage(stageId, message);
    return reply.status(200).send({ status: 'sent' });
  });

  // Approve or deny tool call
  app.post<{
    Params: { stageId: string };
    Body: { requestId: string; decision: string; reason?: string };
  }>('/api/sessions/:stageId/approve', async (req, reply) => {
    const { stageId } = req.params;
    const { requestId, decision, reason } = req.body ?? {};

    if (!requestId || typeof requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId is required' });
    }
    if (decision !== 'allow' && decision !== 'deny') {
      return reply.status(400).send({ error: 'decision must be "allow" or "deny"' });
    }

    orchestratorClient.approveTool(stageId, requestId, decision, reason);
    return reply.status(200).send({ status: 'ok' });
  });

  // Answer AskUserQuestion
  app.post<{
    Params: { stageId: string };
    Body: { requestId: string; answers: Record<string, string> };
  }>('/api/sessions/:stageId/answer', async (req, reply) => {
    const { stageId } = req.params;
    const { requestId, answers } = req.body ?? {};

    if (!requestId || typeof requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return reply.status(400).send({ error: 'answers is required' });
    }

    orchestratorClient.answerQuestion(stageId, requestId, answers);
    return reply.status(200).send({ status: 'ok' });
  });

  // Interrupt session
  app.post<{
    Params: { stageId: string };
  }>('/api/sessions/:stageId/interrupt', async (req, reply) => {
    const { stageId } = req.params;

    const session = orchestratorClient.getSession(stageId);
    if (!session) {
      return reply.status(404).send({ error: `No session for stage ${stageId}` });
    }

    orchestratorClient.interruptSession(stageId);
    return reply.status(200).send({ status: 'ok' });
  });

  // Get pending approvals/questions for a stage
  app.get<{
    Params: { stageId: string };
  }>('/api/sessions/:stageId/pending', async (req, reply) => {
    const { stageId } = req.params;
    const pending = orchestratorClient.getPendingForStage(stageId);
    return reply.status(200).send({ pending });
  });
}
```

Then register in `app.ts`:

```typescript
// In the route registration section of app.ts, add:
import { registerInteractionRoutes } from './routes/interaction.js';
// ... after orchestratorClient is created:
registerInteractionRoutes(app, orchestratorClient);
```

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/server/interaction-routes.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/server/routes/interaction.ts tools/web-server/src/server/app.ts \
        tools/web-server/tests/server/interaction-routes.test.ts
git commit -m "feat(web-server): add REST endpoints for session interaction (message, approve, answer, interrupt)"
```

---

## Task 8: Client-Side Interaction Store

**Files:**
- Create: `tools/web-server/src/client/store/interaction-store.ts`
- Create: `tools/web-server/src/client/api/interaction-hooks.ts`
- Test: `tools/web-server/tests/client/interaction-store.test.ts`

A Zustand store that tracks pending approvals, pending questions, and queued messages. Plus React hooks for the REST interactions and SSE event subscriptions.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/interaction-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useInteractionStore } from '../../src/client/store/interaction-store.js';

describe('interaction-store', () => {
  beforeEach(() => {
    useInteractionStore.getState().reset();
  });

  it('starts with no pending approvals', () => {
    const state = useInteractionStore.getState();
    expect(state.pendingApprovals).toEqual([]);
    expect(state.pendingQuestions).toEqual([]);
  });

  it('addApproval adds to pendingApprovals', () => {
    const store = useInteractionStore.getState();
    store.addApproval({
      stageId: 'STAGE-A',
      requestId: 'req-001',
      toolName: 'Bash',
      input: { command: 'ls' },
      createdAt: 123,
    });

    expect(useInteractionStore.getState().pendingApprovals).toHaveLength(1);
    expect(useInteractionStore.getState().pendingApprovals[0].requestId).toBe('req-001');
  });

  it('removeApproval removes by requestId', () => {
    const store = useInteractionStore.getState();
    store.addApproval({
      stageId: 'STAGE-A',
      requestId: 'req-001',
      toolName: 'Bash',
      input: {},
      createdAt: 123,
    });
    store.removeApproval('req-001');
    expect(useInteractionStore.getState().pendingApprovals).toHaveLength(0);
  });

  it('addQuestion adds to pendingQuestions', () => {
    const store = useInteractionStore.getState();
    store.addQuestion({
      stageId: 'STAGE-A',
      requestId: 'req-002',
      questions: [{ question: 'DB?' }],
      input: {},
      createdAt: 123,
    });
    expect(useInteractionStore.getState().pendingQuestions).toHaveLength(1);
  });

  it('getPendingForStage filters by stageId', () => {
    const store = useInteractionStore.getState();
    store.addApproval({ stageId: 'STAGE-A', requestId: 'r1', toolName: 'Bash', input: {}, createdAt: 1 });
    store.addApproval({ stageId: 'STAGE-B', requestId: 'r2', toolName: 'Read', input: {}, createdAt: 2 });

    const stageA = useInteractionStore.getState().getPendingCountForStage('STAGE-A');
    expect(stageA).toBe(1);
  });

  it('setQueuedMessage and clearQueuedMessage', () => {
    const store = useInteractionStore.getState();
    store.setQueuedMessage('STAGE-A', 'Fix this');
    expect(useInteractionStore.getState().queuedMessages.get('STAGE-A')).toBe('Fix this');

    store.clearQueuedMessage('STAGE-A');
    expect(useInteractionStore.getState().queuedMessages.has('STAGE-A')).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/interaction-store.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// tools/web-server/src/client/store/interaction-store.ts
import { create } from 'zustand';

export interface PendingApprovalUI {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PendingQuestionUI {
  stageId: string;
  requestId: string;
  questions: unknown[];
  input: unknown;
  createdAt: number;
}

interface InteractionState {
  pendingApprovals: PendingApprovalUI[];
  pendingQuestions: PendingQuestionUI[];
  queuedMessages: Map<string, string>; // stageId → message

  addApproval: (approval: PendingApprovalUI) => void;
  removeApproval: (requestId: string) => void;
  addQuestion: (question: PendingQuestionUI) => void;
  removeQuestion: (requestId: string) => void;
  setQueuedMessage: (stageId: string, message: string) => void;
  clearQueuedMessage: (stageId: string) => void;
  getPendingCountForStage: (stageId: string) => number;
  reset: () => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  pendingApprovals: [],
  pendingQuestions: [],
  queuedMessages: new Map(),

  addApproval: (approval) =>
    set((s) => ({ pendingApprovals: [...s.pendingApprovals, approval] })),

  removeApproval: (requestId) =>
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.requestId !== requestId) })),

  addQuestion: (question) =>
    set((s) => ({ pendingQuestions: [...s.pendingQuestions, question] })),

  removeQuestion: (requestId) =>
    set((s) => ({ pendingQuestions: s.pendingQuestions.filter((q) => q.requestId !== requestId) })),

  setQueuedMessage: (stageId, message) =>
    set((s) => {
      const next = new Map(s.queuedMessages);
      next.set(stageId, message);
      return { queuedMessages: next };
    }),

  clearQueuedMessage: (stageId) =>
    set((s) => {
      const next = new Map(s.queuedMessages);
      next.delete(stageId);
      return { queuedMessages: next };
    }),

  getPendingCountForStage: (stageId) => {
    const s = get();
    return (
      s.pendingApprovals.filter((a) => a.stageId === stageId).length +
      s.pendingQuestions.filter((q) => q.stageId === stageId).length
    );
  },

  reset: () =>
    set({
      pendingApprovals: [],
      pendingQuestions: [],
      queuedMessages: new Map(),
    }),
}));
```

Then create the interaction hooks:

```typescript
// tools/web-server/src/client/api/interaction-hooks.ts
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client.js';
import { useSSE } from './use-sse.js';
import { useInteractionStore } from '../store/interaction-store.js';
import { useCallback } from 'react';

// ── Mutations ─────────────────────────────────────────────

export function useSendMessage(stageId: string) {
  return useMutation({
    mutationFn: async (message: string) => {
      const res = await apiFetch(`/api/sessions/${stageId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      return res.json();
    },
  });
}

export function useApproveToolCall(stageId: string) {
  return useMutation({
    mutationFn: async (params: { requestId: string; decision: 'allow' | 'deny'; reason?: string }) => {
      const res = await apiFetch(`/api/sessions/${stageId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return res.json();
    },
  });
}

export function useAnswerQuestion(stageId: string) {
  return useMutation({
    mutationFn: async (params: { requestId: string; answers: Record<string, string> }) => {
      const res = await apiFetch(`/api/sessions/${stageId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return res.json();
    },
  });
}

export function useInterruptSession(stageId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/sessions/${stageId}/interrupt`, {
        method: 'POST',
      });
      return res.json();
    },
  });
}

// ── SSE subscription ──────────────────────────────────────

export function useInteractionSSE() {
  const store = useInteractionStore();

  const handler = useCallback(
    (event: string, data: unknown) => {
      const payload = data as Record<string, unknown>;
      switch (event) {
        case 'approval-requested':
          store.addApproval(payload as any);
          break;
        case 'question-requested':
          store.addQuestion(payload as any);
          break;
        case 'approval-cancelled':
          store.removeApproval((payload as any).requestId);
          break;
        case 'approval-resolved':
          store.removeApproval((payload as any).requestId);
          break;
        case 'message-queued':
          store.setQueuedMessage((payload as any).stageId, (payload as any).message);
          break;
        case 'message-sent':
          store.clearQueuedMessage((payload as any).stageId);
          break;
      }
    },
    [store],
  );

  useSSE(
    ['approval-requested', 'question-requested', 'approval-cancelled', 'approval-resolved', 'message-queued', 'message-sent'],
    handler,
  );
}
```

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/client/interaction-store.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/client/store/interaction-store.ts \
        tools/web-server/src/client/api/interaction-hooks.ts \
        tools/web-server/tests/client/interaction-store.test.ts
git commit -m "feat(web-server): add interaction store and hooks for approval/message/question UI state"
```

---

## Task 9: MessageInput Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/MessageInput.tsx`
- Test: `tools/web-server/tests/client/message-input.test.ts`

A text input at the bottom of the session detail view that lets users send follow-up messages to Claude. Disabled when no active session exists. Shows "Message queued" indicator when Claude is busy.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/message-input.test.ts
import { describe, it, expect } from 'vitest';
// Verify the component exports the expected interface
import type { MessageInputProps } from '../../src/client/components/chat/MessageInput.js';

describe('MessageInput', () => {
  it('exports MessageInputProps type', () => {
    // Type-level test: MessageInputProps should exist with expected fields
    const props: MessageInputProps = {
      stageId: 'STAGE-001',
      disabled: false,
      queuedMessage: undefined,
    };
    expect(props.stageId).toBe('STAGE-001');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/message-input.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```tsx
// tools/web-server/src/client/components/chat/MessageInput.tsx
import { useState, useCallback, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useSendMessage } from '../../api/interaction-hooks.js';

export interface MessageInputProps {
  stageId: string;
  disabled?: boolean;
  queuedMessage?: string;
}

export function MessageInput({ stageId, disabled, queuedMessage }: MessageInputProps) {
  const [text, setText] = useState('');
  const sendMutation = useSendMessage(stageId);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    sendMutation.mutate(trimmed);
    setText('');
  }, [text, disabled, sendMutation]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-zinc-700 bg-zinc-900 p-3">
      {queuedMessage && (
        <div className="mb-2 rounded bg-yellow-900/30 px-3 py-1.5 text-xs text-yellow-300">
          Message queued: &quot;{queuedMessage}&quot;
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'No active session' : 'Send a follow-up message...'}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim() || sendMutation.isPending}
          className="rounded bg-blue-600 p-2 text-white hover:bg-blue-500 disabled:opacity-50"
          title="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
```

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/client/message-input.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/client/components/chat/MessageInput.tsx \
        tools/web-server/tests/client/message-input.test.ts
git commit -m "feat(web-server): add MessageInput component for sending follow-up messages"
```

---

## Task 10: ApprovalDialog Component

**Files:**
- Create: `tools/web-server/src/client/components/interaction/ApprovalDialog.tsx`
- Test: `tools/web-server/tests/client/approval-dialog.test.ts`

A modal overlay that appears when an `approval-requested` SSE event fires. Displays tool name, input parameters (formatted JSON), and Allow/Deny buttons with optional deny reason input.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/approval-dialog.test.ts
import { describe, it, expect } from 'vitest';
import type { ApprovalDialogProps } from '../../src/client/components/interaction/ApprovalDialog.js';

describe('ApprovalDialog', () => {
  it('exports ApprovalDialogProps type', () => {
    const props: ApprovalDialogProps = {
      stageId: 'STAGE-001',
      requestId: 'req-001',
      toolName: 'Bash',
      input: { command: 'npm test' },
      onClose: () => {},
    };
    expect(props.toolName).toBe('Bash');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/approval-dialog.test.ts`
Expected: FAIL

### Step 3: Write minimal implementation

```tsx
// tools/web-server/src/client/components/interaction/ApprovalDialog.tsx
import { useState, useCallback } from 'react';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { useApproveToolCall } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

export interface ApprovalDialogProps {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  onClose: () => void;
}

export function ApprovalDialog({ stageId, requestId, toolName, input, onClose }: ApprovalDialogProps) {
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const approveMutation = useApproveToolCall(stageId);
  const removeApproval = useInteractionStore((s) => s.removeApproval);

  const handleAllow = useCallback(() => {
    approveMutation.mutate({ requestId, decision: 'allow' });
    removeApproval(requestId);
    onClose();
  }, [requestId, approveMutation, removeApproval, onClose]);

  const handleDeny = useCallback(() => {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    approveMutation.mutate({ requestId, decision: 'deny', reason: reason || undefined });
    removeApproval(requestId);
    onClose();
  }, [requestId, reason, showReason, approveMutation, removeApproval, onClose]);

  const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="border-b border-zinc-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">
            Tool Approval Required
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            Stage: {stageId}
          </p>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs font-mono text-zinc-200">
              {toolName}
            </span>
          </div>
          <pre className="max-h-60 overflow-auto rounded bg-zinc-800 p-3 text-xs text-zinc-300">
            {inputStr}
          </pre>

          {showReason && (
            <div className="mt-3">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for denial (optional)"
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleDeny}
            disabled={approveMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-50"
          >
            <ShieldX size={14} />
            Deny
          </button>
          <button
            onClick={handleAllow}
            disabled={approveMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-50"
          >
            <ShieldCheck size={14} />
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/client/approval-dialog.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/client/components/interaction/ApprovalDialog.tsx \
        tools/web-server/tests/client/approval-dialog.test.ts
git commit -m "feat(web-server): add ApprovalDialog component for tool permission requests"
```

---

## Task 11: QuestionAnswerForm Component

**Files:**
- Create: `tools/web-server/src/client/components/interaction/QuestionAnswerForm.tsx`
- Test: `tools/web-server/tests/client/question-answer-form.test.ts`

A modal overlay for `question-requested` events. Renders the AskUserQuestion format: question text, option buttons, "Other" text input, multi-select support.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/question-answer-form.test.ts
import { describe, it, expect } from 'vitest';
import type { QuestionAnswerFormProps } from '../../src/client/components/interaction/QuestionAnswerForm.js';

describe('QuestionAnswerForm', () => {
  it('exports QuestionAnswerFormProps type', () => {
    const props: QuestionAnswerFormProps = {
      stageId: 'STAGE-001',
      requestId: 'req-002',
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [
            { label: 'Postgres', description: 'Relational' },
            { label: 'MongoDB', description: 'Document' },
          ],
          multiSelect: false,
        },
      ],
      onClose: () => {},
    };
    expect(props.questions).toHaveLength(1);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/question-answer-form.test.ts`
Expected: FAIL

### Step 3: Write minimal implementation

```tsx
// tools/web-server/src/client/components/interaction/QuestionAnswerForm.tsx
import { useState, useCallback } from 'react';
import { MessageSquare, Check } from 'lucide-react';
import { useAnswerQuestion } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionDef {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswerFormProps {
  stageId: string;
  requestId: string;
  questions: QuestionDef[];
  onClose: () => void;
}

export function QuestionAnswerForm({ stageId, requestId, questions, onClose }: QuestionAnswerFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const answerMutation = useAnswerQuestion(stageId);
  const removeQuestion = useInteractionStore((s) => s.removeQuestion);

  const handleOptionSelect = useCallback((questionText: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [questionText]: label }));
  }, []);

  const handleOtherChange = useCallback((questionText: string, value: string) => {
    setOtherInputs((prev) => ({ ...prev, [questionText]: value }));
    setAnswers((prev) => ({ ...prev, [questionText]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    answerMutation.mutate({ requestId, answers });
    removeQuestion(requestId);
    onClose();
  }, [requestId, answers, answerMutation, removeQuestion, onClose]);

  const allAnswered = questions.every((q) => answers[q.question]?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="border-b border-zinc-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <MessageSquare size={16} />
            Question from Claude
          </h3>
          <p className="mt-1 text-xs text-zinc-400">Stage: {stageId}</p>
        </div>

        <div className="max-h-96 overflow-auto px-4 py-3 space-y-4">
          {questions.map((q) => (
            <div key={q.question}>
              {q.header && (
                <span className="mb-1 inline-block rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                  {q.header}
                </span>
              )}
              <p className="mb-2 text-sm text-zinc-200">{q.question}</p>

              {q.options && (
                <div className="space-y-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleOptionSelect(q.question, opt.label)}
                      className={`flex w-full items-start gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                        answers[q.question] === opt.label
                          ? 'border-blue-500 bg-blue-900/30 text-blue-200'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      <span className="mt-0.5 flex-shrink-0">
                        {answers[q.question] === opt.label ? (
                          <Check size={14} className="text-blue-400" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border border-zinc-600" />
                        )}
                      </span>
                      <div>
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <p className="mt-0.5 text-xs text-zinc-400">{opt.description}</p>
                        )}
                      </div>
                    </button>
                  ))}

                  {/* "Other" free-text option */}
                  <div
                    className={`rounded border px-3 py-2 ${
                      otherInputs[q.question] !== undefined && answers[q.question] === otherInputs[q.question]
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-zinc-700 bg-zinc-800'
                    }`}
                  >
                    <input
                      type="text"
                      value={otherInputs[q.question] ?? ''}
                      onChange={(e) => handleOtherChange(q.question, e.target.value)}
                      onFocus={() => handleOtherChange(q.question, otherInputs[q.question] ?? '')}
                      placeholder="Other..."
                      className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Text-only question (no options) */}
              {!q.options && (
                <input
                  type="text"
                  value={answers[q.question] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  placeholder="Type your answer..."
                  className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || answerMutation.isPending}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Submit Answers
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/client/question-answer-form.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/client/components/interaction/QuestionAnswerForm.tsx \
        tools/web-server/tests/client/question-answer-form.test.ts
git commit -m "feat(web-server): add QuestionAnswerForm component for AskUserQuestion prompts"
```

---

## Task 12: Pending Approval Indicators

**Files:**
- Create: `tools/web-server/src/client/components/interaction/PendingBadge.tsx`
- Modify: `tools/web-server/src/client/components/board/BoardCard.tsx` (add badge)
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx` (add bell icon)
- Test: `tools/web-server/tests/client/pending-badge.test.ts`

A badge component that shows the pending approval count on stage cards, plus a bell icon in the session detail header.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/pending-badge.test.ts
import { describe, it, expect } from 'vitest';
import type { PendingBadgeProps } from '../../src/client/components/interaction/PendingBadge.js';

describe('PendingBadge', () => {
  it('exports PendingBadgeProps type', () => {
    const props: PendingBadgeProps = { count: 3 };
    expect(props.count).toBe(3);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/pending-badge.test.ts`
Expected: FAIL

### Step 3: Write minimal implementation

```tsx
// tools/web-server/src/client/components/interaction/PendingBadge.tsx
import { Bell } from 'lucide-react';

export interface PendingBadgeProps {
  count: number;
  variant?: 'badge' | 'bell';
}

export function PendingBadge({ count, variant = 'badge' }: PendingBadgeProps) {
  if (count === 0) return null;

  if (variant === 'bell') {
    return (
      <span className="relative inline-flex" title={`${count} pending approval(s)`}>
        <Bell size={16} className="text-yellow-400 animate-pulse" />
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-black">
          {count}
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-black"
      title={`${count} pending approval(s)`}
    >
      {count}
    </span>
  );
}
```

Then modify `BoardCard.tsx` and `SessionDetail.tsx` to import and render `PendingBadge` where stage cards display and where the session header shows. The implementing agent should:

- In `BoardCard.tsx`: import `useInteractionStore`, call `getPendingCountForStage(card.id)`, render `<PendingBadge count={count} />` next to the stage title if count > 0
- In `SessionDetail.tsx`: import `useInteractionStore`, calculate count for current stage, render `<PendingBadge count={count} variant="bell" />` in the header bar

### Step 4: Run test

Run: `cd tools/web-server && npx vitest run tests/client/pending-badge.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add tools/web-server/src/client/components/interaction/PendingBadge.tsx \
        tools/web-server/src/client/components/board/BoardCard.tsx \
        tools/web-server/src/client/pages/SessionDetail.tsx \
        tools/web-server/tests/client/pending-badge.test.ts
git commit -m "feat(web-server): add PendingBadge indicators for approval counts on cards and session header"
```

---

## Task 13: Integration Wiring

**Files:**
- Modify: `tools/web-server/src/server/app.ts` (SSE broadcast for interaction events)
- Modify: `tools/web-server/src/client/App.tsx` (mount interaction SSE listener)
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx` (mount MessageInput, dialogs)
- Create: `tools/web-server/src/client/components/interaction/InteractionOverlay.tsx`
- Test: `tools/web-server/tests/client/interaction-overlay.test.ts`

Wire everything together:

1. **Server app.ts**: When `OrchestratorClient` emits `approval-requested`, `question-requested`, `approval-cancelled` events, broadcast them as SSE events to the browser.
2. **Client App.tsx**: Mount `useInteractionSSE()` at the app root so interaction events are always captured regardless of which page the user is on.
3. **InteractionOverlay**: A component that reads `useInteractionStore` and renders `ApprovalDialog` / `QuestionAnswerForm` modals for the first pending item. Stacks if multiple.
4. **SessionDetail.tsx**: Add `MessageInput` at the bottom of the chat history, and render `InteractionOverlay`.

### Step 1: Write the failing test

```typescript
// tools/web-server/tests/client/interaction-overlay.test.ts
import { describe, it, expect } from 'vitest';

describe('InteractionOverlay', () => {
  it('module exports InteractionOverlay component', async () => {
    const mod = await import('../../src/client/components/interaction/InteractionOverlay.js');
    expect(mod.InteractionOverlay).toBeDefined();
    expect(typeof mod.InteractionOverlay).toBe('function');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd tools/web-server && npx vitest run tests/client/interaction-overlay.test.ts`
Expected: FAIL — module not found

### Step 3: Write implementation

```tsx
// tools/web-server/src/client/components/interaction/InteractionOverlay.tsx
import { useCallback } from 'react';
import { useInteractionStore } from '../../store/interaction-store.js';
import { ApprovalDialog } from './ApprovalDialog.js';
import { QuestionAnswerForm } from './QuestionAnswerForm.js';

/**
 * Renders approval/question modals from the interaction store.
 * Mounted at App root to catch events regardless of current page.
 * Shows the first pending item; once resolved, the next appears.
 */
export function InteractionOverlay() {
  const approvals = useInteractionStore((s) => s.pendingApprovals);
  const questions = useInteractionStore((s) => s.pendingQuestions);

  const firstApproval = approvals[0];
  const firstQuestion = questions[0];

  const noop = useCallback(() => {}, []);

  // Approvals take priority over questions
  if (firstApproval) {
    return (
      <ApprovalDialog
        stageId={firstApproval.stageId}
        requestId={firstApproval.requestId}
        toolName={firstApproval.toolName}
        input={firstApproval.input}
        onClose={noop}
      />
    );
  }

  if (firstQuestion) {
    return (
      <QuestionAnswerForm
        stageId={firstQuestion.stageId}
        requestId={firstQuestion.requestId}
        questions={firstQuestion.questions as any}
        onClose={noop}
      />
    );
  }

  return null;
}
```

**Modify `app.ts` (server):**

Add SSE broadcasts for interaction events from `orchestratorClient`:

```typescript
// In the event wiring section of app.ts, after existing orchestratorClient event handlers:
orchestratorClient.on('approval-requested', (data) => {
  broadcastEvent('approval-requested', data);
});
orchestratorClient.on('question-requested', (data) => {
  broadcastEvent('question-requested', data);
});
orchestratorClient.on('approval-cancelled', (data) => {
  broadcastEvent('approval-cancelled', data);
});
orchestratorClient.on('message-queued', (data) => {
  broadcastEvent('message-queued', data);
});
orchestratorClient.on('message-sent', (data) => {
  broadcastEvent('message-sent', data);
});
```

**Modify `App.tsx` (client):**

```typescript
// Import at top of App.tsx:
import { useInteractionSSE } from './api/interaction-hooks.js';
import { InteractionOverlay } from './components/interaction/InteractionOverlay.js';

// Inside the App component, before the router:
function App() {
  useInteractionSSE();

  return (
    <>
      <InteractionOverlay />
      {/* existing router and layout */}
    </>
  );
}
```

**Modify `SessionDetail.tsx`:**

```typescript
// Import MessageInput
import { MessageInput } from '../components/chat/MessageInput.js';
import { useInteractionStore } from '../store/interaction-store.js';

// Inside the component, after ChatHistory:
// Get queued message for this stage if any
const queuedMessage = useInteractionStore((s) => s.queuedMessages.get(stageId));
const isSessionActive = session?.isOngoing ?? false;

// Render after ChatHistory container:
<MessageInput
  stageId={stageId}
  disabled={!isSessionActive}
  queuedMessage={queuedMessage}
/>
```

### Step 4: Run tests

Run: `cd tools/web-server && npx vitest run tests/client/interaction-overlay.test.ts`
Expected: PASS

Also run full web-server test suite:
Run: `cd tools/web-server && npx vitest run`
Expected: All tests pass

### Step 5: Run full verification

Run: `cd tools/web-server && npm run verify`
Expected: Build, type-check, lint, and all tests pass

### Step 6: Commit

```bash
git add tools/web-server/src/server/app.ts \
        tools/web-server/src/client/App.tsx \
        tools/web-server/src/client/pages/SessionDetail.tsx \
        tools/web-server/src/client/components/interaction/InteractionOverlay.tsx \
        tools/web-server/tests/client/interaction-overlay.test.ts
git commit -m "feat(web-server): wire interaction overlay, SSE events, and message input into session detail"
```

---

## Final Verification

After all 13 tasks are complete:

1. Run full orchestrator tests: `cd tools/orchestrator && npx vitest run`
2. Run full web-server tests: `cd tools/web-server && npx vitest run`
3. Run verification: `npm run verify` (from repo root)
4. Manually verify the data flow:
   - Orchestrator spawns Claude with `--permission-prompt-tool=stdio`
   - ProtocolPeer relays stdin/stdout messages
   - ApprovalService queues requests and emits events
   - WebSocket server broadcasts to web server
   - Web server broadcasts via SSE to browser
   - Browser renders ApprovalDialog/QuestionAnswerForm
   - User decisions flow back: browser → REST → WebSocket → orchestrator → ProtocolPeer → Claude stdin

---

## Key Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ProtocolPeer as standalone class | Separate from SessionExecutor | Testable in isolation, can be mocked, reusable |
| ApprovalService implements ProtocolHandler | Direct plug into ProtocolPeer | No adapter layer needed, clean interface |
| MessageQueue latest-wins per stage | Overwrite, don't append | Matches vibe-kanban pattern; multiple queued messages would overwhelm on resume |
| Bidirectional WebSocket | Extend existing, don't add new | Already have WS infra from 10A; adding message types is cheaper than new connection |
| InteractionOverlay at App root | Not per-page | Approval dialogs must appear regardless of which page user is viewing |
| REST for user actions (not WebSocket) | POST endpoints | Simpler client code (fetch), proper HTTP status codes, easier error handling |
| SSE for events (not WebSocket) | Reuse existing EventSource | Browser already has SSE connection from 9G; adding events is free |
