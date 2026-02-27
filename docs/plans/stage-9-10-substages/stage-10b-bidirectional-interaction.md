# Stage 10B: Bidirectional Interaction

**Parent:** Stage 10 (Session Monitor Integration)
**Dependencies:** 10A (orchestrator communication channel)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Users can send messages, approve/deny tool calls, and answer AskUserQuestion prompts from the browser.

## What Ships

1. Orchestrator: ProtocolPeer for stdin/stdout stream-JSON communication
2. Orchestrator: Approval service with queuing
3. Web server: interaction REST endpoints
4. Browser: message input, approval dialog, question answer UI

## Orchestrator: ProtocolPeer

### Overview

Port vibe-kanban's Rust ProtocolPeer to TypeScript. This component wraps Claude Code's stdin/stdout when spawned with `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio`.

### Claude Code spawn flags

Modify the orchestrator's session spawn to add:
```
claude -p \
  --input-format=stream-json \
  --output-format=stream-json \
  --permission-prompt-tool=stdio \
  --verbose \
  --include-partial-messages \
  --resume <session-id>  # for follow-ups
```

**Reference:** `vibe-kanban/crates/executors/src/executors/claude.rs` lines 154, 171-177 for the flag setup. Lines 589-616 for piped stdin/stdout spawning.

### ProtocolPeer implementation

```typescript
// tools/orchestrator/src/protocol-peer.ts
class ProtocolPeer {
  private stdin: Writable;
  private readLoop: Promise<void>;
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(stdin: Writable, stdout: Readable, handler: ProtocolHandler) {
    this.stdin = stdin;
    this.readLoop = this.startReadLoop(stdout, handler);
  }

  // Send JSON line to Claude's stdin
  private async sendJson<T>(message: T): Promise<void> {
    const json = JSON.stringify(message);
    this.stdin.write(json + '\n');
  }

  // Public methods for sending to Claude
  async sendUserMessage(content: string): Promise<void> {
    await this.sendJson({ type: 'user', message: { role: 'user', content } });
  }

  async initialize(hooks?: unknown): Promise<void> {
    const requestId = uuid();
    await this.sendJson({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'initialize', hooks }
    });
  }

  async setPermissionMode(mode: string): Promise<void> { ... }
  async interrupt(): Promise<void> { ... }

  async sendHookResponse(requestId: string, response: PermissionResult): Promise<void> {
    await this.sendJson({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response }
    });
  }

  // Read loop processes Claude's stdout
  private async startReadLoop(stdout: Readable, handler: ProtocolHandler): Promise<void> {
    const rl = readline.createInterface({ input: stdout });
    for await (const line of rl) {
      const msg = JSON.parse(line) as CLIMessage;
      switch (msg.type) {
        case 'control_request':
          await handler.handleControlRequest(msg.request_id, msg.request);
          break;
        case 'result':
          handler.handleResult(msg);
          break;
      }
    }
  }
}
```

### Message types (from vibe-kanban)

**Outbound (to Claude stdin):**
- `{ type: 'user', message: { role: 'user', content: string } }` — User message
- `{ type: 'control_request', request_id, request: { subtype: 'initialize' | 'interrupt' | 'set_permission_mode' } }` — SDK commands
- `{ type: 'control_response', response: { subtype: 'success', request_id, response: PermissionResult } }` — Approval responses

**Inbound (from Claude stdout):**
- `{ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name, input, tool_use_id } }` — Tool approval request
- `{ type: 'control_request', request_id, request: { subtype: 'hook_callback', callback_id, input, tool_use_id } }` — Hook callback
- `{ type: 'control_cancel_request', request_id }` — Cancel pending request
- `{ type: 'result', ... }` — Session complete

**PermissionResult:**
```typescript
type PermissionResult =
  | { behavior: 'allow', updatedInput?: unknown }
  | { behavior: 'deny', message?: string };
```

**Reference:** `vibe-kanban/crates/executors/src/executors/claude/types.ts` for all type definitions. `vibe-kanban/crates/executors/src/executors/claude/protocol.rs` for the peer implementation.

## Orchestrator: Approval Service

### Overview

When Claude requests tool approval (CanUseTool), the orchestrator queues it and waits for the web UI to respond.

```typescript
class ApprovalService {
  private pending = new Map<string, PendingApproval>();

  // Called by ProtocolPeer when Claude asks for permission
  async createToolApproval(stageId: string, requestId: string, toolName: string, input: unknown): Promise<void> {
    const approval = { stageId, requestId, toolName, input, createdAt: new Date() };
    this.pending.set(requestId, approval);
    // Broadcast to web server via WebSocket
    this.broadcast({ type: 'approval_requested', ...approval });
  }

  // Called when web server relays user's decision
  async resolveApproval(requestId: string, decision: 'allow' | 'deny', reason?: string): Promise<PermissionResult> {
    const approval = this.pending.get(requestId);
    if (!approval) throw new Error('Unknown approval request');
    this.pending.delete(requestId);
    return decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: reason };
  }

  // Handle AskUserQuestion tool
  async createQuestionApproval(stageId: string, requestId: string, questions: unknown): Promise<void> {
    this.pending.set(requestId, { stageId, requestId, type: 'question', questions, createdAt: new Date() });
    this.broadcast({ type: 'question_requested', stageId, requestId, questions });
  }

  async resolveQuestion(requestId: string, answers: Record<string, string>): Promise<PermissionResult> {
    const approval = this.pending.get(requestId);
    this.pending.delete(requestId);
    // Inject answers into tool input
    return { behavior: 'allow', updatedInput: { ...approval.input, answers } };
  }
}
```

**Reference:** `vibe-kanban/crates/executors/src/executors/claude/client.rs` lines 60-231 for tool approval and question handling.

### Message queuing for follow-ups

When a user sends a follow-up while Claude is busy:

```typescript
class MessageQueue {
  private queued = new Map<string, QueuedMessage>();

  queue(stageId: string, message: string): void {
    this.queued.set(stageId, { message, queuedAt: new Date() });
  }

  take(stageId: string): QueuedMessage | undefined {
    const msg = this.queued.get(stageId);
    this.queued.delete(stageId);
    return msg;
  }
}
```

When the current session completes, check the queue. If a message is waiting, spawn a new Claude process with `--resume <sessionId>` and send the queued message.

**Reference:** `vibe-kanban/crates/server/src/routes/sessions/queue.rs`, `vibe-kanban/crates/local-deployment/src/container.rs` lines 549-580.

## Web Server: Interaction Endpoints

### REST endpoints

- `POST /api/sessions/:stageId/message` — Send follow-up message
  - Body: `{ message: string }`
  - Relays to orchestrator via WebSocket `send_message`
  - Returns 200 if sent, 202 if queued (Claude busy)

- `POST /api/sessions/:stageId/approve` — Approve/deny tool call
  - Body: `{ requestId: string, decision: 'allow' | 'deny', reason?: string }`
  - Relays to orchestrator via WebSocket `approve_tool`

- `POST /api/sessions/:stageId/answer` — Answer AskUserQuestion
  - Body: `{ requestId: string, answers: Record<string, string> }`
  - Relays to orchestrator via WebSocket `answer_question`

- `POST /api/sessions/:stageId/interrupt` — Interrupt session
  - Relays to orchestrator via WebSocket `interrupt`

- `GET /api/sessions/:stageId/pending` — Get pending approvals/questions
  - Returns list of pending approval/question requests for this stage

### SSE events for interaction

| Event | Trigger | Payload |
|-------|---------|---------|
| `approval-requested` | Claude asks for tool permission | `{ stageId, requestId, toolName, input }` |
| `question-requested` | Claude uses AskUserQuestion | `{ stageId, requestId, questions }` |
| `approval-resolved` | User approved/denied | `{ stageId, requestId, decision }` |

## Browser: Interaction UI

### Message input (in SessionDetail page)

- Text input at bottom of chat history
- Send button and Enter key to submit
- Disabled when no active session for this stage
- "Message queued" indicator when Claude is busy

### Approval dialog

- Modal/overlay that appears when `approval-requested` SSE event fires
- Shows: tool name, tool input parameters (formatted)
- Buttons: "Allow" (green) and "Deny" (red) with optional reason input
- Auto-dismiss on timeout (configurable, default: no timeout — wait forever)

### Question answer form

- Modal/overlay for `question-requested` events
- Renders the AskUserQuestion format: question text, option buttons, "Other" text input
- Support for multi-select questions
- Submit button sends answers

### Pending indicators

- Badge on stage card showing pending approval count
- Bell icon in session detail header when approvals are waiting

**Reference:** `vibe-kanban/packages/web-core/src/features/workspace-chat/model/hooks/useSessionSend.ts` for the send hook pattern. `vibe-kanban/packages/web-core/src/shared/hooks/useApprovals.ts` for the approval streaming pattern.

## Success Criteria

- Users can send follow-up messages that Claude receives and responds to
- Tool approval dialogs appear when Claude requests permission
- Approvals/denials flow back to Claude within 500ms
- AskUserQuestion answers are correctly injected into tool input
- Messages are queued when Claude is busy and consumed on completion
- Pending approvals survive page refresh (persisted in orchestrator state)
- Session detail shows the conversation updating in real-time as Claude works
