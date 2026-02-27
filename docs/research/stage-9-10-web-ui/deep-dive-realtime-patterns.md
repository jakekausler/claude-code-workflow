# Deep Dive: Real-Time Communication Patterns Across Repositories

This document analyzes the WebSocket, SSE, and event broadcasting patterns used across three repositories: **claude-code-monitor**, **claude-devtools**, and **vibe-kanban**. It includes actual code snippets, protocol details, and architectural patterns suitable for adoption.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [claude-code-monitor: WebSocket Protocol Deep Dive](#2-claude-code-monitor-websocket-protocol-deep-dive)
3. [claude-devtools: SSE Implementation Deep Dive](#3-claude-devtools-sse-implementation-deep-dive)
4. [vibe-kanban: Hybrid WebSocket + Electric SQL Deep Dive](#4-vibe-kanban-hybrid-websocket--electric-sql-deep-dive)
5. [Comparative Analysis: WebSocket vs SSE](#5-comparative-analysis-websocket-vs-sse)
6. [Answers to Specific Questions](#6-answers-to-specific-questions)
7. [Recommended Patterns for Adoption](#7-recommended-patterns-for-adoption)

---

## 1. Architecture Overview

### claude-code-monitor
```
[Claude Code Hooks] --> POST /api/events --> [Secondary Server (per-machine)]
                                                    |
                                              WebSocket (ws)
                                                    |
                                              [Primary Server] <-- WebSocket --> [Dashboard(s)]
                                                    |
                                              REST /api/sessions/:id/events (cached)
```
- **Primary/Secondary architecture** with WebSocket connections in both directions
- Two distinct WebSocket paths: `/api/secondary` (Secondary-to-Primary) and `/api/dashboard` (Dashboard-to-Primary)
- Unified WebSocket coordinator handles path-based routing on a single HTTP server
- REST API for event data retrieval with LRU caching at the Primary

### claude-devtools
```
[File System (fs.watch)] --> [FileWatcher] --> EventEmitter --> [HttpServer.broadcast()]
                                                                       |
                                                                   SSE stream
                                                                       |
                                                               [Browser/Renderer]
                                                                (EventSource API)
```
- **SSE (Server-Sent Events)** for server-to-client push
- HTTP REST for all request/response interactions
- FileWatcher uses Node `fs.watch()` with debouncing, or polling for SSH mode
- No bidirectional WebSocket -- SSE is one-way push only

### vibe-kanban
```
[Database changes] --> [MsgStore (broadcast channel)] --> [WebSocket streams]
                                                     --> [SSE streams]
[PTY sessions] ----> WebSocket (bidirectional terminal I/O)
[Electric SQL] ----> Shape streams (real-time sync via HTTP polling)
```
- **Three separate real-time mechanisms**: WebSocket for bidirectional data, SSE/WebSocket for JSON Patch streams, Electric SQL for database sync
- `MsgStore` acts as an in-process pub/sub with bounded history (100MB)
- Tokio `broadcast::channel` for fan-out to multiple subscribers

---

## 2. claude-code-monitor: WebSocket Protocol Deep Dive

### 2.1 Unified WebSocket Coordinator

The Primary server uses a single `WebSocketServer` in `noServer` mode, routing connections based on URL path:

```typescript
// /packages/server/src/primary/unified-websocket-coordinator.ts
export class UnifiedWebSocketCoordinator {
  private wss: WebSocketServer;
  private secondaryHandler: ((ws: WebSocket, req: any) => void) | null = null;
  private dashboardHandler: ((ws: WebSocket, req: any) => void) | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const path = req.url?.split('?')[0] || '';

      if (path === '/api/secondary' && this.secondaryHandler) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.secondaryHandler!(ws, req);
        });
      } else if (path === '/api/dashboard' && this.dashboardHandler) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.dashboardHandler!(ws, req);
        });
      } else {
        socket.destroy();  // Unknown paths are rejected
      }
    });
  }
}
```

**Key pattern**: `noServer` mode with manual `handleUpgrade` allows multiplexing multiple WebSocket "services" on a single HTTP server. Each path gets its own handler without needing separate ports.

### 2.2 Secondary-to-Primary Protocol

The Secondary connects to the Primary and sends a registration message, then streams session metadata and event notifications:

**Registration handshake:**
```json
// Secondary -> Primary
{
  "type": "register",
  "machineId": "laptop-abc123",
  "hostname": "jake-laptop",
  "apiUrl": "http://localhost:3202"
}

// Primary -> Secondary
{
  "type": "registered",
  "primaryId": "primary-a1b2c3d4"
}
```

**Session metadata updates (Secondary -> Primary):**
```json
{
  "type": "session_metadata",
  "sessionId": "abc-123",
  "machineId": "laptop-abc123",
  "status": "active",
  "eventCount": 42,
  "lastActivity": "2026-02-25T10:30:00.000Z",
  "waitingState": {
    "type": "user_input",
    "since": "2026-02-25T10:29:55.000Z"
  },
  "cwd": "/home/user/project",
  "gitBranch": "feat/my-feature",
  "tokens": { "input": 15000, "output": 3200, "cacheCreation": 500, "cacheRead": 12000 },
  "model": "claude-sonnet-4-20250514"
}
```

**Events appended notification (Secondary -> Primary):**
```json
{
  "type": "events_added",
  "sessionId": "abc-123",
  "newEventCount": 5,
  "latestTimestamp": "2026-02-25T10:31:00.000Z"
}
```

**Out-of-order events notification (Secondary -> Primary):**
```json
{
  "type": "events_inserted",
  "sessionId": "abc-123",
  "insertedAt": "2026-02-25T10:28:00.000Z",
  "count": 3,
  "affectedRange": {
    "start": "2026-02-25T10:27:00.000Z",
    "end": "2026-02-25T10:28:30.000Z"
  }
}
```

### 2.3 Primary-to-Dashboard Protocol

The Primary broadcasts to all connected dashboards:

**Initial state on connect:**
```json
{
  "type": "init",
  "sessions": [
    {
      "id": "abc-123",
      "machineId": "laptop-abc123",
      "status": "active",
      "eventCount": 42,
      "lastActivity": "2026-02-25T10:30:00.000Z"
    }
  ]
}
```

**Session update (broadcast):**
```json
{
  "type": "session_update",
  "session": {
    "id": "abc-123",
    "machineId": "laptop-abc123",
    "status": "active",
    "eventCount": 47,
    "lastActivity": "2026-02-25T10:31:00.000Z"
  }
}
```

**Timeline invalidation (broadcast):**
```json
{
  "type": "timeline_invalidation",
  "sessionId": "abc-123",
  "invalidationType": "appended",
  "latestTimestamp": "2026-02-25T10:31:00.000Z"
}

// Or for out-of-order insertions:
{
  "type": "timeline_invalidation",
  "sessionId": "abc-123",
  "invalidationType": "inserted",
  "affectedRange": {
    "start": "2026-02-25T10:27:00.000Z",
    "end": "2026-02-25T10:28:30.000Z"
  },
  "latestTimestamp": "2026-02-25T10:28:00.000Z"
}
```

### 2.4 Multiple Dashboard Handling

```typescript
// /packages/server/src/primary/dashboard-hub.ts
class DashboardHub {
  private clients: Map<string, DashboardClient> = new Map();

  broadcast(message: DashboardMessage) {
    const payload = JSON.stringify(message);  // Serialize once
    this.clients.forEach(({ ws, id }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else {
        console.warn(`Skipping closed WebSocket for ${id}`);
      }
    });
  }
}
```

**Pattern**: Serialize the message once, iterate and send. Skip closed connections (they will be cleaned up on the `close` event). Each client gets a unique ID (`dashboard-${Date.now()}-${random}`).

### 2.5 Reconnection Logic (Client Side)

```typescript
// /packages/dashboard/src/hooks/useWebSocket.ts
ws.onclose = (_event) => {
  if (isUnmountedRef.current) return;  // Don't reconnect if component unmounted
  setConnectionStatus('disconnected');
  wsRef.current = null;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
  reconnectAttemptsRef.current++;
  reconnectTimeoutRef.current = setTimeout(() => connect(), delay);
};

ws.onopen = () => {
  setConnectionStatus('connected');
  reconnectAttemptsRef.current = 0;  // Reset backoff on success
};
```

**Server-side (Secondary -> Primary):**
```typescript
// /packages/server/src/secondary/primary-client.ts
private scheduleReconnect(): void {
  if (this.intentionalClose) return;
  if (this.reconnectTimer) return;

  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
  this.reconnectAttempts++;
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    this.connect();
  }, delay);
}
```

**Key reconnection patterns**:
- Exponential backoff with cap (1s -> 2s -> 4s -> ... -> 30s max)
- Reset attempts on successful connection
- Guard against unmounted components (React StrictMode double-mount)
- `intentionalClose` flag to distinguish clean shutdown from network errors
- Single reconnect timer guard (prevent multiple pending reconnects)

### 2.6 Event Deduplication

Events are deduplicated at the database layer using UUID:

```typescript
// /packages/server/src/shared/types.ts
export interface EventRow {
  event_uuid: string | null;  // For deduplication
  // ...
}
```

On the client side, timeline events use ID-based dedup when appending:

```typescript
// /packages/dashboard/src/stores/sessionStore.ts
appendMainEvents: (sessionId, newEvents) =>
  set((state) => {
    const timeline = getOrCreateTimeline(state.timelines, sessionId);
    const existingIds = new Set(timeline.mainEvents.map(e => e.id));
    const uniqueNewEvents = newEvents.filter(e => !existingIds.has(e.id));

    if (uniqueNewEvents.length === 0) return state;

    const mergedEvents = [...timeline.mainEvents, ...uniqueNewEvents]
      .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
    // ...
  }),
```

### 2.7 Cache Architecture

The Primary server uses a size-bounded LRU cache for proxied event data:

```typescript
// /packages/server/src/primary/cache-instances.ts
export const timelineCache = new LRUCache<any>({ maxSize: 50_000_000 });  // 50MB
export const subagentCache = new LRUCache<any>({ maxSize: 20_000_000 });  // 20MB
export const toolCache = new LRUCache<any>({ maxSize: 10_000_000 });      // 10MB
```

Cache invalidation is targeted:
- `invalidate(sessionId)` -- removes all entries for a session (prefix-based)
- `invalidateRange(sessionId, startTs, endTs)` -- removes entries overlapping a timestamp range
- The cache uses a global access counter (not timestamps) for proper LRU ordering

```typescript
// LRU eviction selects the entry with the lowest access counter
private evictLRU(): void {
  let oldestKey: string | null = null;
  let oldestAccessTime = Infinity;
  for (const [key, entry] of this.cache.entries()) {
    if (entry.lastAccessedAt < oldestAccessTime) {
      oldestAccessTime = entry.lastAccessedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    this.currentSize -= this.cache.get(oldestKey)!.size;
    this.cache.delete(oldestKey);
  }
}
```

---

## 3. claude-devtools: SSE Implementation Deep Dive

### 3.1 Server-Side SSE

```typescript
// /src/main/http/events.ts
const KEEPALIVE_INTERVAL_MS = 30_000;
const clients = new Set<FastifyReply>();

export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    clients.add(reply);

    // Keep-alive ping every 30s
    const timer = setInterval(() => {
      reply.raw.write(':ping\n\n');  // SSE comment (not a real event)
    }, KEEPALIVE_INTERVAL_MS);

    request.raw.on('close', () => {
      clearInterval(timer);
      clients.delete(reply);
    });

    await reply;  // Prevent Fastify from ending the response
  });
}

export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.raw.write(payload);
    } catch {
      clients.delete(client);  // Remove broken clients
    }
  }
}
```

**SSE wire format examples:**
```
event: file-change
data: {"type":"change","path":"/home/user/.claude/projects/abc/session-123.jsonl","projectId":"abc","sessionId":"session-123","isSubagent":false}

event: notification:new
data: {"id":"notif-1","title":"Error detected","body":"Tool execution failed","sessionId":"session-123","severity":"error"}

event: todo-change
data: {"type":"change","path":"/home/user/.claude/todos/session-123.json","sessionId":"session-123","isSubagent":false}

:ping

```

### 3.2 Client-Side SSE (EventSource)

```typescript
// /src/renderer/api/httpClient.ts
export class HttpAPIClient implements ElectronAPI {
  private eventSource: EventSource | null = null;
  private eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  private initEventSource(): void {
    this.eventSource = new EventSource(`${this.baseUrl}/api/events`);
    this.eventSource.onopen = () => console.log('[HttpAPIClient] SSE connected');
    this.eventSource.onerror = () => {
      // Auto-reconnect is built into EventSource
      console.warn('[HttpAPIClient] SSE connection error, will reconnect...');
    };
  }

  private addEventListener(channel: string, callback: (...args: any[]) => void): () => void {
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set());
      // Register SSE listener for this channel once
      this.eventSource?.addEventListener(channel, ((event: MessageEvent) => {
        const data: unknown = JSON.parse(event.data as string);
        const listeners = this.eventListeners.get(channel);
        listeners?.forEach((cb) => cb(data));
      }) as EventListener);
    }
    this.eventListeners.get(channel)!.add(callback);

    return () => {
      this.eventListeners.get(channel)?.delete(callback);
    };
  }
}
```

**Key SSE advantages demonstrated here**:
- `EventSource` has built-in auto-reconnect (no manual reconnection code needed)
- Named events (`event: file-change`) allow multiplexing many channels on one connection
- Unsubscribe returns a cleanup function for React effect cleanup

### 3.3 FileWatcher with Debouncing

```typescript
// /src/main/services/infrastructure/FileWatcher.ts
const DEBOUNCE_MS = 100;
const CATCH_UP_INTERVAL_MS = 30_000;

private debounce(key: string, fn: () => void): void {
  const existingTimer = this.debounceTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    this.debounceTimers.delete(key);
    fn();
  }, DEBOUNCE_MS);
  this.debounceTimers.set(key, timer);
}
```

**Debouncing characteristics**:
- 100ms window per file (key-based debouncing)
- Trailing edge (fires after the last change in the window)
- Plus a 30s catch-up scan to detect missed `fs.watch` events (macOS FSEvents can coalesce/drop events)
- SSH mode uses 3s polling interval instead of `fs.watch`

**Incremental file processing** avoids re-parsing entire files:
```typescript
// Track file sizes for append-only optimization
private lastProcessedSize = new Map<string, number>();

const canUseIncrementalAppend = lastLineCount > 0 && currentSize > lastSize;
if (canUseIncrementalAppend) {
  // Only read from the last known position
  const stream = this.fsProvider.createReadStream(filePath, {
    start: startOffset,
    encoding: 'utf8',
  });
  // Parse only new lines...
}
```

### 3.4 Wiring FileWatcher to SSE

```typescript
// /src/main/standalone.ts
// Wire file watcher events to SSE broadcast
localContext.fileWatcher.on('file-change', (event: unknown) => {
  httpServer.broadcast('file-change', event);
});
localContext.fileWatcher.on('todo-change', (event: unknown) => {
  httpServer.broadcast('todo-change', event);
});

// Forward notification events to SSE
notificationManager.on('notification-new', (notification: unknown) => {
  httpServer.broadcast('notification:new', notification);
});
```

**Pattern**: EventEmitter -> SSE broadcast. The FileWatcher is a Node.js EventEmitter. Each `emit()` call triggers a broadcast to all connected SSE clients.

---

## 4. vibe-kanban: Hybrid WebSocket + Electric SQL Deep Dive

### 4.1 Terminal WebSocket (Bidirectional)

**Server (Rust/Axum):**
```rust
// /crates/server/src/routes/terminal.rs
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TerminalCommand {
    Input { data: String },       // Base64-encoded terminal input
    Resize { cols: u16, rows: u16 },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TerminalMessage {
    Output { data: String },      // Base64-encoded terminal output
    Error { message: String },
}

async fn handle_terminal_ws(socket: WebSocket, ...) {
    let (session_id, mut output_rx) = deployment.pty().create_session(working_dir, cols, rows).await?;
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // PTY output -> WebSocket (server to client)
    let output_task = tokio::spawn(async move {
        while let Some(data) = output_rx.recv().await {
            let msg = TerminalMessage::Output { data: BASE64.encode(&data) };
            let json = serde_json::to_string(&msg)?;
            ws_sender.send(Message::Text(json.into())).await?;
        }
    });

    // WebSocket -> PTY input (client to server)
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(cmd) = serde_json::from_str::<TerminalCommand>(&text) {
                    match cmd {
                        TerminalCommand::Input { data } => {
                            let bytes = BASE64.decode(&data)?;
                            pty_service.write(session_id, &bytes).await;
                        }
                        TerminalCommand::Resize { cols, rows } => {
                            pty_service.resize(session_id, cols, rows).await;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    deployment.pty().close_session(session_id).await;
    output_task.abort();
}
```

**Client (React/TypeScript):**
```typescript
// /packages/local-web/src/app/providers/TerminalProvider.tsx
const connectWebSocket = () => {
  const wsEndpoint = endpoint.replace(/^http/, 'ws');
  const ws = new WebSocket(wsEndpoint);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'output' && msg.data) {
      callbacks.onData(decodeBase64(msg.data));  // Write to xterm.js
    } else if (msg.type === 'exit') {
      callbacks.onExit?.();
    }
  };

  const send = (data: string) => {
    ws.send(JSON.stringify({ type: 'input', data: encodeBase64(data) }));
  };

  const resize = (cols: number, rows: number) => {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
};
```

**Terminal WebSocket wire format:**
```json
// Client -> Server
{"type": "input", "data": "bHM="}              // "ls" in base64
{"type": "resize", "cols": 120, "rows": 40}

// Server -> Client
{"type": "output", "data": "dG90YWwgOA=="}     // "total 8" in base64
{"type": "error", "message": "PTY session failed"}
```

**Terminal reconnection** uses exponential backoff with max retries:
```typescript
ws.onclose = (event) => {
  if (state.intentionallyClosed) return;
  if (event.code === 1000 && event.wasClean) return;  // Clean close

  // Exponential backoff: 500ms, 1s, 2s, 4s, 8s (max), up to 6 retries
  const maxRetries = 6;
  if (state.retryCount < maxRetries) {
    const delay = Math.min(8000, 500 * Math.pow(2, state.retryCount));
    state.retryCount += 1;
    state.retryTimer = setTimeout(connectWebSocket, delay);
  }
};
```

### 4.2 JSON Patch WebSocket Streams

vibe-kanban uses a sophisticated pattern where database changes are broadcast as JSON Patch (RFC 6902) operations over WebSocket:

**MsgStore -- the in-process pub/sub:**
```rust
// /crates/utils/src/msg_store.rs
pub struct MsgStore {
    inner: RwLock<Inner>,
    sender: broadcast::Sender<LogMsg>,
}

impl MsgStore {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(10000);  // 10k message buffer
        Self {
            inner: RwLock::new(Inner {
                history: VecDeque::with_capacity(32),
                total_bytes: 0,
            }),
            sender,
        }
    }

    pub fn push(&self, msg: LogMsg) {
        let _ = self.sender.send(msg.clone());  // Fan-out to all subscribers

        // Also store in history (bounded by 100MB)
        let bytes = msg.approx_bytes();
        let mut inner = self.inner.write().unwrap();
        while inner.total_bytes.saturating_add(bytes) > HISTORY_BYTES {
            if let Some(front) = inner.history.pop_front() {
                inner.total_bytes = inner.total_bytes.saturating_sub(front.bytes);
            } else {
                break;
            }
        }
        inner.history.push_back(StoredMsg { msg, bytes });
    }
}
```

**LogMsg -- dual SSE/WebSocket format:**
```rust
// /crates/utils/src/log_msg.rs
pub enum LogMsg {
    Stdout(String),
    Stderr(String),
    JsonPatch(Patch),    // RFC 6902 JSON Patch
    SessionId(String),
    MessageId(String),
    Ready,               // Initial snapshot complete
    Finished,            // Stream is done
}

impl LogMsg {
    pub fn to_sse_event(&self) -> Event {
        match self {
            LogMsg::JsonPatch(patch) => {
                let data = serde_json::to_string(patch).unwrap_or("[]".to_string());
                Event::default().event("json_patch").data(data)
            }
            // ...
        }
    }

    pub fn to_ws_message_unchecked(&self) -> Message {
        let json = match self {
            LogMsg::Ready => r#"{"Ready":true}"#.to_string(),
            LogMsg::Finished => r#"{"finished":true}"#.to_string(),
            _ => serde_json::to_string(self).unwrap_or(r#"{"error":"serialization_failed"}"#.to_string()),
        };
        Message::Text(json.into())
    }
}
```

**Stream initialization pattern** -- snapshot then live updates:
```rust
// /crates/services/src/services/events/streams.rs
pub async fn stream_execution_processes_for_session_raw(&self, session_id: Uuid, ...) {
    // 1. Get initial snapshot from database
    let processes = ExecutionProcess::find_by_session_id(&self.db.pool, session_id, ...).await?;

    // 2. Build initial JSON Patch (full replace)
    let initial_patch = json!([{
        "op": "replace",
        "path": "/execution_processes",
        "value": processes_map
    }]);
    let initial_msg = LogMsg::JsonPatch(serde_json::from_value(initial_patch).unwrap());

    // 3. Filter live broadcast stream for this session
    let filtered_stream = BroadcastStream::new(self.msg_store.get_receiver())
        .filter_map(move |msg_result| async move {
            match msg_result {
                Ok(LogMsg::JsonPatch(patch)) => {
                    if patch_matches_session(patch, session_id) {
                        Some(Ok(LogMsg::JsonPatch(patch)))
                    } else {
                        None
                    }
                }
                Ok(other) => Some(Ok(other)),
                Err(_) => None,  // Filter out broadcast lag errors
            }
        });

    // 4. Chain: initial snapshot -> Ready signal -> live updates
    let initial_stream = futures::stream::iter(vec![Ok(initial_msg), Ok(LogMsg::Ready)]);
    let combined_stream = initial_stream.chain(filtered_stream).boxed();
    Ok(combined_stream)
}
```

**WebSocket wire format for JSON Patch streams:**
```json
// Initial snapshot (server -> client)
{"JsonPatch": [{"op": "replace", "path": "/execution_processes", "value": {"uuid-1": {...}, "uuid-2": {...}}}]}

// Ready signal (initial data complete)
{"Ready": true}

// Live updates (server -> client, ongoing)
{"JsonPatch": [{"op": "add", "path": "/execution_processes/uuid-3", "value": {...}}]}
{"JsonPatch": [{"op": "replace", "path": "/execution_processes/uuid-1", "value": {...}}]}
{"JsonPatch": [{"op": "remove", "path": "/execution_processes/uuid-2"}]}

// Stream finished (server -> client)
{"finished": true}
```

**Client-side JSON Patch consumer:**
```typescript
// /packages/web-core/src/shared/hooks/useJsonPatchWsStream.ts
ws.onmessage = (event) => {
  const msg: WsMsg = JSON.parse(event.data);

  if ('JsonPatch' in msg) {
    const patches: Operation[] = msg.JsonPatch;
    const filtered = deduplicatePatches ? deduplicatePatches(patches) : patches;
    if (!filtered.length || !current) return;

    // Immer for structural sharing -- only modified parts get new references
    const next = produce(current, (draft) => {
      applyUpsertPatch(draft, filtered);
    });
    dataRef.current = next;
    setData(next);
  }

  if ('Ready' in msg) {
    setIsInitialized(true);
  }

  if ('finished' in msg) {
    finishedRef.current = true;
    ws.close(1000, 'finished');  // Clean close, no reconnect
  }
};
```

### 4.3 Electric SQL Sync

Electric SQL provides real-time database synchronization through HTTP shape streams:

```typescript
// /packages/web-core/src/shared/integrations/electric/hooks.ts
export function useShape<T>(shape: ShapeDefinition<T>, params: Record<string, string>, options?) {
  const collection = useMemo(() => {
    return createShapeCollection(shape, stableParams, config, mutation);
  }, [enabled, shape, mutation, handleError, retryKey, stableParams]);

  const { data, isLoading } = useLiveQuery(
    (query) => (collection ? query.from({ item: collection }) : undefined),
    [collection]
  );
}
```

**Hybrid sync with fallback:**
```typescript
// /packages/web-core/src/shared/lib/electric/collections.ts
// Electric SQL is the primary source, with automatic fallback to REST polling
function createHybridSync(args) {
  return (syncParams) => {
    const runtime = getOrCreateSourceRuntime(args.sourceKey);
    if (runtime.fallbackLocked) {
      return fallbackSync(syncParams);  // Use REST polling
    }

    // Start with Electric SQL
    let activeSync = normalizeSyncResult(args.electricSync(syncParams));

    // If Electric times out after 3s, switch to fallback
    globalThis.setTimeout(() => {
      if (!syncParams.collection.isReady()) {
        lockSourceToFallback(args.sourceKey);
      }
    }, ELECTRIC_READY_TIMEOUT_MS);
  };
}
```

**Key patterns from Electric SQL integration**:
- 3-second timeout for Electric SQL readiness, then falls back to REST polling
- Fallback mode polls every 30 seconds
- Per-source-key locking (if one collection fails, all collections for that table switch to fallback)
- Optimistic mutations with server reconciliation via transaction IDs

---

## 5. Comparative Analysis: WebSocket vs SSE

### When Each Repository Chose What (and Why)

| Feature | claude-code-monitor | claude-devtools | vibe-kanban |
|---------|-------------------|-----------------|-------------|
| **Primary protocol** | WebSocket | SSE | WebSocket + Electric SQL |
| **Bidirectional?** | Yes (needed for Secondary<->Primary) | No (one-way push only) | Yes (terminal, JSON Patch streams) |
| **Reconnection** | Manual exponential backoff | Built into EventSource | Manual with retry limit |
| **Serialization** | JSON | JSON | JSON + JSON Patch (RFC 6902) + Base64 (terminal) |
| **Multiple channels** | Separate message `type` field | Named SSE events | Separate WebSocket endpoints |
| **Client complexity** | Medium (manual reconnect, state management) | Low (EventSource auto-reconnect) | High (Immer patches, reconnect, clean close) |
| **Server complexity** | High (multi-tier hub architecture) | Low (Set of clients, broadcast) | High (broadcast channels, stream composition) |

### Tradeoffs Observed in Practice

**SSE (claude-devtools)**:
- Advantages: Built-in browser reconnection, simpler server code, works through HTTP proxies, named events for multiplexing
- Disadvantages: Server-to-client only, no binary support, connection limits (6 per domain in HTTP/1.1), no backpressure signal from client
- Best for: Notification-style pushes, file change events, status updates

**WebSocket (claude-code-monitor)**:
- Advantages: True bidirectional, lower latency, binary support, no connection limits
- Disadvantages: Requires manual reconnection, doesn't work through some HTTP proxies, more complex server code
- Best for: Server-to-server communication, interactive terminals, high-frequency data

**JSON Patch over WebSocket (vibe-kanban)**:
- Advantages: Efficient incremental updates, standard format (RFC 6902), structural sharing on client (Immer)
- Disadvantages: Complex to implement, requires initial snapshot + live stream composition
- Best for: Real-time database sync, collaborative editing, complex state trees

---

## 6. Answers to Specific Questions

### Q1: WebSocket vs SSE -- when to use each?

**Use SSE when**:
- Communication is server-to-client only (notifications, file changes, status updates)
- You want zero-config reconnection (built into EventSource)
- You need to go through HTTP proxies or CDNs
- You want named event channels without protocol overhead
- Implementation simplicity is valued (claude-devtools proves SSE can power a full dashboard)

**Use WebSocket when**:
- Communication must be bidirectional (terminals, server-to-server coordination)
- You need binary data (terminal I/O with base64 is a workaround)
- You need high-frequency low-latency messages
- You need server-to-server connections (SSE is browser-only)

### Q2: How should event broadcasting be scoped?

Three scoping strategies observed:

1. **Global broadcast** (claude-devtools SSE): All clients get all events. Simple, works when client count is small and events aren't session-specific. The client filters what it needs.

2. **Per-session filtering server-side** (vibe-kanban): Server filters the broadcast stream per-client based on session_id. Each WebSocket connection only gets events relevant to its subscription.

3. **Metadata broadcast + data pull** (claude-code-monitor): Broadcasts lightweight metadata (session_update) to all dashboards, then dashboards fetch full event data via REST when needed. This hybrid approach keeps WebSocket payloads small.

**Recommendation**: For a web view, use approach #3 (metadata push + data pull). Broadcast lightweight notifications about what changed, let clients decide when to fetch details. This naturally handles backpressure and scales to many sessions.

### Q3: How to handle reconnection gracefully without losing events?

**Pattern 1: Stateless reconnect with full resync** (claude-code-monitor dashboard)
```typescript
// On WebSocket connect, server sends full session list
ws.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', sessions: getAllSessions() }));
});
```
Simple but expensive. Works when state is small (session metadata).

**Pattern 2: EventSource auto-reconnect** (claude-devtools)
```typescript
// EventSource reconnects automatically, no code needed
this.eventSource = new EventSource(`${this.baseUrl}/api/events`);
// Last-Event-ID header enables missed event recovery (not used in this codebase)
```
The SSE spec supports `Last-Event-ID` for missed event recovery, though claude-devtools doesn't use it -- it relies on the FileWatcher re-emitting current state.

**Pattern 3: Snapshot + live stream** (vibe-kanban)
```rust
// Each new WebSocket connection gets: initial snapshot -> Ready -> live updates
let initial_stream = futures::stream::iter(vec![Ok(initial_msg), Ok(LogMsg::Ready)]);
let combined_stream = initial_stream.chain(filtered_stream).boxed();
```
On reconnect, the client gets a fresh snapshot, so no events are missed. The `Ready` signal tells the client when the snapshot is complete.

### Q4: How to handle event ordering and deduplication?

**Ordering**:
- claude-code-monitor: Events have timestamps. Client sorts by `timestamp` then `id` as tiebreaker.
- vibe-kanban: JSON Patches are applied in order received. The MsgStore broadcast channel preserves insertion order.
- claude-devtools: File change events are inherently unordered notifications; session data is re-parsed from the source file.

**Deduplication**:
- claude-code-monitor: `event_uuid` field in the database (INSERT OR IGNORE). Client-side `Set<id>` for appended events.
- vibe-kanban: `useJsonPatchWsStream` accepts a `deduplicatePatches` option for custom filtering. JSON Patch operations targeting the same path naturally overwrite.
- claude-devtools: Debouncing at the file watcher layer (100ms window per file) prevents duplicate events.

### Q5: What's the memory model for in-flight events on the server?

**claude-code-monitor**:
- Primary: LRU cache bounded by byte size (50MB timeline + 20MB subagent + 10MB tool = 80MB total)
- Secondary: SQLite database + file offsets map (no in-memory event buffering)
- Dashboard hub: Clients map only (messages are fire-and-forget)

**claude-devtools**:
- SSE clients Set (just connection references, no message buffering)
- DataCache for parsed session data (invalidated on file change)
- FileWatcher tracks per-file byte offsets for incremental parsing

**vibe-kanban**:
- `MsgStore`: `VecDeque<StoredMsg>` bounded to 100MB (FIFO eviction)
- `broadcast::channel(10000)`: 10k message tokio broadcast buffer
- If a subscriber falls behind, `BroadcastStream` returns `Lagged` errors which are filtered out (dropped)

### Q6: How to scale WebSocket connections for multi-user?

**Observed patterns**:

1. **Path-based routing** (claude-code-monitor): Single `WebSocketServer` with `noServer` mode, route by URL path. Different handlers for different client types.

2. **Per-session filtering** (vibe-kanban): Each WebSocket stream filters the global broadcast channel to only relevant events. The `BroadcastStream` creates independent receivers from a shared sender.

3. **Serialize once, send many** (claude-code-monitor):
   ```typescript
   const payload = JSON.stringify(message);  // Serialize once
   this.clients.forEach(({ ws }) => {
     if (ws.readyState === WebSocket.OPEN) ws.send(payload);
   });
   ```

4. **Connection health checks**: All three repos check `readyState === WebSocket.OPEN` before sending. Dead connections are cleaned up on the `close` event.

For truly large-scale: The current pattern (single-process fan-out) works for <100 concurrent connections. Beyond that, you'd need a message bus (Redis pub/sub) or dedicated WebSocket gateway.

### Q7: What message serialization format works best?

**All three repos use JSON exclusively**. Binary formats (protobuf, msgpack) are not used.

Rationale observed:
- JSON is debuggable with browser devtools
- JSON supports named fields (self-documenting)
- JSON is natively supported by EventSource and WebSocket browser APIs
- Terminal data uses base64 encoding within JSON for binary safety

**JSON Patch (RFC 6902)** in vibe-kanban is the most sophisticated serialization -- it provides efficient incremental updates with a standard specification:
```json
{"JsonPatch": [{"op": "replace", "path": "/workspaces/uuid-1", "value": {...}}]}
```

### Q8: How to handle backpressure when clients are slow?

**claude-code-monitor**: No explicit backpressure. The `ws.send()` call is fire-and-forget. The `ws` library buffers internally. If a client is too slow, the buffer grows until the OS TCP buffer fills and the connection errors out.

**claude-devtools**: SSE has no backpressure mechanism. `reply.raw.write()` returns false if the buffer is full (Node.js writable stream back-pressure), but the code doesn't check the return value. Broken writes cause the client to be removed from the Set via try/catch.

**vibe-kanban**: The tokio `broadcast::channel` has explicit backpressure -- when the 10k message buffer is full, the oldest messages are dropped and `BroadcastStream` receives `Lagged` errors. The server code filters these out:
```rust
let filtered_stream = BroadcastStream::new(self.msg_store.get_receiver())
    .filter_map(move |msg_result| async move {
        match msg_result {
            Ok(LogMsg::JsonPatch(patch)) => { /* process */ },
            Err(_) => None,  // <-- Lagged errors silently dropped
        }
    });
```

This is the most robust approach -- slow clients miss intermediate updates but get the next one that arrives. Combined with the initial snapshot pattern, clients can always recover by reconnecting.

---

## 7. Recommended Patterns for Adoption

### 7.1 For a Web View (Stage 9)

Based on the analysis, here are the recommended patterns:

**Architecture**: Use the claude-devtools SSE pattern for server-to-browser push, with REST for data fetching:
```
[FileWatcher / Event Source] --> EventEmitter --> SSE broadcast --> [Browser]
[Browser] --> REST API --> [Server] --> [Data Source]
```

**Why SSE over WebSocket for a web view**:
- Built-in reconnection (zero client code)
- Works through reverse proxies and CDNs
- Named events allow clean channel multiplexing
- No bidirectional need (the web view is read-only for monitoring)

### 7.2 Reconnection

Use EventSource (gets reconnection for free). If WebSocket is needed, use this pattern:
```typescript
function scheduleReconnect() {
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
  attempt++;
  reconnectTimer = setTimeout(connect, delay);
}

ws.onopen = () => { attempt = 0; };  // Reset on success
ws.onclose = (event) => {
  if (intentionalClose || (event.code === 1000 && event.wasClean)) return;
  scheduleReconnect();
};
```

### 7.3 Event Broadcasting

Use the hybrid approach from claude-code-monitor:
1. Broadcast lightweight metadata notifications via SSE/WebSocket
2. Let clients fetch full data via REST when they need it
3. Server-side cache with targeted invalidation

### 7.4 State Synchronization

For complex state, adopt vibe-kanban's JSON Patch pattern:
1. Initial full snapshot on connect
2. `Ready` signal when snapshot is complete
3. Incremental JSON Patch updates thereafter
4. Client uses Immer for efficient structural sharing

### 7.5 Memory Management

- Use bounded caches (LRU with byte-size limits, not item-count limits)
- Use bounded broadcast channels with lag tolerance
- Track and invalidate per-session, not global
- Debounce file system events (100ms is a good default)
