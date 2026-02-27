# Claude-DevTools: Complete Enrichment + Display Pipeline Map

This document exhaustively traces the data flow from raw JSONL file to rendered React output in the claude-devtools application.

---

## Pipeline Overview (Data Flow Diagram)

```
JSONL File on Disk
    |
    v
[1] SessionParser.parseSessionFile()           -- src/main/services/parsing/SessionParser.ts
    |  reads file, parses lines into ParsedMessage[]
    v
[2] MessageClassifier.classifyMessages()        -- src/main/services/parsing/MessageClassifier.ts
    |  classifies each ParsedMessage into: user | system | compact | hardNoise | ai
    v
[3] ChunkBuilder.buildChunks()                  -- src/main/services/analysis/ChunkBuilder.ts
    |  groups messages into EnhancedChunk[] (UserChunk, AIChunk, SystemChunk, CompactChunk)
    |  uses ChunkFactory, SemanticStepExtractor, ProcessLinker
    v
[4] transformChunksToConversation()             -- src/renderer/utils/groupTransformer.ts
    |  converts EnhancedChunk[] -> SessionConversation { items: ChatItem[] }
    |  ChatItem = UserGroup | AIGroup | SystemGroup | CompactGroup
    |  enriches CompactGroups with tokenDelta + phaseNumber
    v
[5] enhanceAIGroup()                            -- src/renderer/utils/aiGroupEnhancer.ts
    |  transforms AIGroup -> EnhancedAIGroup
    |  calls: findLastOutput, linkToolCallsToResults, attachMainSessionImpact,
    |         buildDisplayItems, buildSummary, extractMainModel, extractSubagentModels
    v
[6] processSessionContextWithPhases()           -- src/renderer/utils/contextTracker.ts
    |  computes per-turn ContextStats with 6 categories
    v
[7] React Components                            -- src/renderer/components/chat/
    ChatHistory -> ChatHistoryItem -> AIChatGroup / UserChatGroup / SystemChatGroup / CompactBoundary
```

---

## Stage 1: JSONL Parsing (Server-Side)

### Files
- `src/main/services/parsing/SessionParser.ts` — orchestrator
- `src/main/utils/jsonl.ts` — low-level parsing (not shown in detail, called via `parseJsonlFile`)
- `src/main/types/jsonl.ts` — raw JSONL type definitions

### How Raw JSONL Files Are Read

`SessionParser.parseSessionFile(filePath)` delegates to `parseJsonlFile(filePath, fsProvider)` which:
1. Reads the file via the FileSystemProvider (local or SSH)
2. Splits into lines, parses each line as JSON
3. Converts each JSON object into a `ParsedMessage`
4. Returns `ParsedMessage[]`

### Entry Types (from `ChatHistoryEntry`)

```typescript
type EntryType = 'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation';
```

| Type | Purpose |
|------|---------|
| `user` | User input OR tool results (distinguished by `isMeta`) |
| `assistant` | AI response with content blocks |
| `system` | Turn duration / init metadata |
| `summary` | Compact summary marker |
| `file-history-snapshot` | File state snapshots |
| `queue-operation` | Queue operations |

### Content Block Types

```typescript
type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';
```

| Block | Key Fields |
|-------|------------|
| `TextContent` | `text: string` |
| `ThinkingContent` | `thinking: string`, `signature: string` |
| `ToolUseContent` | `id: string`, `name: string`, `input: Record<string, unknown>` |
| `ToolResultContent` | `tool_use_id: string`, `content: string \| ContentBlock[]`, `is_error?: boolean` |
| `ImageContent` | `source: { type: 'base64', media_type: string, data: string }` |

### Key User Entry Subtypes

```typescript
// User entries serve TWO purposes:
// 1. Real user input:  isMeta: false/undefined, content: string
// 2. Tool result flow:  isMeta: true, content: array with tool_result blocks

interface UserEntry extends ConversationalEntry {
  type: 'user';
  message: UserMessage;
  isMeta?: boolean;
  agentId?: string;
  toolUseResult?: ToolUseResultData;
  sourceToolUseID?: string;        // Links to the tool_use that triggered this
  sourceToolAssistantUUID?: string; // Links to the assistant message
}
```

### ParsedMessage (Application Internal Representation)

```typescript
interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  type: MessageType;
  timestamp: Date;
  role?: string;
  content: ContentBlock[] | string;
  usage?: TokenUsage;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain: boolean;
  isMeta: boolean;
  userType?: string;
  toolCalls: ToolCall[];      // Extracted from assistant content blocks
  toolResults: ToolResult[];  // Extracted from user content blocks
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: ToolUseResultData;
  isCompactSummary?: boolean;
  requestId?: string;         // For deduplicating streaming entries
}
```

### ParsedSession Result

```typescript
interface ParsedSession {
  messages: ParsedMessage[];
  metrics: SessionMetrics;
  taskCalls: ToolCall[];
  byType: {
    user: ParsedMessage[];
    realUser: ParsedMessage[];     // isParsedRealUserMessage
    internalUser: ParsedMessage[]; // isParsedInternalUserMessage (isMeta: true)
    assistant: ParsedMessage[];
    system: ParsedMessage[];
    other: ParsedMessage[];
  };
  sidechainMessages: ParsedMessage[];  // isSidechain: true
  mainMessages: ParsedMessage[];       // isSidechain: false
}
```

### Subagent File Discovery

Two directory structures are supported:
- **New**: `{session_uuid}/{agent_uuid}.jsonl` (subdirectory)
- **Old/Legacy**: `agent_{agent_uuid}.jsonl` (same directory as parent)

Linking: `subagent.sessionId === parent session UUID`

---

## Stage 2: Message Classification + Chunk Building

### Files
- `src/main/services/parsing/MessageClassifier.ts`
- `src/main/services/analysis/ChunkBuilder.ts`
- `src/main/services/analysis/ChunkFactory.ts`
- `src/main/services/analysis/SemanticStepExtractor.ts`
- `src/main/services/analysis/ProcessLinker.ts`
- `src/main/services/analysis/SemanticStepGrouper.ts`
- `src/main/services/analysis/ToolExecutionBuilder.ts`
- `src/main/types/chunks.ts`

### Message Classification (5 Categories)

`classifyMessages(messages)` applies `categorizeMessage()` to each message in order:

| Priority | Category | Type Guard | What Gets Classified |
|----------|----------|-----------|---------------------|
| 1 | `hardNoise` | `isParsedHardNoiseMessage()` | system/summary/file-history/queue-operation entries; `<local-command-caveat>` or `<system-reminder>` only messages; empty stdout; interruption messages; synthetic assistant messages (`model='<synthetic>'`) |
| 2 | `compact` | `isParsedCompactMessage()` | `isCompactSummary === true` |
| 3 | `system` | `isParsedSystemChunkMessage()` | User messages starting with `<local-command-stdout>` or `<local-command-stderr>` |
| 4 | `user` | `isParsedUserChunkMessage()` | type='user', isMeta!=true, has text/image content, NOT teammate messages, NOT system output tags, NOT interruption messages |
| 5 | `ai` | (default) | Everything else — assistant messages, tool results, internal user messages |

### isParsedUserChunkMessage() Details

Returns true when ALL of:
- `type === 'user'`
- `isMeta !== true`
- NOT a teammate message (`<teammate-message ...>`)
- Content is non-empty
- Content does NOT start with any SYSTEM_OUTPUT_TAG: `<local-command-stderr>`, `<local-command-stdout>`, `<local-command-caveat>`, `<system-reminder>`
- `<command-name>` IS allowed (slash commands like /model are visible user input)
- For array content: must have text/image blocks, must NOT be `[Request interrupted by user...]`

### isParsedHardNoiseMessage() Details

Returns true when ANY of:
- type is `system`, `summary`, `file-history-snapshot`, or `queue-operation`
- type is `assistant` and `model === '<synthetic>'`
- type is `user` and content is wrapped entirely in `<local-command-caveat>` or `<system-reminder>`
- type is `user` and content equals empty stdout/stderr
- type is `user` and content starts with `[Request interrupted by user`
- type is `user` with array content of single interruption text block

### Chunk Building Algorithm (`ChunkBuilder.buildChunks`)

1. Filter to main thread messages (`!isSidechain`)
2. Classify all messages
3. Iterate through classified messages with an `aiBuffer`:
   - `hardNoise`: Skip
   - `compact`: Flush aiBuffer -> AIChunk, create CompactChunk
   - `user`: Flush aiBuffer -> AIChunk, create UserChunk
   - `system`: Flush aiBuffer -> AIChunk, create SystemChunk
   - `ai`: Accumulate into aiBuffer
4. Flush remaining aiBuffer

### Chunk Types

```typescript
interface EnhancedUserChunk extends UserChunk {
  chunkType: 'user';
  userMessage: ParsedMessage;
  rawMessages: ParsedMessage[];
  // BaseChunk: id, startTime, endTime, durationMs, metrics
}

interface EnhancedAIChunk extends AIChunk {
  chunkType: 'ai';
  responses: ParsedMessage[];        // All assistant + internal messages
  processes: Process[];              // Linked subagents
  sidechainMessages: ParsedMessage[];
  toolExecutions: ToolExecution[];
  semanticSteps: SemanticStep[];     // Extracted steps
  semanticStepGroups?: SemanticStepGroup[];
  rawMessages: ParsedMessage[];
}

interface EnhancedSystemChunk extends SystemChunk {
  chunkType: 'system';
  message: ParsedMessage;
  commandOutput: string;  // Extracted from <local-command-stdout>
  rawMessages: ParsedMessage[];
}

interface EnhancedCompactChunk extends CompactChunk {
  chunkType: 'compact';
  message: ParsedMessage;
  rawMessages: ParsedMessage[];
}
```

### AIChunk Building (`buildAIChunkFromBuffer`)

1. Generate stable ID from first response message UUID: `ai-{uuid}`
2. Calculate timing from all response timestamps
3. Calculate metrics via `calculateMetrics(responses)`
4. Build tool executions via `buildToolExecutions(responses)`
5. Collect sidechain messages in time range
6. Link processes (subagents) to chunk via `linkProcessesToAIChunk`
7. Extract semantic steps via `extractSemanticStepsFromAIChunk`
8. Fill timeline gaps via `fillTimelineGaps`
9. Calculate step context via `calculateStepContext`
10. Build semantic step groups via `buildSemanticStepGroups`

### Semantic Step Extraction (`SemanticStepExtractor.ts`)

Iterates through all chunk responses:

| Source | Step Type | Key Content Fields |
|--------|-----------|--------------------|
| Assistant `thinking` block | `thinking` | `thinkingText`, `tokenCount` |
| Assistant `tool_use` block | `tool_call` | `toolName`, `toolInput`, `sourceModel` |
| Assistant `text` block | `output` | `outputText`, `tokenCount` |
| User message with `toolResults` | `tool_result` | `toolResultContent`, `isError`, `toolUseResult`, `tokenCount` |
| User message with interruption text | `interruption` | `interruptionText` |
| Linked Process | `subagent` | `subagentId`, `subagentDescription` |

**Important**: ALL tool calls are included in semantic steps (including Task tools with subagents). Task tools are only filtered from *display* in the renderer's `buildDisplayItems`.

Each step includes:
- `id`: For tool_call/tool_result, uses the tool_use ID; for others, `{msgUuid}-{type}-{counter}`
- `context`: `'main'` or `'subagent'` based on `msg.agentId`
- `sourceMessageId`: UUID of the assistant message
- `tokens`: Pre-computed token counts using `countContentTokens()`

Steps are sorted by `startTime` ascending.

### Process (Subagent) Type

```typescript
interface Process {
  id: string;
  filePath: string;
  messages: ParsedMessage[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: SessionMetrics;
  description?: string;        // From parent Task call
  subagentType?: string;       // e.g., "Explore", "Plan"
  isParallel: boolean;
  parentTaskId?: string;       // tool_use ID of the spawning Task call
  isOngoing?: boolean;
  mainSessionImpact?: {
    callTokens: number;
    resultTokens: number;
    totalTokens: number;
  };
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}
```

---

## Stage 3: Group Transformation (`groupTransformer.ts`)

### File
- `src/renderer/utils/groupTransformer.ts`

### `transformChunksToConversation(chunks, _subagents, isOngoing)`

**Input**: `EnhancedChunk[]`, `Process[]` (unused), `boolean`
**Output**: `SessionConversation`

```typescript
interface SessionConversation {
  sessionId: string;
  items: ChatItem[];
  totalUserGroups: number;
  totalSystemGroups: number;
  totalAIGroups: number;
  totalCompactGroups: number;
}

type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup };
```

**Algorithm**:

1. **Iterate chunks** and dispatch by type:
   - `EnhancedUserChunk` -> `UserGroup` via `createUserGroupFromChunk()`
   - `EnhancedSystemChunk` -> `SystemGroup` via `createSystemGroup()`
   - `EnhancedAIChunk` -> `AIGroup` via `createAIGroupFromChunk()`
   - `EnhancedCompactChunk` -> `CompactGroup` via `createCompactGroup()`

2. **CompactGroup post-pass enrichment**:
   - Iterate items, incrementing `phaseCounter` at each compact item
   - Set `compactItem.group.startingPhaseNumber = phaseCounter`
   - Find last AI group before and first AI group after the compact
   - Compute `tokenDelta`:
     - `preCompactionTokens` = last assistant's total tokens from the AI group *before*
     - `postCompactionTokens` = **first** assistant's total tokens from the AI group *after* (reflects actual compacted context)
     - `delta = post - pre`

3. **isOngoing detection**:
   - If `isOngoing` is true, find the last AI item
   - Set `isOngoing = true` and `status = 'in_progress'` on it
   - **Exception**: Don't override `interrupted` status

### UserGroup Creation

```typescript
interface UserGroup {
  id: string;             // "user-{uuid}"
  message: ParsedMessage;
  timestamp: Date;
  content: UserGroupContent;
  index: number;          // Position within session
}

interface UserGroupContent {
  text?: string;           // Display text (commands removed)
  rawText?: string;        // Sanitized original
  commands: CommandInfo[];  // Extracted /commands
  images: ImageData[];
  fileReferences: FileReference[];  // @path references
}
```

**Content extraction** (`extractUserGroupContent`):
1. Extract raw text from message content (string or array of text blocks)
2. Sanitize via `sanitizeDisplayContent()` (strips XML tags, converts `<command-name>` to readable format)
3. Check if command content via `isCommandContent()`
4. Extract inline `/commands` via regex: `/([a-z][a-z-]{0,50})(?:\s+(\S[^\n]{0,1000}))?$/gim`
5. Extract `@file` references via regex: `/@([~a-zA-Z0-9._/-]+)/g`, validated against known directory names
6. Remove extracted commands from display text

### SystemGroup Creation

```typescript
interface SystemGroup {
  id: string;              // Same as chunk.id
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string;   // Extracted from <local-command-stdout>
}
```

### AIGroup Creation

```typescript
interface AIGroup {
  id: string;              // Same as chunk.id
  turnIndex: number;       // 0-based index
  startTime: Date;
  endTime: Date;
  durationMs: number;
  steps: SemanticStep[];
  tokens: AIGroupTokens;
  summary: AIGroupSummary;
  status: AIGroupStatus;
  processes: Process[];
  chunkId: string;
  metrics: SessionMetrics;
  responses: ParsedMessage[];
  isOngoing?: boolean;
}
```

**Token calculation** (`calculateTokensFromSteps`):
- Sum `tokens.input`, `tokens.output`, `tokens.cached` from all steps
- Sum `tokenBreakdown.input`, `tokenBreakdown.output`, `tokenBreakdown.cacheRead` from all steps
- **Override** with `sourceMessage.usage` if available (more accurate from API)
- Track thinking tokens separately

**Summary computation** (`computeAIGroupSummary`):
- `thinkingPreview`: First 100 chars of first thinking step
- Count `toolCallCount`, `outputMessageCount`, `subagentCount`
- Sum `totalDurationMs`, `totalTokens`, `outputTokens`, `cachedTokens`

**Status determination** (`determineAIGroupStatus`):
- Empty steps -> `'error'`
- Has `interruption` step -> `'interrupted'`
- Has `tool_result` with `isError` -> `'error'`
- Has step without `endTime` -> `'in_progress'`
- Otherwise -> `'complete'`

### CompactGroup Creation

```typescript
interface CompactGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage;
  tokenDelta?: CompactionTokenDelta;    // Set in post-pass
  startingPhaseNumber?: number;         // Set in post-pass
}
```

---

## Stage 4: AI Group Enhancement (`aiGroupEnhancer.ts`)

### File
- `src/renderer/utils/aiGroupEnhancer.ts`

### `enhanceAIGroup(aiGroup, claudeMdStats?, precedingSlash?)`

**Input**: `AIGroup`, optional `ClaudeMdStats`, optional `PrecedingSlashInfo`
**Output**: `EnhancedAIGroup`

**Orchestration steps** (in order):

1. **`findLastOutput(steps, isOngoing)`** — determines what to show as "the answer"
2. **`linkToolCallsToResults(steps, responses)`** — matches tool calls to results
3. **`attachMainSessionImpact(processes, linkedTools)`** — sets `mainSessionImpact` on subagents
4. **`buildDisplayItems(steps, lastOutput, processes, responses, precedingSlash)`** — creates flat display list
5. **`buildSummary(displayItems)`** — creates "2 thinking, 4 tool calls" string
6. **`extractMainModel(steps)`** — finds most common model
7. **`extractSubagentModels(processes, mainModel)`** — finds unique subagent models

```typescript
interface EnhancedAIGroup extends AIGroup {
  lastOutput: AIGroupLastOutput | null;
  displayItems: AIGroupDisplayItem[];
  linkedTools: Map<string, LinkedToolItem>;
  itemsSummary: string;
  mainModel: ModelInfo | null;
  subagentModels: ModelInfo[];
  claudeMdStats: ClaudeMdStats | null;
}
```

---

## Stage 5: Last Output Detection (`lastOutputDetector.ts`)

### File
- `src/renderer/utils/lastOutputDetector.ts`

### `findLastOutput(steps, isOngoing)` Priority Chain

```typescript
interface AIGroupLastOutput {
  type: 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';
  text?: string;
  toolName?: string;
  toolResult?: string;
  isError?: boolean;
  interruptionMessage?: string;
  planContent?: string;
  planPreamble?: string;
  timestamp: Date;
}
```

| Priority | Check | Returns |
|----------|-------|---------|
| 1 | Any `interruption` step (reverse scan) | `{ type: 'interruption', timestamp }` |
| 2 | `isOngoing === true` (and no interruption) | `{ type: 'ongoing', timestamp }` |
| 3 | Last `tool_call` with `toolName === 'ExitPlanMode'` AND no later output/tool_result | `{ type: 'plan_exit', planContent, planPreamble, timestamp }` |
| 4 | Last `output` step with `outputText` (reverse scan) | `{ type: 'text', text, timestamp }` |
| 5 | Last `tool_result` step with `toolResultContent` (reverse scan) | `{ type: 'tool_result', toolName, toolResult, isError, timestamp }` |
| 6 | Last `interruption` step with `interruptionText` (redundant fallback) | `{ type: 'interruption', interruptionMessage, timestamp }` |
| 7 | None found | `null` |

**ExitPlanMode special case**: Extracts `plan` from tool input and preceding output step as `planPreamble`.

---

## Stage 6: Tool Linking Engine (`toolLinkingEngine.ts`)

### File
- `src/renderer/utils/toolLinkingEngine.ts`

### `linkToolCallsToResults(steps, responses?)`

**Input**: `SemanticStep[]`, optional `ParsedMessage[]`
**Output**: `Map<string, LinkedToolItem>`

**Algorithm**:
1. Filter steps to find all `tool_call` steps
2. Build map of `tool_result` steps by ID for fast lookup
3. Build map of skill instructions from responses (isMeta:true messages with `sourceToolUseID` and text starting with `"Base directory for this skill:"`)
4. For each tool call:
   - Find matching result by ID (`tool_result` step ID === `tool_call` step ID)
   - Convert timestamps via `toDate()` (handles IPC serialization)
   - Calculate `callTokens = estimateTokens(toolName + JSON.stringify(toolInput))`
   - Build `LinkedToolItem`

```typescript
interface LinkedToolItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  callTokens?: number;          // Token count for tool call
  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: ToolUseResultData;
    tokenCount?: number;        // Pre-computed result token count
  };
  inputPreview: string;         // First 100 chars of JSON.stringify(input)
  outputPreview?: string;       // First 200 chars of result content
  startTime: Date;
  endTime?: Date;
  durationMs?: number;          // endTime - startTime
  isOrphaned: boolean;          // No matching result
  sourceModel?: string;         // Only populated in buildDisplayItemsFromMessages (subagent traces); always undefined in linkToolCallsToResults (main session)
  skillInstructions?: string;
  skillInstructionsTokenCount?: number;
}
```

### Token Estimation

```typescript
// src/shared/utils/tokenFormatting.ts
function estimateTokens(text: string | undefined | null): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);  // ~4 chars per token heuristic
}
```

---

## Stage 7: Display Item Building (`displayItemBuilder.ts`)

### File
- `src/renderer/utils/displayItemBuilder.ts`

### `buildDisplayItems(steps, lastOutput, subagents, responses?, precedingSlash?)`

**For main session AI groups.**

**Algorithm**:
1. Call `linkToolCallsToResults(steps, responses)` to get linked tools
2. Build set of Task IDs with associated subagents (to prevent duplication)
3. Find lastOutput step ID by reverse-scanning steps and matching content
4. Iterate steps:
   - **Skip** step matching `lastOutputStepId`
   - `thinking` -> `{ type: 'thinking', content, timestamp, tokenCount }`
   - `tool_call` -> Get `LinkedToolItem`, skip if Task with subagent, else `{ type: 'tool', tool }`
   - `tool_result` -> **Skip** (already linked to calls)
   - `subagent` -> Find matching Process, `{ type: 'subagent', subagent }`
   - `output` -> `{ type: 'output', content, timestamp, tokenCount }`
   - `interruption` -> `{ type: 'output', content: interruptionText, ... }` (displayed as output)
5. Extract slashes via `extractSlashes(responses, precedingSlash)`, add as `{ type: 'slash', slash }`
6. Extract teammate messages from responses (non-meta user messages with `<teammate-message>` blocks)
7. **Sort chronologically** by timestamp
8. **Link teammate replies** to their triggering SendMessage calls (scan backwards)

### `buildDisplayItemsFromMessages(messages, subagents?)`

**For subagent traces.** Two-pass logic:

**First pass** — iterate all messages:
- Detect `compact_boundary`: compact summary messages -> `{ type: 'compact_boundary', content, timestamp, tokenDelta, phaseNumber }`
  - Token delta computed from last assistant input tokens before vs first after
- Detect `teammate_message`: user messages with `<teammate-message>` blocks
- Detect `subagent_input`: non-meta user messages with text content (and no tool_result blocks)
- Process `assistant` blocks: thinking, tool_use (collected for linking), text output
- Process tool results from `user` isMeta messages: collected for linking
- Detect skill instructions: isMeta messages with `sourceToolUseID` and "Base directory" text

**Second pass** — build LinkedToolItems:
- Match collected tool calls with results by ID
- Skip Task calls with associated subagents
- Attach skill instructions
- Add subagents as display items
- Extract slashes

**Sort and link**: Same as main session.

### Display Item Types

```typescript
type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItem }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage }
  | { type: 'subagent_input'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'compact_boundary'; content: string; timestamp: Date;
      tokenDelta?: CompactionTokenDelta; phaseNumber: number };
```

---

## Stage 8: Display Summary Building (`displaySummary.ts`)

### File
- `src/renderer/utils/displaySummary.ts`

### `buildSummary(items)`

Counts items by type and builds a human-readable string:

```
"2 thinking, 4 tool calls, 1 message, 2 teammates, 1 subagent, 1 slash"
```

- `thinking` -> `"N thinking"`
- `tool` -> `"N tool call(s)"`
- `output` -> `"N message(s)"`
- Team subagents (with `team` property) -> counted by unique `memberName` -> `"N teammate(s)"`
- `subagent` (non-team) -> `"N subagent(s)"`
- `slash` -> `"N slash(es)"`
- `teammate_message` -> `"N teammate message(s)"`
- `compact_boundary` -> `"N compaction(s)"`
- Returns `"No items"` if empty

---

## Stage 9: Model Extraction (`modelExtractor.ts`)

### File
- `src/renderer/utils/modelExtractor.ts`
- `src/shared/utils/modelParser.ts`

### `extractMainModel(steps)`

1. Scan `tool_call` steps for `content.sourceModel`
2. Parse each with `parseModelString()`, count occurrences
3. Return most common model

### `extractSubagentModels(processes, mainModel)`

1. For each process, find first assistant message with valid model
2. Parse with `parseModelString()`
3. Return unique models that differ from `mainModel`

### `parseModelString(model)` — Model String Parser

Handles two formats:
- **New**: `claude-{family}-{major}-{minor}-{date}` (e.g., `claude-sonnet-4-5-20250929`)
- **Old**: `claude-{major}[-{minor}]-{family}-{date}` (e.g., `claude-3-5-sonnet-20241022`)

```typescript
interface ModelInfo {
  name: string;           // e.g., "sonnet4.5"
  family: ModelFamily;    // 'sonnet' | 'opus' | 'haiku' | string
  majorVersion: number;
  minorVersion: number | null;
}
```

Returns `null` for empty, synthetic (`<synthetic>`), or invalid strings.

---

## Stage 10: Context Tracking (`contextTracker.ts`)

### File
- `src/renderer/utils/contextTracker.ts`

### `processSessionContextWithPhases(items, projectRoot, claudeMdTokenData?, mentionedFileTokenData?, directoryTokenData?)`

**Input**: `ChatItem[]`, `string`, optional token data maps
**Output**: `{ statsMap: Map<string, ContextStats>, phaseInfo: ContextPhaseInfo }`

**Algorithm**: Iterates through all ChatItem[] sequentially:

1. Track `previousUserGroup` (for pairing with next AI group)
2. On `compact` item: reset accumulated state, increment phase counter, start new phase
3. On `ai` item: call `computeContextStats()` for the AI group

**Phase tracking**:
- Phase 1 starts at beginning
- Each compact boundary increments phase number
- `aiGroupPhaseMap` maps each AI group ID to its phase number
- `compactionTokenDeltas` computed for first AI group after each compaction

### `computeContextStats()` — Per-Turn Computation

The 6 context categories:

| Category | Key | Source |
|----------|-----|--------|
| CLAUDE.md files | `claude-md` | Global injections (first group only) + directory CLAUDE.md detected from file paths |
| Mentioned files | `mentioned-file` | User `@path` references, validated against mentionedFileTokenData |
| Tool outputs | `tool-output` | All linked tool call/result tokens EXCEPT task coordination tools |
| Thinking/text | `thinking-text` | Thinking blocks + text output blocks from display items |
| Task coordination | `task-coordination` | SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet + teammate messages |
| User messages | `user-message` | User input text from preceding UserGroup |

```typescript
interface ContextStats {
  newInjections: ContextInjection[];
  accumulatedInjections: ContextInjection[];
  totalEstimatedTokens: number;
  tokensByCategory: TokensByCategory;
  newCounts: NewCountsByCategory;
  phaseNumber?: number;
}
```

**Important behaviors**:
- CLAUDE.md global injections are added only for the first AI group in each phase
- Directory CLAUDE.md files are detected from Read tool paths, user @mentions, and response file refs
- Mentioned files are validated via `mentionedFileTokenData` (must exist and be under `MAX_MENTIONED_FILE_TOKENS`)
- Tool output tokens = `callTokens + resultTokens + skillInstructionsTokens`
- Accumulated injections carry forward across turns, reset at compaction boundaries

---

## Stage 11: Slash Command Extraction (`slashCommandExtractor.ts`)

### File
- `src/renderer/utils/slashCommandExtractor.ts`

### `extractSlashes(responses, precedingSlash?)`

**All slash commands** have the same XML format:
```xml
<command-name>/xxx</command-name>
<command-message>xxx</command-message>
<command-args>optional</command-args>
```

**Algorithm**:
1. Build map of follow-up messages (isMeta:true with parentUuid, NOT tool-call related) for instructions
2. Build map of slash messages found in responses (fallback)
3. **Strategy 1**: If `precedingSlash` provided, create SlashItem with matched follow-up instructions
4. **Strategy 2**: Match slash messages in responses to their follow-ups

```typescript
interface SlashItem {
  id: string;                        // "slash-{uuid}"
  name: string;                      // Without leading /
  message?: string;
  args?: string;
  commandMessageUuid: string;
  instructions?: string;             // From follow-up isMeta message
  instructionsTokenCount?: number;
  timestamp: Date;
}
```

---

## Stage 12: AI Group Helpers (`aiGroupHelpers.ts`)

### File
- `src/renderer/utils/aiGroupHelpers.ts`

### Key Functions

**`toDate(timestamp)`**: Safely converts `Date | string | number` to `Date`. Handles IPC serialization where Dates become strings.

**`truncateText(text, maxLength)`**: Truncates with `...` ellipsis.

**`formatToolInput(input)`**: `JSON.stringify(input, null, 2)`, truncated to 100 chars.

**`formatToolResult(content)`**: For strings, truncated to 200 chars. For arrays, JSON stringified then truncated.

**`attachMainSessionImpact(subagents, linkedTools)`**: For each subagent with `parentTaskId`, finds matching Task tool and sets:
```typescript
subagent.mainSessionImpact = {
  callTokens,    // Task tool_use input tokens
  resultTokens,  // Task tool_result output tokens
  totalTokens,   // Sum
};
```

**`computeSubagentPhaseBreakdown(messages)`**: Computes multi-phase context breakdown for subagent sessions. Tracks assistant input tokens across compaction events.

---

## Stage 13: Formatters and Utilities

### `formatDuration(ms)` — `src/renderer/utils/formatters.ts`

| Range | Format | Example |
|-------|--------|---------|
| < 1000ms | `{N}ms` | `"450ms"` |
| < 60s | `{N.N}s` | `"12.5s"` |
| >= 60s | `{M}m {S}s` | `"2m 30s"` |

**Note**: TWO different `formatDuration` implementations exist:
1. `formatters.ts` — the shared utility (as described above)
2. An inline implementation in `AIChatGroup.tsx` (lines 63-78) with slightly different decimal handling

Components use the inline implementation for display, not the shared utility.

### `formatTimestamp` — uses `date-fns format()`

There is no standalone `formatTimestamp` function exported. Instead, components call `format(timestamp, 'h:mm:ss a')` directly from `date-fns`. Format pattern: `'h:mm:ss a'` (12-hour with AM/PM). Example: `"2:45:30 PM"`

### `formatTokensCompact(tokens)` — `src/shared/utils/tokenFormatting.ts`

| Range | Format | Example |
|-------|--------|---------|
| >= 1,000,000 | `{N.N}M` | `"1.5M"` |
| >= 1,000 | `{N.N}k` | `"50.0k"` |
| < 1,000 | `{N}` | `"500"` |

### `toolSummaryHelpers.ts` — Tool Summary Generation

`getToolSummary(toolName, input)` generates human-readable summaries for 17+ tool types:

| Tool | Summary Format |
|------|----------------|
| `Edit` | `"{filename} - {N} line(s)"` or `"{filename} - {old} -> {new} lines"` |
| `Read` | `"{filename}"` or `"{filename} - lines {start}-{end}"` |
| `Write` | `"{filename} - {N} lines"` |
| `Bash` | Description (preferred) or command, truncated to 50 chars |
| `Grep` | `'"{pattern}" in {glob/path}'` |
| `Glob` | `'"{pattern}" in {path}'` |
| `Task` | `"{subagentType} - {description}"` truncated to 40 chars |
| `LSP` | `"{operation} - {filename}"` |
| `WebFetch` | `"{hostname}{pathname}"` truncated to 50 chars |
| `WebSearch` | `'"{query}"'` truncated to 40 chars |
| `TodoWrite` | `"{N} item(s)"` |
| `NotebookEdit` | `"{editMode} - {filename}"` |
| `TeamCreate` | `"{teamName} - {description}"` |
| `TaskCreate` | `"{subject}"` truncated to 50 chars |
| `TaskUpdate` | `"#{taskId} {status} -> {owner}"` |
| `TaskList` | `"List tasks"` |
| `TaskGet` | `"Get task #{taskId}"` |
| `SendMessage` | `"To {recipient}: {summary}"` or `"Shutdown {recipient}"` or `"Shutdown response"` or `"Broadcast: {summary}"` |
| `TeamDelete` | `"Delete team"` |
| Default | 1. Try common parameter names (`name`, `path`, `file`, `query`, `command`) — truncated to 50 chars. 2. If none found, use first string parameter value — truncated to 40 chars. 3. Fall back to tool name. |

### Content Sanitizer (`contentSanitizer.ts`)

**`sanitizeDisplayContent(content)`**:
1. Command output (`<local-command-stdout>`) -> extract inner content
2. Command messages (`<command-name>`) -> convert to `/commandName args`
3. Remove noise tags: `<local-command-caveat>`, `<system-reminder>`
4. Remove any remaining command tags

**`extractSlashInfo(content)`**: Extracts `name`, `message`, `args` from command XML format.

### Teammate Message Parser (`teammateMessageParser.ts`)

**`parseAllTeammateMessages(rawContent)`**:
- Regex: `<teammate-message\s+teammate_id="([^"]+)"([^>]*)>([\s\S]*?)<\/teammate-message>`
- Extracts: `teammateId`, `color` (from `color="..."` attr), `summary` (from `summary="..."` attr), `content`
- Returns array of `ParsedTeammateContent` (may be 0, 1, or many per message)

---

## Stage 14: Display Components

### ChatHistory (`ChatHistory.tsx`)

**Props**: `{ tabId?: string }`

**Key features**:
- **Virtualization**: Uses `@tanstack/react-virtual` when items >= 120 (`VIRTUALIZATION_THRESHOLD`)
- **Estimated item height**: 260px
- **Overscan**: 8 items
- **Auto-scroll**: Follows conversation updates when user is near bottom (300px threshold)
- **Scroll-to-bottom button**: Shows when not near bottom
- **Context panel**: Sidebar with session context stats, toggleable
- **Navigation**: Supports deep linking to specific turns, tools, and search results
- **Search**: Highlights search matches in rendered content, scrolls to current match

**Layout**: `flex flex-1 flex-col overflow-hidden` with `max-w-5xl` centered content.

### ChatHistoryItem (`ChatHistoryItem.tsx`)

**Props**: `{ item: ChatItem, highlightedGroupId, highlightToolUseId, isSearchHighlight, isNavigationHighlight, highlightColor, registerChatItemRef, registerAIGroupRef, registerToolRef }`

Dispatches to:
- `user` -> `UserChatGroup`
- `system` -> `SystemChatGroup`
- `ai` -> `AIChatGroup`
- `compact` -> `CompactBoundary`

**Highlight styles**:
- Search: `ring-2 ring-yellow-500/30 bg-yellow-500/5`
- Navigation: `ring-2 ring-blue-500/30 bg-blue-500/5`
- Error: Custom color from `triggerColors`

### AIChatGroup (`AIChatGroup.tsx`)

**Props**: `{ aiGroup: AIGroup, highlightToolUseId?, highlightColor?, registerToolRef? }`

**Key behaviors**:
1. Calls `enhanceAIGroup(aiGroup, claudeMdStats, precedingSlash)` via `useMemo`
2. Finds preceding UserGroup to extract `PrecedingSlashInfo`
3. Gets `lastUsage` from last assistant message (not summed — single snapshot)
4. Estimates `thinkingTokens` and `textOutputTokens` from content blocks

**Layout (vertical stack)**:
```
[Header Row]
  Bot icon | "Claude" | mainModel (color-coded) | -> subagentModels | . | itemsSummary | chevron
  [right side] ContextBadge | TokenUsageDisplay | Clock duration | timestamp

[Expandable Content] (when expanded)
  DisplayItemList

[Always-visible Output]
  LastOutputDisplay
```

**Expansion logic**:
- Manual toggle via per-tab state
- Auto-expand for highlighted error tools
- Auto-expand for search results

### UserChatGroup (`UserChatGroup.tsx`)

**Props**: `{ userGroup: UserGroup }`

**Layout**: Right-aligned bubble
```
[Header]  timestamp | "You" | User icon

[Content Bubble]  rounded-2xl rounded-br-sm
  ReactMarkdown with:
  - @path highlighting (validated via IPC, styled as inline tags)
  - Search term highlighting
  - Copy button on hover
  - Collapse toggle for > 500 chars
  - Auto-expand when search matches this message

[Images indicator]  "N images attached"
```

**Styling**: `--chat-user-bg`, `--chat-user-border`, `--chat-user-text`, `--chat-user-shadow` CSS variables.

### SystemChatGroup (`SystemChatGroup.tsx`)

Renders command output on the LEFT side (like AI responses) with neutral gray styling. Shows the extracted command output text.

### CompactBoundary (`CompactBoundary.tsx`)

**Props**: `{ compactGroup: CompactGroup }`

**Layout**:
```
[Collapsible Header Button]
  ChevronRight | Layers icon | "Compacted" label
  Token delta: "50.0k -> 12.5k (37.5k freed)" in green
  Phase badge: "Phase 2" in indigo
  Timestamp

[Expanded Content] (when clicked)
  ReactMarkdown rendering of compact summary
  with border-l-2 accent bar and CopyButton
```

**Token delta display**: `formatTokensCompact(pre) -> formatTokensCompact(post)` with `formatTokensCompact(|delta|) freed` in green.

### DisplayItemList (`DisplayItemList.tsx`)

Renders the flat chronological list of `AIGroupDisplayItem[]`. Dispatches each item to its component:
- `thinking` -> `ThinkingItem`
- `tool` -> `LinkedToolItem`
- `subagent` -> `SubagentItem`
- `output` -> `TextItem`
- `slash` -> `SlashItem`
- `teammate_message` -> `TeammateMessageItem`
- `subagent_input` -> rendered inline
- `compact_boundary` -> rendered inline

### LastOutputDisplay (`LastOutputDisplay.tsx`)

**Props**: `{ lastOutput: AIGroupLastOutput | null, aiGroupId, isLastGroup?, isSessionOngoing? }`

**Rendering by type**:

| Type | Rendering |
|------|-----------|
| `text` | ReactMarkdown in code-bg rounded-lg with CopyButton, max-h-96 scrollable |
| `tool_result` | Header (CheckCircle/XCircle + tool name + "Error" label) + pre content, styled green/red |
| `interruption` | Yellow banner with AlertTriangle + "Request interrupted by user" |
| `plan_exit` | Optional preamble block + "Plan Ready for Approval" card with FileCheck icon, ReactMarkdown content |
| `ongoing` | `OngoingBanner` component (animated indicator) |
| `null` | Returns null |

**Special case**: If `isLastGroup && isSessionOngoing`, shows OngoingBanner regardless of lastOutput.

### ThinkingItem (`items/ThinkingItem.tsx`)

Renders thinking content in a collapsible block with `<Brain>` icon. Token count displayed.

### TextItem (`items/TextItem.tsx`)

Renders text output with ReactMarkdown. Collapsible for long content.

### LinkedToolItem (`items/LinkedToolItem.tsx`)

**Complex component** with multiple special cases:

1. **Normal tool**: Collapsible row with tool name badge, summary, duration, token count
2. **Viewer selection**: Based on tool name, selects appropriate viewer component
3. **Teammate spawned**: When `result.toolUseResult.status === 'teammate_spawned'`, shows team member badge with color
4. **SendMessage shutdown**: When `name === 'SendMessage'` and `input.type === 'shutdown_request'`, shows shutdown styling
5. **Error display**: Red styling for error results

**Token display**: Shows `callTokens` (generated by Claude) and `result.tokenCount` (read back).

### SubagentItem (`items/SubagentItem.tsx`)

**Features**:
- Lazy display items: Calls `buildDisplayItemsFromMessages()` only when expanded
- Shows `mainSessionImpact` tokens (Task call + result in parent context)
- Phase-aware: Shows phase breakdown for subagents with compaction
- Shutdown-only: Special handling for subagents that only received shutdown
- Color theming: Team members get custom color from `team.memberColor`
- Expandable execution trace with nested DisplayItemList

### ContextBadge (`ContextBadge.tsx`)

Shows a small badge indicating context injection count. On hover/click, opens popover with:
- 6 categories of context with token counts
- Click to navigate to source turns

### TokenUsageDisplay (`common/TokenUsageDisplay.tsx`)

**Props**: `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens?, textOutputTokens?, modelName?, modelFamily?, size?, claudeMdStats?, contextStats?, phaseNumber?, totalPhases? }`

**Compact display**: Shows total tokens using `formatTokensCompact()`.

**Hover popover** (portal-based) shows:
- Input tokens breakdown
- Cache read + creation tokens
- Output tokens
- Thinking + text output breakdown
- Model info
- Phase badge (e.g., "Phase 2 of 3")
- Session context breakdown (6 categories as expandable section)

---

## Stage 15: Tool Viewers

### ReadToolViewer (`linkedTool/ReadToolViewer.tsx`)

Shows file content from Read tool results. Displays file path, line numbers, and syntax-highlighted content via `CodeBlockViewer`.

### EditToolViewer (`linkedTool/EditToolViewer.tsx`)

Shows edit operations with before/after diff. Uses `DiffViewer` for visual diff.
- Extracts `file_path`, `old_string`, `new_string` from input
- Shows filename and line change count

### WriteToolViewer (`linkedTool/WriteToolViewer.tsx`)

Shows written file content. Displays file path and full content via `CodeBlockViewer`.

### SkillToolViewer (`linkedTool/SkillToolViewer.tsx`)

Shows skill invocation with instructions. Displays skill name, arguments, and the follow-up instructions text.

### DefaultToolViewer (`linkedTool/DefaultToolViewer.tsx`)

Fallback viewer for unknown tools. Shows JSON input and output as formatted code blocks.

### ToolErrorDisplay (`linkedTool/ToolErrorDisplay.tsx`)

Renders error results with red styling. Shows error content in pre-formatted block.

### DiffViewer (`viewers/DiffViewer.tsx`)

Computes LCS (Longest Common Subsequence) algorithm for line-by-line diff visualization. Shows additions in green, deletions in red, and unchanged lines in gray. Line numbers on both sides.

### CodeBlockViewer (`viewers/CodeBlockViewer.tsx`)

Shows code with:
- Line numbers
- Language detection from file extension
- Syntax highlighting via `syntaxHighlighter.ts`
- Copy button
- Collapsible for long content

### MarkdownViewer (`viewers/MarkdownViewer.tsx`)

Renders markdown content using ReactMarkdown with remark-gfm. Used for rendering assistant text output.

---

## Appendix A: Subagent Directory Structures

```
NEW STRUCTURE (Current):
~/.claude/projects/
  {project_name}/
    {session_uuid}.jsonl              <- Main agent
    {session_uuid}/
      agent_{agent_uuid}.jsonl         <- Subagents

OLD STRUCTURE (Legacy, still supported):
~/.claude/projects/
  {project_name}/
    {session_uuid}.jsonl              <- Main agent
    agent_{agent_uuid}.jsonl           <- Subagents (at root)
```

## Appendix B: Message Flow Pattern

```
1. User types       -> type: "user", isMeta: false, content: string     -> STARTS CHUNK
2. Assistant responds -> type: "assistant", may contain tool_use          -> PART OF RESPONSE
3. Tool executes    -> type: "user", isMeta: true, contains tool_result  -> PART OF RESPONSE
4. User interrupts  -> type: "user", isMeta: false, content: array       -> PART OF RESPONSE
5. Assistant continues -> type: "assistant"                               -> PART OF RESPONSE
```

## Appendix C: Key File Locations

| Module | File Path |
|--------|-----------|
| JSONL Types | `src/main/types/jsonl.ts` |
| Domain Types | `src/main/types/domain.ts` |
| Chunk Types | `src/main/types/chunks.ts` |
| Message Types | `src/main/types/messages.ts` |
| Group Types | `src/renderer/types/groups.ts` |
| Context Injection Types | `src/renderer/types/contextInjection.ts` |
| SessionParser | `src/main/services/parsing/SessionParser.ts` |
| MessageClassifier | `src/main/services/parsing/MessageClassifier.ts` |
| ChunkBuilder | `src/main/services/analysis/ChunkBuilder.ts` |
| ChunkFactory | `src/main/services/analysis/ChunkFactory.ts` |
| SemanticStepExtractor | `src/main/services/analysis/SemanticStepExtractor.ts` |
| ProcessLinker | `src/main/services/analysis/ProcessLinker.ts` |
| GroupTransformer | `src/renderer/utils/groupTransformer.ts` |
| AIGroupEnhancer | `src/renderer/utils/aiGroupEnhancer.ts` |
| DisplayItemBuilder | `src/renderer/utils/displayItemBuilder.ts` |
| ToolLinkingEngine | `src/renderer/utils/toolLinkingEngine.ts` |
| LastOutputDetector | `src/renderer/utils/lastOutputDetector.ts` |
| ContextTracker | `src/renderer/utils/contextTracker.ts` |
| DisplaySummary | `src/renderer/utils/displaySummary.ts` |
| ModelExtractor | `src/renderer/utils/modelExtractor.ts` |
| SlashCommandExtractor | `src/renderer/utils/slashCommandExtractor.ts` |
| AIGroupHelpers | `src/renderer/utils/aiGroupHelpers.ts` |
| Formatters | `src/renderer/utils/formatters.ts` |
| TokenFormatting | `src/shared/utils/tokenFormatting.ts` |
| ContentSanitizer | `src/shared/utils/contentSanitizer.ts` |
| ModelParser | `src/shared/utils/modelParser.ts` |
| TeammateMessageParser | `src/shared/utils/teammateMessageParser.ts` |
| MessageTags | `src/main/constants/messageTags.ts` |
| ToolSummaryHelpers | `src/renderer/utils/toolRendering/toolSummaryHelpers.ts` |
| ChatHistory | `src/renderer/components/chat/ChatHistory.tsx` |
| ChatHistoryItem | `src/renderer/components/chat/ChatHistoryItem.tsx` |
| AIChatGroup | `src/renderer/components/chat/AIChatGroup.tsx` |
| UserChatGroup | `src/renderer/components/chat/UserChatGroup.tsx` |
| SystemChatGroup | `src/renderer/components/chat/SystemChatGroup.tsx` |
| CompactBoundary | `src/renderer/components/chat/CompactBoundary.tsx` |
| DisplayItemList | `src/renderer/components/chat/DisplayItemList.tsx` |
| LastOutputDisplay | `src/renderer/components/chat/LastOutputDisplay.tsx` |
| ThinkingItem | `src/renderer/components/chat/items/ThinkingItem.tsx` |
| TextItem | `src/renderer/components/chat/items/TextItem.tsx` |
| LinkedToolItem | `src/renderer/components/chat/items/LinkedToolItem.tsx` |
| SubagentItem | `src/renderer/components/chat/items/SubagentItem.tsx` |
| SlashItem | `src/renderer/components/chat/items/SlashItem.tsx` |
| TeammateMessageItem | `src/renderer/components/chat/items/TeammateMessageItem.tsx` |
| ContextBadge | `src/renderer/components/chat/ContextBadge.tsx` |
| TokenUsageDisplay | `src/renderer/components/common/TokenUsageDisplay.tsx` |
| ReadToolViewer | `src/renderer/components/chat/items/linkedTool/ReadToolViewer.tsx` |
| EditToolViewer | `src/renderer/components/chat/items/linkedTool/EditToolViewer.tsx` |
| WriteToolViewer | `src/renderer/components/chat/items/linkedTool/WriteToolViewer.tsx` |
| SkillToolViewer | `src/renderer/components/chat/items/linkedTool/SkillToolViewer.tsx` |
| DefaultToolViewer | `src/renderer/components/chat/items/linkedTool/DefaultToolViewer.tsx` |
| DiffViewer | `src/renderer/components/chat/viewers/DiffViewer.tsx` |
| CodeBlockViewer | `src/renderer/components/chat/viewers/CodeBlockViewer.tsx` |
| MarkdownViewer | `src/renderer/components/chat/viewers/MarkdownViewer.tsx` |
