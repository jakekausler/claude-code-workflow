# Stage 10A: Orchestrator Communication

**Parent:** Stage 10 (Session Monitor Integration)
**Dependencies:** Stage 9 complete (web server exists)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

WebSocket communication channel between the web server and orchestrator, allowing the web server to know about running sessions and their status.

## What Ships

1. Orchestrator WebSocket server
2. Web server WebSocket client
3. Session process registry
4. Protocol messages

## Orchestrator Changes

### WebSocket Server

Add a lightweight WebSocket server to the orchestrator (`tools/orchestrator/`).

**Port:** 3101 (configurable via `ORCHESTRATOR_WS_PORT` env var)
**Library:** `ws` (already available in the project ecosystem)

The WebSocket server accepts connections from the web server and broadcasts session lifecycle events.

```typescript
// tools/orchestrator/src/ws-server.ts
const wss = new WebSocketServer({ port: ORCHESTRATOR_WS_PORT });

wss.on('connection', (ws) => {
  // Send current session registry snapshot on connect
  ws.send(JSON.stringify({ type: 'init', sessions: getActiveSessionsSnapshot() }));
});

function broadcast(message: OrchestratorMessage) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
```

### Session Process Registry

The orchestrator already tracks spawned sessions. Expose this as a structured registry:

```typescript
interface SessionRegistryEntry {
  stageId: string;          // e.g., STAGE-001-001-001
  sessionId: string;        // Claude Code session UUID
  processId: number;        // OS process ID
  worktreePath: string;     // Git worktree absolute path
  status: 'active' | 'waiting' | 'ended';
  waitingType?: 'user_input' | 'permission' | 'idle';
  spawnedAt: string;        // ISO timestamp
  lastActivity: string;     // ISO timestamp
}
```

### Protocol Messages (Orchestrator -> Web Server)

| Message | When | Payload |
|---------|------|---------|
| `init` | Web server connects | `{ sessions: SessionRegistryEntry[] }` |
| `session_registered` | New Claude session spawned | `{ entry: SessionRegistryEntry }` |
| `session_status` | Session status changes | `{ stageId, status, waitingType?, lastActivity }` |
| `session_ended` | Session exits (clean or crash) | `{ stageId, sessionId, exitReason, exitCode? }` |

### Protocol Messages (Web Server -> Orchestrator)

| Message | Purpose | Payload |
|---------|---------|---------|
| `send_message` | Follow-up message to session | `{ stageId, message: string }` |
| `approve_tool` | Approve/deny tool call | `{ stageId, requestId, decision: 'allow'|'deny', reason? }` |
| `answer_question` | Answer AskUserQuestion | `{ stageId, requestId, answers: Record<string,string> }` |
| `interrupt` | Interrupt running session | `{ stageId }` |

Note: The web server -> orchestrator messages are defined here but implemented in Stage 10B.

### Integration with existing orchestrator

The orchestrator's session spawning code (`tools/orchestrator/src/loop.ts`) already:
- Discovers stages via `kanban-cli next`
- Spawns Claude Code sessions
- Sets `session_active = true/false`
- Handles exit gates

**Additions:**
- After spawning: call `registry.register(stageId, sessionId, pid, worktreePath)` and `broadcast({ type: 'session_registered', ... })`
- On session exit: call `registry.unregister(stageId)` and `broadcast({ type: 'session_ended', ... })`
- On status change detection: `broadcast({ type: 'session_status', ... })`

Status changes can be detected from:
- The ProtocolPeer stdout messages (10B adds this)
- Falling back to JSONL file watching (check for `stop` entries indicating waiting state)

## Web Server Changes

### WebSocket Client

The web server connects to the orchestrator's WebSocket on startup:

```typescript
// tools/web-server/src/server/services/orchestrator-client.ts
class OrchestratorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionRegistry = new Map<string, SessionRegistryEntry>();

  connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => this.handleMessage(JSON.parse(data)));
    this.ws.on('close', () => this.scheduleReconnect());
  }

  private handleMessage(msg: OrchestratorMessage) {
    switch (msg.type) {
      case 'init':
        this.sessionRegistry = new Map(msg.sessions.map(s => [s.stageId, s]));
        break;
      case 'session_registered':
        this.sessionRegistry.set(msg.entry.stageId, msg.entry);
        this.emit('session-change', msg.entry);
        break;
      // ...
    }
  }

  getSession(stageId: string): SessionRegistryEntry | undefined {
    return this.sessionRegistry.get(stageId);
  }

  getAllSessions(): SessionRegistryEntry[] {
    return Array.from(this.sessionRegistry.values());
  }
}
```

**Reconnection:** Exponential backoff (1s -> 30s max), reset on success. Use `intentionalClose` guard.

**Reference:** claude-code-monitor `packages/server/src/secondary/primary-client.ts` for the reconnection pattern, `packages/dashboard/src/hooks/useWebSocket.ts` for the client-side pattern.

### New REST endpoints

- `GET /api/orchestrator/sessions` — Returns current session registry
- `GET /api/orchestrator/sessions/:stageId` — Returns single session entry

### SSE integration

Forward orchestrator events to browser via SSE:
```typescript
orchestratorClient.on('session-change', (entry) => {
  broadcastEvent('session-status', entry);
});
```

## Configuration

**Environment variables:**
- `ORCHESTRATOR_WS_PORT` (default: 3101) — Port for orchestrator WebSocket server
- `ORCHESTRATOR_WS_URL` (default: `ws://localhost:3101`) — URL web server connects to

**Graceful handling when orchestrator is not running:**
- Web server starts without orchestrator connection
- Session features show "Orchestrator not connected" state
- Reconnection attempts continue in background
- Board and session viewing (Stage 9 features) work independently

## Success Criteria

- Orchestrator broadcasts session lifecycle events via WebSocket
- Web server connects and maintains session registry mirror
- Registry stays in sync (register/unregister/status changes)
- Web server handles orchestrator disconnection gracefully
- Browser receives session status via SSE pipeline
- REST endpoints expose session registry data
