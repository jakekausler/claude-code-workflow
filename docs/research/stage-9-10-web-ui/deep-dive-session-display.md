# Deep Dive: Displaying Claude Code Sessions in a Web Browser

## Executive Summary

Three open-source projects demonstrate different approaches to showing Claude Code session data in a web browser. They vary in data source (hooks vs. JSONL file watching vs. stdout capture), transport mechanism (WebSocket vs. SSE vs. polling), data transformation (entity merging, chunking, normalization), and rendering strategy (virtual scrolling, DOM virtualization, xterm.js). This document covers each in detail with code references.

---

## 1. claude-code-monitor

**Repository**: `/home/jakekausler/dev/localenv/claude-code-monitor`
**Architecture**: Primary-Secondary server model with hooks + transcript watching + WebSocket push to browser dashboard

### 1.1 Data Source: Hooks + Transcript Watching (Dual Ingest)

The monitor uses **two complementary ingest paths** to capture Claude Code session data:

#### Path A: Claude Code Hooks (Real-time, event-driven)

Claude Code supports lifecycle hooks that fire on specific events. The monitor installs a shell script as a hook handler for 11 event types:

**Hook types registered** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/cli/src/install.ts`, lines 24-36):
```typescript
const HOOK_TYPES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PermissionRequest',
  'Notification',
] as const;
```

Hooks are installed into `~/.claude/settings.json` with wildcard matchers (lines 193-221). Each hook type gets an entry like:
```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "/path/to/session-monitor.sh" }] }]
  }
}
```

The hook shell script (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/cli/templates/session-monitor.sh`) is extremely simple -- it reads the hook event from stdin, transforms it with `jq`, and fires a `curl` POST:

```bash
#!/bin/bash
event=$(cat)

# Transform hook format to internal format
transformed=$(echo "$event" | jq -c '{
  type: .hook_event_name,
  sessionId: .session_id,
  timestamp: (now | . as $t | ($t | floor) as $sec | (($t - $sec) * 1000 | floor) as $ms | $sec | strftime("%Y-%m-%dT%H:%M:%S") + "." + ($ms | tostring | ("000" + .)[-3:]) + "Z"),
  uuid: .uuid,
  data: .
}')

# POST to secondary server (fire-and-forget)
curl -X POST "{{SECONDARY_URL}}/api/events" \
  -H "Content-Type: application/json" \
  -d "$transformed" \
  --max-time 2 \
  --silent \
  --show-error \
  >/dev/null 2>&1 &

exit 0
```

Key design decisions:
- **Fire-and-forget**: The curl runs in background (`&`) so it never blocks Claude Code
- **2-second timeout**: Prevents hung connections from blocking hooks
- **URL template**: `{{SECONDARY_URL}}` is replaced during installation with the actual secondary server URL

#### Path B: Transcript JSONL Watching (Backfill, richer data)

Hooks provide real-time events but have limited data. The transcript watcher reads Claude Code's native JSONL session files for richer content (assistant text, token usage, model info).

**TranscriptWatcher** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/transcript-watcher.ts`, lines 16-68):
```typescript
export class TranscriptWatcher {
  private watcher: FSWatcher;
  private offsets: Map<string, number> = new Map();  // Track read position per file
  // ...
  constructor(watchPath: string, db: DatabaseManager, primaryClient: PrimaryClientLike) {
    this.watcher = chokidar.watch(watchPath, {
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      depth: 4,  // Catch subagent transcripts
      ignoreInitial: false,  // Process existing files on startup
    });
    // ...
  }
}
```

The watcher uses **offset-based incremental parsing** to only read new content (line 137-139):
```typescript
const currentOffset = this.offsets.get(filePath) ?? 0;
const fileContent = readFileSync(filePath, 'utf-8');
const contentFromOffset = fileContent.substring(currentOffset);
```

**TranscriptParser** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/transcript-parser.ts`) maps Claude's native record types to the monitor's internal event types (lines 19-23):
```typescript
const TYPE_MAPPING: Record<string, string> = {
  assistant: 'assistant_text',
  tool_use: 'pre_tool_use',
  tool_result: 'post_tool_use',
};
```

It also extracts token metadata and model info from the JSONL records.

The transcript file path encodes session and subagent identity (lines 184-212):
- Main: `~/.claude/projects/<project-slug>/<session-id>.jsonl`
- Subagent: `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.jsonl`

### 1.2 Data Storage

Events are stored in SQLite (via better-sqlite3) with two main tables:

**Session row** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/shared/types.ts`, lines 13-30):
```typescript
export interface SessionRow {
  id: string;
  machine_id: string;
  cwd: string | null;
  transcript_path: string | null;
  status: 'active' | 'waiting' | 'ended';
  waiting_state: string | null;  // JSON: {type, since}
  start_time: number;
  last_activity: number | null;
  git_branch: string | null;
  tokens: string | null;  // JSON: {input, output, cacheCreation, cacheRead}
  model: string | null;
  hidden: number;
  pinned: number;
}
```

**Event row** (lines 36-53):
```typescript
export interface EventRow {
  id?: number;
  session_id: string;
  timestamp: number;
  event_type: string;
  event_data: string;  // Full JSON blob
  source: 'hook' | 'transcript';
  subagent_id: string | null;
  event_uuid: string | null;  // For deduplication
  tokens_input: number | null;  // Cumulative odometer values
  tokens_output: number | null;
  tool_name: string | null;
  duration_ms: number | null;
}
```

**Deduplication**: Events from both hooks and transcript have UUID-based deduplication via `event_uuid` unique constraint. The UUID is generated from `(sessionId, timestamp, eventType, hookUuid)`.

**Timestamp precision enhancement** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/hook-receiver.ts`, lines 57-70): Claude Code hooks often provide second-level precision (`.000Z`). The monitor adds arrival-time milliseconds to break ties for events in the same second.

### 1.3 Architecture: Primary-Secondary Model

The system uses a two-tier architecture:

- **Secondary server**: Runs on each machine where Claude Code operates. Receives hook events via HTTP POST, watches transcript files, stores events in local SQLite. Connects to Primary via WebSocket.
- **Primary server**: Aggregates data from multiple Secondaries. Routes event queries to the correct Secondary. Serves the dashboard UI. Pushes session metadata to dashboards via WebSocket.

**Unified WebSocket Coordinator** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/unified-websocket-coordinator.ts`) handles all WebSocket upgrades on a single HTTP server, routing by path:
```typescript
server.on('upgrade', (req, socket, head) => {
  const path = req.url?.split('?')[0] || '';
  if (path === '/api/secondary' && this.secondaryHandler) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.secondaryHandler!(ws, req));
  } else if (path === '/api/dashboard' && this.dashboardHandler) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.dashboardHandler!(ws, req));
  } else {
    socket.destroy();
  }
});
```

### 1.4 Transport: WebSocket for Real-Time Updates

**Dashboard Hub** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/dashboard-hub.ts`) broadcasts session updates to all connected dashboard clients:

```typescript
broadcast(message: DashboardMessage) {
  const payload = JSON.stringify(message);
  this.clients.forEach(({ ws, id }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}
```

Message types include:
- `init`: Full session list on connect
- `session_update`: Session metadata changed
- `session_removed`: Session deleted
- `timeline_invalidation`: Events appended or inserted out-of-order

**Client-side WebSocket hook** (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/dashboard/src/hooks/useWebSocket.ts`) with exponential backoff reconnection:

```typescript
ws.onclose = (_event) => {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
  reconnectAttemptsRef.current++;
  reconnectTimeoutRef.current = setTimeout(() => connect(), delay);
};
```

### 1.5 Data Fetching Strategy: Tiered Loading

The dashboard uses a 4-tier loading system to minimize data transfer (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/dashboard/src/hooks/useFetchWindow.ts`):

- **T1**: Main-level events (metadata only, no full `event_data`) -- loaded when session selected
- **T2**: Full `event_data` for a single expanded main-level tool
- **T3**: Subagent child events (metadata only) -- loaded when subagent expanded
- **T4**: Full `event_data` for a single expanded subagent-level tool

```typescript
/** T1: Fetch main-level events */
const fetchMainEvents = useCallback(async (sessionId: string): Promise<void> => {
  const url = `${getPrimaryUrl()}/api/sessions/${sessionId}/events/main`;
  const response = await fetch(url);
  const data = await response.json();
  storeActionsRef.current.setMainEvents(sessionId, data.events as EventMetadata[]);
}, []);
```

**Real-time incremental updates**: Instead of refetching all events, the dashboard watches `eventCount` in session metadata. When it increases, it fetches only the latest events and appends them:

```typescript
// In ActivityTimeline.tsx, lines 151-165
useEffect(() => {
  if (sessionEventCount > prevEventCountRef.current && prevEventCountRef.current > 0) {
    fetchLatestTimeoutRef.current = setTimeout(() => {
      fetchLatestEvents(sessionId);
    }, 300);  // 300ms debounce
  }
  prevEventCountRef.current = sessionEventCount;
}, [sessionEventCount, sessionId, fetchLatestEvents]);
```

### 1.6 Data Transformation: Entity Merging

Raw events are transformed into higher-level entities for display (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/dashboard/src/utils/entityTransformer.ts`).

The `transformEventsToEntities` function (lines 130-302) performs a two-pass algorithm:

1. **First pass**: Collect all `subagent_start` and `pre_tool_use` events into maps keyed by agent_id/tool_use_id
2. **Second pass**: Match `subagent_stop`/`post_tool_use` events to their starts, creating `SubagentEntity` and `ToolEntity` objects
3. **Orphan handling**: Unpaired starts become "running" entities
4. **Post-processing**: Filter out `Task` ToolEntities that correspond to SubagentEntities (enriching the subagent with model/description metadata), and absorb skill content

The resulting `TimelineItem` union type (`EventMetadata | SubagentEntity | ToolEntity`) is sorted chronologically and rendered.

### 1.7 Rendering: Virtua Virtual Scrolling

The `ActivityTimeline` component (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/dashboard/src/components/ActivityTimeline.tsx`) uses the **Virtua** library (`VList` component) for virtual scrolling:

```tsx
<VList
  key={`vlist-${sessionId}`}
  ref={virtualizerRef}
  style={{ height: '100%', overflowAnchor: 'none' }}
  reverse={true}
  onScroll={handleScroll}
>
  {displayItems.map((item) => (
    <ActivityEvent key={getItemKey(item)} item={item} sessionId={sessionId} />
  ))}
</VList>
```

Key rendering optimizations:

- **Reference stabilization** (lines 22-82): `stabilizeItems()` reuses previous React object references when items haven't semantically changed, preventing Virtua from re-measuring unchanged items
- **Reverse mode**: `reverse={true}` means newest items are at the bottom (natural chat order)
- **Sticky headers**: When a subagent or tool is expanded and scrolled past, a sticky header appears at the top
- **Auto-scroll**: Tracks `isNearBottomRef` (within 100px of bottom) and auto-scrolls when new items arrive, but preserves scroll position if user scrolled up
- **Fallback mode**: If Virtua crashes (TimelineErrorBoundary), falls back to plain `<div>` rendering of last 100 items

The dashboard also has specialized tool renderers (`packages/dashboard/src/toolRenderers/renderers/`) for Bash, Read, Write, Edit, Grep, Glob, Playwright, etc., each rendering tool-specific content.

### 1.8 Subagent Correlation

A notable challenge: Claude Code hook events for tools (PreToolUse, PostToolUse) do not include which subagent they belong to. The monitor solves this by maintaining an **active subagent stack** per session (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/hook-receiver.ts`, lines 16-110):

```typescript
const activeSubagents = new Map<string, Array<{ agentId: string; startTime: number }>>();

function getCurrentSubagent(sessionId: string): { agentId: string; startTime: number } | null {
  const stack = activeSubagents.get(sessionId);
  if (stack && stack.length > 0) {
    return stack[stack.length - 1];
  }
  return null;
}
```

When a tool event arrives during an active subagent, the monitor assigns that subagent's ID to the tool event.

### 1.9 Caching

The event router on the Primary server uses an LRU cache for event query results (`/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/event-router.ts`, lines 66-73):

```typescript
const cached = timelineCache.get(cacheKey);
if (cached) {
  console.log(`[Cache HIT] ${cacheKey}`);
  res.json(cached);
  return;
}
```

Cache keys include session ID, direction, limit, and timestamp. Cache is invalidated when `events_added` or `events_inserted` messages arrive from Secondaries.

### 1.10 Latency Characteristics

- **Hook path**: Hook fires -> shell script runs -> curl POST -> Secondary receives -> DB insert -> push to Primary -> broadcast to dashboards -> client eventCount update -> 300ms debounce -> fetch latest. **Estimated end-to-end: 500ms-1.5s**
- **Transcript path**: File write -> chokidar detects (500ms stabilityThreshold) -> parse new lines -> DB insert -> push to Primary. **Estimated: 1-2s**

---

## 2. claude-devtools

**Repository**: `/home/jakekausler/dev/localenv/claude-devtools`
**Architecture**: Electron app (or standalone Fastify HTTP server) that reads Claude Code JSONL files directly and displays them with rich analysis UI

### 2.1 Data Source: Direct JSONL File Reading

claude-devtools reads Claude Code's native session files from `~/.claude/projects/`. No hooks are needed -- it works with the existing JSONL transcript files.

### 2.2 File Watching

**FileWatcher** (`/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/FileWatcher.ts`) is a sophisticated file watcher supporting both local and SSH modes:

**Local mode**: Uses Node.js `fs.watch` with recursive option (lines 271-279):
```typescript
this.projectsWatcher = fs.watch(
  this.projectsPath,
  { recursive: true },
  (eventType, filename) => {
    if (filename) this.handleProjectsChange(eventType, filename);
  }
);
```

**SSH mode**: Falls back to polling with 3-second intervals (lines 376-398):
```typescript
private startPollingMode(): void {
  const runPoll = (): void => {
    if (this.pollingInProgress) return;
    this.pollingInProgress = true;
    this.pollForChanges().finally(() => { this.pollingInProgress = false; });
  };
  runPoll();
  this.pollingTimer = setInterval(runPoll, FileWatcher.SSH_POLL_INTERVAL_MS);
}
```

**Catch-up scan** (lines 820-873): A periodic scan every 30 seconds catches any events missed by `fs.watch` (macOS FSEvents can coalesce/drop events).

**Incremental append parsing** (lines 708-763): For efficiency, the watcher tracks file sizes and only reads new bytes:
```typescript
private async parseAppendedMessages(filePath: string, startOffset: number): Promise<AppendedParseResult> {
  const stream = this.fsProvider.createReadStream(filePath, { start: startOffset, encoding: 'utf8' });
  // ... reads only new content, parses JSONL lines
}
```

**Debouncing**: File changes are debounced at 100ms to avoid processing rapid successive writes (lines 882-896).

### 2.3 Session Parsing

**SessionParser** (`/home/jakekausler/dev/localenv/claude-devtools/src/main/services/parsing/SessionParser.ts`) parses complete JSONL files into structured data:

```typescript
async parseSession(projectId: string, sessionId: string): Promise<ParsedSession> {
  const sessionPath = this.projectScanner.getSessionPath(projectId, sessionId);
  return this.parseSessionFile(sessionPath);
}
```

The `ParsedSession` includes messages grouped by type (user, assistant, system), separated sidechain messages, task calls, and metrics.

### 2.4 Data Transformation: Chunking

**ChunkBuilder** (`/home/jakekausler/dev/localenv/claude-devtools/src/main/services/analysis/ChunkBuilder.ts`) transforms parsed messages into visualization chunks using a 4-category classification:

```typescript
buildChunks(messages: ParsedMessage[], subagents: Process[] = []): EnhancedChunk[] {
  const mainMessages = messages.filter((m) => !m.isSidechain);
  const classified = classifyMessages(mainMessages);
  // Categories: user, ai, system, hardNoise, compact
  let aiBuffer: ParsedMessage[] = [];
  for (const { message, category } of classified) {
    switch (category) {
      case 'hardNoise': break;  // Skip
      case 'user':
        if (aiBuffer.length > 0) { chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages)); aiBuffer = []; }
        chunks.push(buildUserChunk(message));
        break;
      case 'ai':
        aiBuffer.push(message);
        break;
      // ...
    }
  }
}
```

This produces **UserChunks** (right-aligned), **AIChunks** (left-aligned, containing tool executions and subagent references), **SystemChunks**, and **CompactChunks**.

The ChunkBuilder also generates waterfall chart data showing tool and subagent execution timelines.

### 2.5 Transport: Dual Mode (IPC vs HTTP+SSE)

claude-devtools supports two deployment modes through an adapter pattern:

**Electron mode**: Uses Electron's IPC for renderer-to-main communication. IPC handlers are defined in `/home/jakekausler/dev/localenv/claude-devtools/src/main/ipc/`.

**Browser/standalone mode**: Uses HTTP (Fastify) for request-response and SSE for real-time events.

**SSE implementation** (`/home/jakekausler/dev/localenv/claude-devtools/src/main/http/events.ts`):
```typescript
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
    const timer = setInterval(() => { reply.raw.write(':ping\n\n'); }, 30_000);
    request.raw.on('close', () => { clearInterval(timer); clients.delete(reply); });
    await reply;
  });
}

export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.raw.write(payload); }
    catch { clients.delete(client); }
  }
}
```

**HttpAPIClient** (`/home/jakekausler/dev/localenv/claude-devtools/src/renderer/api/httpClient.ts`) implements the same `ElectronAPI` interface using HTTP+SSE instead of IPC:

```typescript
export class HttpAPIClient implements ElectronAPI {
  private eventSource: EventSource | null = null;

  private initEventSource(): void {
    this.eventSource = new EventSource(`${this.baseUrl}/api/events`);
  }

  private addEventListener(channel: string, callback: (...args: any[]) => void): () => void {
    this.eventSource?.addEventListener(channel, ((event: MessageEvent) => {
      const data = JSON.parse(event.data);
      const listeners = this.eventListeners.get(channel);
      listeners?.forEach((cb) => cb(data));
    }) as EventListener);
    // ...
  }

  // All API calls use fetch():
  getSessionDetail = (projectId, sessionId) =>
    this.get(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`);
}
```

Key insight: The HttpAPIClient includes a **date reviver** because Electron IPC preserves Date objects via structured clone, but JSON serialization turns them into strings.

### 2.6 HTTP API Endpoints

Session routes (`/home/jakekausler/dev/localenv/claude-devtools/src/main/http/sessions.ts`) include:
- `GET /api/projects/:projectId/sessions` -- List sessions
- `GET /api/projects/:projectId/sessions-paginated` -- Paginated sessions
- `GET /api/projects/:projectId/sessions/:sessionId` -- Full session detail (parsed + chunked)
- `GET /api/projects/:projectId/sessions/:sessionId/groups` -- Conversation groups
- `GET /api/projects/:projectId/sessions/:sessionId/waterfall` -- Waterfall chart data

Session detail fetching includes caching via `DataCache`:
```typescript
let sessionDetail = services.dataCache.get(cacheKey);
if (sessionDetail) return sessionDetail;
// Parse, resolve subagents, build chunks, cache, return
```

### 2.7 Rendering: Chat History with Virtual Scrolling

**ChatHistory** (`/home/jakekausler/dev/localenv/claude-devtools/src/renderer/components/chat/ChatHistory.tsx`) uses `@tanstack/react-virtual` for virtualization:

```typescript
const VIRTUALIZATION_THRESHOLD = 120;
const shouldVirtualize = (conversation?.items.length ?? 0) >= VIRTUALIZATION_THRESHOLD;

const rowVirtualizer = useVirtualizer({
  count: shouldVirtualize ? (conversation?.items.length ?? 0) : 0,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 260,  // Estimated chat item height
  overscan: 8,
  measureElement: (element) => element.getBoundingClientRect().height,
});
```

Key features:
- **Conditional virtualization**: Only virtualizes when item count exceeds 120
- **Auto-scroll with user preservation**: Tracks if user is near bottom; only auto-scrolls if they are
- **Search highlighting**: In-page search with `<mark>` elements and DOM-based fallback
- **Navigation coordination**: Deep-linking to specific turns, tools, and subagent traces
- **Per-tab state isolation**: Each tab maintains its own scroll position, expansion state, and search state
- **Context panel**: Shows accumulated context injections (system prompt, CLAUDE.md, etc.) with cost analysis

### 2.8 Rich Analysis Features

Beyond session display, claude-devtools provides:
- **Error detection**: `ErrorDetector` scans session files for errors and sends notifications
- **Subagent drill-down**: Full subagent transcript parsing with nested tool executions
- **Waterfall visualization**: Gantt-chart-style view of tool and subagent execution timelines
- **Session reports**: Cost analysis, quality metrics, friction detection
- **Git identity resolution**: Maps sessions to git identities
- **Search**: Full-text search across all sessions and projects

### 2.9 Latency Characteristics

- **File change to display**: `fs.watch` fires -> 100ms debounce -> file read -> parse -> cache invalidation -> SSE broadcast -> re-fetch. **Estimated: 200-500ms**
- **Full session load**: File read -> parse all JSONL -> classify + chunk -> render. **Depends on session size, typically 100ms-2s for large sessions**

---

## 3. vibe-kanban

**Repository**: `/home/jakekausler/dev/localenv/vibe-kanban`
**Architecture**: Rust backend (Axum) with React frontend; orchestrates coding agents and shows their output via WebSocket streams and xterm.js terminal

### 3.1 Data Source: Process Stdout/Stderr Capture

Unlike the other two tools that read session data after the fact, vibe-kanban **spawns and controls** coding agent processes. It captures their stdout/stderr in real time.

### 3.2 PTY Service

**PtyService** (`/home/jakekausler/dev/localenv/vibe-kanban/crates/local-deployment/src/pty.rs`) creates pseudo-terminal sessions using the `portable-pty` crate:

```rust
pub async fn create_session(
    &self,
    working_dir: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<(Uuid, mpsc::UnboundedReceiver<Vec<u8>>), PtyError> {
    let pty_pair = pty_system.openpty(PtySize { rows, cols, ... })?;
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Spawn shell in PTY
    let child = pty_pair.slave.spawn_command(cmd)?;

    // Reader thread pumps PTY output into mpsc channel
    let output_handle = thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => { output_tx.send(buf[..n].to_vec()); }
                Err(_) => break,
            }
        }
    });
    // ...
}
```

### 3.3 Transport: WebSocket for Terminal and Execution Logs

#### Terminal WebSocket

**Terminal route** (`/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/terminal.rs`) handles WebSocket connections for interactive terminals:

```rust
async fn handle_terminal_ws(socket: WebSocket, deployment: DeploymentImpl, working_dir: PathBuf, cols: u16, rows: u16) {
    let (session_id, mut output_rx) = deployment.pty().create_session(working_dir, cols, rows).await?;
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Output task: PTY -> base64 encode -> WebSocket
    let output_task = tokio::spawn(async move {
        while let Some(data) = output_rx.recv().await {
            let msg = TerminalMessage::Output { data: BASE64.encode(&data) };
            ws_sender.send(Message::Text(serde_json::to_string(&msg))).await;
        }
    });

    // Input loop: WebSocket -> base64 decode -> PTY
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match serde_json::from_str::<TerminalCommand>(&text) {
            TerminalCommand::Input { data } => { pty_service.write(session_id, &BASE64.decode(&data)).await; }
            TerminalCommand::Resize { cols, rows } => { pty_service.resize(session_id, cols, rows).await; }
        }
    }
}
```

The protocol uses JSON messages with base64-encoded data:
- `{ "type": "input", "data": "<base64>" }` (client -> server)
- `{ "type": "resize", "cols": N, "rows": N }` (client -> server)
- `{ "type": "output", "data": "<base64>" }` (server -> client)
- `{ "type": "error", "message": "..." }` (server -> client)

#### Execution Process Logs

**Execution processes** (`/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/execution_processes.rs`) provide two WebSocket endpoints for streaming coding agent output:

1. **Raw logs** (`/execution-processes/{id}/raw-logs/ws`): Converts stdout/stderr to JSON patches
```rust
async fn handle_raw_logs_ws(socket, deployment, exec_id) {
    let raw_stream = deployment.container().stream_raw_logs(&exec_id).await?;
    let mut stream = raw_stream.map_ok(move |m| match m {
        LogMsg::Stdout(content) => {
            let patch = ConversationPatch::add_stdout(index, content);
            LogMsg::JsonPatch(patch).to_ws_message_unchecked()
        }
        LogMsg::Stderr(content) => {
            let patch = ConversationPatch::add_stderr(index, content);
            LogMsg::JsonPatch(patch).to_ws_message_unchecked()
        }
        // ...
    });
}
```

2. **Normalized logs** (`/execution-processes/{id}/normalized-logs/ws`): Pre-normalized stream

3. **Session-scoped stream** (`/execution-processes/stream/session/ws`): All execution processes for a session

### 3.4 Message Store and SSE

**MsgStore** (`/home/jakekausler/dev/localenv/vibe-kanban/crates/utils/src/msg_store.rs`) is a ring-buffer message store (100MB limit) with broadcast channel:

```rust
pub struct MsgStore {
    inner: RwLock<Inner>,          // History ring buffer
    sender: broadcast::Sender<LogMsg>,  // Live broadcast channel
}

impl MsgStore {
    pub fn push(&self, msg: LogMsg) {
        let _ = self.sender.send(msg.clone());  // Live listeners
        // ... add to history ring buffer with eviction
    }

    pub fn history_plus_stream(&self) -> BoxStream<'static, Result<LogMsg, io::Error>> {
        let (history, rx) = (self.get_history(), self.get_receiver());
        let hist = futures::stream::iter(history.into_iter().map(Ok));
        let live = BroadcastStream::new(rx).filter_map(|res| async move { res.ok().map(Ok) });
        Box::pin(hist.chain(live))  // History first, then live stream
    }

    pub fn sse_stream(&self) -> BoxStream<'static, Result<Event, io::Error>> {
        self.history_plus_stream().map_ok(|m| m.to_sse_event()).boxed()
    }
}
```

**LogMsg types** (`/home/jakekausler/dev/localenv/vibe-kanban/crates/utils/src/log_msg.rs`):
```rust
pub enum LogMsg {
    Stdout(String),
    Stderr(String),
    JsonPatch(Patch),
    SessionId(String),
    MessageId(String),
    Ready,
    Finished,
}
```

Each LogMsg converts to SSE events with named event types (`stdout`, `stderr`, `json_patch`, etc.):
```rust
pub fn to_sse_event(&self) -> Event {
    match self {
        LogMsg::Stdout(s) => Event::default().event("stdout").data(s.clone()),
        LogMsg::Stderr(s) => Event::default().event("stderr").data(s.clone()),
        LogMsg::JsonPatch(patch) => Event::default().event("json_patch").data(serde_json::to_string(patch).unwrap()),
        // ...
    }
}
```

### 3.5 Frontend: xterm.js Terminal Rendering

**XTermInstance** (`/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/shared/components/XTermInstance.tsx`) creates xterm.js terminal instances:

```tsx
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 12,
  fontFamily: '"IBM Plex Mono", monospace',
  theme: getTerminalTheme(),
});
const fitAddon = new FitAddon();
const webLinksAddon = new WebLinksAddon();
terminal.loadAddon(fitAddon);
terminal.loadAddon(webLinksAddon);
terminal.open(containerRef.current);

// Connect WebSocket
createTerminalConnection(tabId, endpoint,
  (data) => terminal?.write(data),  // Server output -> terminal
  onClose
);

// Forward user input to WebSocket
terminal.onData((data) => {
  const conn = getTerminalConnection(tabId);
  conn?.send(data);
});
```

**TerminalProvider** (`/home/jakekausler/dev/localenv/vibe-kanban/packages/local-web/src/app/providers/TerminalProvider.tsx`) manages terminal lifecycle with:
- **Tab management**: Multiple terminal tabs per workspace
- **Connection persistence**: WebSocket connections stored in refs, persist across React remounts
- **Reconnection**: Exponential backoff (500ms, 1s, 2s, 4s, 8s) up to 6 retries
- **Base64 encoding**: All terminal I/O is base64-encoded for safe JSON transport

### 3.6 Latency Characteristics

- **Terminal I/O**: PTY -> mpsc channel -> WebSocket -> xterm.js. **Near-instantaneous, <50ms**
- **Execution logs**: Process stdout -> MsgStore broadcast -> WebSocket -> client. **Near-instantaneous**
- **History replay**: MsgStore history (ring buffer) + live stream. **History delivery is immediate on connect**

---

## Comparison Matrix

| Aspect | claude-code-monitor | claude-devtools | vibe-kanban |
|--------|-------------------|-----------------|-------------|
| **Data Source** | Hooks (stdin POST) + JSONL watching | JSONL file watching | Process stdout/stderr capture |
| **Requires Hooks?** | Yes (Claude Code settings.json) | No | No (spawns processes directly) |
| **Transport** | WebSocket (bidirectional) | SSE (server->client) + HTTP fetch | WebSocket (bidirectional) |
| **Data Storage** | SQLite (better-sqlite3) | In-memory cache + raw files | Ring buffer (MsgStore, 100MB) |
| **Rendering** | Virtua (VList) virtual scrolling | @tanstack/react-virtual | xterm.js terminal emulator |
| **Subagent Support** | Yes (stack-based correlation) | Yes (file path + process linking) | Yes (execution process hierarchy) |
| **Multi-machine** | Yes (Primary-Secondary model) | Yes (SSH file system provider) | Yes (via deployment abstraction) |
| **Real-time Latency** | 500ms-1.5s (hook path) | 200-500ms (file watch) | <50ms (direct capture) |
| **Session Format** | Custom events in SQLite | Native JSONL parsed in-process | Raw stdout/stderr + JSON patches |
| **Browser Deployment** | Standalone web dashboard | Electron or standalone Fastify | SPA with Axum backend |

---

## Key Patterns and Lessons

### 1. JSONL Is the Universal Session Format

Claude Code writes session transcripts as JSONL files at `~/.claude/projects/<project>/<session-id>.jsonl`. Both claude-code-monitor and claude-devtools parse these files. Key record types: `user`, `assistant`, `tool_use`, `tool_result`, `summary`, `progress`. Each line is a complete JSON object with `type`, `timestamp`, `message`, and optional `uuid` and `usage` fields.

### 2. Incremental File Parsing Is Essential

All file-based approaches use offset/size tracking to avoid re-reading entire files on every change:
- claude-code-monitor: Character offset (`fileContent.substring(currentOffset)`)
- claude-devtools: Byte offset with `createReadStream({ start: startOffset })`

### 3. WebSocket vs SSE Trade-offs

- **WebSocket** (claude-code-monitor, vibe-kanban): Bidirectional, lower overhead per message, requires explicit reconnection logic
- **SSE** (claude-devtools): Built-in browser reconnection, simpler protocol, one-directional, uses separate HTTP fetch for commands

### 4. Virtual Scrolling Is Non-Negotiable

Sessions can generate hundreds or thousands of events. Both claude-code-monitor (Virtua) and claude-devtools (@tanstack/react-virtual) use virtual scrolling. Key challenges:
- **Auto-scroll vs. manual reading**: Track "near bottom" state, only auto-scroll when user hasn't scrolled up
- **Dynamic item heights**: Items vary dramatically in size (user message vs. expanded tool output)
- **Reference stability**: Prevent re-measurement of unchanged items during incremental updates

### 5. Entity Merging Reduces Noise

Raw events are noisy (e.g., separate `pre_tool_use` and `post_tool_use` events). Both claude-code-monitor and claude-devtools merge these into higher-level entities:
- claude-code-monitor: `SubagentEntity` and `ToolEntity` with start/end matching
- claude-devtools: `Chunk` (UserChunk, AIChunk, SystemChunk) with message classification and process linking

### 6. The Adapter Pattern Enables Dual Deployment

claude-devtools demonstrates how to support both Electron (IPC) and browser (HTTP+SSE) deployment through a shared `ElectronAPI` interface. The `HttpAPIClient` implements the same interface using fetch/SSE, allowing the renderer to work identically in both contexts.

### 7. Base64 Encoding for Binary Safety

vibe-kanban base64-encodes all terminal I/O to safely transport binary/control characters through JSON WebSocket messages. This is essential for xterm.js compatibility with raw terminal output.

### 8. History + Live Stream Pattern

vibe-kanban's MsgStore provides the cleanest real-time pattern: `history_plus_stream()` returns historical events followed by a live stream, seamlessly handling late-connecting clients. This avoids the "missed events" problem entirely.
