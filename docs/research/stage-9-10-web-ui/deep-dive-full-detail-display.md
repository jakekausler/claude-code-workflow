# Deep Dive: Full Detail Display of Claude Code Sessions

This document provides a comprehensive technical analysis of how three applications display the full detail of Claude Code sessions, including tool use, subagent execution, thinking, costs, and context tracking.

---

## Table of Contents

1. [JSONL Format and Type Definitions](#1-jsonl-format-and-type-definitions)
2. [claude-devtools: Complete Architecture](#2-claude-devtools-complete-architecture)
   - [Message Parsing Pipeline](#21-message-parsing-pipeline)
   - [Chunk Building System](#22-chunk-building-system)
   - [Tool Execution Display](#23-tool-execution-display)
   - [Subagent/Task Tracking](#24-subagenttask-tracking)
   - [Semantic Step Extraction](#25-semantic-step-extraction)
   - [Context Window Tracking](#26-context-window-tracking)
   - [Cost and Metrics](#27-cost-and-metrics)
3. [claude-code-monitor: Event-Based Timeline](#3-claude-code-monitor-event-based-timeline)
4. [vibe-kanban: Streaming Patch System](#4-vibe-kanban-streaming-patch-system)
5. [Comparison Summary](#5-comparison-summary)

---

## 1. JSONL Format and Type Definitions

Claude Code stores sessions as JSONL files at:
```
~/.claude/projects/{project_name}/{session_uuid}.jsonl
```

### Entry Types

There are 6 entry types in the JSONL format:

```typescript
type EntryType =
  | 'user'        // User input or tool results
  | 'assistant'   // Claude responses
  | 'system'      // Turn duration or init metadata
  | 'summary'     // Compact summary boundaries
  | 'file-history-snapshot'  // File backup snapshots
  | 'queue-operation';       // Queue operations
```

### Content Block Types

Each message can contain different content blocks:

```typescript
type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

interface TextContent {
  type: 'text';
  text: string;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature: string;  // Cryptographic signature for thinking blocks
}

interface ToolUseContent {
  type: 'tool_use';
  id: string;                        // Unique ID for linking to results
  name: string;                      // Tool name (Read, Edit, Bash, etc.)
  input: Record<string, unknown>;    // Tool parameters
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;               // Links back to tool_use.id
  content: string | ContentBlock[];  // Result content
  is_error?: boolean;                // Whether execution errored
}

interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}
```

### Usage Metadata (per assistant message)

```typescript
interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
```

### Full Entry Structures

**User Entry** (dual-purpose: real user input OR tool results):
```typescript
interface UserEntry {
  type: 'user';
  parentUuid: string | null;
  isSidechain: boolean;         // true = subagent message
  sessionId: string;            // For subagents, points to parent session UUID
  isMeta?: boolean;             // true = internal tool result, false = real user input
  message: { role: 'user'; content: string | ContentBlock[] };
  toolUseResult?: Record<string, unknown>;  // Structured tool result data
  sourceToolUseID?: string;      // Links to the tool_use that produced this result
  sourceToolAssistantUUID?: string;
  timestamp?: string;
  uuid?: string;
  cwd: string;
  gitBranch: string;
  version: string;
  agentId?: string;
}
```

**Assistant Entry**:
```typescript
interface AssistantEntry {
  type: 'assistant';
  message: {
    role: 'assistant';
    model: string;           // e.g., "claude-sonnet-4-20250514"
    id: string;
    content: ContentBlock[];
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
    usage: UsageMetadata;
  };
  requestId: string;
  agentId?: string;
  // ... same conversational fields as UserEntry
}
```

**System Entry**:
```typescript
interface SystemEntry {
  type: 'system';
  subtype: 'turn_duration' | 'init';
  durationMs: number;
  isMeta: boolean;
}
```

### Message Flow Pattern

The critical insight is how messages flow:

```
1. User types       -> type: "user",  isMeta: false, content: string    -> STARTS NEW CHUNK
2. Assistant responds -> type: "assistant", may contain tool_use blocks  -> PART OF RESPONSE
3. Tool executes     -> type: "user",  isMeta: true, contains tool_result -> PART OF RESPONSE
4. User interrupts   -> type: "user",  isMeta: false, content: array    -> PART OF RESPONSE
5. Assistant continues -> type: "assistant"                               -> PART OF RESPONSE
```

### Tool Linking

Tools are linked by matching IDs:
- `tool_use.id` in assistant message content blocks
- `tool_result.tool_use_id` in the subsequent user (isMeta: true) message
- `sourceToolUseID` field directly on the internal user entry (most reliable)

### Subagent Directory Structures

```
NEW STRUCTURE (Current):
~/.claude/projects/
  {project_name}/
    {session_uuid}.jsonl                    <- Main agent
    {session_uuid}/subagents/
      agent-{agent_uuid}.jsonl              <- Subagents

OLD STRUCTURE (Legacy):
~/.claude/projects/
  {project_name}/
    {session_uuid}.jsonl                    <- Main agent
    agent-{agent_uuid}.jsonl                <- Subagents (at project root)

Identification:
- Main agent:  isSidechain: false (or undefined)
- Subagent:    isSidechain: true
- Linking:     subagent.sessionId === parent session UUID
```

---

## 2. claude-devtools: Complete Architecture

### 2.1 Message Parsing Pipeline

The pipeline processes JSONL files through several stages:

```
JSONL File → SessionParser → ParsedMessage[] → MessageClassifier → ChunkBuilder → EnhancedChunk[]
```

**ParsedMessage** is the internal representation after parsing:

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
  toolCalls: ToolCall[];       // Extracted from content blocks
  toolResults: ToolResult[];   // Extracted from content blocks
  sourceToolUseID?: string;
  toolUseResult?: Record<string, unknown>;
  isCompactSummary?: boolean;
}
```

**Message Classification** (4-category system):

1. **User** (`isParsedUserChunkMessage`): Genuine user input that starts a new chunk. Renders on RIGHT side.
   - `type='user'`, `isMeta!=true`, has text/image content
   - Excludes `<local-command-stdout>`, `<local-command-caveat>`, `<system-reminder>`
   - Allows `<command-name>` (slash commands are visible user input)

2. **System** (`isParsedSystemChunkMessage`): Command output from slash commands. Renders on LEFT side.
   - Contains `<local-command-stdout>` tag

3. **Hard Noise** (`isParsedHardNoiseMessage`): Filtered out entirely.
   - system/summary/file-history-snapshot/queue-operation entries
   - Messages with ONLY `<local-command-caveat>` or `<system-reminder>`
   - Synthetic assistant messages (`model='<synthetic>'`)
   - Empty command output
   - Interruption messages

4. **AI**: All other messages grouped into AIChunks. Renders on LEFT side.

### 2.2 Chunk Building System

The `ChunkBuilder` orchestrates chunk creation:

```typescript
// From ChunkBuilder.ts
buildChunks(messages: ParsedMessage[], subagents: Process[] = []): EnhancedChunk[] {
  // 1. Filter to main thread messages (non-sidechain)
  const mainMessages = messages.filter(m => !m.isSidechain);

  // 2. Classify each message into categories
  const classified = classifyMessages(mainMessages);

  // 3. Build chunks - AI messages are buffered and grouped
  let aiBuffer: ParsedMessage[] = [];
  for (const { message, category } of classified) {
    switch (category) {
      case 'hardNoise': break;  // Skip
      case 'compact':   // Flush buffer, create CompactChunk
      case 'user':      // Flush buffer, create UserChunk
      case 'system':    // Flush buffer, create SystemChunk
      case 'ai':        aiBuffer.push(message); break;  // Buffer
    }
  }
}
```

**Chunk Types:**

```typescript
interface UserChunk {
  chunkType: 'user';
  userMessage: ParsedMessage;
  // BaseChunk: id, startTime, endTime, durationMs, metrics
}

interface AIChunk {
  chunkType: 'ai';
  responses: ParsedMessage[];          // All assistant + internal messages
  processes: Process[];                 // Linked subagents
  sidechainMessages: ParsedMessage[];   // Sidechain messages
  toolExecutions: ToolExecution[];      // Linked tool call/result pairs
}

interface SystemChunk {
  chunkType: 'system';
  message: ParsedMessage;
  commandOutput: string;               // Extracted from <local-command-stdout>
}

interface CompactChunk {
  chunkType: 'compact';
  message: ParsedMessage;              // Marks conversation compaction boundary
}
```

**Enhanced Chunks** add visualization data:

```typescript
interface EnhancedAIChunk extends AIChunk {
  semanticSteps: SemanticStep[];           // Logical work units
  semanticStepGroups?: SemanticStepGroup[];  // Grouped for collapsible UI
  rawMessages: ParsedMessage[];             // For debug sidebar
}
```

### 2.3 Tool Execution Display

#### ToolExecutionBuilder

Matches tool calls with their results in a two-pass approach:

```typescript
// From ToolExecutionBuilder.ts
function buildToolExecutions(messages: ParsedMessage[]): ToolExecution[] {
  const toolCallMap = new Map<string, { call: ToolCall; startTime: Date }>();

  // First pass: collect all tool calls
  for (const msg of messages) {
    for (const toolCall of msg.toolCalls) {
      toolCallMap.set(toolCall.id, { call: toolCall, startTime: msg.timestamp });
    }
  }

  // Second pass: match with results
  // Try sourceToolUseID first (most accurate), then toolResults array fallback
  for (const msg of messages) {
    if (msg.sourceToolUseID) {
      const callInfo = toolCallMap.get(msg.sourceToolUseID);
      // ... match and build execution with timing
    }
    // Also check toolResults array for unmatched results
  }

  // Add calls without results (orphaned tools)
  // Sort by start time
}
```

Result type:
```typescript
interface ToolExecution {
  toolCall: ToolCall;
  result?: ToolResult;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}
```

#### Tool Rendering Components

**LinkedToolItem** is the main tool display component. It uses specialized viewers based on tool type:

| Tool Type | Viewer | What It Shows |
|-----------|--------|---------------|
| `Read` | `ReadToolViewer` | CodeBlockViewer with file content, line numbers, file path |
| `Edit` | `EditToolViewer` | DiffViewer with old/new strings, diff format, result status |
| `Write` | `WriteToolViewer` | CodeBlockViewer with created/written content, markdown preview toggle |
| `Skill` | `SkillToolViewer` | Result text + skill instructions in code viewer |
| All others | `DefaultToolViewer` | Key-value input display + raw output section |

Each tool item displays:
- **Icon**: Wrench icon (highlighted for errors)
- **Label**: Tool name
- **Summary**: Human-readable description (e.g., "filename.ts - 3 -> 5 lines")
- **Token count**: Estimated context tokens consumed
- **Status**: ok (green), error (red), orphaned (gray)
- **Duration**: Formatted time

**Tool Summary Generation** (from `toolSummaryHelpers.ts`):

```typescript
function getToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Edit':  // "filename.ts - 3 -> 5 lines"
    case 'Read':  // "filename.ts - lines 1-100"
    case 'Write': // "filename.ts - 42 lines"
    case 'Bash':  // Description or truncated command
    case 'Grep':  // '"pattern" in *.ts'
    case 'Glob':  // '"**/*.ts" in src'
    case 'Task':  // "Explore - Search for patterns..."
    case 'Skill': // Skill name
    case 'WebFetch': // hostname + pathname
    case 'WebSearch': // Quoted query
    case 'SendMessage': // "To recipient: summary"
    case 'TeamCreate': // "teamName - description"
    case 'TaskCreate': // Subject text
    case 'TaskUpdate': // "#id status -> owner"
    // ... etc
  }
}
```

**Tool Context Token Calculation** (from `toolTokens.ts`):

```typescript
function getToolContextTokens(linkedTool: LinkedToolItem): number {
  let totalTokens = 0;

  // Tool CALL tokens (what Claude generated — e.g., file content for Write)
  totalTokens += linkedTool.callTokens ?? estimateTokens(JSON.stringify(linkedTool.input));

  // Tool RESULT tokens (what Claude reads back — e.g., Read file content)
  totalTokens += linkedTool.result?.tokenCount ?? estimateTokens(result.content);

  // Skill tools also add instruction tokens
  if (linkedTool.name === 'Skill') {
    totalTokens += linkedTool.skillInstructionsTokenCount ?? estimateTokens(instructions);
  }

  return totalTokens;
}
```

**Input Rendering** (from `renderHelpers.tsx`):

```typescript
function renderInput(toolName: string, input: Record<string, unknown>): React.ReactElement {
  // Edit: Shows diff-like format with "- old" and "+ new" lines
  // Bash: Shows description + command code block
  // Read: Shows file path + offset/limit info
  // Default: Key-value pairs with formatted values
}
```

### 2.4 Subagent/Task Tracking

#### SubagentLocator

Finds subagent JSONL files:

```typescript
class SubagentLocator {
  async listSubagentFiles(projectId: string, sessionId: string): Promise<string[]> {
    // 1. Scan NEW structure: {projectId}/{sessionId}/subagents/agent-*.jsonl
    // 2. Scan OLD structure: {projectId}/agent-*.jsonl (filter by sessionId)
    // Returns combined list
  }

  async subagentBelongsToSession(filePath: string, sessionId: string): Promise<boolean> {
    // Read first line, check if entry.sessionId === sessionId
  }
}
```

#### SubagentResolver

Links Task calls to subagent files and detects parallelism:

```typescript
class SubagentResolver {
  async resolveSubagents(
    projectId: string, sessionId: string,
    taskCalls: ToolCall[], messages?: ParsedMessage[]
  ): Promise<Process[]> {
    // 1. Get subagent files via SubagentLocator
    // 2. Parse each file (with bounded concurrency: 4 for SSH, 24 for local)
    // 3. Filter out warmup subagents (content = "Warmup")
    // 4. Filter out compact files (agentId starts with "acompact")
    // 5. Link to Task calls (3-phase matching)
    // 6. Propagate team metadata via parentUuid chain
    // 7. Detect parallel execution (100ms overlap threshold)
    // 8. Enrich team colors from tool results
  }
}
```

**3-Phase Task Call Linking:**

1. **Result-based matching**: Reads `toolUseResult.agentId` from tool result messages, matches to subagent file UUID
2. **Description-based matching** (for team members): Matches Task description to `<teammate-message summary="...">` in subagent's first message
3. **Positional fallback**: For remaining unmatched, matches by order (no wrap-around)

**Process Type:**

```typescript
interface Process {
  id: string;
  filePath: string;
  messages: ParsedMessage[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: SessionMetrics;
  description?: string;          // From parent Task call
  subagentType?: string;         // e.g., "Explore", "Plan"
  isParallel: boolean;           // Detected via 100ms window
  parentTaskId?: string;         // The tool_use ID of spawning Task
  isOngoing?: boolean;
  mainSessionImpact?: {          // Tokens consumed in parent context
    callTokens: number;
    resultTokens: number;
    totalTokens: number;
  };
  team?: {                       // For team member agents
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}
```

#### ProcessLinker

Links subagents to AI chunks:

```typescript
function linkProcessesToAIChunk(chunk: EnhancedAIChunk, subagents: Process[]): void {
  // 1. Build set of Task tool IDs from this chunk's responses
  // 2. Primary: Match subagents by parentTaskId to chunk's Task tool IDs
  // 3. Fallback: For orphaned subagents (no parentTaskId), use timing-based matching
}
```

#### SubagentItem Component

The SubagentItem renders a multi-level card:

**Level 1 (Header):**
- Expand chevron
- Icon (colored dot for team/typed subagents, Bot icon for generic)
- Type badge (team member name or subagent type like "Explore", "Plan")
- Model info (e.g., "Opus 4.6", "Sonnet 4")
- Description (truncated to 60 chars)
- Status indicator (spinning loader for ongoing, green checkmark for complete)
- MetricsPill (main session impact | subagent context tokens)
- Duration

**Level 1 Expanded (Dashboard Content):**
- Meta info row: Type, Duration, Model, Agent ID (first 8 chars)
- Context Usage section:
  - Main Context: tokens injected into parent session
  - Total Output: cumulative output tokens (for team members)
  - Subagent Context: internal token usage
  - Per-phase breakdown (if compaction occurred within subagent)

**Level 2 (Execution Trace):**
- Nested toggle within the expanded subagent
- Shows all tool calls, thinking, output, nested subagents within the subagent
- Uses `ExecutionTrace` component which renders:
  - `ThinkingItem` for thinking blocks
  - `TextItem` for output text
  - `LinkedToolItem` for tool calls (full rendering as described above)
  - Nested subagent references
  - `SubagentInput` with markdown viewer
  - `TeammateMessageItem` for team messages
  - `CompactBoundary` for compaction events (shows pre/post token counts)

### 2.5 Semantic Step Extraction

The `SemanticStepExtractor` converts AI chunk messages into logical work units:

```typescript
function extractSemanticStepsFromAIChunk(chunk: AIChunk): SemanticStep[] {
  const steps: SemanticStep[] = [];

  for (const msg of chunk.responses) {
    if (msg.type === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'thinking')  -> 'thinking' step with token count
        if (block.type === 'tool_use')  -> 'tool_call' step with call tokens
        if (block.type === 'text')      -> 'output' step with text tokens
      }
    }
    if (msg.type === 'user' && msg.toolResults.length > 0) {
      for (const result of msg.toolResults) {
        -> 'tool_result' step with result tokens
      }
    }
    if (msg.type === 'user' && isInterruption) {
      -> 'interruption' step
    }
  }

  // Link processes as 'subagent' steps
  for (const process of chunk.processes) {
    -> 'subagent' step with subagent metrics
  }

  return steps.sort((a, b) => a.startTime - b.startTime);
}
```

**SemanticStep structure:**

```typescript
interface SemanticStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'subagent' | 'output' | 'interruption';
  startTime: Date;
  endTime?: Date;
  durationMs: number;
  content: {
    thinkingText?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResultContent?: string;
    isError?: boolean;
    toolUseResult?: Record<string, unknown>;
    tokenCount?: number;
    subagentId?: string;
    subagentDescription?: string;
    outputText?: string;
    sourceModel?: string;
    interruptionText?: string;
  };
  tokens?: { input: number; output: number; cached?: number };
  isParallel?: boolean;
  context: 'main' | 'subagent';
  agentId?: string;
  sourceMessageId?: string;
  contextTokens?: number;           // Context tokens for this step
  accumulatedContext?: number;       // Cumulative context up to this step
  tokenBreakdown?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}
```

### 2.6 Context Window Tracking

The `contextTracker.ts` provides comprehensive context tracking across **7 categories**:

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

**Context Injection Types:**

```typescript
type ContextInjection =
  | ClaudeMdContextInjection     // CLAUDE.md file loaded
  | MentionedFileInjection       // @-mentioned file content
  | ToolOutputInjection          // Tool call/result tokens
  | ThinkingTextInjection        // Thinking + text output tokens
  | TaskCoordinationInjection    // Team/task management tokens
  | UserMessageInjection;        // User input tokens
```

Each injection is tracked with:
- `id`: Unique identifier
- `category`: One of the 7 categories
- `estimatedTokens`: Token count for this injection
- `turnIndex` / `aiGroupId`: Which turn this appeared in

**Processing pipeline:**

```typescript
function processSessionContextWithPhases(items: ChatItem[], ...): {
  statsMap: Map<string, ContextStats>;
  phaseInfo: ContextPhaseInfo;
} {
  // For each AI group:
  // a) First group: Add CLAUDE.md global injections (enterprise, user, project)
  // b) Detect directory CLAUDE.md from file paths in tool calls
  // c) Process @-mentioned files
  // d) Aggregate tool outputs (excluding task coordination tools)
  // d2) Aggregate task coordination tokens separately
  // d3) Create user message injection
  // e) Aggregate thinking and text output tokens
  // f) Build accumulated injections across turns
  // g) Calculate totals and category breakdowns

  // Handle compact boundaries: reset accumulated state, start new phase
}
```

**Compaction Detection:**

When a `compact` chunk is encountered:
1. Finalize current phase
2. Reset all accumulated injections
3. Start new phase (incrementing phase number)
4. Calculate pre/post compaction token delta

**Phase Information:**

```typescript
interface ContextPhaseInfo {
  phases: ContextPhase[];           // Array of phase boundaries
  compactionCount: number;          // Number of compaction events
  aiGroupPhaseMap: Map<string, number>;  // AI group -> phase number
  compactionTokenDeltas: Map<string, CompactionTokenDelta>;  // Pre/post tokens
}

interface CompactionTokenDelta {
  preCompactionTokens: number;     // Last assistant message before compaction
  postCompactionTokens: number;    // First assistant message after compaction
  delta: number;                   // postCompaction - preCompaction (negative = freed)
}
```

**ContextBadge Component:**

Displays a compact badge showing new context injections per turn:
- Shows "Context +N" badge where N = total new injections
- Hover popover with expandable sections:
  - User Messages (count, tokens, preview)
  - CLAUDE.md Files (paths, tokens per file)
  - Mentioned Files (paths, tokens per file)
  - Tool Outputs (per-tool token breakdown)
  - Task Coordination (SendMessage recipients, task tools)
  - Thinking + Text (per-turn breakdown)
  - Total new tokens footer

### 2.7 Cost and Metrics

**SessionMetrics:**

```typescript
interface SessionMetrics {
  durationMs: number;
  totalTokens: number;         // input + output
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  messageCount: number;
  costUsd?: number;            // Estimated cost
}
```

**Pricing Calculation** (from `pricing.ts`):

Uses LiteLLM pricing data with tiered pricing above 200K tokens:

```typescript
function calculateMessageCost(
  modelName: string,
  inputTokens: number, outputTokens: number,
  cacheReadTokens: number, cacheCreationTokens: number
): number {
  const pricing = getPricing(modelName);  // Lookup from pricing.json

  // Tiered calculation: different rates below/above 200K tokens
  const inputCost = calculateTieredCost(inputTokens, pricing.input_cost_per_token, pricing.input_cost_per_token_above_200k_tokens);
  const outputCost = calculateTieredCost(outputTokens, pricing.output_cost_per_token, ...);
  const cacheCreationCost = calculateTieredCost(cacheCreationTokens, ...);
  const cacheReadCost = calculateTieredCost(cacheReadTokens, ...);

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}
```

**MetricsPill Component:**

Compact pill showing token metrics for subagents:

```
[12.3K | 45.7K]
 ^        ^
 |        +-- Subagent internal context
 +-- Main session impact (what parent pays)
```

Tooltip on hover shows:
- Main Context: X tokens (what was injected to parent)
- Subagent Context: Y tokens (internal usage)
- Per-phase breakdown (if multi-phase with compaction)

**Waterfall Chart Data:**

The ChunkBuilder also produces waterfall visualization data:

```typescript
interface WaterfallItem {
  id: string;
  label: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  tokenUsage: UsageMetadata;
  level: number;              // 0 = chunk, 1 = tool/subagent within chunk
  type: 'chunk' | 'tool' | 'subagent';
  isParallel: boolean;
  parentId?: string;
  metadata?: {
    subagentType?: string;
    messageCount?: number;
  };
}
```

---

## 3. claude-code-monitor: Event-Based Timeline

claude-code-monitor uses a fundamentally different approach: **real-time event-based timeline** rather than post-hoc JSONL parsing.

### Timeline Architecture

```typescript
interface TimelineState {
  mainEvents: EventMetadata[];        // T1: Main-level events
  expandedToolData: string | null;    // T2: Currently expanded tool's full data
  subagentEvents: EventMetadata[];    // T3: Expanded subagent's child events
  subagentToolData: string | null;    // T4: Expanded subagent tool data
}
```

### Event Metadata

Events come from hooks and transcript parsing:

```typescript
interface EventMetadata {
  id: number;
  session_id: string;
  timestamp: number;                  // Milliseconds since epoch
  event_type: string;                 // e.g., 'pre_tool_use', 'post_tool_use'
  event_data: string;                 // JSON string
  source: 'hook' | 'transcript';
  subagent_id: string | null;         // Non-null for subagent events
  event_uuid: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_cache_creation: number | null;
  tokens_cache_read: number | null;
  tool_name: string | null;
  duration_ms: number | null;
}
```

### Entity Types

Events are merged into entities for display:

**SubagentEntity:**
```typescript
interface SubagentEntity {
  type: 'subagent';
  id: string;                         // agent_id from event data
  agentType: string;                  // "Task", "Explore", etc.
  startTime: number;
  endTime: number | null;             // null while running
  status: 'running' | 'ended';
  duration: number | null;
  tokens: { input: number; output: number; cacheCreation?: number; cacheRead?: number } | null;
  model: string | null;
  description: string | null;         // From Task tool_input.description
  taskEventId: number | null;         // Database row ID for T2 fetch
}
```

**ToolEntity:**
```typescript
interface ToolEntity {
  type: 'tool';
  id: string;                         // tool_use_id
  agentId: string | null;             // Non-null if inside subagent
  toolName: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'success' | 'failure';
  duration: number | null;
  absorbedContent?: string;           // e.g., skill markdown
}
```

### Subagent Child Event Filtering

```typescript
function filterChildEvents(items: TimelineItem[], subagent: SubagentEntity): TimelineItem[] {
  return items.filter(item => {
    if (isEventMetadata(item)) return item.subagent_id === subagent.id;
    if (isToolEntity(item)) return item.agentId === subagent.id;
    return false;
  }).sort((a, b) => getItemTimestamp(a) - getItemTimestamp(b));
}
```

### Tool Renderer Registry

The monitor uses a comprehensive registry of 20+ specialized renderers:

```typescript
const REGISTRY: Record<string, ToolRenderer> = {
  Bash: bashRenderer,
  Read: readRenderer,
  Edit: editRenderer,
  Write: writeRenderer,
  Grep: grepRenderer,
  Glob: globRenderer,
  Task: subagentTaskRenderer,
  TaskCreate: taskRenderer,
  TaskUpdate: taskRenderer,
  TaskList: taskRenderer,
  TaskGet: taskRenderer,
  TaskOutput: taskRenderer,
  NotebookEdit: notebookDefaultRenderer,
  NotebookRead: notebookDefaultRenderer,
  LS: createDefaultRenderer('📂'),
  Agent: createDefaultRenderer('🤖'),
  WebFetch: webFetchRenderer,
  WebSearch: webSearchRenderer,
  Skill: skillRenderer,
  EnterPlanMode: modeControlRenderer,
  ExitPlanMode: modeControlRenderer,
  AskUserQuestion: askUserQuestionRenderer,
};

// MCP tools use prefix matching
const MCP_REGISTRY: Record<string, ToolRenderer> = {
  'mcp__playwright__': playwrightRenderer,
  'mcp__plugin_episodic-memory_': memoryRenderer,
};
```

**ToolRenderer Interface:**

```typescript
interface ToolRenderer {
  getIcon(): string;                  // Emoji icon
  summarizeInput(input: unknown): string;
  renderInput(input: unknown): ReactNode;
  renderOutput(output: unknown, input: unknown, status: ToolStatus, context?: RenderContext): ReactNode;
}
```

**Example: SubagentTaskRenderer output rendering:**

```typescript
renderOutput(output: unknown): ReactNode {
  const { agentId, content, totalDurationMs, totalTokens, totalToolUseCount } = asTaskOutput(output);

  // Stats bar: Agent ID (first 7 chars), duration, tokens, tool call count
  // Content: Rendered as markdown
}
```

**Key Differences from claude-devtools:**
- Real-time events vs. post-hoc JSONL parsing
- Per-tool event pairs (pre_tool_use + post_tool_use) vs. message-level content blocks
- Database-backed event storage vs. file-based
- Flat timeline with expand-in-place vs. nested chunk hierarchy
- No context window tracking or cost calculation

---

## 4. vibe-kanban: Streaming Patch System

vibe-kanban uses a **WebSocket JSON Patch streaming system** for real-time updates.

### Streaming Architecture

```typescript
function streamJsonPatchEntries<E>(url: string, opts: StreamOptions<E>): StreamController<E> {
  // Connects to WebSocket endpoint
  // Receives JSON messages: {"JsonPatch": [RFC 6902 operations]}
  // Applies patches to in-memory { entries: [] } snapshot
  // Notifies subscribers after each patch
  // Handles "finished" events for completed processes
}
```

### Normalized Entry Types

The system normalizes different executor formats into a unified type:

```typescript
type NormalizedEntry = {
  timestamp: string | null;
  entry_type: NormalizedEntryType;
  content: string;
};

type NormalizedEntryType =
  | { type: "user_message" }
  | { type: "user_feedback"; denied_tool: string }
  | { type: "assistant_message" }
  | { type: "tool_use"; tool_name: string; action_type: ActionType; status: ToolStatus }
  | { type: "system_message" }
  | { type: "error_message"; error_type: NormalizedEntryError }
  | { type: "thinking" }
  | { type: "loading" }
  | { type: "next_action"; failed: boolean; execution_processes: number; needs_setup: boolean }
  | { type: "token_usage_info" } & TokenUsageInfo
  | { type: "user_answered_questions"; answers: AnsweredQuestion[] };
```

### Tool Action Types

```typescript
type ActionType =
  | { action: "file_read"; path: string }
  | { action: "file_edit"; path: string; changes: FileChange[] }
  | { action: "command_run"; command: string; result: CommandRunResult | null; category: CommandCategory }
  | { action: "search"; query: string }
  | { action: "web_fetch"; url: string }
  | { action: "tool"; tool_name: string; arguments: JsonValue | null; result: ToolResult | null }
  | { action: "task_create"; description: string; subagent_type: string | null; result: ToolResult | null }
  | { action: "plan_presentation"; plan: string }
  | { action: "todo_management"; todos: TodoItem[]; operation: string }
  | { action: "ask_user_question"; questions: AskUserQuestionItem[] }
  | { action: "other"; description: string };
```

### File Change Tracking

```typescript
type FileChange =
  | { action: "write"; content: string }
  | { action: "delete" }
  | { action: "rename"; new_path: string }
  | { action: "edit"; unified_diff: string; has_line_numbers: boolean };
```

### Diff Stats

```rust
// From diff_stream.rs
pub struct DiffStats {
    pub files_changed: usize,
    pub lines_added: usize,
    pub lines_removed: usize,
}
```

Computed by comparing workspace worktree against base commit:
- Uses git diff between worktree and merge-base of workspace branch and target branch
- Tracked per-workspace in the database

### Workspace Metadata

```typescript
interface Workspace {
  id: string;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  // ... other fields
}
```

### Token Usage

```typescript
type TokenUsageInfo = {
  total_tokens: number;
  model_context_window: number;
};
```

Displayed via a `ContextUsageGauge` component showing tokens consumed relative to the model's context window.

### Execution Process Tracking

```typescript
type ExecutionProcess = {
  id: string;
  session_id: string;
  run_reason: ExecutionProcessRunReason;
  executor_action: ExecutorAction;
  status: ExecutionProcessStatus;
  exit_code: number | null;
  dropped: boolean;          // Excluded from history view due to restore/trimming
  started_at: string;
  completed_at: string | null;
};
```

### Conversation History Hook

```typescript
function useConversationHistory({ attempt, onEntriesUpdated }): {
  hasSetupScriptRun: boolean;
  hasCleanupScriptRun: boolean;
  hasRunningProcess: boolean;
  isFirstTurn: boolean;
} {
  // Streams normalized entries for each execution process
  // Distinguishes between setup scripts, cleanup scripts, and coding agent turns
  // Loads historic entries via WebSocket, live entries via streaming
}
```

**Key Differences from claude-devtools:**
- Executor-agnostic (supports Claude, Codex, Cursor, OpenCode, ACP)
- WebSocket JSON Patch streaming vs. file-based JSONL parsing
- Normalized entry format (abstracts away executor-specific formats)
- Focus on workspace-level metrics (files changed, lines added/removed)
- Diff tracking via git comparison
- No deep context window attribution or per-category token tracking

---

## 5. Comparison Summary

| Feature | claude-devtools | claude-code-monitor | vibe-kanban |
|---------|----------------|-------------------|-------------|
| **Data Source** | JSONL files on disk | Real-time hooks + events DB | WebSocket JSON Patches |
| **Tool Display** | 5 specialized viewers (Read, Edit, Write, Skill, Default) | 20+ specialized renderers | Normalized ActionType enum |
| **Subagent Tracking** | Full hierarchy with 3-phase linking | SubagentEntity with child event filtering | task_create action type |
| **Thinking Display** | Dedicated ThinkingItem with token count | Event-based thinking events | "thinking" entry type |
| **Context Tracking** | 7-category token attribution with phases | Basic token counters per event | total_tokens + context_window gauge |
| **Cost Tracking** | Per-model tiered pricing with LiteLLM data | None | None |
| **Compaction Detection** | Full phase tracking with pre/post token deltas | None | None |
| **Parallel Detection** | 100ms overlap window | None | None |
| **Team Support** | Full team member colors, names, parentUuid chains | None | None |
| **File Diffs** | DiffViewer for Edit tool | EditRenderer with unified diff | FileChange with unified_diff |
| **Workspace Metrics** | None | Session-level token counts | files_changed, lines_added/removed |
| **Streaming** | File watcher for live updates | Real-time event hooks | WebSocket JSON Patch |
| **Multi-executor** | Claude Code only | Claude Code only | Claude, Codex, Cursor, OpenCode, ACP |

### What claude-devtools Shows That Others Don't

1. **Full context window attribution** across 7 categories per turn
2. **Compaction-aware phase tracking** with pre/post token deltas
3. **Per-tool context token counting** (call tokens + result tokens + skill tokens)
4. **Cost estimation** using tiered pricing models
5. **Waterfall chart data** for timeline visualization
6. **Nested subagent drill-down** with full execution trace recursion
7. **Team member propagation** via parentUuid chain walking
8. **Parallel execution detection** with 100ms overlap window
9. **CLAUDE.md injection tracking** (enterprise, user, project, directory levels)
10. **Mentioned file tracking** with token estimation

### How to Build a Similar Display System

To replicate claude-devtools' level of detail, you need:

1. **JSONL Parser**: Read and parse `.jsonl` files, handling all 6 entry types
2. **Message Classifier**: Categorize messages into user/system/hardNoise/ai/compact
3. **Chunk Builder**: Group messages into independent chunks
4. **Tool Execution Builder**: Two-pass matching of tool_use to tool_result via sourceToolUseID
5. **Subagent Resolver**: Find subagent files, parse them, link via 3-phase matching
6. **Semantic Step Extractor**: Convert message content blocks into logical work units
7. **Process Linker**: Attach subagents to chunks via parentTaskId or timing fallback
8. **Context Tracker**: Track all 7 injection categories with phase-aware accumulation
9. **Pricing Engine**: Per-model cost calculation with tiered rates
10. **Component Library**: Specialized viewers for Read/Edit/Write/Skill tools, collapsible BaseItem, SubagentItem with nested ExecutionTrace
