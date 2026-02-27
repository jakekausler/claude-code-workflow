# Stage 10A + 9E: Orchestrator Communication & Session JSONL Engine

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture session IDs from Claude Code via stream-JSON stdout parsing (10A), expose them via WebSocket + DB column, then build the full JSONL parsing pipeline that transforms raw session files into structured data for the session detail view (9E).

**Architecture:** The orchestrator switches to stream-JSON mode when spawning Claude, parses the session ID from stdout, stores it in a SessionRegistry, broadcasts it over WebSocket, and writes it to the stages DB. The web server connects to the orchestrator WebSocket to mirror the registry, and provides a full JSONL parsing pipeline (8 services) that transforms raw `.jsonl` files into chunks, tool executions, subagent trees, context stats, and cost data. Three API endpoints serve this parsed data.

**Tech Stack:** Node.js built-ins (fs, readline, path, events, crypto), `ws` npm package for WebSocket, Fastify 5, Zod, Vitest 3, better-sqlite3 (existing), TypeScript 5 (strict, NodeNext, ES2022).

---

## Context for Implementors

### Project Structure
- **Orchestrator**: `tools/orchestrator/` — spawns Claude Code sessions for stages
- **Web Server**: `tools/web-server/` — Fastify backend + React SPA
- **Kanban CLI**: `tools/kanban-cli/` — CLI tool with SQLite DB, repos, parsers

### ESM Module Rules
- All local imports use `.js` extensions: `import { foo } from './bar.js'`
- Use `fileURLToPath(import.meta.url)` instead of `__dirname`
- npm package imports do NOT need `.js` extensions

### Testing
- Vitest 3, globals enabled (`describe`/`it`/`expect` without imports)
- Web server tests: `tools/web-server/tests/**/*.test.ts`, run with `npm run test`
- Orchestrator tests: `tools/orchestrator/tests/**/*.test.ts`, run with `npm run test`
- Use Fastify `inject()` for route tests, dependency injection for service tests
- Use `fs.mkdtempSync()` for temp directories in tests

### Key Files to Reference
- `tools/web-server/src/server/app.ts` — server factory, route registration
- `tools/web-server/src/server/services/data-service.ts` — existing service pattern
- `tools/web-server/src/server/routes/sessions.ts` — current 501 stubs to replace
- `tools/orchestrator/src/session.ts` — current spawn logic (209 lines)
- `tools/orchestrator/src/loop.ts` — main orchestration loop (526 lines)
- `tools/orchestrator/src/types.ts` — WorkerInfo, OrchestratorConfig
- `tools/kanban-cli/src/db/schema.ts` — all table definitions + migrations array

### Existing Patterns
- Routes use `fastify-plugin` (`fp()`) wrapper
- DataService decorates Fastify instance: `app.dataService`
- Session routes use `app.claudeProjectsDir` (defaults to `~/.claude/projects`)
- Orchestrator uses dependency injection: `SessionDeps`, `OrchestratorDeps`
- Database migrations are `ALTER TABLE` statements in a `MIGRATIONS` array, wrapped in try/catch
- `session_active` is already a column on stages (BOOLEAN DEFAULT 0)

---

## Task 1: Add `session_id` Column to Stages Table

**Files:**
- Modify: `tools/kanban-cli/src/db/schema.ts` — add migration
- Modify: `tools/kanban-cli/src/db/repositories/types.ts` — add field to StageRow
- Modify: `tools/kanban-cli/src/db/repositories/stage-repository.ts` — add field to StageUpsertData, add query methods
- Test: `tools/kanban-cli/tests/db/stage-repository.test.ts` (find existing or create)

**Step 1: Add the migration**

In `schema.ts`, add to the `MIGRATIONS` array:

```typescript
`ALTER TABLE stages ADD COLUMN session_id TEXT DEFAULT NULL`,
```

**Step 2: Update StageRow type**

In `types.ts`, add to `StageRow`:

```typescript
session_id: string | null;
```

**Step 3: Update StageUpsertData**

In `stage-repository.ts`, add `session_id` to `StageUpsertData` interface and the upsert SQL.

**Step 4: Add query methods to StageRepository**

```typescript
findBySessionId(sessionId: string): StageRow | null {
  return this.db.get<StageRow>(
    'SELECT * FROM stages WHERE session_id = ?',
    sessionId
  ) ?? null;
}

updateSessionId(stageId: string, sessionId: string | null): void {
  this.db.run(
    'UPDATE stages SET session_id = ? WHERE id = ?',
    sessionId, stageId
  );
}
```

**Step 5: Write tests**

Test that:
- Migration adds the column (existing DB still works)
- `updateSessionId()` writes and `findBySessionId()` reads back
- `findBySessionId()` returns null for unknown ID
- Upsert preserves session_id

**Step 6: Run kanban-cli tests**

```bash
cd tools/kanban-cli && npm run verify
```

**Step 7: Commit**

```
feat(kanban-cli): add session_id column to stages table
```

---

## Task 2: Stream-JSON Stdout Parsing in Orchestrator

**Files:**
- Create: `tools/orchestrator/src/stream-parser.ts`
- Test: `tools/orchestrator/tests/stream-parser.test.ts`

**What this does:** Parses JSON lines from Claude's stdout when spawned with `--output-format=stream-json`. Extracts the session ID and other control messages.

**Step 1: Write the stream parser**

```typescript
// stream-parser.ts
import { EventEmitter } from 'events';

export interface StreamMessage {
  type: string;
  [key: string]: unknown;
}

export interface StreamParserEvents {
  'session-id': (sessionId: string) => void;
  'message': (msg: StreamMessage) => void;
  'error': (err: Error) => void;
}

export class StreamParser extends EventEmitter {
  private buffer = '';
  private sessionId: string | null = null;

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Feed raw stdout data into the parser.
   * Splits on newlines, parses each complete line as JSON.
   */
  feed(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }

  /** Flush any remaining buffer content */
  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (trimmed) {
      this.parseLine(trimmed);
    }
  }

  private parseLine(line: string): void {
    try {
      const msg = JSON.parse(line) as StreamMessage;
      this.emit('message', msg);

      // Extract session ID from init or result messages
      // Claude stream-json outputs session_id in the initial system message
      if (msg.session_id && typeof msg.session_id === 'string' && !this.sessionId) {
        this.sessionId = msg.session_id;
        this.emit('session-id', msg.session_id);
      }
      // Also check nested structures
      if (msg.type === 'system' && typeof msg.sessionId === 'string' && !this.sessionId) {
        this.sessionId = msg.sessionId;
        this.emit('session-id', msg.sessionId);
      }
    } catch {
      // Non-JSON lines (e.g. plain text stderr mixed in) — skip silently
    }
  }
}
```

**Step 2: Write tests**

Test that:
- Parses complete JSON lines and emits 'message' events
- Extracts session_id from message and emits 'session-id' event
- Handles partial lines across multiple `feed()` calls (buffering)
- Handles empty lines and non-JSON gracefully
- `flush()` processes remaining buffer
- `getSessionId()` returns captured ID

**Step 3: Run orchestrator tests**

```bash
cd tools/orchestrator && npm run test
```

**Step 4: Commit**

```
feat(orchestrator): add stream-JSON stdout parser for session ID capture
```

---

## Task 3: Session Registry

**Files:**
- Create: `tools/orchestrator/src/session-registry.ts`
- Test: `tools/orchestrator/tests/session-registry.test.ts`

**What this does:** In-memory registry mapping stageId to session metadata. Emits events when sessions register/unregister.

**Step 1: Write the registry**

```typescript
// session-registry.ts
import { EventEmitter } from 'events';

export interface SessionEntry {
  stageId: string;
  sessionId: string;
  processId: number;
  worktreePath: string;
  status: 'starting' | 'active' | 'ended';
  spawnedAt: number; // epoch ms
  lastActivity: number; // epoch ms
}

export interface SessionRegistryEvents {
  'session-registered': (entry: SessionEntry) => void;
  'session-status': (entry: SessionEntry) => void;
  'session-ended': (entry: SessionEntry) => void;
}

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, SessionEntry>();

  register(entry: Omit<SessionEntry, 'status' | 'lastActivity'>): SessionEntry {
    const full: SessionEntry = {
      ...entry,
      status: 'starting',
      lastActivity: entry.spawnedAt,
    };
    this.sessions.set(entry.stageId, full);
    this.emit('session-registered', full);
    return full;
  }

  activate(stageId: string, sessionId: string): void {
    const entry = this.sessions.get(stageId);
    if (!entry) return;
    entry.status = 'active';
    entry.sessionId = sessionId;
    entry.lastActivity = Date.now();
    this.emit('session-status', entry);
  }

  end(stageId: string): void {
    const entry = this.sessions.get(stageId);
    if (!entry) return;
    entry.status = 'ended';
    entry.lastActivity = Date.now();
    this.emit('session-ended', entry);
    this.sessions.delete(stageId);
  }

  get(stageId: string): SessionEntry | undefined {
    return this.sessions.get(stageId);
  }

  getBySessionId(sessionId: string): SessionEntry | undefined {
    for (const entry of this.sessions.values()) {
      if (entry.sessionId === sessionId) return entry;
    }
    return undefined;
  }

  getAll(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  size(): number {
    return this.sessions.size;
  }
}
```

**Step 2: Write tests**

Test that:
- `register()` adds entry with 'starting' status, emits 'session-registered'
- `activate()` transitions to 'active', updates sessionId, emits 'session-status'
- `end()` transitions to 'ended', emits 'session-ended', removes from map
- `get()` and `getBySessionId()` find correct entries
- `getAll()` returns all active entries
- `end()` on unknown stageId is a no-op

**Step 3: Run tests and commit**

```bash
cd tools/orchestrator && npm run test
```

```
feat(orchestrator): add SessionRegistry for stage-to-session mapping
```

---

## Task 4: Integrate Stream-JSON Mode into Session Executor

**Files:**
- Modify: `tools/orchestrator/src/session.ts` — switch to stream-JSON flags, integrate StreamParser
- Modify: `tools/orchestrator/src/types.ts` — extend SpawnOptions with registry callback
- Modify: `tools/orchestrator/tests/` — update affected tests

**Step 1: Update spawn flags**

In `session.ts`, change the `claude` spawn arguments to include:

```typescript
const args = [
  '-p',
  '--model', options.model,
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
];
```

**Step 2: Integrate StreamParser**

In the `spawn()` method, create a `StreamParser` instance. Pipe stdout data through it:

```typescript
const parser = new StreamParser();

child.stdout?.on('data', (chunk: Buffer) => {
  const text = chunk.toString('utf-8');
  parser.feed(text);
  // Still pass through to session logger for logging
  deps.logger.write(text);
});

parser.on('session-id', (sessionId) => {
  // Callback to caller with captured session ID
  options.onSessionId?.(sessionId);
});
```

**Step 3: Extend SpawnOptions**

Add optional callback:

```typescript
interface SpawnOptions {
  // ... existing fields
  onSessionId?: (sessionId: string) => void;
}
```

**Step 4: Update tests**

- Update mock session tests to handle stream-JSON output format
- Verify StreamParser integration doesn't break existing spawn behavior
- Test that `onSessionId` callback fires when stream contains session ID

**Step 5: Run all orchestrator tests**

```bash
cd tools/orchestrator && npm run verify
```

**Step 6: Commit**

```
feat(orchestrator): switch to stream-JSON mode for session ID capture
```

---

## Task 5: WebSocket Server in Orchestrator

**Files:**
- Create: `tools/orchestrator/src/ws-server.ts`
- Modify: `tools/orchestrator/package.json` — add `ws` dependency
- Test: `tools/orchestrator/tests/ws-server.test.ts`

**Step 1: Install ws package**

```bash
cd tools/orchestrator && npm install ws && npm install -D @types/ws
```

**Step 2: Write the WebSocket server**

```typescript
// ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { SessionRegistry, SessionEntry } from './session-registry.js';

export interface WsServerOptions {
  port: number;
  registry: SessionRegistry;
}

export interface WsMessage {
  type: 'init' | 'session_registered' | 'session_status' | 'session_ended';
  data: SessionEntry | SessionEntry[];
}

export function createWsServer(options: WsServerOptions): { start: () => void; stop: () => Promise<void> } {
  const { port, registry } = options;
  let wss: WebSocketServer | null = null;

  function broadcast(msg: WsMessage): void {
    if (!wss) return;
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function start(): void {
    wss = new WebSocketServer({ port });

    wss.on('connection', (ws) => {
      // Send current state on connect
      ws.send(JSON.stringify({
        type: 'init',
        data: registry.getAll(),
      } satisfies WsMessage));
    });

    // Forward registry events as broadcasts
    registry.on('session-registered', (entry: SessionEntry) => {
      broadcast({ type: 'session_registered', data: entry });
    });
    registry.on('session-status', (entry: SessionEntry) => {
      broadcast({ type: 'session_status', data: entry });
    });
    registry.on('session-ended', (entry: SessionEntry) => {
      broadcast({ type: 'session_ended', data: entry });
    });
  }

  async function stop(): Promise<void> {
    if (!wss) return;
    return new Promise((resolve) => {
      wss!.close(() => resolve());
    });
  }

  return { start, stop };
}
```

**Step 3: Write tests**

Test that:
- Server starts and accepts WebSocket connections
- New clients receive 'init' message with current registry state
- Registry events are broadcast to all connected clients
- `stop()` closes the server cleanly
- Multiple clients each receive broadcasts

Use real WebSocket connections in tests (ws client connecting to localhost).

**Step 4: Run tests and commit**

```bash
cd tools/orchestrator && npm run verify
```

```
feat(orchestrator): add WebSocket server for session registry broadcasts
```

---

## Task 6: Wire Registry + WebSocket into Orchestrator Loop

**Files:**
- Modify: `tools/orchestrator/src/loop.ts` — create registry, start WS server, register/end sessions
- Modify: `tools/orchestrator/src/types.ts` — add WS port to OrchestratorConfig
- Modify: `tools/orchestrator/src/index.ts` — pass registry to orchestrator (if entry point exists)
- Test: Update integration tests

**Step 1: Add WS port to config**

In `types.ts`, add to `OrchestratorConfig`:

```typescript
wsPort?: number; // default 3101
```

**Step 2: Create registry and WS server in orchestrator startup**

In `loop.ts`, inside `createOrchestrator()`:

```typescript
const registry = new SessionRegistry();
const wsServer = createWsServer({ port: config.wsPort ?? 3101, registry });
```

Start WS server in `start()`, stop in `stop()`.

**Step 3: Wire session lifecycle**

When spawning a session:
1. Call `registry.register({ stageId, sessionId: '', processId: pid, worktreePath, spawnedAt: Date.now() })`
2. Pass `onSessionId` callback that calls `registry.activate(stageId, sessionId)` and writes to DB via `deps.stages.updateSessionId(stageId, sessionId)`

When session ends:
1. Call `registry.end(stageId)`

**Step 4: Add registry to OrchestratorDeps or create internally**

Decide whether registry is injected (for testability) or created internally. Recommend: create internally but expose via `getRegistry()` method on the Orchestrator interface.

**Step 5: Update integration tests**

- Mock or stub the WebSocket server in tests (don't bind real ports in unit tests)
- Verify registry lifecycle through spawn → activate → end flow

**Step 6: Run all orchestrator tests**

```bash
cd tools/orchestrator && npm run verify
```

**Step 7: Commit**

```
feat(orchestrator): wire SessionRegistry + WebSocket into orchestrator loop
```

---

## Task 7: WebSocket Client in Web Server

**Files:**
- Create: `tools/web-server/src/server/services/orchestrator-client.ts`
- Modify: `tools/web-server/package.json` — add `ws` dependency
- Modify: `tools/web-server/src/server/app.ts` — register lifecycle hooks
- Modify: `tools/web-server/src/server/index.ts` — pass config
- Test: `tools/web-server/tests/server/orchestrator-client.test.ts`

**Step 1: Install ws**

```bash
cd tools/web-server && npm install ws && npm install -D @types/ws
```

**Step 2: Write the orchestrator client**

```typescript
// orchestrator-client.ts
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface SessionInfo {
  stageId: string;
  sessionId: string;
  processId: number;
  worktreePath: string;
  status: 'starting' | 'active' | 'ended';
  spawnedAt: number;
  lastActivity: number;
}

export class OrchestratorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessions = new Map<string, SessionInfo>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private shouldConnect: boolean = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  connect(): void {
    this.shouldConnect = true;
    this.tryConnect();
  }

  disconnect(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getSession(stageId: string): SessionInfo | undefined {
    return this.sessions.get(stageId);
  }

  getSessionBySessionId(sessionId: string): SessionInfo | undefined {
    for (const s of this.sessions.values()) {
      if (s.sessionId === sessionId) return s;
    }
    return undefined;
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  private tryConnect(): void {
    if (!this.shouldConnect) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => this.emit('connected'));
      this.ws.on('message', (data) => this.handleMessage(data.toString()));
      this.ws.on('close', () => this.scheduleReconnect());
      this.ws.on('error', () => { /* close event will fire */ });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect) return;
    this.reconnectTimer = setTimeout(() => this.tryConnect(), 3000);
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'init':
          this.sessions.clear();
          for (const entry of msg.data as SessionInfo[]) {
            this.sessions.set(entry.stageId, entry);
          }
          this.emit('init', this.getAllSessions());
          break;
        case 'session_registered':
          this.sessions.set(msg.data.stageId, msg.data);
          this.emit('session-registered', msg.data);
          break;
        case 'session_status':
          this.sessions.set(msg.data.stageId, msg.data);
          this.emit('session-status', msg.data);
          break;
        case 'session_ended':
          this.sessions.delete(msg.data.stageId);
          this.emit('session-ended', msg.data);
          break;
      }
    } catch { /* ignore malformed messages */ }
  }
}
```

**Step 3: Register in app.ts**

Add `orchestratorClient` to ServerOptions (optional). Register Fastify lifecycle hooks:

```typescript
if (options.orchestratorClient) {
  app.decorate('orchestratorClient', options.orchestratorClient);
  app.addHook('onReady', async () => options.orchestratorClient!.connect());
  app.addHook('onClose', async () => options.orchestratorClient!.disconnect());
}
```

**Step 4: Wire in index.ts**

```typescript
const orchestratorWsUrl = process.env.ORCHESTRATOR_WS_URL ?? 'ws://localhost:3101';
const orchestratorClient = new OrchestratorClient(orchestratorWsUrl);
```

Pass to `createServer()`.

**Step 5: Write tests**

Test that:
- Handles init message and populates sessions map
- Handles session_registered, session_status, session_ended
- `getSession()` and `getSessionBySessionId()` work correctly
- Auto-reconnect on disconnect (use mock WS server)
- `disconnect()` stops reconnection attempts

**Step 6: Run tests and commit**

```bash
cd tools/web-server && npm run verify
```

```
feat(web-server): add OrchestratorClient WebSocket connection
```

---

## Task 8: JSONL Type Definitions

**Files:**
- Create: `tools/web-server/src/server/types/jsonl.ts`
- No tests needed (pure types)

**What this does:** Defines all TypeScript types for JSONL entries, content blocks, parsed messages, chunks, tool executions, subagent processes, session metrics, and context tracking. This is the data contract for all 9E services.

**Step 1: Write the type definitions**

Port the full type system from the research docs (`deep-dive-jsonl-hooks.md` Section 11). Key types:

**Entry types:**
- `EntryType` union: `'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation'`
- `ContentBlock` union: `TextContent | ThinkingContent | ToolUseContent | ToolResultContent | ImageContent`
- `UserEntry`, `AssistantEntry`, `SystemEntry`, `SummaryEntry`, `FileHistorySnapshotEntry`, `QueueOperationEntry`
- `UsageMetadata`, `StopReason`

**Parsed types:**
- `ParsedMessage` — normalized message with extracted tool calls/results
- `ToolCall` — `{ id, name, input, isTask, taskDescription?, taskSubagentType? }`
- `ToolResult` — `{ toolUseId, content, isError }`

**Chunk types:**
- `MessageCategory`: `'user' | 'system' | 'hardNoise' | 'ai'`
- `UserChunk`, `AIChunk`, `SystemChunk`, `CompactChunk`
- `Chunk` union type
- `EnhancedAIChunk` — AIChunk with semantic steps and linked subagents

**Analysis types:**
- `SemanticStep` — `{ type: 'thinking' | 'tool_call' | 'tool_result' | 'subagent' | 'output' | 'interruption', ... }`
- `ToolExecution` — matched tool_use + tool_result with duration
- `Process` — subagent execution with messages, metrics, linking info

**Session types:**
- `SessionMetrics` — `{ totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalCost, turnCount, toolCallCount, duration }`
- `ParsedSession` — `{ chunks, metrics, subagents, isOngoing }`

**Context types:**
- `TokensByCategory` — 7 categories
- `ContextStats` — per-turn attribution
- `ContextPhaseInfo` — compaction-aware phase tracking

**Step 2: Commit**

```
feat(web-server): add JSONL type definitions for session parsing pipeline
```

---

## Task 9: SessionParser Service

**Files:**
- Create: `tools/web-server/src/server/services/session-parser.ts`
- Create: `tools/web-server/tests/fixtures/` — JSONL test fixtures
- Test: `tools/web-server/tests/server/services/session-parser.test.ts`

**What this does:** Parses raw JSONL files line-by-line into `ParsedMessage[]`. This is the foundation all other services build on.

**Step 1: Create JSONL test fixtures**

Create realistic test fixtures in `tests/fixtures/`:

- `simple-conversation.jsonl` — 2-turn conversation (user → assistant → user → assistant) with text content
- `tool-calls.jsonl` — conversation with tool_use and tool_result blocks (Bash, Read, Edit)
- `subagent-session.jsonl` — conversation with Task tool calls spawning subagents
- `compact-summary.jsonl` — conversation with a summary entry mid-stream (compaction)
- `malformed.jsonl` — mix of valid JSON, invalid JSON, empty lines, progress entries (no uuid)
- `empty.jsonl` — empty file

Each fixture should use realistic field values matching the JSONL format documented in `deep-dive-jsonl-hooks.md`.

**Step 2: Write the parser**

```typescript
// session-parser.ts
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { ParsedMessage, ToolCall, ToolResult, ContentBlock } from '../types/jsonl.js';

export interface ParseOptions {
  /** Byte offset to start reading from (for incremental parsing) */
  startOffset?: number;
}

export async function parseSessionFile(
  filePath: string,
  options?: ParseOptions
): Promise<{ messages: ParsedMessage[]; bytesRead: number }> {
  // Implementation:
  // 1. createReadStream with start: options?.startOffset
  // 2. readline.createInterface
  // 3. For each line: JSON.parse, skip if no uuid, extract fields
  // 4. Return messages + total bytes read
}

export function parseJsonlLine(line: string): ParsedMessage | null {
  // Parse single JSON line into ParsedMessage
  // Skip entries without uuid (filters progress entries)
  // Extract: uuid, parentUuid, type, timestamp, role, content, usage, model
  // Extract tool calls from content blocks
  // Extract tool results from content blocks
  // Capture special fields: sourceToolUseID, sourceToolAssistantUUID, toolUseResult
  // Detect compact summaries via isCompactSummary field
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  // Scan content blocks for type: 'tool_use'
  // Build ToolCall objects with isTask detection (name === 'Task')
}

function extractToolResults(content: ContentBlock[]): ToolResult[] {
  // Scan content blocks for type: 'tool_result'
  // Build ToolResult objects
}
```

**Step 3: Write tests**

Test that:
- Parses simple conversation fixture into correct ParsedMessage array
- Extracts tool calls from assistant messages
- Extracts tool results from user messages (isMeta entries)
- Links sourceToolUseID and sourceToolAssistantUUID
- Skips progress entries (no uuid)
- Handles malformed lines gracefully (skip, don't throw)
- Handles empty files (returns empty array)
- Detects compact summaries
- Incremental parsing with startOffset works correctly
- Returns accurate bytesRead count

**Step 4: Run tests and commit**

```bash
cd tools/web-server && npm run test
```

```
feat(web-server): add SessionParser for JSONL line-by-line parsing
```

---

## Task 10: ToolExecutionBuilder Service

**Files:**
- Create: `tools/web-server/src/server/services/tool-execution-builder.ts`
- Test: `tools/web-server/tests/server/services/tool-execution-builder.test.ts`

**What this does:** Matches `tool_use` content blocks to `tool_result` content blocks, calculating duration for each execution.

**Step 1: Write the builder**

```typescript
// tool-execution-builder.ts
import type { ParsedMessage, ToolExecution } from '../types/jsonl.js';

export function buildToolExecutions(messages: ParsedMessage[]): ToolExecution[] {
  // Pass 1: Collect all tool calls into Map<toolUseId, { call, message, timestamp }>
  // Pass 2: Match tool results via sourceToolUseID (most reliable)
  // Pass 2b: Fallback via tool_result.tool_use_id in content blocks
  // Calculate duration from call timestamp to result timestamp
  // Detect orphaned tool calls (no result) — mark as running or failed
  // Sort by start time
}
```

**Step 2: Write tests using tool-calls fixture**

Test that:
- Matches tool_use to tool_result by sourceToolUseID
- Falls back to tool_result.tool_use_id matching
- Calculates correct duration in milliseconds
- Detects orphaned tool calls (present in output as `result: undefined`)
- Handles empty messages array
- Results sorted by start time

**Step 3: Run tests and commit**

```
feat(web-server): add ToolExecutionBuilder for tool_use/result linking
```

---

## Task 11: ChunkBuilder Service

**Files:**
- Create: `tools/web-server/src/server/services/chunk-builder.ts`
- Test: `tools/web-server/tests/server/services/chunk-builder.test.ts`

**What this does:** Groups ParsedMessages into visualization chunks (UserChunk, AIChunk, SystemChunk, CompactChunk) and extracts semantic steps.

**Step 1: Write the message classifier**

```typescript
export function classifyMessage(msg: ParsedMessage): MessageCategory {
  // 'user': type='user', isMeta!=true, has text/image content, no system XML tags
  // 'system': type='user', content contains <local-command-stdout>
  // 'hardNoise': system/summary/file-history-snapshot/queue-operation entries,
  //   contains <local-command-caveat>, <system-reminder>, synthetic assistant (model='<synthetic>'),
  //   interruption text '[Request interrupted by user]'
  // 'ai': everything else
}
```

**Step 2: Write the chunk builder**

```typescript
export function buildChunks(messages: ParsedMessage[]): Chunk[] {
  // Filter out hardNoise
  // Buffer consecutive AI messages
  // On user message: flush AI buffer → AIChunk, create UserChunk
  // On system message: flush AI buffer → SystemChunk
  // On compact boundary (isCompactSummary): flush → CompactChunk
  // Final flush for trailing AI messages
}
```

**Step 3: Write semantic step extraction**

```typescript
export function extractSemanticSteps(chunk: AIChunk, toolExecutions: ToolExecution[]): SemanticStep[] {
  // Walk through chunk's messages and their content blocks
  // Produce: thinking, tool_call, tool_result, subagent, output, interruption steps
}
```

**Step 4: Write tests**

Test that:
- Simple conversation produces [UserChunk, AIChunk, UserChunk, AIChunk]
- System messages create SystemChunks
- Hard noise is filtered out entirely
- Compact summaries create CompactChunks
- isMeta tool result user messages are classified as 'ai' (not 'user')
- Semantic steps correctly identify thinking, tool calls, text output
- Edge case: empty messages array returns empty chunks

**Step 5: Run tests and commit**

```
feat(web-server): add ChunkBuilder for message grouping and semantic steps
```

---

## Task 12: SubagentResolver Service

**Files:**
- Create: `tools/web-server/src/server/services/subagent-resolver.ts`
- Create: `tools/web-server/tests/fixtures/subagents/` — subagent JSONL fixtures
- Test: `tools/web-server/tests/server/services/subagent-resolver.test.ts`

**What this does:** Discovers subagent JSONL files and links them to parent Task tool calls using 3-phase matching.

**Step 1: Create subagent test fixtures**

In `tests/fixtures/subagents/`:
- `agent-abc123.jsonl` — a simple subagent session (user prompt → assistant response)
- `agent-def456.jsonl` — a subagent with its own tool calls

**Step 2: Write the resolver**

```typescript
// subagent-resolver.ts
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { ParsedMessage, Process } from '../types/jsonl.js';
import { parseSessionFile } from './session-parser.js';

export interface SubagentResolverOptions {
  projectDir: string;
  sessionId: string;
}

export async function resolveSubagents(
  parentMessages: ParsedMessage[],
  options: SubagentResolverOptions
): Promise<Process[]> {
  // 1. Discover subagent files
  //    - New structure: {projectDir}/{sessionId}/subagents/agent-*.jsonl
  //    - Legacy structure: {projectDir}/agent-*.jsonl (verify via sessionId in first line)
  // 2. Filter out warmup (content = "Warmup"), compact (acompact*), empty files
  // 3. Parse each subagent file
  // 4. Three-phase linking:
  //    a. Result-based: match toolUseResult.agentId to subagent file agent ID
  //    b. Description-based: match Task description to <teammate-message summary="...">
  //    c. Positional fallback: match remaining by chronological order
  // 5. Detect parallel subagents (start times within 100ms)
  // 6. Calculate metrics per subagent
}

async function discoverSubagentFiles(
  projectDir: string,
  sessionId: string
): Promise<{ agentId: string; filePath: string }[]> {
  // Scan both directory structures
}

function isFilteredAgent(messages: ParsedMessage[], agentId: string): boolean {
  // Check warmup, compact, empty
}
```

**Step 3: Write tests**

Test that:
- Discovers subagent files in new directory structure
- Discovers subagent files in legacy directory structure
- Filters out warmup agents, compact files, empty files
- Result-based linking matches correctly
- Positional fallback works for unmatched agents
- Parallel detection marks agents with close start times
- Returns empty array when no subagent files exist

**Step 4: Run tests and commit**

```
feat(web-server): add SubagentResolver for subagent discovery and linking
```

---

## Task 13: ContextTracker Service

**Files:**
- Create: `tools/web-server/src/server/services/context-tracker.ts`
- Test: `tools/web-server/tests/server/services/context-tracker.test.ts`

**What this does:** Tracks token attribution across 7 categories per conversation turn, with compaction-aware phase tracking.

**Step 1: Write the tracker**

```typescript
// context-tracker.ts
import type { Chunk, AIChunk, TokensByCategory, ContextStats, ContextPhaseInfo } from '../types/jsonl.js';

export function trackContext(chunks: Chunk[]): {
  perTurn: ContextStats[];
  phases: ContextPhaseInfo[];
} {
  // Walk chunks sequentially
  // For each AIChunk:
  //   - Detect CLAUDE.md injections (first turn: global; subsequent: directory-level)
  //   - Detect @-mentioned file content
  //   - Sum tool output tokens (tool_call + tool_result)
  //   - Sum thinking + text output tokens
  //   - Sum task coordination tokens (SendMessage, TeamCreate, TaskCreate/Update)
  //   - Sum user message tokens
  // Handle CompactChunks: start new phase, calculate compaction delta
  // Return per-turn stats and phase boundaries
}
```

**Categories:**
1. `claudeMd` — content containing CLAUDE.md, `<system-reminder>` with settings
2. `mentionedFiles` — @-mentioned file content in user messages
3. `toolOutputs` — tool call inputs + tool result outputs
4. `thinkingText` — thinking blocks + text output blocks
5. `taskCoordination` — Task/SendMessage/TeamCreate tool calls
6. `userMessages` — real user input text

**Step 2: Write tests**

Test that:
- Simple conversation has correct user message and thinking/text attribution
- Tool calls are attributed to toolOutputs category
- Compaction creates phase boundary
- Cumulative totals increase across turns
- Empty chunks return empty stats

**Step 3: Run tests and commit**

```
feat(web-server): add ContextTracker for 7-category token attribution
```

---

## Task 14: PricingEngine Service

**Files:**
- Create: `tools/web-server/src/server/services/pricing.ts`
- Test: `tools/web-server/tests/server/services/pricing.test.ts`

**What this does:** Calculates per-session costs using tiered pricing for different Claude models.

**Step 1: Write the pricing engine**

```typescript
// pricing.ts
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number;
  cacheReadPerMillion: number;
  /** Threshold above which prices may differ (200K default) */
  tierThreshold?: number;
  inputPerMillionAboveTier?: number;
  outputPerMillionAboveTier?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheCreationPerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheCreationPerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
};

export function calculateCost(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model: string;
}): number {
  // Look up model pricing (with fallback matching for model name variants)
  // Calculate: (input * rate + output * rate + cache_creation * rate + cache_read * rate) / 1_000_000
}

export function calculateSessionCost(messages: ParsedMessage[]): {
  totalCost: number;
  costByModel: Record<string, number>;
} {
  // Aggregate usage across all assistant messages
  // Group by model, calculate per-model and total
}
```

**Step 2: Write tests**

Test that:
- Calculates correct cost for known token counts and model
- Handles unknown model gracefully (returns 0 or uses default)
- Aggregates across multiple assistant messages
- Cache tokens are accounted for
- costByModel breakdown is correct

**Step 3: Run tests and commit**

```
feat(web-server): add PricingEngine for session cost calculation
```

---

## Task 15: DataCache Service

**Files:**
- Create: `tools/web-server/src/server/services/data-cache.ts`
- Test: `tools/web-server/tests/server/services/data-cache.test.ts`

**What this does:** LRU cache bounded by memory size for parsed session data.

**Step 1: Write the cache**

```typescript
// data-cache.ts
export interface CacheEntry<T> {
  data: T;
  sizeBytes: number;
  lastAccessed: number;
  accessCount: number;
}

export class DataCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private currentSizeBytes = 0;
  private maxSizeBytes: number;

  constructor(maxSizeMB: number = 50) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    return entry.data;
  }

  set(key: string, data: T, sizeBytes: number): void {
    // Remove existing entry if present
    this.delete(key);
    // Evict LRU entries until we have room
    while (this.currentSizeBytes + sizeBytes > this.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }
    this.cache.set(key, { data, sizeBytes, lastAccessed: Date.now(), accessCount: 1 });
    this.currentSizeBytes += sizeBytes;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.currentSizeBytes -= entry.sizeBytes;
    this.cache.delete(key);
    return true;
  }

  invalidate(key: string): boolean {
    return this.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number { return this.cache.size; }
  get totalSizeBytes(): number { return this.currentSizeBytes; }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestAccess) {
        oldest = key;
        oldestAccess = entry.lastAccessed;
      }
    }
    if (oldest) this.delete(oldest);
  }
}
```

**Step 2: Write tests**

Test that:
- `set()` and `get()` work correctly
- `get()` updates lastAccessed
- Evicts LRU entry when size limit exceeded
- `invalidate()` removes specific entry
- `clear()` removes all entries
- Size tracking is accurate
- Handles zero-size entries

**Step 3: Run tests and commit**

```
feat(web-server): add DataCache with LRU eviction and size bounds
```

---

## Task 16: FileWatcher Service

**Files:**
- Create: `tools/web-server/src/server/services/file-watcher.ts`
- Test: `tools/web-server/tests/server/services/file-watcher.test.ts`

**What this does:** Watches `~/.claude/projects/` for JSONL file changes with incremental byte-offset parsing and debouncing.

**Step 1: Write the watcher**

```typescript
// file-watcher.ts
import { watch, stat } from 'fs';
import { readdir } from 'fs/promises';
import { join, basename, relative } from 'path';
import { EventEmitter } from 'events';

export interface FileChangeEvent {
  projectId: string;
  sessionId: string;
  filePath: string;
  isSubagent: boolean;
}

export interface FileWatcherOptions {
  rootDir: string; // ~/.claude/projects
  debounceMs?: number; // default 100
  catchUpIntervalMs?: number; // default 30000
}

export class FileWatcher extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null;
  private catchUpTimer: ReturnType<typeof setInterval> | null = null;
  private fileOffsets = new Map<string, number>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private options: Required<FileWatcherOptions>;

  constructor(options: FileWatcherOptions) {
    super();
    this.options = {
      debounceMs: 100,
      catchUpIntervalMs: 30000,
      ...options,
    };
  }

  start(): void {
    // fs.watch with recursive: true
    // On change: debounce per-file, then emit file-change event
    // Start catch-up interval
  }

  stop(): void {
    // Close watcher, clear timers
  }

  /** Get current byte offset for a file (for incremental parsing) */
  getOffset(filePath: string): number {
    return this.fileOffsets.get(filePath) ?? 0;
  }

  /** Update byte offset after successful parse */
  setOffset(filePath: string, offset: number): void {
    this.fileOffsets.set(filePath, offset);
  }

  private handleChange(eventType: string, filename: string | null): void {
    // Parse filename to extract projectId, sessionId, isSubagent
    // Debounce per-file
    // Emit 'file-change' event
  }

  private async catchUpScan(): Promise<void> {
    // Scan all known JSONL files for size changes
    // Emit events for any files that grew since last offset
  }
}
```

**Step 2: Write tests**

Test that:
- Emits 'file-change' for new/modified JSONL files
- Debounces rapid changes to same file (only one event per debounce window)
- Tracks byte offsets correctly
- Catch-up scan detects missed changes
- Parses projectId and sessionId from file paths
- Correctly identifies subagent files (agent-*.jsonl)
- `stop()` cleans up watchers and timers
- Handles non-existent root directory gracefully

Note: File system watcher tests may need real temp directories with actual file writes to trigger `fs.watch`.

**Step 3: Run tests and commit**

```
feat(web-server): add FileWatcher for incremental JSONL monitoring
```

---

## Task 17: Session Parsing Pipeline (Orchestration)

**Files:**
- Create: `tools/web-server/src/server/services/session-pipeline.ts`
- Test: `tools/web-server/tests/server/services/session-pipeline.test.ts`

**What this does:** Orchestrates all services into a single parsing pipeline: file → parse → chunks → tool executions → subagents → context → pricing → ParsedSession.

**Step 1: Write the pipeline**

```typescript
// session-pipeline.ts
import type { ParsedSession, SessionMetrics } from '../types/jsonl.js';
import { parseSessionFile } from './session-parser.js';
import { buildToolExecutions } from './tool-execution-builder.js';
import { buildChunks, extractSemanticSteps } from './chunk-builder.js';
import { resolveSubagents } from './subagent-resolver.js';
import { trackContext } from './context-tracker.js';
import { calculateSessionCost } from './pricing.js';
import { DataCache } from './data-cache.js';

export interface SessionPipelineOptions {
  cacheSizeMB?: number;
}

export class SessionPipeline {
  private cache: DataCache<ParsedSession>;

  constructor(options?: SessionPipelineOptions) {
    const sizeMB = options?.cacheSizeMB ?? parseInt(process.env.CACHE_SIZE_MB ?? '50', 10);
    this.cache = new DataCache<ParsedSession>(sizeMB);
  }

  async parseSession(projectDir: string, sessionId: string): Promise<ParsedSession> {
    const cacheKey = `${projectDir}/${sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const { messages } = await parseSessionFile(filePath);
    const toolExecutions = buildToolExecutions(messages);
    const chunks = buildChunks(messages);
    // Enhance AI chunks with semantic steps
    const subagents = await resolveSubagents(messages, { projectDir, sessionId });
    const context = trackContext(chunks);
    const { totalCost, costByModel } = calculateSessionCost(messages);
    const metrics = computeMetrics(messages, toolExecutions, totalCost);

    const session: ParsedSession = {
      chunks,
      metrics,
      subagents,
      context,
      costByModel,
      isOngoing: detectOngoing(messages),
    };

    // Estimate size for cache (rough: JSON.stringify length * 2 for UTF-16)
    const sizeEstimate = JSON.stringify(session).length * 2;
    this.cache.set(cacheKey, session, sizeEstimate);
    return session;
  }

  async getMetrics(projectDir: string, sessionId: string): Promise<SessionMetrics> {
    const session = await this.parseSession(projectDir, sessionId);
    return session.metrics;
  }

  invalidateSession(projectDir: string, sessionId: string): void {
    this.cache.invalidate(`${projectDir}/${sessionId}`);
  }
}

function computeMetrics(messages, toolExecutions, totalCost): SessionMetrics { /* ... */ }
function detectOngoing(messages): boolean { /* ... */ }
```

**Step 2: Write tests**

Test that:
- Full pipeline produces correct ParsedSession from fixture file
- Caching works (second call returns cached result)
- `invalidateSession()` forces re-parse
- `getMetrics()` returns subset of data
- Pipeline handles empty sessions gracefully

**Step 3: Run tests and commit**

```
feat(web-server): add SessionPipeline orchestrating full parsing flow
```

---

## Task 18: Replace 501 Stubs with Real API Endpoints

**Files:**
- Modify: `tools/web-server/src/server/routes/sessions.ts` — replace stubs
- Modify: `tools/web-server/src/server/app.ts` — register pipeline + file watcher
- Modify: `tools/web-server/src/server/index.ts` — initialize services
- Test: `tools/web-server/tests/server/sessions.test.ts` — add tests for new endpoints

**Step 1: Register SessionPipeline and FileWatcher on Fastify**

In `app.ts`:

```typescript
// Add to ServerOptions
sessionPipeline?: SessionPipeline;
fileWatcher?: FileWatcher;

// Decorate
if (options.sessionPipeline) {
  app.decorate('sessionPipeline', options.sessionPipeline);
}
if (options.fileWatcher) {
  app.addHook('onReady', () => options.fileWatcher!.start());
  app.addHook('onClose', () => options.fileWatcher!.stop());

  // Invalidate cache on file changes
  options.fileWatcher.on('file-change', (event: FileChangeEvent) => {
    options.sessionPipeline?.invalidateSession(
      join(options.claudeProjectsDir!, event.projectId),
      event.sessionId
    );
  });
}
```

**Step 2: Replace GET /api/sessions/:projectId/:sessionId**

```typescript
app.get<{ Params: { projectId: string; sessionId: string } }>(
  '/api/sessions/:projectId/:sessionId',
  async (request, reply) => {
    const { projectId, sessionId } = request.params;
    const projectDir = resolve(app.claudeProjectsDir, projectId);
    // Path traversal guard (existing)
    const session = await app.sessionPipeline.parseSession(projectDir, sessionId);
    return session;
  }
);
```

**Step 3: Add GET /api/sessions/:projectId/:sessionId/metrics**

```typescript
app.get<{ Params: { projectId: string; sessionId: string } }>(
  '/api/sessions/:projectId/:sessionId/metrics',
  async (request, reply) => {
    const { projectId, sessionId } = request.params;
    const projectDir = resolve(app.claudeProjectsDir, projectId);
    const metrics = await app.sessionPipeline.getMetrics(projectDir, sessionId);
    return metrics;
  }
);
```

**Step 4: Add GET /api/sessions/:projectId/:sessionId/subagents/:agentId**

```typescript
app.get<{ Params: { projectId: string; sessionId: string; agentId: string } }>(
  '/api/sessions/:projectId/:sessionId/subagents/:agentId',
  async (request, reply) => {
    const { projectId, sessionId, agentId } = request.params;
    const projectDir = resolve(app.claudeProjectsDir, projectId);
    const session = await app.sessionPipeline.parseSession(projectDir, sessionId);
    const agent = session.subagents.find(s => s.id === agentId);
    if (!agent) return reply.status(404).send({ error: 'Subagent not found' });
    return agent;
  }
);
```

**Step 5: Add a stage-to-session convenience endpoint**

```typescript
// GET /api/stages/:stageId/session — resolve stage → session via DB
app.get<{ Params: { stageId: string } }>(
  '/api/stages/:stageId/session',
  async (request, reply) => {
    const { stageId } = request.params;
    const stage = app.dataService.stages.findById(stageId);
    if (!stage) return reply.status(404).send({ error: 'Stage not found' });
    if (!stage.session_id) return reply.status(404).send({ error: 'No session linked to this stage' });
    // Derive projectId from stage's repo path
    // Parse and return session
  }
);
```

**Step 6: Update tests**

- Update existing 501 tests to expect 200 or proper error responses
- Add test with JSONL fixture files in temp directory
- Test session detail endpoint returns ParsedSession shape
- Test metrics endpoint returns SessionMetrics shape
- Test subagent endpoint with known agent ID
- Test subagent endpoint with unknown agent ID returns 404
- Test stage-to-session convenience endpoint
- Preserve all existing session listing tests

**Step 7: Run full test suite**

```bash
cd tools/web-server && npm run verify
```

**Step 8: Commit**

```
feat(web-server): replace session 501 stubs with full JSONL parsing endpoints
```

---

## Task 19: Integration Testing + Cross-Package Verification

**Files:**
- Test: integration-level tests touching multiple services together
- Verify: all three packages pass

**Step 1: Create an end-to-end test**

Write a test that:
1. Creates a temp directory with realistic JSONL fixtures (main session + subagent)
2. Initializes SessionPipeline
3. Calls `parseSession()` and verifies the full shape
4. Calls the API endpoint via Fastify inject and verifies response

**Step 2: Verify all packages**

```bash
cd tools/kanban-cli && npm run verify    # existing 888+ tests still pass
cd tools/orchestrator && npm run verify  # existing 396+ tests + new 10A tests
cd tools/web-server && npm run verify    # existing 79+ tests + new 9E tests
```

**Step 3: Commit**

```
test(web-server): add integration tests for session parsing pipeline
```

---

## Task 20: Update Seed Data + Web Server Types

**Files:**
- Modify: `tools/web-server/tests/helpers/seed-data.ts` — add session_id to seed stages
- Modify: `tools/web-server/src/client/api/hooks.ts` — add session_id to StageItem types (for 9F readiness)
- Modify: `tools/web-server/src/server/routes/stages.ts` — include session_id in stage responses

**Step 1: Update seed data**

Add `session_id` field to seeded stages (null for most, a test UUID for one).

**Step 2: Update API types**

Add `session_id: string | null` to stage response types.

**Step 3: Update stage routes**

Include `session_id` in stage detail and list responses.

**Step 4: Run all tests**

```bash
cd tools/web-server && npm run verify
```

**Step 5: Commit**

```
feat(web-server): expose session_id in stage API responses
```

---

## Summary

| Task | Package | What | Est. Lines |
|------|---------|------|-----------|
| 1 | kanban-cli | session_id DB column + migration | ~40 |
| 2 | orchestrator | StreamParser for JSON stdout | ~80 |
| 3 | orchestrator | SessionRegistry | ~80 |
| 4 | orchestrator | Integrate stream-JSON into session.ts | ~60 |
| 5 | orchestrator | WebSocket server | ~80 |
| 6 | orchestrator | Wire registry + WS into loop | ~60 |
| 7 | web-server | OrchestratorClient WS connection | ~120 |
| 8 | web-server | JSONL type definitions | ~200 |
| 9 | web-server | SessionParser | ~150 |
| 10 | web-server | ToolExecutionBuilder | ~80 |
| 11 | web-server | ChunkBuilder | ~200 |
| 12 | web-server | SubagentResolver | ~200 |
| 13 | web-server | ContextTracker | ~150 |
| 14 | web-server | PricingEngine | ~80 |
| 15 | web-server | DataCache | ~80 |
| 16 | web-server | FileWatcher | ~150 |
| 17 | web-server | SessionPipeline orchestration | ~120 |
| 18 | web-server | API endpoints (replace stubs) | ~150 |
| 19 | web-server | Integration tests | ~100 |
| 20 | web-server | Seed data + API type updates | ~40 |

**Total: ~20 tasks, ~2200 lines of implementation + tests**
