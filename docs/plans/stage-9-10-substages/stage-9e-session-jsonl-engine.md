# Stage 9E: Session JSONL Engine

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9A (server scaffold)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Port the claude-devtools parsing pipeline to our server. This is the backend engine that transforms raw JSONL session files into structured data for the session detail view.

## What Ships

8 server-side services + complete TypeScript type definitions for JSONL parsing.

## Services

### 1. FileWatcher (`src/server/services/file-watcher.ts`)

Watch `~/.claude/projects/` for JSONL file changes.

**Implementation:**
- Use Node.js `fs.watch()` with `{ recursive: true }` on the projects directory
- Track per-file byte offsets for incremental append parsing
- 100ms per-file debouncing (trailing edge)
- 30-second catch-up scan to detect missed fs.watch events
- Emit `file-change` events with `{ projectId, sessionId, isSubagent }` payload
- Configurable root path via `CLAUDE_ROOT` env var (default: `~/.claude`)

**Reference:** `claude-devtools/src/main/services/infrastructure/FileWatcher.ts`
- Lines 271-279: `fs.watch()` setup with recursive option
- Lines 708-763: Incremental append parsing with byte offsets
- Lines 820-873: Catch-up scan implementation
- Lines 882-896: Debounce logic

### 2. SessionParser (`src/server/services/session-parser.ts`)

Parse JSONL files into `ParsedMessage[]`.

**Implementation:**
- Line-by-line streaming via `readline.createInterface()` on a `fs.createReadStream()`
- Parse each JSON line, skip entries without `uuid` (filters progress entries)
- Extract from each entry: uuid, parentUuid, type, timestamp, role, content, usage, model, cwd, gitBranch, agentId, isSidechain, isMeta
- Extract tool calls: scan content blocks for `type: 'tool_use'`, build `ToolCall` objects
- Extract tool results: scan content blocks for `type: 'tool_result'`, build `ToolResult` objects
- Capture special fields: sourceToolUseID, sourceToolAssistantUUID, toolUseResult
- Detect compact summaries via `isCompactSummary` field

**Reference:** `claude-devtools/src/main/services/parsing/SessionParser.ts`, `claude-devtools/src/main/utils/jsonl.ts`

### 3. ChunkBuilder (`src/server/services/chunk-builder.ts`)

Group `ParsedMessage[]` into visualization chunks.

**Implementation:**

**Step 1: Message classification (4 categories):**
- **User**: `type='user'`, `isMeta!=true`, has text/image content, no system XML tags
- **System**: contains `<local-command-stdout>`
- **Hard Noise**: system/summary/file-history-snapshot/queue-operation entries, caveats, reminders, synthetic assistant, interruptions
- **AI**: everything else

**Step 2: Chunk building:**
- Buffer AI messages consecutively
- On user message: flush AI buffer into AIChunk, create UserChunk
- On system message: flush AI buffer, create SystemChunk
- On compact boundary: flush AI buffer, create CompactChunk

**Step 3: Enhancement:**
- For each AIChunk, extract SemanticSteps (thinking, tool_call, tool_result, subagent, output, interruption)
- Link subagent Processes to AIChunks via parentTaskId or timing fallback
- Calculate per-chunk metrics (tokens, duration, cost)

**Reference:** `claude-devtools/src/main/services/analysis/ChunkBuilder.ts`

### 4. ToolExecutionBuilder (`src/server/services/tool-execution-builder.ts`)

Match `tool_use` content blocks to `tool_result` content blocks.

**Implementation:**
- **Pass 1:** Collect all tool calls into a Map keyed by `tool_use.id`
- **Pass 2:** Match tool results via `sourceToolUseID` field on user entries (most reliable)
- **Pass 2b:** Fallback: match via `tool_result.tool_use_id` in content blocks
- Calculate duration from tool call timestamp to tool result timestamp
- Detect orphaned tool calls (no result) — mark as running or failed
- Sort by start time

**Output:** `ToolExecution[]` — each with `toolCall`, `result?`, `startTime`, `endTime?`, `durationMs?`

**Reference:** `claude-devtools/src/main/services/analysis/ToolExecutionBuilder.ts`

### 5. SubagentResolver (`src/server/services/subagent-resolver.ts`)

Find subagent JSONL files and link them to parent Task tool calls.

**Implementation:**

**Subagent file discovery:**
- Scan new structure: `{projectId}/{sessionId}/subagents/agent-*.jsonl`
- Scan legacy structure: `{projectId}/agent-*.jsonl` (verify via first line's sessionId)
- Filter out: warmup agents (content = "Warmup"), compact files (agentId starts with "acompact"), empty files

**3-phase linking:**
1. **Result-based:** Read `toolUseResult.agentId` from parent's tool result messages, match to subagent file UUID
2. **Description-based:** For team members, match Task description to `<teammate-message summary="...">` in subagent first message
3. **Positional fallback:** Match remaining unmatched by chronological order

**Parallel detection:** Subagents with start times within 100ms of each other marked `isParallel: true`

**Output:** `Process[]` — each with id, filePath, messages, metrics, description, subagentType, isParallel, parentTaskId, team metadata

**Reference:** `claude-devtools/src/main/services/discovery/SubagentLocator.ts`, `claude-devtools/src/main/services/discovery/SubagentResolver.ts`

### 6. ContextTracker (`src/server/services/context-tracker.ts`)

Track token attribution across 7 categories per conversation turn.

**Categories:**
1. `claudeMd` — CLAUDE.md files (enterprise, user, project, directory levels)
2. `mentionedFiles` — @-mentioned file content
3. `toolOutputs` — Tool call + result tokens
4. `thinkingText` — Thinking blocks + text output
5. `taskCoordination` — SendMessage, TeamCreate, TaskCreate/Update tokens
6. `userMessages` — User input text

**Implementation:**
- Walk conversation groups (AIChunks)
- First group: add global CLAUDE.md injections
- Each group: detect directory CLAUDE.md, @-mentions, aggregate tool outputs, thinking, user text
- Handle compaction boundaries: reset accumulated state, start new phase
- Calculate per-turn and cumulative token counts

**Output:** Per-turn `ContextStats` with new injections and accumulated totals, `ContextPhaseInfo` with phase boundaries and compaction deltas.

**Reference:** `claude-devtools/src/renderer/utils/contextTracker.ts` (the whole file)

### 7. PricingEngine (`src/server/services/pricing.ts`)

Calculate per-session costs.

**Implementation:**
- Tiered pricing: different rates below/above 200K tokens
- Load pricing data from embedded LiteLLM JSON (or maintain a small pricing table)
- Calculate: input cost + output cost + cache creation cost + cache read cost
- Support models: claude-opus-4-6, claude-sonnet-4, claude-haiku-4-5, etc.

**Reference:** claude-devtools pricing module

### 8. DataCache (`src/server/services/data-cache.ts`)

LRU cache for parsed session data.

**Implementation:**
- Size-bounded (default 50MB, configurable)
- Keys: `{projectId}/{sessionId}` for full parsed sessions
- Invalidated when FileWatcher emits `file-change` for that session
- Eviction: LRU by access counter (not timestamp)

**Reference:** `claude-devtools/src/main/services/infrastructure/DataCache.ts`

## Type Definitions

Port complete JSONL types to `src/server/types/jsonl.ts`. Full type definitions are documented in:
`docs/research/stage-9-10-web-ui/deep-dive-jsonl-hooks.md` Section 11

Key types to define:
- `EntryType`, `ContentBlock`, `TextContent`, `ThinkingContent`, `ToolUseContent`, `ToolResultContent`, `ImageContent`
- `UserEntry`, `AssistantEntry`, `SystemEntry`, `SummaryEntry`, `FileHistorySnapshotEntry`, `QueueOperationEntry`
- `UsageMetadata`, `StopReason`
- `ParsedMessage`, `ToolCall`, `ToolResult`
- `UserChunk`, `AIChunk`, `SystemChunk`, `CompactChunk`, `EnhancedAIChunk`
- `SemanticStep`, `ToolExecution`, `Process`, `SessionMetrics`
- `ContextStats`, `ContextPhaseInfo`, `TokensByCategory`

## API Endpoints (completing 9B placeholders)

- `GET /api/sessions/:projectId/:sessionId` — Returns full parsed session: chunks, metrics, subagents
- `GET /api/sessions/:projectId/:sessionId/metrics` — Returns SessionMetrics + cost
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Returns parsed subagent Process

## Success Criteria

- FileWatcher detects new JSONL content within 200ms
- SessionParser correctly parses all 6 entry types
- ChunkBuilder produces correct chunk boundaries (user messages start new chunks)
- ToolExecutionBuilder links >95% of tool_use to tool_result
- SubagentResolver finds subagents in both directory structures
- ContextTracker produces accurate 7-category attribution
- PricingEngine calculates costs matching claude-devtools output
- DataCache prevents re-parsing on repeated requests
- Tests cover each service with real JSONL fixtures
