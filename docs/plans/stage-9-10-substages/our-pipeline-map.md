# Our Pipeline Map: JSONL to Rendered React Output

Exhaustive documentation of every transformation step in our session viewing pipeline,
from raw `.jsonl` files on disk to pixels on screen.

---

## Overview: Data Flow Diagram

```
 .jsonl file on disk
        |
        v
 [1] SessionParser.parseSessionFile()
     (stream → line → JSON.parse → ParsedMessage[])
        |
        v
 [2] SessionPipeline.parseSession()  -- orchestrates all enrichment
     |        |         |            |           |
     v        v         v            v           v
  buildTool  buildChunks  resolveSubagents  calculateSessionCost
  Executions                                      |
     |        |         |                         v
     v        v         v                    totalCost
  ToolExecution[]  Chunk[]  Process[]
     |        |         |
     +---+----+---------+
         |
         v
  enhanceAIChunks() — attaches semanticSteps to AI chunks
         |
         v
  computeMetrics() — aggregates SessionMetrics
         |
         v
  ParsedSession { chunks, metrics, subagents, isOngoing }
         |
         v
  DataCache<ParsedSession> — LRU in-memory cache (50 MB default)
         |
         v
 [3] Fastify route handler → HTTP JSON response
         |
         v
 [4] React Query (useSessionDetail hook)
         |
         v
 [5] SessionDetail page → ChatHistory → chunk components → items → tool renderers
```

---

## 1. Server-Side Parsing: SessionParser

**File**: `/tools/web-server/src/server/services/session-parser.ts`

### Entry Point: `parseSessionFile(filePath, options?)`

**Input**:
- `filePath: string` — absolute path to a `.jsonl` file
- `options?.startOffset?: number` — byte offset for incremental parsing

**Output**: `ParseResult { messages: ParsedMessage[], bytesRead: number }`

**Mechanism**:
1. `stat()` the file to get size; return empty if missing/empty/offset-past-end
2. `createReadStream(filePath, { start: startOffset })` — node:fs
3. `createInterface({ input: stream })` — node:readline, line-by-line
4. Each line → `parseJsonlLine(line)` → `ParsedMessage | null`
5. Accumulate non-null results
6. Return `{ messages, bytesRead: fileSize - startOffset }`

### Line Parser: `parseJsonlLine(line)`

**Input**: raw JSON string (one JSONL line)

**Output**: `ParsedMessage | null`

**Filtering (returns null)**:
- Empty/whitespace lines
- Invalid JSON
- Non-object or array JSON
- Entries without a `uuid` field (progress entries, etc.)
- Unknown `type` values (not in `KNOWN_ENTRY_TYPES`)

**Known Entry Types**: `'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation'`

**Entry-Type-Specific Handling**:

| Entry Type | Special Handling |
|---|---|
| `summary` | Sets `content` from `raw.summary`, `isCompactSummary: true`, no message field |
| `file-history-snapshot` | Empty content, `isMeta: true`, no tool data |
| `queue-operation` | Content from `raw.content`, `isMeta: true` |
| `system` | Forces `isMeta: true` |
| `user`/`assistant` | Extracts from `raw.message` (content, usage, model) |

**Note on `isCompactSummary`**: The `summary` entry type forces `isCompactSummary: true`, but other entry types can also have this field set from the raw JSONL entry data. When present on non-summary entries, the raw entry's `isCompactSummary` field is propagated to the `ParsedMessage`.

**Tool Extraction** (only when content is `ContentBlock[]`):
- `extractToolCalls(content)` — finds all `tool_use` blocks, creates `ToolCall[]`
  - Detects `isTask: true` when `toolUse.name === 'Task'`
  - Extracts `taskDescription` from `input.description`
  - Extracts `taskSubagentType` from `input.subagent_type`
- `extractToolResults(content)` — finds all `tool_result` blocks, creates `ToolResult[]`

### ParsedMessage Type

```typescript
interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  type: EntryType;  // 'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation'
  timestamp: Date;
  role?: string;
  content: ContentBlock[] | string;
  usage?: UsageMetadata;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain: boolean;
  isMeta: boolean;
  userType?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: Record<string, unknown>;
  isCompactSummary?: boolean;
}
```

### ContentBlock Types

```typescript
type ContentBlock = TextContent | ThinkingContent | ToolUseContent | ToolResultContent | ImageContent;

interface TextContent      { type: 'text'; text: string }
interface ThinkingContent  { type: 'thinking'; thinking: string; signature: string }
interface ToolUseContent   { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface ToolResultContent { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
interface ImageContent     { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }
```

### Edge Cases & Gaps

- **No UUID filtering**: Does NOT deduplicate entries by UUID — duplicate UUIDs are preserved
- **No timestamp sorting**: Messages are in file order, NOT sorted by timestamp
- **isSidechain field**: Parsed but NOT used anywhere downstream — sidechain messages are treated identically
- **Image content**: Parsed into `ImageContent` blocks but never rendered (no image display component exists)
- **Missing**: No `progress` or `result` entry type handling — these are silently dropped (no UUID)

---

## 2. Chunk Building

**File**: `/tools/web-server/src/server/services/chunk-builder.ts`

### Message Classification: `classifyMessage(msg)`

**Input**: `ParsedMessage`
**Output**: `MessageCategory` — `'user' | 'system' | 'hardNoise' | 'ai'`

**Classification Rules (in priority order)**:

| Priority | Condition | Category |
|---|---|---|
| 1 | `type` is `system`, `file-history-snapshot`, `queue-operation`, or `summary` | `hardNoise` |
| 2 | `type === 'assistant'` and `model === '<synthetic>'` | `hardNoise` |
| 3 | String content contains `<local-command-caveat>` or `<system-reminder>` | `hardNoise` |
| 4 | String content contains `[Request interrupted by user]` | `hardNoise` |
| 5 | `type === 'user'` and string content contains `<local-command-stdout>` | `system` |
| 6 | `type === 'user'` and `!isMeta` | `user` |
| 7 | Everything else (assistant messages, meta user messages with tool results) | `ai` |

**TODOs in code**:
- Does NOT check array `ContentBlock[]` for noise markers (only string content checked)
- Interruptions are dropped as `hardNoise` instead of producing an `interruption` SemanticStep

### Chunk Assembly: `buildChunks(messages)`

**Input**: `ParsedMessage[]`
**Output**: `Chunk[]`

**Algorithm**:
1. Walk messages in order
2. `isCompactSummary` messages → flush AI buffer → `CompactChunk`
3. `classifyMessage()` the rest:
   - `hardNoise` → silently dropped
   - `user` → flush AI buffer → `UserChunk`
   - `system` → flush AI buffer → `SystemChunk`
   - `ai` → accumulate into `aiBuffer`
4. When AI buffer is flushed (or end of messages), all accumulated AI messages become one `AIChunk`

**Key Insight**: Consecutive AI-category messages (assistant responses + meta/tool-result user messages) merge into a single `AIChunk`. This means one AIChunk can contain multiple assistant turns with their interleaved tool results.

### Chunk Types

```typescript
interface UserChunk    { type: 'user';    message: ParsedMessage; timestamp: Date }
interface AIChunk      { type: 'ai';      messages: ParsedMessage[]; timestamp: Date }
interface SystemChunk  { type: 'system';  messages: ParsedMessage[]; timestamp: Date }
interface CompactChunk { type: 'compact'; summary: string; timestamp: Date }
type Chunk = UserChunk | AIChunk | SystemChunk | CompactChunk;
```

### Semantic Step Extraction: `extractSemanticSteps(chunk, toolExecutions)`

**Input**: `AIChunk` + `ToolExecution[]`
**Output**: `SemanticStep[]`

Called by `enhanceAIChunks()` in the pipeline to enrich AIChunks.

**Walks each message in the AI chunk, then each content block**:

| Content Block Type | SemanticStep Produced |
|---|---|
| `thinking` | `{ type: 'thinking', content: block.thinking }` |
| `tool_use` where `name === 'Task'` | `{ type: 'subagent', content: description, subagentId: block.id }` |
| `tool_use` (other) | `{ type: 'tool_call', content: toolName, toolCallId, durationMs }` |
| `tool_result` | `{ type: 'tool_result', content, toolCallId, toolName, isError }` |
| `text` | `{ type: 'output', content: block.text }` |
| `image` | Skipped entirely |
| String `msg.content` | `{ type: 'output', content }` |

```typescript
interface SemanticStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'subagent' | 'output' | 'interruption';
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  durationMs?: number;
  subagentId?: string;
}
```

**Note**: The `interruption` type is defined but never produced — interruptions are filtered as `hardNoise` in `classifyMessage()`.

### Enhanced AI Chunk

After pipeline enrichment, AI chunks become:

```typescript
interface EnhancedAIChunk extends AIChunk {
  semanticSteps: SemanticStep[];
  subagents: Process[];  // NOTE: `subagents` is added by enhanceAIChunks but the field is NOT populated there
}
```

**Gap**: The `subagents` field on `EnhancedAIChunk` is defined in the type but `enhanceAIChunks()` only sets `semanticSteps`. The `subagents` array is NOT populated at the chunk level — it lives at the `ParsedSession` level. The client-side `AIChunk` component accesses `chunk.subagents` which works because of TypeScript's structural typing with the type assertion, but the data must exist on the chunk object for this to work. In practice, the `subagents` array on AI chunks may be `undefined` rather than populated.

---

## 3. Tool Execution Building

**File**: `/tools/web-server/src/server/services/tool-execution-builder.ts`

### `buildToolExecutions(messages)`

**Input**: `ParsedMessage[]`
**Output**: `ToolExecution[]` (sorted by startTime ascending)

**Three-Pass Algorithm**:

1. **Pass 1**: Collect all `toolCalls` from all messages into `callMap<id, {toolName, input, startTime}>`
2. **Pass 2**: Match results to calls:
   - **Primary**: `msg.sourceToolUseID` on the result message (most reliable)
   - **Fallback**: `toolResult.toolUseId` inside content blocks
   - Computes `durationMs = endTime - startTime`
3. **Pass 3**: Any unmatched calls → `isOrphaned: true` (no result, no endTime, no durationMs)

```typescript
interface ToolExecution {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: ToolResult;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  isOrphaned: boolean;
}
```

### Edge Cases

- **Duplicate matching**: Each call can only match one result (first-match wins via `matchedCallIds` set)
- **sourceToolUseID priority**: If a message has `sourceToolUseID`, fallback matching is skipped for that message
- **Orphaned calls**: Tool calls with no matching result are common (ongoing sessions, subagent dispatches)

---

## 4. Subagent Resolution

**File**: `/tools/web-server/src/server/services/subagent-resolver.ts`

### `resolveSubagents(parentMessages, options)`

**Input**:
- `parentMessages: ParsedMessage[]` — the parent session's messages
- `options: { projectDir, sessionId }`

**Output**: `Process[]`

### Step-by-Step Flow

1. **Discover subagent files**: `discoverSubagentFiles(projectDir, sessionId)`
   - New structure: `{projectDir}/{sessionId}/subagents/agent-*.jsonl`
   - Legacy structure: `{projectDir}/agent-*.jsonl`
   - Deduplicates by agentId (new structure takes priority)

2. **Parse each subagent file**: `parseSessionFile(filePath)` for each
   - **Filter out**:
     - Empty files
     - Warmup agents (first message content is "Warmup")
     - Compact files (agentId starts with "acompact")

3. **Collect Task tool calls** from parent messages (where `call.isTask`)

4. **Collect result-based links** from parent messages:
   - Messages with `toolUseResult.agentId` + `sourceToolUseID` → maps agentId to taskCallId

5. **Three-Phase Linking** (matches agents to Task tool calls):
   - **Phase A — Result-based**: Uses `toolUseResult.agentId` → `sourceToolUseID` link
   - **Phase B — Description-based**: Matches `<teammate-message summary="...">` in agent's first user message against Task `description`
   - **Phase C — Positional fallback**: Remaining unmatched agents/tasks matched chronologically

6. **Parallel detection**: Any two processes with start times within 100ms → `isParallel: true`

7. Sort by startTime, return

### Process Type

```typescript
interface Process {
  id: string;              // agentId
  filePath: string;        // path to the .jsonl file
  messages: ParsedMessage[];  // ALL parsed messages from the subagent file
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: SessionMetrics; // calculated from subagent messages
  description?: string;    // from parent Task tool call
  subagentType?: string;   // from parent Task input.subagent_type
  isParallel: boolean;
  parentTaskId?: string;   // tool call ID of the parent Task
  isOngoing?: boolean;     // detected from last message state
  team?: { teamName: string; memberName: string; memberColor: string };  // defined but never populated
}
```

### Ongoing Detection for Subagents

Different from main session: checks if last message is assistant with `tool_use` or `thinking` content blocks (suggesting incomplete execution).

### Edge Cases & Gaps

- **Subagent cost**: `metrics.totalCost` is always 0 — pricing is NOT calculated for subagents
- **Team field**: Defined in type but never populated by `buildProcess()`
- **Nested subagents**: NOT resolved — a subagent that spawns its own subagents will not have those reflected
- **No chunk building for subagents**: Subagent `Process.messages` are raw `ParsedMessage[]`, NOT chunked. The client-side `SubagentItem` builds its own tool executions from these raw messages.

---

## 5. Context Tracking

**File**: `/tools/web-server/src/server/services/context-tracker.ts`

### `trackContext(chunks)`

**Input**: `Chunk[]`
**Output**: `{ perTurn: ContextStats[], phases: ContextPhaseInfo[] }`

**IMPORTANT**: This function is defined but **NOT called** in the pipeline. The `SessionPipeline.parseSession()` explicitly notes:

> Context tracking (trackContext) is not called here because ParsedSession doesn't carry context fields.

### What It Would Track (if called)

**Categories** (TokensByCategory):
- `claudeMd` — content containing "CLAUDE.md" or `<system-reminder>`
- `mentionedFiles` — content with `@` patterns (file mentions)
- `toolOutputs` — tool_use inputs + tool_result content
- `thinkingText` — thinking blocks + text blocks (grouped together)
- `taskCoordination` — tool_use inputs for coordination tools (Task, SendMessage, TeamCreate, TaskCreate, TaskUpdate)
- `userMessages` — regular user messages

**Token Estimation**: `Math.ceil(text.length / 4)` — rough 4-chars-per-token heuristic

**Phase Tracking**: Compact chunks reset cumulative counters and start a new phase.

### Gap

This is completely unused. The `ParsedSession` type has no field for context stats. The `ContextBadge` and `SessionContextPanel` components on the client side do NOT receive or display per-turn context breakdowns — `ContextBadge` only shows `totalNewTokens` (the chunk's total token count calculated client-side).

---

## 6. Pricing/Cost

**File**: `/tools/web-server/src/server/services/pricing.ts`

### Model Pricing Table

| Model | Input/M | Output/M | Cache Create/M | Cache Read/M |
|---|---|---|---|---|
| `claude-opus-4-6` | $15 | $75 | $18.75 | $1.50 |
| `claude-sonnet-4-6` | $3 | $15 | $3.75 | $0.30 |
| `claude-haiku-4-5-20251001` | $0.80 | $4 | $1.00 | $0.08 |

### `findPricing(model)` — Model lookup

1. Exact match against known keys
2. Prefix match (e.g., `claude-sonnet-4-6-20260225` matches `claude-sonnet-4-6`)

### `calculateCost(usage)` — Per-message cost

Computes: `inputCost + outputCost + cacheCreationCost + cacheReadCost`

### `calculateSessionCost(messages)` — Session aggregate

Iterates all assistant messages with `usage` + `model` fields, sums costs.

**Output**: `{ totalCost: number, costByModel: Record<string, number> }`

### Gaps

- **Tiered pricing**: Type has `tierThreshold`, `inputPerMillionAboveTier`, etc. but implementation is TODO
- **`costByModel`**: Computed but NOT exposed in `ParsedSession` — only `totalCost` reaches the client
- **Subagent costs**: NOT calculated (subagent `Process.metrics.totalCost` is always 0)

---

## 7. API Layer

**File**: `/tools/web-server/src/server/routes/sessions.ts`

### Endpoints

#### `GET /api/sessions/:projectId`
- Lists `.jsonl` files in the project directory
- Excludes `agent-*.jsonl` files
- Returns: `{ sessionId, filePath, lastModified, fileSize }[]`

#### `GET /api/sessions/:projectId/:sessionId`
- Calls `sessionPipeline.parseSession(projectDir, sessionId)`
- Returns full `ParsedSession` as JSON
- Validation: sessionId must match `/^[\w-]+$/`

#### `GET /api/sessions/:projectId/:sessionId/metrics`
- Returns `SessionMetrics` only (lighter endpoint)

#### `GET /api/sessions/:projectId/:sessionId/subagents/:agentId`
- Returns a single `Process` by agent ID from the parsed session

#### `GET /api/stages/:stageId/session`
- Convenience: looks up stage's `session_id` from database
- Returns `{ sessionId, stageId, projectId: string | null }`

### ParsedSession Response Shape

```typescript
interface ParsedSession {
  chunks: Chunk[];            // UserChunk | AIChunk | SystemChunk | CompactChunk
  metrics: SessionMetrics;    // aggregate stats
  subagents: Process[];       // resolved subagent processes
  isOngoing: boolean;         // true if last message is user (awaiting response)
}

interface SessionMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCost: number;
  turnCount: number;
  toolCallCount: number;
  duration: number;  // ms
}
```

### Caching

**File**: `/tools/web-server/src/server/services/data-cache.ts`

- `DataCache<ParsedSession>` — LRU eviction, default 50 MB max
- Key: `${projectDir}/${sessionId}`
- Size estimate: `JSON.stringify(session).length * 2` (UTF-16 heuristic)
- Invalidated when `FileWatcher` detects changes

### File Watching

**File**: `/tools/web-server/src/server/services/file-watcher.ts`

- Watches `~/.claude/projects` recursively with `fs.watch({ recursive: true })`
- Debounces changes per-file (100ms default)
- Periodic catch-up scan (30s default) for missed events
- Emits `file-change` events → triggers cache invalidation in `app.ts`

### Gap: No SSE/Live Update Endpoints

There are NO Server-Sent Events (SSE) or WebSocket endpoints for live session streaming. The `FileWatcher` invalidates the server cache, but there is no mechanism to push updates to connected clients. Clients must poll via React Query's refetch intervals.

---

## 8. Client-Side State

### API Client

**File**: `/tools/web-server/src/client/api/client.ts`

Simple `fetch()` wrapper:
```typescript
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>
```
- Prepends `/api` base
- Auto-sets `Content-Type: application/json` for bodies
- Throws on non-2xx responses

### React Query Hooks

**File**: `/tools/web-server/src/client/api/hooks.ts`

| Hook | Endpoint | Returns |
|---|---|---|
| `useSessionDetail(projectId, sessionId)` | `GET /api/sessions/:projectId/:sessionId` | `ParsedSession` |
| `useSessionMetrics(projectId, sessionId)` | `GET /api/sessions/:projectId/:sessionId/metrics` | `SessionMetrics` |
| `useSubagent(projectId, sessionId, agentId)` | `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` | `Process` |
| `useSessions(projectId)` | `GET /api/sessions/:projectId` | `SessionListItem[]` |
| `useStageSession(stageId)` | `GET /api/stages/:stageId/session` | `{ sessionId, stageId, projectId }` |

All use `@tanstack/react-query` with `enabled` guards.

### Client Types

**File**: `/tools/web-server/src/client/types/session.ts`

Pure re-exports from the server types — no client-side type transformations:
```typescript
export type { ParsedSession, SessionMetrics, Chunk, UserChunk, AIChunk, ... } from '@server/types/jsonl.js';
```

### Zustand Stores

**File**: `/tools/web-server/src/client/store/session-store.ts`

Two stores:

#### `useSessionStore`
```typescript
interface SessionState {
  activeSessionIds: string[];
  setActiveSessionIds: (ids: string[]) => void;
}
```
Tracks which sessions are active across the app. (Not directly used by session detail view.)

#### `useSessionViewStore`
```typescript
interface SessionViewState {
  expandedChunks: Set<number>;       // which AI chunks are expanded
  expandedTools: Set<string>;         // which tool executions are expanded (by toolCallId)
  expandedSubagents: Set<string>;     // which subagent items are expanded (by agentId)
  expandedSubagentTraces: Set<string>; // which subagent execution traces are visible
  isNearBottom: boolean;              // auto-scroll tracking
  // toggle/set/reset methods
}
```

This store controls ALL expand/collapse state for the session view.

### Client-Side Transformations

There are **no client-side transformations** of the `ParsedSession` data. The API response is used directly by components. The only "transformations" are:

1. **Model detection**: `SessionDetail` extracts the first `model` string from AI chunk messages
2. **Tool execution rebuilding**: `AIChunk` component rebuilds `ToolExecution` objects from chunk messages (client-side, duplicating server logic)
3. **SubagentItem** builds its own `ToolExecution[]` from `process.messages`

### Gap: No Polling/Live Updates

React Query hooks have no `refetchInterval` configured. Once loaded, session data is static until the user navigates away and back.

---

## 9. React Components — Display Layer

### Routing

**File**: `/tools/web-server/src/client/App.tsx`

Session detail route: `/sessions/:projectId/:sessionId` → `<SessionDetail />`

### SessionDetail Page

**File**: `/tools/web-server/src/client/pages/SessionDetail.tsx`

**Props**: None (uses URL params via `useParams`)

**Data**: `useSessionDetail(projectId, sessionId)` → `ParsedSession`

**Layout**:
```
+--------------------------------------------+
| [Back] Session {id}  model  dur  tokens $  |  (top bar)
+---------------------------+----------------+
|                           |                |
|   ChatHistory             | SessionContext |
|   (flex-1)                | Panel (w-80)   |
|                           | (hidden < lg)  |
+---------------------------+----------------+
```

**Behaviors**:
- Resets `useSessionViewStore` when `projectId` or `sessionId` changes
- Loading state with spinner
- Error state with back button
- Detects model from first assistant message in AI chunks
- Displays: model, duration, token count, cost, "Live" badge if ongoing

---

### ChatHistory

**File**: `/tools/web-server/src/client/components/chat/ChatHistory.tsx`

**Props**: `{ chunks: Chunk[] }`

**Key Behaviors**:
- **Virtualization threshold**: 120 chunks → switches to `@tanstack/react-virtual`
- **Below threshold**: renders all chunks in a scrollable div
- **Virtualization config**: `estimateSize: 260px`, `overscan: 8`
- **Auto-scroll**: When `isNearBottom` (within 100px of bottom), scrolls to bottom on new chunks
- **Scroll tracking**: Updates `isNearBottom` in Zustand store on scroll events

**ChunkRenderer** dispatches to:
| Chunk Type | Component |
|---|---|
| `user` | `<UserChunk>` |
| `ai` | `<AIChunk>` |
| `system` | `<SystemChunk>` |
| `compact` | `<CompactChunk>` |

---

### AIChunk Component

**File**: `/tools/web-server/src/client/components/chat/AIChunk.tsx`

**Props**: `{ chunk: AIChunkType; chunkIndex: number }`

**Two Rendering Modes**:

#### Non-Enhanced Fallback (no `semanticSteps` on chunk)
- Renders raw text from messages
- NOT collapsible
- Shows: bot icon, extracted text, model badge, token count, timestamp

#### Enhanced Mode (has `semanticSteps`)
- **Collapsed** (default): Header bar with bot icon, model badge, step summary, context badge, tokens, duration, chevron
- **Expanded**: Renders all semantic steps via `AIStepRenderer`
- **Always visible**: `LastOutputDisplay` below the header

**Client-Side Tool Execution Rebuilding**:
The component builds its own `Map<string, ToolExecution>` from chunk messages by matching `toolCalls` to `toolResults`. This duplicates the server-side `buildToolExecutions` logic but is scoped to the single chunk.

**Step Summary**: Counts of each step type, formatted as "2 tools, 1 thinking, 1 output"

**AIStepRenderer** dispatches semantic steps:
| Step Type | Component |
|---|---|
| `thinking` | `<ThinkingItem>` |
| `output` | `<TextItem>` |
| `tool_call` | `<LinkedToolItem>` (if execution found) or inline text |
| `tool_result` | `null` (rendered as part of LinkedToolItem) |
| `subagent` | `<SubagentItem>` (if Process found) or inline placeholder |
| `interruption` | Amber badge with text |

---

### UserChunk Component

**File**: `/tools/web-server/src/client/components/chat/UserChunk.tsx`

**Props**: `{ chunk: UserChunkType }`

**Renders**:
- Right-aligned blue bubble (chat-style)
- Content rendered via `ReactMarkdown` with `remark-gfm`
- Image count badge (if content has image blocks)
- Long message collapse: truncates at 500 chars with "Show more" toggle
- Timestamp in bottom-right

**Gap**: Image content blocks are counted but NOT rendered (only a count badge is shown).

---

### SystemChunk Component

**File**: `/tools/web-server/src/client/components/chat/SystemChunk.tsx`

**Props**: `{ chunk: SystemChunkType }`

**Renders**:
- Center-aligned gray card with Terminal icon
- Strips ANSI escape codes from content (`\x1B\[[0-9;]*m`)
- Renders as `<pre>` monospace text
- Returns `null` if no text content after filtering

---

### CompactChunk Component

**File**: `/tools/web-server/src/client/components/chat/CompactChunk.tsx`

**Props**: `{ chunk: CompactChunkType }`

**Renders**:
- Horizontal amber divider line with centered pill
- "Context compacted" label with timestamp
- Expandable: if `chunk.summary` exists, clicking reveals markdown-rendered summary
- Max height 256px with overflow scroll

---

### ThinkingItem

**File**: `/tools/web-server/src/client/components/chat/items/ThinkingItem.tsx`

**Props**: `{ content: string; tokenCount?: number }`

**Renders**:
- Purple collapsible card with Brain icon
- Collapsed: "Thinking" label + token count badge
- Expanded: `<pre>` monospace text of thinking content
- Token count estimated as `Math.ceil(content.length / 4)` by the parent `AIChunk`

---

### TextItem

**File**: `/tools/web-server/src/client/components/chat/items/TextItem.tsx`

**Props**: `{ content: string }`

**Renders**:
- Prose-styled markdown via `ReactMarkdown` with `remark-gfm`
- Custom `code` component: inline codes get slate background; fenced code blocks get dark background with syntax highlighting via `highlightLine()`
- Custom `pre` component: passes through children (avoids double wrapping)
- Custom `table` component: adds horizontal overflow wrapper

---

### LinkedToolItem

**File**: `/tools/web-server/src/client/components/chat/items/LinkedToolItem.tsx`

**Props**: `{ execution: ToolExecution }`

**Renders**:
- Collapsible card with tool-specific icon
- Header: icon, tool name, summary text, duration, success/error indicator
- Expanded: delegates to tool-specific renderer via `getToolRenderer(toolName)`
- Visual states: error (red border), orphaned (amber border), normal (slate border)

**Tool Icons**: Read→FileText, Edit→Pencil, Write→FilePlus, Bash→TerminalSquare, Glob→FolderSearch, Grep→Search, Skill→Zap, default→Wrench

---

### SubagentItem

**File**: `/tools/web-server/src/client/components/chat/items/SubagentItem.tsx`

**Props**: `{ process: Process; depth?: number }`

**Three-Level Expand**:

1. **Level 0 — Collapsed header**: Agent type badge (with icon/color), description, MetricsPill, duration, status icon (spinning if ongoing, checkmark if done)
2. **Level 1 — Expanded meta**: 3x2 grid showing Type, Duration, Agent ID, Tokens, Tool Calls, Turns. Parallel execution badge if applicable. "Show execution trace" toggle.
3. **Level 2 — Execution trace**: Renders filtered messages (user + assistant only):
   - User messages: blue badge with preview (120 chars max)
   - Assistant messages: ThinkingItem, TextItem, LinkedToolItem for each content block
   - Sub-task indicators for nested Task calls

**Client-Side Tool Execution Building**: Builds its own `ToolExecution[]` from `process.messages` by matching `toolCalls` to `toolResults`. Different from server-side logic — simpler, no sourceToolUseID matching, no duration computation. The execution trace view also builds per-message inline tool executions that cross-reference the full `toolExecutions` list for results from later messages.

**Type Colors**: Explore→blue, Plan→purple, general-purpose→green, default→slate

---

### LastOutputDisplay

**File**: `/tools/web-server/src/client/components/chat/LastOutputDisplay.tsx`

**Props**: `{ lastOutput: LastOutput | null }`

**Renders based on `lastOutput.type`**:
| Type | Display |
|---|---|
| `text` | Slate card with markdown-rendered content |
| `tool_result` (error) | Red card with XCircle icon, tool name, error content |
| `tool_result` (success) | Green card with CheckCircle icon, tool name, content |
| `interruption` | Amber card with AlertTriangle icon |
| `ongoing` | Pulsing blue dot with "Claude is responding..." |
| `null` | Nothing |

---

### ContextBadge

**File**: `/tools/web-server/src/client/components/chat/context/ContextBadge.tsx`

**Props**: `{ totalNewTokens: number; categories?: ContextCategory[] }`

**Renders**:
- Small indigo pill showing "Context +{tokens}"
- Hover popover with category breakdown (if categories provided)
- Returns null if `totalNewTokens === 0`

**Gap**: The `categories` prop is never populated — `AIChunk` passes only `totalNewTokens` (aggregate). The popover breakdown feature is implemented but never used.

---

### MetricsPill

**File**: `/tools/web-server/src/client/components/chat/MetricsPill.tsx`

**Props**: `{ mainTokens: number; subagentTokens?: number }`

**Renders**: Inline monospace pill showing token count with optional `|` separator for subagent tokens.

---

### SessionContextPanel

**File**: `/tools/web-server/src/client/components/chat/context/SessionContextPanel.tsx`

**Props**: `{ metrics: SessionMetrics; chunks: Chunk[]; model?: string }`

**Renders sidebar with sections**:
1. **Session Summary**: Model, Turns, Tool Calls, Duration, Cost
2. **Token Usage**: Total, Input, Output, Cache Read (if > 0), Cache Write (if > 0)
3. **Compactions** (if any compact chunks): Count + visual timeline bar
4. **Activity**: Counts of user messages, AI responses, system events

**Gap**: No per-turn context breakdown, no cost-by-model, no context category visualization.

---

## 10. Tool Renderers

**File**: `/tools/web-server/src/client/components/tools/index.ts`

### Renderer Registry

```typescript
const rendererMap: Record<string, ToolRendererComponent> = {
  Read: ReadRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  Bash: BashRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  Skill: SkillRenderer,
  NotebookEdit: DefaultRenderer,
  WebFetch: DefaultRenderer,
  WebSearch: DefaultRenderer,
};
// Fallback: DefaultRenderer
```

### ReadRenderer

**File**: `/tools/web-server/src/client/components/tools/ReadRenderer.tsx`

**Extracts**: `file_path`, `offset`, `limit` from input; content from result
**Renders**: File path header with icon, line range indicator, dark-background code viewer with line numbers and syntax highlighting

### EditRenderer

**File**: `/tools/web-server/src/client/components/tools/EditRenderer.tsx`

**Extracts**: `file_path`, `old_string`, `new_string` from input
**Renders**:
- Header with filename and +/- stats
- If both old and new: LCS-based unified diff with dual line-number gutters, color-coded added/removed/context lines
- Fallback: separate "Removed" and "Added" panels if only one side available

### WriteRenderer

**File**: `/tools/web-server/src/client/components/tools/WriteRenderer.tsx`

**Extracts**: `file_path`, `content` from input
**Renders**: File path header, dark-background code viewer with line numbers and syntax highlighting

### BashRenderer

**File**: `/tools/web-server/src/client/components/tools/BashRenderer.tsx`

**Extracts**: `command`, `description` from input; output from result
**Renders**: Description (if provided), command in code block, output in dark terminal-style viewer with red highlighting for error-like lines, duration, exit status

### GlobRenderer

**File**: `/tools/web-server/src/client/components/tools/GlobRenderer.tsx`

**Extracts**: `pattern` from input; file list from result
**Renders**: Pattern with icon, file count, scrollable file list

### GrepRenderer

**File**: `/tools/web-server/src/client/components/tools/GrepRenderer.tsx`

**Extracts**: `pattern`, `glob` from input; matches from result
**Renders**: Pattern with icon, glob filter, match count, scrollable match list in monospace

### SkillRenderer

**File**: `/tools/web-server/src/client/components/tools/SkillRenderer.tsx`

**Extracts**: `skill` name, `args` from input; output from result
**Renders**: Skill name with lightning icon, args, output in monospace pre

### DefaultRenderer

**File**: `/tools/web-server/src/client/components/tools/DefaultRenderer.tsx`

**Fallback for**: NotebookEdit, WebFetch, WebSearch, and any unknown tools
**Renders**:
- "Input" section: key-value pairs (truncated at 200 chars)
- "Output" section: full result content in monospace pre (red background if error)

### Missing Tool Renderers

The following tools appear in `generateToolSummary()` but have no dedicated renderer:
- **Task** — uses DefaultRenderer (but SubagentItem handles display at the semantic step level)
- **NotebookEdit** — explicitly mapped to DefaultRenderer
- **WebFetch** — explicitly mapped to DefaultRenderer
- **WebSearch** — explicitly mapped to DefaultRenderer
- **TodoWrite** — no mapping, falls through to DefaultRenderer
- **TaskCreate/TaskUpdate/TaskList/TaskGet** — no mapping, falls through to DefaultRenderer
- **EnterWorktree** — no mapping, falls through to DefaultRenderer

---

## 11. Utilities

### syntax-highlighter.ts

**File**: `/tools/web-server/src/client/utils/syntax-highlighter.ts`

**`inferLanguage(filename)`**: Maps file extensions to language names. Supports: ts, tsx, js, jsx, py, rs, go, rb, php, sql, r, md, json, yaml, css, html, sh, bash, zsh. Special: Dockerfile, Makefile, .env files.

**`highlightLine(line, language)`**: Character-scanning tokenizer that produces colored React nodes.
- **Token types**: strings (purple), comments (gray italic), numbers (amber), keywords (blue bold), types/class names (green), operators (slate)
- **Comment styles**: `//`, `#` (Python/Bash/R/Ruby/PHP), `--` (SQL)
- **Keywords**: Language-specific sets for TS, JS, Python, Rust, Go, Ruby, PHP, SQL, R
- **Limitation**: Line-by-line only — no multi-line comment or string handling

### diff.ts

**File**: `/tools/web-server/src/client/utils/diff.ts`

**`computeDiff(oldStr, newStr)`**: LCS-based line-level diff. Returns `DiffLine[]` with types: `added`, `removed`, `context`. Each line has `oldLineNum` and/or `newLineNum`.

**`getDiffStats(lines)`**: Counts added/removed lines.

**Limitation**: O(m*n) LCS matrix — may be slow for very large diffs.

### last-output-detector.ts

**File**: `/tools/web-server/src/client/utils/last-output-detector.ts`

**`findLastOutput(semanticSteps, isOngoing?)`**: Determines what to show as the "last visible output" of an AI chunk.

**Priority**:
1. Any `interruption` step (reverse scan) → `{ type: 'interruption' }`
2. If `isOngoing` → `{ type: 'ongoing' }`
3. Last `output` step → `{ type: 'text', content }`
4. Last `tool_result` step → `{ type: 'tool_result', toolName, isError }`
5. `null`

**Note**: The `isOngoing` parameter is available but the caller (`AIChunk`) does NOT pass it — ongoing state is only tracked at the session level, not per-chunk.

### session-formatters.ts

**File**: `/tools/web-server/src/client/utils/session-formatters.ts`

| Function | Input | Output | Notes |
|---|---|---|---|
| `formatTokenCount(n)` | number | string | `500` → `"500"`, `12300` → `"12.3K"`, `1500000` → `"1.5M"` |
| `formatDuration(ms)` | number | string | `5000` → `"5s"`, `125000` → `"2m 5s"`, `<1000` → `"Nms"` |
| `formatCost(cost)` | number | string | `0` → `"$0.00"`, `<0.01` → `"$0.XXXX"`, else `"$X.XX"` |
| `formatTimestamp(date)` | Date/string/number | string | Local time `HH:MM` |
| `generateToolSummary(name, input)` | string, object | string | Tool-specific one-liner for collapsed display |
| `extractResultContent(result)` | ToolResult/undefined | string/null | Converts result content to string |

**`generateToolSummary`** has specific formatting for: Edit, Read, Write, Bash, Grep, Glob, Task, Skill, WebFetch, WebSearch, NotebookEdit, TodoWrite, TaskCreate, TaskUpdate, TaskList, TaskGet. Unknown tools try `input.name/path/file/query/command` before falling back to tool name.

---

## Summary of Gaps and Missing Features

### Server-Side Gaps

1. **Context tracking unused**: `trackContext()` exists but is never called in the pipeline
2. **Cost-by-model not exposed**: Computed but only `totalCost` reaches `ParsedSession`
3. **Subagent costs always 0**: Pricing not calculated for subagent processes
4. **No SSE/WebSocket**: No live push mechanism — clients must poll
5. **Interruptions dropped**: Filtered as `hardNoise` instead of producing semantic steps
6. **Image blocks ignored**: Parsed but never rendered at any point
7. **isSidechain unused**: Parsed from JSONL but never used in classification or display
8. **No nested subagent resolution**: Subagents of subagents are not resolved
9. **No streaming/incremental parsing in API**: Full re-parse on every request (cache mitigates)
10. **Tiered pricing not implemented**: Model pricing has tier fields but logic is TODO

### Client-Side Gaps

1. **No live updates**: No polling, no SSE subscription — data is static after initial load
2. **No image rendering**: Image content blocks show a count badge only
3. **Context badge has no breakdown**: `categories` prop available but never populated
4. **No per-turn context visualization**: SessionContextPanel shows only aggregates
5. **No cost-by-model display**: Only total cost shown
6. **Duplicate tool execution building**: Client rebuilds ToolExecution objects in AIChunk and SubagentItem
7. **Missing tool renderers**: TaskCreate, TaskUpdate, WebSearch, WebFetch, NotebookEdit use generic DefaultRenderer
8. **No search/filter**: No way to search within a session's messages
9. **No keyboard navigation**: No keyboard shortcuts for expand/collapse
10. **Ongoing state not per-chunk**: `isOngoing` is session-level; `findLastOutput` has `isOngoing` param but it's never passed

### Type Mismatches

1. **EnhancedAIChunk.subagents**: Defined in type but not populated by `enhanceAIChunks()`. The AIChunk component accesses `chunk.subagents` which may be undefined at runtime.
2. **Process.team**: Defined in type but never populated by `buildProcess()`.
