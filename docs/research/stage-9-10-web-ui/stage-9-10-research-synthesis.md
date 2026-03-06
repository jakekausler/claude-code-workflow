# Stage 9-10 Research Synthesis: Web UI & Session Monitor Integration

---

## Part 1: Executive Summary

Three open-source projects were analyzed in depth: **vibe-kanban** (a full kanban + coding agent orchestrator with Rust/React), **claude-code-monitor** (a distributed session monitoring system with hooks and WebSocket), and **claude-devtools** (an Electron/standalone JSONL analysis tool with rich session detail display). Together they cover every dimension of our Stage 9 and Stage 10 requirements: kanban board rendering, real-time session display, bidirectional interaction with Claude Code, full-detail tool/subagent visualization, and multi-user deployment.

**Key findings:** (1) Claude Code sessions can be monitored via two complementary data paths -- hooks for real-time events, and JSONL transcript file watching for rich content. (2) Bidirectional interaction with Claude Code is only possible through the `--input-format=stream-json --output-format=stream-json` stdin/stdout protocol; vibe-kanban is the only project that implements this, and our orchestrator already spawns processes similarly. (3) claude-devtools provides the most sophisticated full-detail display with 7-category context tracking, compaction-aware phases, and tiered cost calculation. (4) For multi-user deployment, vibe-kanban's trait-based deployment abstraction (design for local, swap for remote) is the proven pattern. (5) SSE is recommended for server-to-browser push (simpler, auto-reconnect), while WebSocket is needed specifically for terminal I/O and bidirectional session interaction.

**Key decision points:**
- Whether to use hooks, JSONL file watching, or both for session data capture
- Whether to build bidirectional interaction in Stage 10 or start with read-only monitoring
- Whether to adopt the chunking model (claude-devtools) or the event timeline model (claude-code-monitor) for display
- Whether to add multi-user abstractions in Stage 9 or defer entirely to a later stage
- Which virtual scrolling library to use (Virtua vs @tanstack/react-virtual)

---

## Part 2: How to Show Claude Sessions in the Browser

### Data Sources Available

There are three ways to capture Claude Code session data, each with different trade-offs:

**1. Claude Code Hooks (Real-time, event-driven)**

Claude Code supports lifecycle hooks configured in `~/.claude/settings.json`. A shell script receives JSON on stdin and can POST it to a server. claude-code-monitor registers 11 hook types:

```typescript
const HOOK_TYPES = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'PermissionRequest', 'Notification',
];
```

The hook script is fire-and-forget (background curl, 2s timeout, `exit 0` always). Hooks provide real-time status changes (session started, tool invoked, waiting for input) but contain limited data -- they don't include assistant response text or full tool outputs.

**2. JSONL Transcript File Watching (Rich data, slight delay)**

Claude Code writes append-only JSONL files at `~/.claude/projects/{project-slug}/{session-uuid}.jsonl`. Both claude-code-monitor and claude-devtools watch these files with incremental parsing (offset tracking to avoid re-reading). JSONL contains full assistant text, tool inputs/outputs, token usage, thinking blocks, and subagent data. File watching introduces 100-500ms latency due to filesystem event debouncing.

**3. Direct Process Control (Lowest latency, requires spawning)**

Vibe-kanban spawns Claude Code with `--input-format=stream-json --output-format=stream-json` and captures stdout directly. This gives near-instant (<50ms) access to all output but requires the system to have spawned the process. Since our orchestrator already spawns Claude sessions, this is available to us.

### Recommended Approach: Dual Ingest (Hooks + JSONL Watching) + Direct Capture

Use all three paths, prioritized by availability:

1. **For sessions spawned by our orchestrator**: Capture stdout directly via the stream-JSON protocol (lowest latency, richest data, enables interaction). The orchestrator already has process handles.

2. **For all sessions (including those spawned outside our system)**: Install hooks for real-time status tracking AND watch JSONL files for rich content. This is the claude-code-monitor pattern.

3. **Deduplication**: Use event UUIDs to prevent double-processing when the same event arrives via both hooks and transcript watching. claude-code-monitor uses a `UNIQUE(session_id, event_uuid)` constraint in SQLite.

### Transport: SSE for Dashboard, WebSocket for Interactive Features

**SSE (Server-Sent Events) for the main dashboard** -- recommended because:
- Built-in browser reconnection via `EventSource` (no manual backoff code)
- Works through reverse proxies and CDNs
- Named events allow multiplexing channels (`event: session-update`, `event: file-change`)
- Sufficient for one-way server-to-client push

From claude-devtools (`/src/main/http/events.ts`):
```typescript
export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.raw.write(payload); }
    catch { clients.delete(client); }
  }
}
```

**WebSocket for interactive features** (Stage 10):
- Terminal I/O (xterm.js requires bidirectional binary-safe transport)
- Session interaction (sending messages, approving tools)
- Use `noServer` mode with path-based routing to multiplex on a single HTTP server

### Rendering Strategy

**Virtual scrolling is mandatory.** Sessions can generate thousands of events. Both Virtua and @tanstack/react-virtual are proven:

| Library | Used By | Strengths |
|---------|---------|-----------|
| Virtua (VList) | claude-code-monitor | Handles 30K+ items, reverse mode, variable heights, tested at scale |
| @tanstack/react-virtual | claude-devtools | Conditional virtualization (skip for small lists), good React integration |

**Recommendation: Virtua.** claude-code-monitor demonstrates 30K+ events with <500 DOM elements, 60fps scrolling, and <50MB memory. Key rendering patterns to adopt:

- **Reference stabilization**: Reuse previous React object references for unchanged items to prevent re-measurement
- **Reverse mode**: `reverse={true}` for chat-like newest-at-bottom layout
- **Auto-scroll with preservation**: Track "near bottom" state (within 100px), auto-scroll only when user hasn't scrolled up
- **Debounced incremental fetching**: When `eventCount` increases, wait 300ms then fetch only latest events

**Tiered data loading** (from claude-code-monitor):
- T1: Main-level events (metadata only) -- loaded when session selected
- T2: Full event data for a single expanded tool
- T3: Subagent child events -- loaded when subagent expanded
- T4: Full event data for expanded subagent tool

### Latency Characteristics

| Path | End-to-End Latency | Notes |
|------|-------------------|-------|
| Direct stdout capture | <50ms | Requires process control |
| Hook path | 500ms-1.5s | Hook script -> curl -> server -> DB -> push -> client debounce |
| JSONL file watching | 200ms-500ms | fs.watch -> debounce -> parse -> broadcast |
| Combined (hooks + JSONL) | 500ms-1.5s (hooks for status) + 200ms-500ms (JSONL for content) | Best of both worlds |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Sessions                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Orchestrator- │  │ Hook Scripts │  │ JSONL Transcript     │   │
│  │ Spawned       │  │ (stdin POST) │  │ Files (~/.claude/)   │   │
│  │ (stdout pipe) │  └──────┬───────┘  └──────────┬───────────┘   │
│  └──────┬────────┘         │                     │               │
└─────────┼──────────────────┼─────────────────────┼───────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (Node.js/Fastify)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Process      │  │ Hook         │  │ Transcript           │   │
│  │ Manager      │  │ Receiver     │  │ Watcher              │   │
│  │ (stdin/out)  │  │ (POST /api)  │  │ (chokidar/fs.watch)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────┬───────┴──────────────────────┘               │
│                   ▼                                              │
│         ┌──────────────────┐    ┌────────────────────────┐      │
│         │ Event Store      │    │ Session Coordinator     │      │
│         │ (SQLite + cache) │    │ (in-memory metadata)    │      │
│         └────────┬─────────┘    └───────────┬────────────┘      │
│                  │                          │                    │
│         ┌────────┴──────────────────────────┴────────────┐      │
│         │            SSE / WebSocket Hub                  │      │
│         │  SSE: session updates, file changes             │      │
│         │  WS:  terminal I/O, session interaction          │      │
│         └─────────────────────┬───────────────────────────┘      │
└───────────────────────────────┼──────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Browser (React SPA)                          │
│  ┌────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ Kanban      │  │ Session         │  │ Session Detail      │  │
│  │ Board       │  │ Monitor         │  │ (Full Timeline)     │  │
│  │ (DnD cols)  │  │ (SSE events)    │  │ (Virtua virtual)    │  │
│  └────────────┘  └─────────────────┘  └─────────────────────┘  │
│  ┌────────────┐  ┌─────────────────┐                           │
│  │ Terminal    │  │ Interaction     │                           │
│  │ (xterm.js) │  │ Panel (Stage 10)│                           │
│  └────────────┘  └─────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 3: How to Allow User Interaction with Sessions

### The Critical Finding

Only vibe-kanban implements bidirectional interaction with Claude Code sessions from a web browser. It does so by wrapping Claude Code's **stdin/stdout stream-JSON protocol** -- not through any official API, SDK, or hook mechanism.

**claude-code-monitor and claude-devtools are entirely read-only.** They observe sessions but cannot send any input back.

### How stream-JSON Works

Claude Code supports a JSON-line protocol when spawned with specific flags:

```bash
claude -p \
  --input-format=stream-json \
  --output-format=stream-json \
  --include-partial-messages \
  --permission-prompt-tool=stdio \
  --verbose
```

The process's stdin and stdout become JSON-line channels:

**Sending a user message (write to stdin):**
```json
{"type": "user", "message": {"role": "user", "content": "Your message here"}}
```

**Receiving a control request (read from stdout):**
```json
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {...}}}
```

**Sending a control response (write to stdin):**
```json
{"type": "control_response", "response": {"subtype": "success", "request_id": "uuid", "response": {"behavior": "allow", "updatedInput": {...}}}}
```

**SDK control requests (write to stdin):**
```json
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "initialize", "hooks": {...}}}
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "interrupt"}}
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "set_permission_mode", "mode": "bypassPermissions"}}
```

From vibe-kanban's `ProtocolPeer` (`/crates/executors/src/executors/claude/protocol.rs`):
```rust
async fn send_json<T: serde::Serialize>(&self, message: &T) -> Result<(), ExecutorError> {
    let json = serde_json::to_string(message)?;
    let mut stdin = self.stdin.lock().await;
    stdin.write_all(json.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}
```

### Interaction Capabilities

| Capability | How It Works |
|------------|-------------|
| Send messages | Write `{"type": "user", "message": {...}}` to stdin |
| Approve tools | Respond to `CanUseTool` control request with `Allow` |
| Deny tools | Respond to `CanUseTool` control request with `Deny` |
| Answer questions | Intercept `AskUserQuestion` tool via hook, inject answers into tool input |
| Interrupt | Send `{"type": "control_request", "request": {"subtype": "interrupt"}}` |
| Resume sessions | Spawn new process with `--resume <session-id>` |
| Set permission mode | Send `set_permission_mode` control request |

**Critical limitation:** You cannot attach to an already-running Claude Code session you didn't spawn. For follow-ups to existing sessions, you spawn a NEW process with `--resume <session-id>` and send the message to that new process's stdin.

### Message Queuing

When a user sends a follow-up while Claude is still processing, vibe-kanban queues the message:

```rust
// When current execution finishes, check for queued messages
if let Some(queued_msg) = container.queued_message_service.take_queued(ctx.session.id) {
    container.start_queued_follow_up(&ctx, &queued_msg.data).await?;
}
```

This pattern is essential -- Claude Code processes one prompt at a time within a session, so messages must be serialized.

### Architecture for Interaction

```
Browser (React)
    │
    │ HTTP POST /api/sessions/{id}/send-message
    │ HTTP POST /api/sessions/{id}/approve-tool
    │ WebSocket /api/sessions/{id}/stream
    │
    ▼
Backend (Node.js)
    │
    ├── Process Manager (tracks running Claude processes)
    │     │
    │     ├── Protocol Peer (manages stdin/stdout JSON-line protocol)
    │     │     │
    │     │     ├── send_user_message(text) → stdin
    │     │     ├── send_approval(request_id, allow/deny) → stdin
    │     │     └── read_loop() ← stdout (control requests, results)
    │     │
    │     └── Approval Service (queues pending approvals, waits for browser response)
    │
    ├── Message Queue (buffers follow-ups while Claude is busy)
    │
    └── Session State (maps session IDs to running processes)
```

### What This Means for Our Orchestrator

Our orchestrator already spawns Claude Code sessions in git worktrees. To add interaction:

1. **Add stream-JSON flags** to the spawn command: `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio`
2. **Hold stdin references** in the process manager instead of closing them
3. **Implement a ProtocolPeer** (TypeScript equivalent of vibe-kanban's Rust implementation) that reads stdout JSON lines and writes stdin JSON lines
4. **Add an Approval Service** that creates pending approval requests and blocks until the browser responds
5. **Add a Message Queue** that buffers follow-up messages and sends them when the current execution completes
6. **Expose HTTP endpoints** for the browser to send messages and respond to approvals
7. **Stream session output** to the browser via WebSocket or SSE

The orchestrator's existing process management is the foundation -- the key addition is keeping stdin open and implementing the protocol peer.

---

## Part 4: How to Show Full Detail at All Levels

### JSONL Format Reference

Claude Code sessions are stored as append-only JSONL files. There are 6 entry types plus the frequent `progress` type (which lacks UUIDs and is typically filtered out):

| Entry Type | Purpose | Frequency |
|------------|---------|-----------|
| `user` | Real user input OR internal tool results | Common |
| `assistant` | Claude responses with content blocks | Common |
| `system` | Turn duration, init metadata | Per-turn |
| `summary` | Compaction boundary markers | Rare |
| `file-history-snapshot` | File modification tracking | Per-tool |
| `queue-operation` | Subagent task scheduling | Per-subagent |
| `progress` | Real-time progress (~70% of entries) | Very frequent, filtered |

Content blocks within messages: `text`, `thinking`, `tool_use`, `tool_result`, `image`.

**Tool linking mechanism**: `tool_use.id` in assistant messages matches `tool_result.tool_use_id` in subsequent user (isMeta: true) messages. The `sourceToolUseID` field on user entries provides the most reliable link.

### Chunking Strategy (from claude-devtools)

Messages are classified into 4 categories and grouped into semantic chunks:

```
JSONL → SessionParser → ParsedMessage[] → MessageClassifier → ChunkBuilder → EnhancedChunk[]
```

**Classification rules:**
- **User**: `type='user'`, `isMeta!=true`, has text/image content, no system tags -- starts new chunk
- **System**: Contains `<local-command-stdout>` tag
- **Hard Noise**: system/summary/file-history entries, caveats, reminders, synthetic messages -- filtered out entirely
- **AI**: Everything else -- buffered into AIChunks

**Chunk types:**
- **UserChunk**: Single user input (renders on right side)
- **AIChunk**: Consecutive AI messages until next user input (renders on left), contains tool executions and subagent references
- **SystemChunk**: Command output from slash commands
- **CompactChunk**: Marks conversation compaction boundary

**Enhanced chunks** add `SemanticStep` sequences that break AI chunks into logical work units: `thinking` -> `tool_call` -> `tool_result` -> `subagent` -> `output` -> `interruption`.

### Tool-Specific Renderers

Both claude-code-monitor and claude-devtools implement specialized renderers per tool type:

| Tool | What to Show | Key Data |
|------|-------------|----------|
| Read | File path, line range, content preview | `input.file_path`, `input.offset`, `input.limit`, result content |
| Edit | File path, old/new diff | `input.file_path`, `input.old_string`, `input.new_string` |
| Write | File path, written content | `input.file_path`, `input.content`, line count |
| Bash | Command, description, stdout/stderr | `input.command`, `input.description`, `toolUseResult.stdout/stderr` |
| Grep | Pattern, file glob, matches | `input.pattern`, `input.glob`, match results |
| Glob | Pattern, matched files | `input.pattern`, file list |
| Task | Subagent type, description, duration, tokens | `input.description`, `input.subagent_type`, result metrics |
| Skill | Skill name, instructions | `input.skill`, instructions text |
| WebFetch | URL, response summary | `input.url`, extracted content |

**Tool summary generation** (from claude-devtools `toolSummaryHelpers.ts`) creates human-readable one-liners:
- Edit: `"filename.ts - 3 -> 5 lines"`
- Read: `"filename.ts - lines 1-100"`
- Bash: Description text or truncated command
- Grep: `'"pattern" in *.ts'`

### Subagent Visualization

Subagent files live in `{session-uuid}/subagents/agent-{agent-id}.jsonl` (new structure) or at the project root (legacy). They have the exact same JSONL format but with `isSidechain: true` and `sessionId` pointing to the parent session.

**Three-phase linking** (from claude-devtools SubagentResolver):
1. **Result-based**: Read `toolUseResult.agentId` from parent's tool result -> match to subagent file
2. **Description-based**: Match Task description to `<teammate-message summary="...">` in subagent's first message
3. **Positional fallback**: Match remaining by chronological order

**Parallel detection**: Subagents with start times within 100ms of each other are marked `isParallel: true`.

**Display hierarchy:**
```
Main Session
  ├── UserChunk (user input)
  ├── AIChunk
  │   ├── ThinkingItem (extended thinking)
  │   ├── LinkedToolItem (Bash: "npm test")
  │   ├── SubagentItem (Explore: "Search for patterns...")
  │   │   ├── [Expand Level 1: Meta info, context usage]
  │   │   └── [Expand Level 2: Full execution trace]
  │   │       ├── ThinkingItem
  │   │       ├── LinkedToolItem (Grep)
  │   │       ├── LinkedToolItem (Read)
  │   │       └── TextItem (output)
  │   └── TextItem (assistant response)
  └── UserChunk (next user input)
```

### Context Tracking

Claude-devtools tracks context across 7 categories:

```typescript
interface TokensByCategory {
  claudeMd: number;           // CLAUDE.md files (enterprise, user, project, directory)
  mentionedFiles: number;     // @-mentioned files
  toolOutputs: number;        // Tool call + result tokens
  thinkingText: number;       // Thinking blocks + text output
  taskCoordination: number;   // SendMessage, TeamCreate, TaskCreate, etc.
  userMessages: number;       // User input text
}
```

**Compaction-aware phases**: When a `summary` entry appears (compaction), a new phase starts. Tracking resets and the delta between pre-compaction and post-compaction token counts is recorded. This gives a "total context consumed" metric that can exceed the context window size.

**Cost calculation** uses LiteLLM pricing data with tiered rates above 200K tokens:
```typescript
function calculateMessageCost(modelName, inputTokens, outputTokens, cacheRead, cacheCreation) {
  const pricing = getPricing(modelName);
  return calculateTieredCost(inputTokens, pricing.input_cost_per_token, pricing.input_cost_per_token_above_200k_tokens)
       + calculateTieredCost(outputTokens, pricing.output_cost_per_token, ...)
       + calculateTieredCost(cacheCreation, ...) + calculateTieredCost(cacheRead, ...);
}
```

### Recommended Component Architecture

```
<KanbanBoard>                    // Drag-and-drop columns
  <KanbanColumn>                 // Per-phase column
    <TicketCard>                 // Individual ticket

<SessionMonitor>                 // Real-time session overview
  <SessionList>                  // Sidebar with active sessions
    <SessionCard>                // Status, tokens, branch
  <SessionDetail>                // Selected session's timeline
    <VList reverse>              // Virtua virtual scrolling
      <UserChunkItem>            // User input (right-aligned)
      <AIChunkItem>              // AI response group
        <ThinkingItem>           // Extended thinking (collapsible)
        <ToolItem>               // Tool execution (tool-specific renderer)
          <BashRenderer>
          <ReadRenderer>
          <EditRenderer>
          <WriteRenderer>
          // ... etc
        <SubagentItem>           // Subagent (collapsible)
          <SubagentHeader>       // Type, model, duration, metrics
          <ExecutionTrace>       // Nested tool/thinking items
        <TextItem>               // Assistant text output
      <CompactBoundary>          // Compaction marker
    <ContextPanel>               // Token attribution sidebar
      <ContextBadge>             // Per-turn context injection summary
```

---

## Part 5: How to Plan for Multi-User on Hosted Environment

### The Deployment Trait Pattern

Vibe-kanban uses a **trait-based deployment abstraction** -- a common interface with local and remote implementations:

```rust
#[async_trait]
pub trait Deployment: Clone + Send + Sync + 'static {
    fn user_id(&self) -> &str;
    fn db(&self) -> &DBService;
    fn container(&self) -> &impl ContainerService;
    fn auth_context(&self) -> &AuthContext;
    // ... other services
}
```

Local deployment uses SQLite + filesystem with no auth. Remote deployment uses Postgres + S3 with full OAuth. The key insight is that `remote_client()` and `shared_api_base()` have default implementations returning "not configured" -- local mode just uses the defaults.

**TypeScript equivalent for our project:**

```typescript
interface DeploymentContext {
  getUserId(): string;
  getSessionStore(): SessionStore;
  getFileAccess(): FileAccessProvider;
  getEventStream(): EventBroadcaster;
  getAuthProvider(): AuthProvider;
}

class LocalDeployment implements DeploymentContext {
  getUserId() { return 'local-user'; }
  getSessionStore() { return new FilesystemSessionStore('~/.claude'); }
  getFileAccess() { return new DirectFileAccess(); }
  getEventStream() { return new BroadcastSSE(); }      // All clients see everything
  getAuthProvider() { return new NoOpAuth(); }           // No auth needed
}

class HostedDeployment implements DeploymentContext {
  constructor(private user: AuthenticatedUser) {}
  getUserId() { return this.user.id; }
  getSessionStore() { return new PostgresSessionStore(this.user.id); }
  getFileAccess() { return new ScopedFileAccess(this.user.homeDir); }
  getEventStream() { return new UserScopedSSE(this.user.id); }
  getAuthProvider() { return new OAuthJWTAuth(); }
}
```

### Authentication Strategy

Vibe-kanban's OAuth + JWT pattern is production-proven:

- **GitHub OAuth** for login (most users have GitHub accounts)
- **Short-lived access tokens** (120 seconds) to minimize damage from token theft
- **Long-lived refresh tokens** (365 days) with rotation and reuse detection
- **Provider token validation** on refresh -- revoked GitHub account invalidates all sessions
- `require_session` middleware validates JWT on every API request

For local mode: No auth. Localhost binding + optional `ALLOWED_ORIGINS`.

### Multi-Tenancy Model

Row-level isolation with a shared schema (not schema-per-tenant):

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    os_username TEXT,              -- Maps to Unix account on EC2
    claude_home_path TEXT,         -- /home/<username>/.claude
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE claude_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    session_id TEXT NOT NULL,      -- Claude Code's session ID
    status TEXT DEFAULT 'active',
    last_activity TIMESTAMPTZ,
    UNIQUE (user_id, session_id)
);
```

Access control: Every query filters by `user_id` from the JWT. Middleware injects the authenticated user into the request context.

### Real-Time Scoping

Per-user SSE channels:

```typescript
const userClients = new Map<string, Set<FastifyReply>>();

function broadcastToUser(userId: string, event: string, data: unknown): void {
  const clients = userClients.get(userId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.raw.write(payload);
  }
}
```

For local mode, `userId` is always `'local-user'` so all clients see everything.

### Session Isolation

On a shared EC2 instance:
1. Each user has their own OS account and `~/.claude/` directory
2. Claude Code runs under each user's account
3. The web server runs as a service account with read access to all home directories
4. API middleware resolves authenticated user -> OS username -> `~/.claude/` path
5. File reads are validated against the user's home directory using `realpath` (symlink-safe)

### Database Changes for Multi-Tenancy

| Mode | Database | User Table | Session Scoping |
|------|----------|------------|-----------------|
| Local | SQLite (or none -- read from filesystem directly) | Not needed | Everything visible |
| Hosted | PostgreSQL | users, auth_sessions, oauth_accounts | `WHERE user_id = $1` on all queries |

### What to Build Now vs Later

**Build during Stage 9 (local-only):**
- `DeploymentContext` interface with `LocalDeployment` implementation
- `FileSystemProvider` abstraction (so file access can be swapped later)
- `SessionStore` interface (local impl reads from filesystem)
- `EventBroadcaster` interface (local impl broadcasts to all)
- `AuthProvider` interface with `NoOpAuth` implementation
- Environment variable `DEPLOYMENT_MODE=local` (defaults to local)

**Defer to a later stage:**
- `HostedDeployment` implementation
- OAuth + JWT authentication
- PostgreSQL migration and session index
- Per-user SSE channels
- Docker compose with Postgres + reverse proxy
- User management UI

The abstractions added during Stage 9 are lightweight (just interfaces and a local implementation) but they prevent having to refactor the entire codebase later.

---

## Part 6: Recommended Tech Stack

### Frontend

| Library | Purpose | Justification |
|---------|---------|---------------|
| React 19 | UI framework | Used by all three repos; our project already uses TypeScript |
| Vite 5 | Build tool | Fast HMR, used by all three repos |
| TailwindCSS 3.4 | Styling | Used by all three repos, productive for rapid UI development |
| Zustand 5 | Client state | Lightweight, used by claude-code-monitor and claude-devtools |
| @hello-pangea/dnd | Drag-and-drop | Maintained fork of react-beautiful-dnd, used by vibe-kanban for kanban board |
| Virtua | Virtual scrolling | Proven at 30K+ events by claude-code-monitor |
| react-markdown + remark-gfm | Markdown rendering | Used by claude-code-monitor for assistant text |
| Shiki | Syntax highlighting | Used by claude-code-monitor for code blocks |
| lucide-react | Icons | Used by both claude-code-monitor and claude-devtools |
| xterm.js | Terminal emulation | Used by vibe-kanban for PTY terminals (Stage 10) |

### Backend

| Library | Purpose | Justification |
|---------|---------|---------------|
| Fastify 5 | HTTP framework | Used by claude-devtools, faster than Express, good TypeScript support |
| ws | WebSocket | Used by claude-code-monitor, mature, no-frills |
| better-sqlite3 | SQLite | Used by claude-code-monitor, synchronous API, WAL mode support |
| chokidar 5 | File watching | Used by claude-code-monitor, reliable cross-platform |
| Vitest | Testing | Used by all three repos |

### Real-Time Communication

- **SSE** for dashboard notifications (session updates, file changes)
- **WebSocket** for terminal I/O and bidirectional session interaction (Stage 10)
- **REST** for data fetching (session details, event timelines, kanban state)

### Database Strategy

- **Local mode**: SQLite via better-sqlite3 with WAL mode (same as claude-code-monitor)
  - Session metadata cache
  - Event storage for hook-captured events
  - Kanban state already in SQLite from existing kanban-cli
- **Hosted mode (future)**: PostgreSQL (following vibe-kanban's remote deployment)

### Build and Deployment

- **Development**: `pnpm` workspace, Vite dev server with HMR, concurrent backend + frontend
- **Production**: Vite builds static SPA assets, Fastify serves them + API
- **Docker (future)**: Alpine multi-stage build, compiled TypeScript + built frontend assets

### What to Reuse vs Build Fresh

**Reuse from existing codebase:**
- kanban-cli's YAML parsing and SQLite database
- Orchestrator's process spawning and worktree management
- MCP server's external service integrations

**Reuse patterns from researched repos:**
- claude-code-monitor's hook system architecture (adapt the shell script template)
- claude-code-monitor's event storage schema and deduplication logic
- claude-devtools' chunking pipeline (port ChunkBuilder, ToolExecutionBuilder, SubagentResolver)
- claude-devtools' tool renderers (port or rewrite in React)
- vibe-kanban's ProtocolPeer pattern (port to TypeScript for session interaction)

**Build fresh:**
- Web server (Fastify routes, SSE/WebSocket hubs)
- React SPA (kanban board view, session monitor view, session detail view)
- Integration layer between kanban-cli and web UI

---

## Part 7: Architecture Recommendations

### Overall System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    kanban-web (new package)                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Fastify HTTP Server                        │    │
│  │                                                             │    │
│  │  REST API                 SSE Hub              WebSocket Hub │    │
│  │  /api/kanban/*           /api/events           /api/ws/*    │    │
│  │  /api/sessions/*                               (terminal,   │    │
│  │  /api/tickets/*                                 interaction)│    │
│  └────┬───────────────────────┬────────────────────┬───────────┘    │
│       │                       │                    │                │
│  ┌────┴────────┐  ┌──────────┴──────────┐  ┌─────┴──────────┐    │
│  │ Kanban       │  │ Session Monitor     │  │ Interaction     │    │
│  │ Service      │  │ Service             │  │ Service         │    │
│  │              │  │                     │  │ (Stage 10)      │    │
│  │ Reads from   │  │ Hook Receiver       │  │                 │    │
│  │ kanban-cli   │  │ Transcript Watcher  │  │ Protocol Peer   │    │
│  │ SQLite DB    │  │ Event Store         │  │ Approval Queue  │    │
│  └──────────────┘  └─────────────────────┘  │ Message Queue   │    │
│                                              └─────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Deployment Context (interface)                   │   │
│  │  LocalDeployment: SQLite + filesystem + no auth              │   │
│  │  HostedDeployment: Postgres + scoped access + OAuth (future) │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘

Existing packages (unchanged):
  kanban-cli    → Provides YAML parsing, SQLite DB, validation
  orchestrator  → Spawns Claude sessions, manages worktrees
  mcp-server    → Jira, GitHub/GitLab, Slack integrations
```

### Component Breakdown for the Web UI

**Page 1: Kanban Board** (`/`)
- Column per phase (Design, Build, Testing, Finalize, PR)
- Cards show ticket title, assignee, session status indicator
- Drag-and-drop between columns (triggers phase transition)
- Click card to navigate to ticket detail

**Page 2: Ticket Detail** (`/tickets/:id`)
- Ticket metadata (title, Jira link, branch, worktree)
- Phase progress indicator
- Active session panel (if session is running)
- Session history list
- Link to full session detail

**Page 3: Session Detail** (`/sessions/:id`)
- Full timeline with virtual scrolling
- Chunked display (UserChunk, AIChunk, CompactBoundary)
- Tool-specific renderers
- Subagent tree with expand/collapse
- Context tracking sidebar (optional, toggle)
- Token/cost summary

**Page 4: Session Interaction** (`/sessions/:id/interact`) (Stage 10)
- Chat-style input for sending messages
- Pending approval cards for tool approvals
- Question answering panel for AskUserQuestion
- Terminal panel (xterm.js) for workspace shell access

### API Surface Design

**Kanban endpoints (read from kanban-cli SQLite):**
```
GET    /api/kanban/board                    # Full board state
GET    /api/kanban/tickets                  # All tickets with filters
GET    /api/kanban/tickets/:id              # Ticket detail
POST   /api/kanban/tickets/:id/transition   # Move to next phase
```

**Session monitoring endpoints:**
```
GET    /api/sessions                         # Active/recent sessions
GET    /api/sessions/:id                     # Session metadata
GET    /api/sessions/:id/events              # Paginated event timeline
GET    /api/sessions/:id/events/main         # Main-level events only
GET    /api/sessions/:id/events/subagent/:agentId  # Subagent events
GET    /api/sessions/:id/events/:eventId/full      # Full event data
SSE    /api/events                           # Real-time notifications
```

**Interaction endpoints (Stage 10):**
```
POST   /api/sessions/:id/send-message        # Send follow-up to Claude
POST   /api/sessions/:id/approve-tool        # Approve/deny tool execution
POST   /api/sessions/:id/answer-question     # Answer AskUserQuestion
POST   /api/sessions/:id/interrupt           # Interrupt current processing
WS     /api/sessions/:id/terminal            # Terminal WebSocket
WS     /api/sessions/:id/stream              # Session output stream
```

### Integration Points

1. **kanban-cli SQLite database**: Web server opens the same SQLite DB (read-only for board state). kanban-cli remains the authoritative writer.

2. **Orchestrator process management**: The orchestrator already spawns Claude sessions. For Stage 10 interaction, the web server needs access to process stdin handles. Options: (a) orchestrator exposes an IPC channel, (b) web server takes over spawning responsibility, (c) shared process manager module.

3. **MCP server**: Existing Jira/GitHub/Slack integrations remain separate. The web UI calls them via the kanban-cli or directly when needed for ticket enrichment.

4. **Hook system**: The web server installs hooks into `~/.claude/settings.json` (following claude-code-monitor's pattern) to receive real-time session events.

### Incremental Build Plan

**Stage 9A**: Static kanban board (reads from existing SQLite, no real-time updates)
**Stage 9B**: Session monitoring (hook installation, event capture, SSE push, timeline display)
**Stage 9C**: Full session detail (chunking, tool renderers, subagent tree, virtual scrolling)
**Stage 10A**: Read-only session streaming (live output in browser, no interaction)
**Stage 10B**: Bidirectional interaction (send messages, approve tools, message queue)
**Stage 10C**: Terminal and workspace access (xterm.js, PTY WebSocket)

---

## Part 8: Key Patterns to Adopt

### 1. Dual-Ingest Session Monitoring
**Source**: claude-code-monitor
**Why valuable**: Hooks provide instant status awareness; transcript watching provides rich content. Using both with deduplication gives the most complete picture.
**How to adopt**: Install hook scripts via a setup command. Run a chokidar watcher on `~/.claude/projects/`. Store both sources in SQLite with `event_uuid` deduplication.

### 2. Tiered Data Loading
**Source**: claude-code-monitor (T1-T4 loading system)
**Why valuable**: Avoids loading full event data for all sessions upfront. Loads metadata first, full data on demand.
**How to adopt**: T1 loads main event metadata when session is selected. T2 loads full data for a single expanded tool. T3/T4 do the same for subagent events.

### 3. Entity Merging (Pre/Post Tool Correlation)
**Source**: claude-code-monitor (`entityTransformer.ts`) and claude-devtools (`ToolExecutionBuilder.ts`)
**Why valuable**: Raw events are noisy (separate pre_tool_use and post_tool_use). Merging them into ToolEntity objects with start/end/duration makes the timeline coherent.
**How to adopt**: Two-pass algorithm: first pass collects all tool_use events by ID; second pass matches tool_result events and creates ToolExecution objects.

### 4. Message Chunking
**Source**: claude-devtools (`ChunkBuilder.ts`)
**Why valuable**: Groups related messages into semantic units (UserChunk, AIChunk) that map naturally to UI components. The 4-category classification (user/system/hardNoise/ai) filters noise effectively.
**How to adopt**: Port the classification rules and chunk builder. The key insight is that user messages with `isMeta != true` and text content start new chunks; everything else buffers into the current AI chunk.

### 5. Deployment Context Abstraction
**Source**: vibe-kanban (`Deployment` trait)
**Why valuable**: Clean separation between local and remote modes. Adding multi-user later requires implementing a new class, not refactoring existing code.
**How to adopt**: Define TypeScript interfaces for `DeploymentContext`, `FileSystemProvider`, `SessionStore`, `AuthProvider`, `EventBroadcaster`. Implement `LocalDeployment` during Stage 9. Implement `HostedDeployment` when multi-user is needed.

### 6. History-Plus-Stream Pattern
**Source**: vibe-kanban (`MsgStore.history_plus_stream()`)
**Why valuable**: Cleanest solution for late-connecting clients. Returns historical events followed by a live stream, seamlessly handling the "missed events" problem.
**How to adopt**: When a browser connects to a session stream, send the historical snapshot first, then chain the live event stream. Include a `Ready` signal to tell the client when the snapshot is complete.

### 7. Reference Stabilization for Virtual Scrolling
**Source**: claude-code-monitor (`ActivityTimeline.tsx`)
**Why valuable**: Prevents Virtua from re-measuring unchanged items during incremental updates. Without this, every new event causes all visible items to re-render.
**How to adopt**: Compare new items to previous items by semantic key. If an item hasn't changed, reuse the previous React object reference.

### 8. Subagent Stack for Tool Correlation
**Source**: claude-code-monitor (`hook-receiver.ts`)
**Why valuable**: Claude Code hook events for tools (PreToolUse, PostToolUse) don't include which subagent they belong to. The stack-based approach assigns tools to the currently active subagent.
**How to adopt**: Maintain a `Map<sessionId, Array<{agentId, startTime}>>` stack. Push on SubagentStart, pop on SubagentStop. When tool events arrive, tag them with the top-of-stack subagent ID.

### 9. Fire-and-Forget Hooks
**Source**: claude-code-monitor (`session-monitor.sh`)
**Why valuable**: Hook scripts that block or fail can break Claude Code. Fire-and-forget (background curl with `exit 0`) ensures hooks never impact the user's Claude experience.
**How to adopt**: Copy the shell script template. Run curl in background (`&`), set a 2-second timeout, always exit 0.

### 10. Adapter Pattern for Dual Deployment
**Source**: claude-devtools (IPC vs HTTP+SSE behind shared interface)
**Why valuable**: Same renderer code works in Electron (IPC) and browser (HTTP+SSE) modes.
**How to adopt**: Not directly needed for our project (we're browser-only), but the pattern of hiding transport behind a service interface is valuable for testing and future flexibility.

---

## Part 9: Risks and Open Questions

### Technical Risks

1. **stream-JSON protocol stability**: The stdin/stdout protocol used by vibe-kanban is undocumented and may change between Claude Code versions. Our interaction features (Stage 10) depend on it. **Mitigation**: Abstract the protocol behind a `ProtocolPeer` interface; version-check Claude Code on startup.

2. **Hook installation conflicts**: Other tools (claude-code-monitor, custom hooks) may already have hook entries in `~/.claude/settings.json`. Our hook installer must merge, not overwrite. **Mitigation**: Read existing settings, merge hook arrays, never remove existing entries.

3. **JSONL file format changes**: Claude Code's JSONL format is not officially documented. The `progress` entry type, subagent directory structure, and `toolUseResult` shapes have changed between versions. **Mitigation**: Defensive parsing with fallbacks; filter unknown entry types gracefully.

4. **Virtual scrolling with dynamic heights**: Tool outputs vary dramatically in size (a one-line Read vs a 500-line Bash output). Virtua handles this but it requires careful height estimation and measurement. **Mitigation**: Use Virtua's `measureElement` callback; provide conservative `estimateSize` defaults.

5. **SQLite concurrent access**: The web server and kanban-cli may both access the SQLite database simultaneously. WAL mode handles concurrent reads well, but concurrent writes need coordination. **Mitigation**: Web server opens kanban DB as read-only; use a separate SQLite DB for session monitoring data.

### Open Questions Requiring User Input

1. **Scope of Stage 10 interaction**: Should the web UI allow full bidirectional interaction (send messages, approve tools, answer questions), or start with read-only monitoring plus a simple "send follow-up" feature?

2. **Multi-user priority**: How soon is hosted/multi-user deployment needed? This affects whether to invest in deployment abstractions during Stage 9 or keep things simple.

3. **Session display model**: Should we use the event-based timeline model (claude-code-monitor style -- real-time, flat) or the chunked conversation model (claude-devtools style -- richer, but requires more parsing)? Or a hybrid?

4. **Existing orchestrator integration**: Should the web server take over process spawning from the orchestrator, or should they communicate via IPC? This affects the architecture for Stage 10 interaction.

5. **Hook installation ownership**: Should the web server automatically install hooks on startup, or should this be a manual setup step (like `kanban-cli setup-hooks`)?

6. **Terminal access**: Is browser-based terminal access to worktrees a requirement for Stage 10, or is session interaction sufficient?

7. **Cost tracking**: Is per-session cost estimation (using LiteLLM pricing like claude-devtools) a priority, or can it be deferred?

### Things That Need Further Investigation

1. **Claude Code `--input-format=stream-json` in Node.js**: vibe-kanban implements this in Rust with Tokio async I/O. We need to verify that Node.js's `child_process` module handles the stdin/stdout pipes correctly for the JSON-line protocol, particularly around line buffering and backpressure.

2. **xterm.js + node-pty integration**: vibe-kanban uses Rust's `portable-pty` crate. For our TypeScript backend, we'd use `node-pty`. Need to verify compatibility and performance characteristics.

3. **Electric SQL vs simpler real-time sync**: vibe-kanban uses Electric SQL for database sync, but it's complex and may be overkill. Need to evaluate whether SSE + REST polling is sufficient for our kanban board updates.

4. **Subagent file watching depth**: Claude Code creates subagent files in nested directories. chokidar's `depth` option needs to be set deep enough (claude-code-monitor uses depth: 4) to catch all subagent transcripts.

5. **Browser EventSource connection limits**: HTTP/1.1 limits connections per domain to 6. With SSE, each tab uses one connection. Need to verify this isn't a problem, or use HTTP/2 which removes this limit.
