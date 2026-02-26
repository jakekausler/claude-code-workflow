# Pipeline Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a client-side enrichment pipeline that transforms raw server chunks into display-ready groups matching claude-devtools' architecture.

**Architecture:** Raw `Chunk[]` from the server pass through a client-side `groupTransformer` (chunks -> ChatItem groups), then each AIGroup passes through an `aiGroupEnhancer` (linking tools, building display items, detecting last output). Components render `ChatItem[]` and `EnhancedAIGroup` instead of raw chunks. Context tracking runs in parallel to produce per-turn stats for ContextBadge popovers.

**Tech Stack:** React 19, TypeScript, Vitest, Zustand 5, Tailwind CSS, ESM with `.js` extensions, path aliases `@server/*` and `@client/*`

---

## Pattern Analysis

**Files examined for existing patterns:**
- `tools/web-server/src/server/types/jsonl.ts` -- all current type definitions
- `tools/web-server/src/client/utils/last-output-detector.ts` -- existing pure function pattern
- `tools/web-server/src/client/utils/session-formatters.ts` -- utility function pattern
- `tools/web-server/src/client/components/chat/AIChunk.tsx` -- current component that will be refactored
- `tools/web-server/tests/client/session-formatters.test.ts` -- test pattern for client utilities

**Patterns found:**
- Pure functions exported from `utils/` files, tested with Vitest `describe/it/expect` (see `session-formatters.test.ts`)
- Types defined in `@server/types/jsonl.ts`, re-exported via `@client/types/session.ts`
- Components use `lucide-react` icons, Tailwind utility classes, `useSessionViewStore` for expand/collapse
- ESM imports with `.js` extensions throughout (e.g., `from '../../utils/session-formatters.js'`)
- No `date-fns` installed -- timestamps use `toLocaleTimeString`; we should NOT add date-fns

**Framework constraints:**
- Client types are re-exports from server types file -- new client-only types need a separate client types file
- Zustand store uses `Set<number>` keyed by chunk index for expand state -- switching to group IDs (strings) requires store migration
- `ChatHistory` receives `chunks: Chunk[]` as props from `SessionDetail` -- the transformation must happen between these two

---

## Task 1: Define ChatItem and Group Types

**Files:**
- Create: `tools/web-server/src/client/types/groups.ts`
- Modify: `tools/web-server/src/client/types/session.ts`

**Action:** Create new client-side type definitions for the group layer. These types represent the intermediate representation between raw chunks and enhanced display-ready groups.

**Dependencies:** None (foundation task)

**Reference:** Devtools pipeline map, Stage 3 (groupTransformer types) and Stage 4 (aiGroupEnhancer types)

```typescript
// tools/web-server/src/client/types/groups.ts

import type { ParsedMessage, SemanticStep, Process, SessionMetrics, UsageMetadata } from './session.js';

// ─── Chat Item (discriminated union) ─────────────────────────────────────────

export type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup };

export interface SessionConversation {
  sessionId: string;
  items: ChatItem[];
  totalUserGroups: number;
  totalSystemGroups: number;
  totalAIGroups: number;
  totalCompactGroups: number;
}

// ─── User Group ──────────────────────────────────────────────────────────────

export interface UserGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  content: UserGroupContent;
  index: number;
}

export interface UserGroupContent {
  text?: string;
  rawText?: string;
  commands: CommandInfo[];
  images: ImageData[];
  fileReferences: FileReference[];
}

export interface CommandInfo {
  name: string;
  args?: string;
  message?: string;
}

export interface ImageData {
  mediaType: string;
}

export interface FileReference {
  path: string;
}

// ─── System Group ────────────────────────────────────────────────────────────

export interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string;
}

// ─── AI Group ────────────────────────────────────────────────────────────────

export type AIGroupStatus = 'complete' | 'in_progress' | 'interrupted' | 'error';

export interface AIGroup {
  id: string;
  turnIndex: number;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  steps: SemanticStep[];
  tokens: AIGroupTokens;
  summary: AIGroupSummary;
  status: AIGroupStatus;
  processes: Process[];
  chunkId: string;
  responses: ParsedMessage[];
  isOngoing?: boolean;
}

export interface AIGroupSummary {
  thinkingPreview?: string;
  toolCallCount: number;
  outputMessageCount: number;
  subagentCount: number;
  totalDurationMs: number;
  totalTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AIGroupTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

// ─── Compact Group ───────────────────────────────────────────────────────────

export interface CompactGroup {
  id: string;
  timestamp: Date;
  summary: string;
  message: ParsedMessage;
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}

export interface CompactionTokenDelta {
  preCompactionTokens: number;
  postCompactionTokens: number;
  delta: number;
}

// ─── Enhanced AI Group (output of aiGroupEnhancer) ───────────────────────────

export interface EnhancedAIGroup extends AIGroup {
  lastOutput: AIGroupLastOutput | null;
  displayItems: AIGroupDisplayItem[];
  linkedTools: Map<string, LinkedToolItemData>;
  itemsSummary: string;
  mainModel: ModelInfo | null;
  subagentModels: ModelInfo[];
  claudeMdStats: { paths: string[]; totalTokens: number } | null;
}

// ─── Last Output ─────────────────────────────────────────────────────────────

export interface AIGroupLastOutput {
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

// ─── Linked Tool Item ────────────────────────────────────────────────────────

export interface LinkedToolItemData {
  id: string;
  name: string;
  input: Record<string, unknown>;
  callTokens?: number;
  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: { status: string; [key: string]: unknown };
    tokenCount?: number;
  };
  inputPreview: string;
  outputPreview?: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  isOrphaned: boolean;
  sourceModel?: string;
  skillInstructions?: string;
  skillInstructionsTokenCount?: number;
}

// ─── Display Items ───────────────────────────────────────────────────────────

export type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItemData }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage }
  | { type: 'subagent_input'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'compact_boundary'; content: string; timestamp: Date; tokenDelta?: CompactionTokenDelta; phaseNumber: number };

export interface SlashItem {
  id: string;
  name: string;
  message?: string;
  args?: string;
  commandMessageUuid?: string;
  instructions?: string;
  instructionsTokenCount?: number;
  timestamp: Date;
}

export interface TeammateMessage {
  teammateId: string;
  color?: string;
  summary?: string;
  content: string;
  timestamp: Date;
}

// ─── Model Info ──────────────────────────────────────────────────────────────

export type ModelFamily = 'sonnet' | 'opus' | 'haiku' | string;

export interface ModelInfo {
  name: string;
  family: ModelFamily;
  majorVersion: number;
  minorVersion: number | null;
}
```

Also update the re-export file:

```typescript
// tools/web-server/src/client/types/session.ts -- ADD at the end:
export type {
  ChatItem,
  SessionConversation,
  UserGroup,
  UserGroupContent,
  SystemGroup,
  AIGroup,
  AIGroupTokens,
  AIGroupStatus,
  AIGroupSummary,
  CompactGroup,
  CompactionTokenDelta,
  EnhancedAIGroup,
  AIGroupLastOutput,
  LinkedToolItemData,
  AIGroupDisplayItem,
  SlashItem,
  TeammateMessage,
  ModelInfo,
  ModelFamily,
  CommandInfo,
  ImageData,
  FileReference,
} from './groups.js';
```

**Tests needed:**
- Type-only file; no runtime tests needed. Verified by TypeScript compilation.

---

## Task 1B: Shared Utility Helpers

**Files:**
- Create: `tools/web-server/src/client/utils/display-helpers.ts`
- Create: `tools/web-server/tests/client/display-helpers.test.ts`

**Action:** Implement small shared utilities that multiple tasks depend on. These are used across the group transformer, display item builder, tool linking engine, and components.

**Dependencies:** None (foundation utilities)

**Reference:** Devtools pipeline map, Stage 12 (aiGroupHelpers)

```typescript
// tools/web-server/src/client/utils/display-helpers.ts

/**
 * Safe Date conversion for JSON-serialized timestamps.
 * Timestamps from the server API arrive as strings (ISO format) or numbers (epoch ms)
 * after JSON serialization. This normalizes them to Date objects.
 */
export function toDate(timestamp: Date | string | number): Date {
  if (timestamp instanceof Date) return timestamp;
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Standard truncation with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\u2026';
}

/**
 * Strips XML noise tags from display content:
 * - <local-command-caveat>...</local-command-caveat>
 * - <system-reminder>...</system-reminder>
 * - <command-name>X</command-name> -> /X
 */
export function sanitizeDisplayContent(content: string): string {
  let result = content;
  // Strip local-command-caveat blocks
  result = result.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '');
  // Strip system-reminder blocks
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  // Convert command-name tags to /command format
  result = result.replace(/<command-name>\/?([^<]+)<\/command-name>/g, '/$1');
  return result.trim();
}

/**
 * Format tool input as JSON string with truncation for preview display.
 */
export function formatToolInput(input: unknown): string {
  try {
    const json = JSON.stringify(input, null, 2);
    return truncateText(json, 100);
  } catch {
    return String(input);
  }
}

/**
 * Extract text from tool result content for preview display.
 * Tool results can be either a string or an array of ContentBlock objects.
 */
export function formatToolResult(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return truncateText(content, 200);
  }
  if (Array.isArray(content)) {
    // Extract text from content blocks
    const texts = content
      .filter((block: any) => block?.type === 'text' && block?.text)
      .map((block: any) => block.text);
    if (texts.length > 0) {
      return truncateText(texts.join('\n'), 200);
    }
    return truncateText(JSON.stringify(content), 200);
  }
  return '';
}
```

**Tests needed:**
- `toDate` handles Date objects, ISO strings, epoch numbers, and invalid values
- `truncateText` truncates with ellipsis at correct length
- `sanitizeDisplayContent` strips `<local-command-caveat>`, `<system-reminder>`, converts `<command-name>`
- `formatToolInput` truncates JSON at 100 chars
- `formatToolResult` extracts text from string content and content block arrays

---

## Task 2: Group Transformer

**Files:**
- Create: `tools/web-server/src/client/utils/group-transformer.ts`
- Create: `tools/web-server/tests/client/group-transformer.test.ts`

**Action:** Implement `transformChunksToConversation()` that converts raw `Chunk[]` into `SessionConversation` with `ChatItem[]`.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 3. Our `Chunk` types are simpler than devtools' `EnhancedChunk` types -- we adapt from our existing chunk shapes.

```typescript
// tools/web-server/src/client/utils/group-transformer.ts

import type {
  Chunk, AIChunk, UserChunk, SystemChunk, CompactChunk,
  EnhancedAIChunk, SemanticStep, ParsedMessage, UsageMetadata,
} from '../types/session.js';
import type {
  SessionConversation, ChatItem, UserGroup, UserGroupContent,
  SystemGroup, AIGroup, AIGroupTokens, AIGroupStatus,
  CompactGroup, CompactionTokenDelta, CommandInfo, ImageData, FileReference,
} from '../types/groups.js';

export function transformChunksToConversation(
  chunks: Chunk[],
  isOngoing: boolean,
  sessionId: string = '',
): SessionConversation {
  const items: ChatItem[] = [];
  let userIndex = 0;
  let aiTurnIndex = 0;

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'user':
        items.push({ type: 'user', group: createUserGroup(chunk, userIndex++) });
        break;
      case 'system':
        items.push({ type: 'system', group: createSystemGroup(chunk) });
        break;
      case 'ai':
        items.push({ type: 'ai', group: createAIGroup(chunk, aiTurnIndex++) });
        break;
      case 'compact':
        items.push({ type: 'compact', group: createCompactGroup(chunk) });
        break;
    }
  }

  // Post-pass: enrich CompactGroups with tokenDelta and phaseNumber
  enrichCompactGroups(items);

  // Post-pass: mark last AI group as ongoing if session is ongoing
  if (isOngoing) {
    markLastAIGroupOngoing(items);
  }

  return {
    sessionId,
    items,
    totalUserGroups: items.filter((i) => i.type === 'user').length,
    totalSystemGroups: items.filter((i) => i.type === 'system').length,
    totalAIGroups: items.filter((i) => i.type === 'ai').length,
    totalCompactGroups: items.filter((i) => i.type === 'compact').length,
  };
}
```

**Key helper functions to implement:**

1. `createUserGroup(chunk: UserChunk, index: number): UserGroup`
   - Extract text from `chunk.message.content` (string or ContentBlock[])
   - Sanitize using `sanitizeDisplayContent()` from `display-helpers.ts` (strips XML noise tags, converts command-name)
   - Extract `/commands` via regex: `/\/([a-z][a-z-]{0,50})(?:\s+(\S[^\n]{0,1000}))?$/gim`
   - Extract `@file` references via regex: `/@([~a-zA-Z0-9._/-]+)/g`
   - Extract image blocks from ContentBlock[] content
   - Remove extracted commands from display text
   - Set `rawText` to sanitized original, `text` to display text with commands removed

2. `createSystemGroup(chunk: SystemChunk): SystemGroup`
   - Extract command output from first message content
   - Strip `<local-command-stdout>` / `<local-command-stderr>` XML wrappers
   - Generate ID from first message UUID

3. `createAIGroup(chunk: AIChunk, turnIndex: number): AIGroup`
   - Check if chunk is `EnhancedAIChunk` (has `semanticSteps`)
   - Calculate timing from message timestamps (first to last)
   - Calculate tokens from **last assistant message's `usage`** field (context window snapshot, NOT sum)
   - Determine status from steps (interruption -> error steps -> in_progress -> complete)
   - Attach `processes` from chunk's `subagents` field (may be undefined/empty)
   - Set `chunkId` from chunk ID
   - Set `responses` from chunk's messages array (NOT `messages` -- the field is named `responses` to match devtools naming)
   - Compute `summary: AIGroupSummary` with: `thinkingPreview` (first 100 chars of first thinking step), `toolCallCount`, `outputMessageCount`, `subagentCount`, `totalDurationMs`, `totalTokens`, `outputTokens`, `cachedTokens`

4. `createCompactGroup(chunk: CompactChunk): CompactGroup`
   - Map summary and timestamp
   - Generate ID from timestamp

5. `enrichCompactGroups(items: ChatItem[]): void`
   - Walk items, track phase counter (increment at each compact)
   - Set `startingPhaseNumber` on each compact group
   - For tokenDelta: find last AI group before compact, first AI group after
   - `preCompactionTokens` = last assistant message's total tokens from AI group before
   - `postCompactionTokens` = first assistant message's total tokens from AI group after
   - `delta = post - pre`

6. `markLastAIGroupOngoing(items: ChatItem[]): void`
   - Find last AI item in reverse scan
   - Set `isOngoing = true` on its group
   - Do NOT override `interrupted` status

**Token calculation detail** (critical -- devtools uses context window snapshot, NOT sum):
```typescript
function getLastAssistantUsage(messages: ParsedMessage[]): UsageMetadata | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'assistant' && messages[i].usage) {
      return messages[i].usage;
    }
  }
  return undefined;
}

function calculateTokens(messages: ParsedMessage[]): AIGroupTokens {
  const usage = getLastAssistantUsage(messages);
  if (!usage) {
    return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  return { input, output, cacheRead, cacheCreation, total: input + output };
}
```

**Tests needed:**
- Transforms a single user chunk into UserGroup with correct text extraction
- Transforms AI chunk with usage into AIGroup with correct token snapshot
- Handles CompactChunk with tokenDelta enrichment (needs before/after AI groups)
- Marks last AI group as ongoing when `isOngoing` is true
- Empty chunks array produces empty conversation
- User content sanitization: strips XML noise tags, converts command-name tags
- Phase numbering across multiple compact groups

---

## Task 3: Tool Linking Engine

**Files:**
- Create: `tools/web-server/src/client/utils/tool-linking-engine.ts`
- Create: `tools/web-server/tests/client/tool-linking-engine.test.ts`

**Action:** Implement `linkToolCallsToResults()` that matches tool_call semantic steps to tool_result steps and produces `LinkedToolItemData` objects.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 6. Our `SemanticStep` already has `toolCallId` fields that make matching straightforward.

```typescript
// tools/web-server/src/client/utils/tool-linking-engine.ts

import type { SemanticStep, ParsedMessage } from '../types/session.js';
import type { LinkedToolItemData } from '../types/groups.js';

/**
 * Match tool_call steps to their tool_result steps by toolCallId.
 * Returns a Map keyed by toolCallId.
 */
export function linkToolCallsToResults(
  steps: SemanticStep[],
  responses?: ParsedMessage[],
): Map<string, LinkedToolItemData> {
  const linked = new Map<string, LinkedToolItemData>();

  // Build result lookup: toolCallId -> tool_result step
  const resultMap = new Map<string, SemanticStep>();
  for (const step of steps) {
    if (step.type === 'tool_result' && step.toolCallId) {
      resultMap.set(step.toolCallId, step);
    }
  }

  // Build skill instructions lookup from responses
  const skillInstructionsMap = new Map<string, { text: string; tokenCount: number }>();
  if (responses) {
    for (const msg of responses) {
      if (msg.isMeta && msg.sourceToolUseID && typeof msg.content === 'string') {
        if (msg.content.startsWith('Base directory for this skill:')) {
          skillInstructionsMap.set(msg.sourceToolUseID, {
            text: msg.content,
            tokenCount: estimateTokens(msg.content),
          });
        }
      }
    }
  }

  // Link each tool_call to its result
  for (const step of steps) {
    if (step.type !== 'tool_call' || !step.toolCallId) continue;

    const resultStep = resultMap.get(step.toolCallId);
    const toolInput = parseToolInput(step.content, step.toolName);
    const callTokens = estimateTokens((step.toolName ?? '') + JSON.stringify(toolInput));
    const skillInfo = skillInstructionsMap.get(step.toolCallId);

    const item: LinkedToolItemData = {
      id: step.toolCallId,
      name: step.toolName ?? 'unknown',
      input: toolInput,
      callTokens,
      result: resultStep ? {
        content: resultStep.content,
        isError: resultStep.isError ?? false,
        tokenCount: estimateTokens(
          typeof resultStep.content === 'string'
            ? resultStep.content
            : JSON.stringify(resultStep.content),
        ),
      } : undefined,
      inputPreview: JSON.stringify(toolInput).slice(0, 100),
      outputPreview: resultStep?.content
        ? String(resultStep.content).slice(0, 200)
        : undefined,
      startTime: new Date(), // Will be set from step timestamps when available
      isOrphaned: !resultStep,
      skillInstructions: skillInfo?.text,
      skillInstructionsTokenCount: skillInfo?.tokenCount,
    };

    if (step.durationMs != null) {
      item.durationMs = step.durationMs;
    }

    linked.set(step.toolCallId, item);
  }

  return linked;
}

export function estimateTokens(text: string | undefined | null): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function parseToolInput(content: string, toolName?: string): Record<string, unknown> {
  // SemanticStep.content for tool_call is the tool name string, not JSON input.
  // The actual input comes from the original content blocks.
  // For now, return empty -- the input is attached during step extraction on the server.
  // This will be populated from the ToolExecution that AIChunk currently builds.
  return {};
}
```

**NOTE on tool input:** Our `SemanticStep` type stores `content: string` which for `tool_call` steps is just the tool name. The actual `input` object lives on the original `ToolUseContent` block. The linking engine needs access to the chunk's messages to get the real input. The implementation should accept the messages and build a `toolCallId -> input` map from `msg.toolCalls` arrays.

Revised signature:
```typescript
export function linkToolCallsToResults(
  steps: SemanticStep[],
  messages: ParsedMessage[],
): Map<string, LinkedToolItemData>
```

Build `inputMap: Map<string, { input: Record<string, unknown>; startTime: Date }>` from all `msg.toolCalls` in the messages array. Use `inputMap.get(step.toolCallId)` to populate `input` and `startTime`.

Similarly, build `resultContentMap: Map<string, { content: string | unknown[]; isError: boolean; endTime: Date }>` from `msg.toolResults` for richer result data.

**Tests needed:**
- Links a tool_call step to matching tool_result step by ID
- Orphaned tool_call (no matching result) has `isOrphaned: true`
- Token estimation matches `Math.ceil(text.length / 4)`
- Skill instructions extracted from isMeta messages with sourceToolUseID
- Multiple tool calls linked correctly
- Duration computed from timestamps when available

---

## Task 4: Last Output Detector Update

**Files:**
- Modify: `tools/web-server/src/client/utils/last-output-detector.ts`
- Modify: `tools/web-server/tests/client/last-output-detector.test.ts` (create if not exists)

**Action:** Update `findLastOutput` to return `AIGroupLastOutput` type (richer than current `LastOutput`) and add `plan_exit` detection.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 5. Priority chain: interruption -> ongoing -> plan_exit -> text -> tool_result -> null

```typescript
// tools/web-server/src/client/utils/last-output-detector.ts

import type { SemanticStep } from '../types/session.js';
import type { AIGroupLastOutput } from '../types/groups.js';

/**
 * Find the last visible output for an AI group.
 *
 * Priority:
 * 1. Any interruption step (reverse scan)
 * 2. If isOngoing (and no interruption)
 * 3. Last tool_call with toolName === 'ExitPlanMode' AND no later output/tool_result
 * 4. Last output step with content
 * 5. Last tool_result step
 * 6. null
 */
export function findLastOutput(
  steps: SemanticStep[],
  isOngoing?: boolean,
): AIGroupLastOutput | null {
  const now = new Date();

  // 1. Check for interruption
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'interruption') {
      return {
        type: 'interruption',
        interruptionMessage: steps[i].content,
        timestamp: now,
      };
    }
  }

  // 2. Ongoing
  if (isOngoing) {
    return { type: 'ongoing', timestamp: now };
  }

  // 3. Plan exit: last ExitPlanMode tool_call with no later output or tool_result
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'tool_call' && step.toolName === 'ExitPlanMode') {
      // Check no later output or tool_result
      const hasLaterContent = steps.slice(i + 1).some(
        (s) => s.type === 'output' || s.type === 'tool_result',
      );
      if (!hasLaterContent) {
        // Extract plan content from step (tool input would have plan field)
        // Find preceding output step as preamble
        let planPreamble: string | undefined;
        for (let j = i - 1; j >= 0; j--) {
          if (steps[j].type === 'output' && steps[j].content) {
            planPreamble = steps[j].content;
            break;
          }
        }
        return {
          type: 'plan_exit',
          planContent: step.content,
          planPreamble,
          timestamp: now,
        };
      }
    }
  }

  // 4. Last output step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'output' && steps[i].content) {
      return { type: 'text', text: steps[i].content, timestamp: now };
    }
  }

  // 5. Last tool_result
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'tool_result') {
      return {
        type: 'tool_result',
        toolName: steps[i].toolName,
        toolResult: steps[i].content,
        isError: steps[i].isError,
        timestamp: now,
      };
    }
  }

  return null;
}
```

**Backward compatibility:** The old `LastOutput` type is used by `LastOutputDisplay.tsx`. We need to update that component in Task 14 to accept `AIGroupLastOutput`. During the transition, the old `findLastOutput` should remain importable. Strategy: export both the new function (as default) and keep the old return type mapped in the component.

**Tests needed:**
- Returns interruption when present (priority 1)
- Returns ongoing when flag is true and no interruption (priority 2)
- Returns plan_exit for ExitPlanMode with no later output (priority 3)
- Returns text for last output step (priority 4)
- Returns tool_result for last tool result step (priority 5)
- Returns null for empty steps
- plan_exit extracts preamble from preceding output step
- Interruption takes priority over ongoing

---

## Task 5: Display Item Builder

**Files:**
- Create: `tools/web-server/src/client/utils/display-item-builder.ts`
- Create: `tools/web-server/tests/client/display-item-builder.test.ts`

**Action:** Implement `buildDisplayItems()` for main session and `buildDisplayItemsFromMessages()` for subagent traces.

**Dependencies:** Task 1 (types), Task 3 (tool linking engine)

**Reference:** Devtools pipeline map, Stage 7

```typescript
// tools/web-server/src/client/utils/display-item-builder.ts

import type { SemanticStep, ParsedMessage, Process } from '../types/session.js';
import type { AIGroupLastOutput, AIGroupDisplayItem, LinkedToolItemData, SlashItem, TeammateMessage, CompactionTokenDelta } from '../types/groups.js';
import { linkToolCallsToResults, estimateTokens } from './tool-linking-engine.js';

/**
 * Build display items for a main session AI group.
 * Skips the lastOutput step (rendered separately), skips Task calls that have subagents.
 *
 * @param precedingSlash - Optional slash command from the preceding user group,
 *   passed through to extractSlashCommands() for Strategy 1 matching.
 */
export function buildDisplayItems(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
  processes: Process[],
  messages: ParsedMessage[],
  precedingSlash?: SlashItem,
): { items: AIGroupDisplayItem[]; linkedTools: Map<string, LinkedToolItemData> } {
  const linkedTools = linkToolCallsToResults(steps, messages);

  // Set of Task tool IDs that have associated subagents (don't show as tool items)
  const taskIdsWithSubagents = new Set<string>();
  for (const p of processes) {
    if (p.parentTaskId) taskIdsWithSubagents.add(p.parentTaskId);
  }

  // Find the step ID that matches lastOutput (to skip it in display)
  const lastOutputStepId = findLastOutputStepId(steps, lastOutput);

  const items: AIGroupDisplayItem[] = [];
  const now = new Date();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Skip the step that produced lastOutput
    if (lastOutputStepId !== null && step.toolCallId === lastOutputStepId) continue;
    if (lastOutputStepId !== null && step.type === 'output' && isLastOutputTextMatch(step, lastOutput)) continue;

    switch (step.type) {
      case 'thinking':
        items.push({
          type: 'thinking',
          content: step.content,
          timestamp: now,
          tokenCount: estimateTokens(step.content),
        });
        break;

      case 'tool_call': {
        const tool = linkedTools.get(step.toolCallId ?? '');
        if (!tool) break;
        // Skip Task calls that have subagents
        if (tool.name === 'Task' && taskIdsWithSubagents.has(tool.id)) break;
        items.push({ type: 'tool', tool });
        break;
      }

      case 'tool_result':
        // Rendered as part of linked tool items
        break;

      case 'subagent': {
        const process = processes.find((p) => p.id === step.subagentId);
        if (process) {
          items.push({ type: 'subagent', subagent: process });
        }
        break;
      }

      case 'output':
        items.push({
          type: 'output',
          content: step.content,
          timestamp: now,
          tokenCount: estimateTokens(step.content),
        });
        break;

      case 'interruption':
        items.push({
          type: 'output',
          content: step.content || 'Request interrupted by user',
          timestamp: now,
        });
        break;
    }
  }

  // Extract teammate messages from responses
  const teammateMessages = extractTeammateMessages(messages);
  for (const tm of teammateMessages) {
    items.push({ type: 'teammate_message', teammateMessage: tm });
  }

  // Extract slash commands from responses (uses precedingSlash for Strategy 1)
  const slashes = extractSlashCommands(messages, precedingSlash);
  for (const slash of slashes) {
    items.push({ type: 'slash', slash });
  }

  // Sort all items chronologically by timestamp so teammate messages and
  // slash commands appear in their correct timeline position, not always at the bottom
  items.sort((a, b) => {
    const tsA = getDisplayItemTimestamp(a);
    const tsB = getDisplayItemTimestamp(b);
    return tsA.getTime() - tsB.getTime();
  });

  return { items, linkedTools };
}

function getDisplayItemTimestamp(item: AIGroupDisplayItem): Date {
  switch (item.type) {
    case 'thinking':
    case 'output':
    case 'subagent_input':
    case 'compact_boundary':
      return item.timestamp;
    case 'tool':
      return item.tool.startTime;
    case 'subagent':
      return item.subagent.startTime ?? new Date(0);
    case 'slash':
      return item.slash.timestamp;
    case 'teammate_message':
      return item.teammateMessage.timestamp;
  }
}
```

**Helper functions:**

1. `findLastOutputStepId(steps, lastOutput)` -- reverse scan to find which step produced the lastOutput, return its toolCallId or index marker
2. `isLastOutputTextMatch(step, lastOutput)` -- checks if an output step matches the lastOutput text
3. `extractTeammateMessages(messages)` -- finds non-meta user messages containing `<teammate-message>` XML blocks, parses teammateId, color, summary, content using regex
4. `extractSlashCommands(responses, precedingSlash?)` -- standalone slash extraction utility implementing two-strategy logic from devtools:
   - **Strategy 1**: If `precedingSlash` is provided, use it directly as the slash item. Find follow-up `isMeta` messages in `responses` whose `parentUuid` matches the slash command message, and attach their content as `instructions` with token count.
   - **Strategy 2**: Scan `responses` for messages with `sourceToolAssistantUUID` matching a slash-invoking user message. Look for `<command-name>` XML blocks in the response content. For each found slash, search for follow-up `isMeta` messages that provide instructions.
   - Returns `SlashItem[]` with all fields populated: `id` ("slash-{uuid}"), `name`, `message`, `args`, `commandMessageUuid`, `instructions`, `instructionsTokenCount`, `timestamp`
5. `buildDisplayItemsFromMessages(messages, subagents?)` -- two-pass builder for subagent traces:
   - **Pass 1**: Walk messages chronologically. For each message:
     - `compact_boundary` entries (compact summary messages) -> `CompactBoundary` display items with `tokenDelta` computed from last assistant input tokens before vs first after
     - `teammate` messages (user messages with `<teammate-message>` blocks) -> `TeammateMessage` display items
     - `subagent_input` entries (non-meta user messages with text content and no tool_result blocks) -> `SubagentInput` display items
     - `assistant` message content blocks -> `thinking`, `tool_use` (collected for linking), `text` output items
     - tool results from `user` isMeta messages -> collected for linking
     - skill instructions: isMeta messages with `sourceToolUseID` and "Base directory" text -> collected for tool linking
   - **Pass 2**: Build `LinkedToolItems` by matching tool_use to tool_result from Pass 1. Skip Task calls with associated subagents. Attach skill instructions. Add subagents as display items. Extract slashes.
   - Sort chronologically by timestamp, return

**Tests needed:**
- Skips lastOutput step from display items
- Skips Task tool calls that have associated subagents
- Includes thinking items with token count
- Links tool calls correctly
- Extracts teammate messages from `<teammate-message>` XML
- Returns empty array for no steps
- Subagent trace builder handles compact boundaries
- All items sorted chronologically by timestamp (teammate messages and slashes appear in correct timeline position)
- extractSlashCommands: Strategy 1 uses provided precedingSlash directly
- extractSlashCommands: Strategy 2 scans responses for slash-invoking messages

---

## Task 6: Display Summary Builder

**Files:**
- Create: `tools/web-server/src/client/utils/display-summary.ts`
- Create: `tools/web-server/tests/client/display-summary.test.ts`

**Action:** Implement `buildSummary()` that creates a human-readable string from display items.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 8

```typescript
// tools/web-server/src/client/utils/display-summary.ts

import type { AIGroupDisplayItem } from '../types/groups.js';

/**
 * Build a summary string like "2 thinking, 4 tool calls, 1 message, 2 teammates, 1 subagent"
 *
 * Distinguishes between:
 * - Team subagents (Process objects with `team` property) -> counted by unique `memberName`,
 *   reported as "N teammate(s)"
 * - Regular subagents (no `team` property) -> reported as "N subagent(s)"
 * - teammate_message display items -> reported as "N teammate message(s)"
 */
export function buildSummary(items: AIGroupDisplayItem[]): string {
  if (items.length === 0) return 'No items';

  let thinking = 0;
  let tools = 0;
  let outputs = 0;
  const teamMemberNames = new Set<string>();
  let regularSubagents = 0;
  let slashes = 0;
  let teammateMessages = 0;
  let compactions = 0;

  for (const item of items) {
    switch (item.type) {
      case 'thinking': thinking++; break;
      case 'tool': tools++; break;
      case 'output': outputs++; break;
      case 'subagent':
        if (item.subagent.team) {
          teamMemberNames.add(item.subagent.team.memberName ?? item.subagent.id);
        } else {
          regularSubagents++;
        }
        break;
      case 'slash': slashes++; break;
      case 'teammate_message': teammateMessages++; break;
      case 'compact_boundary': compactions++; break;
    }
  }

  const parts: string[] = [];
  if (thinking > 0) parts.push(`${thinking} thinking`);
  if (tools > 0) parts.push(`${tools} tool call${tools !== 1 ? 's' : ''}`);
  if (outputs > 0) parts.push(`${outputs} message${outputs !== 1 ? 's' : ''}`);
  if (teamMemberNames.size > 0) parts.push(`${teamMemberNames.size} teammate${teamMemberNames.size !== 1 ? 's' : ''}`);
  if (regularSubagents > 0) parts.push(`${regularSubagents} subagent${regularSubagents !== 1 ? 's' : ''}`);
  if (teammateMessages > 0) parts.push(`${teammateMessages} teammate message${teammateMessages !== 1 ? 's' : ''}`);
  if (slashes > 0) parts.push(`${slashes} slash${slashes !== 1 ? 'es' : ''}`);
  if (compactions > 0) parts.push(`${compactions} compaction${compactions !== 1 ? 's' : ''}`);

  return parts.join(', ');
}
```

**Tests needed:**
- Empty array returns "No items"
- Single tool call returns "1 tool call"
- Mixed items returns correct plural forms
- Team subagents counted by unique memberName, reported as "N teammate(s)"
- Regular subagents (no team property) reported as "N subagent(s)"
- teammate_message items reported as "N teammate message(s)"
- All item types counted correctly

---

## Task 7: Model Extractor

**Files:**
- Create: `tools/web-server/src/client/utils/model-extractor.ts`
- Create: `tools/web-server/tests/client/model-extractor.test.ts`

**Action:** Implement `parseModelString()`, `extractMainModel()`, and `extractSubagentModels()`.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 9

```typescript
// tools/web-server/src/client/utils/model-extractor.ts

import type { ParsedMessage, Process, SemanticStep } from '../types/session.js';
import type { ModelInfo, ModelFamily } from '../types/groups.js';

/**
 * Parse a model string like "claude-sonnet-4-5-20250929" or "claude-3-5-sonnet-20241022"
 * into structured ModelInfo.
 */
export function parseModelString(model: string | undefined): ModelInfo | null {
  if (!model || model === '<synthetic>' || model.trim() === '') return null;

  // New format: claude-{family}-{major}-{minor}-{date}
  const newMatch = model.match(/^claude-(\w+)-(\d+)-(\d+)(?:-\d+)?$/);
  if (newMatch) {
    const family = newMatch[1] as ModelFamily;
    return {
      name: `${family}${newMatch[2]}.${newMatch[3]}`,
      family,
      majorVersion: parseInt(newMatch[2], 10),
      minorVersion: parseInt(newMatch[3], 10),
    };
  }

  // Old format: claude-{major}[-{minor}]-{family}-{date}
  const oldMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(\w+)(?:-\d+)?$/);
  if (oldMatch) {
    const family = oldMatch[3] as ModelFamily;
    const major = parseInt(oldMatch[1], 10);
    const minor = oldMatch[2] ? parseInt(oldMatch[2], 10) : null;
    return {
      name: minor !== null ? `${family}${major}.${minor}` : `${family}${major}`,
      family,
      majorVersion: major,
      minorVersion: minor,
    };
  }

  return null;
}

/**
 * Extract the main model from tool_call semantic steps.
 * Scans `step.content.sourceModel` on tool_call steps (NOT msg.model on assistant messages).
 * This matches devtools behavior -- sourceModel on tool_call steps accurately reflects the
 * model that generated each specific call, which matters for sessions with model switches.
 * Returns the most common model found.
 */
export function extractMainModel(steps: SemanticStep[]): ModelInfo | null {
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (step.type === 'tool_call' && step.sourceModel) {
      counts.set(step.sourceModel, (counts.get(step.sourceModel) ?? 0) + 1);
    }
  }

  let maxModel: string | null = null;
  let maxCount = 0;
  for (const [model, count] of counts) {
    if (count > maxCount) {
      maxModel = model;
      maxCount = count;
    }
  }

  return maxModel ? parseModelString(maxModel) : null;
}

/**
 * Extract unique subagent models that differ from the main model.
 */
export function extractSubagentModels(
  processes: Process[],
  mainModel: ModelInfo | null,
): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const proc of processes) {
    const firstAssistant = proc.messages.find(
      (m) => m.type === 'assistant' && m.model,
    );
    if (!firstAssistant?.model) continue;

    const info = parseModelString(firstAssistant.model);
    if (!info) continue;
    if (mainModel && info.name === mainModel.name) continue;
    if (seen.has(info.name)) continue;

    seen.add(info.name);
    models.push(info);
  }

  return models;
}
```

**Tests needed:**
- Parses new format `claude-sonnet-4-5-20250929` correctly
- Parses old format `claude-3-5-sonnet-20241022` correctly
- Returns null for `<synthetic>` and empty strings
- `extractMainModel` scans tool_call steps' sourceModel, returns most common model
- `extractMainModel` ignores assistant msg.model (uses step.sourceModel instead)
- `extractSubagentModels` excludes the main model
- `extractSubagentModels` deduplicates

---

## Task 8: AI Group Enhancer (Orchestrator)

**Files:**
- Create: `tools/web-server/src/client/utils/ai-group-enhancer.ts`
- Create: `tools/web-server/tests/client/ai-group-enhancer.test.ts`

**Action:** Implement the orchestrator `enhanceAIGroup()` that calls all enrichment functions to produce `EnhancedAIGroup`.

**Dependencies:** Task 1 (types), Task 3 (tool linking), Task 4 (last output), Task 5 (display items), Task 6 (summary), Task 7 (model extractor)

**Reference:** Devtools pipeline map, Stage 4

```typescript
// tools/web-server/src/client/utils/ai-group-enhancer.ts

import type { AIGroup, EnhancedAIGroup, SlashItem } from '../types/groups.js';
import { findLastOutput } from './last-output-detector.js';
import { buildDisplayItems } from './display-item-builder.js';
import { buildSummary } from './display-summary.js';
import { extractMainModel, extractSubagentModels } from './model-extractor.js';

/**
 * Enhance an AIGroup with linked tools, display items, summary, and model info.
 * This is the main orchestrator that calls all enrichment functions.
 *
 * @param aiGroup - The AI group to enhance
 * @param claudeMdStats - Optional CLAUDE.md token stats for context tracking
 * @param precedingSlash - Optional slash command from the preceding user group
 *   (detected by the group transformer when a user group before this AI group
 *    contains a slash command invocation)
 */
export function enhanceAIGroup(
  aiGroup: AIGroup,
  claudeMdStats?: { paths: string[]; totalTokens: number },
  precedingSlash?: SlashItem,
): EnhancedAIGroup {
  // 1. Find last output
  const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing);

  // 2. Build display items (includes tool linking internally)
  const { items: displayItems, linkedTools } = buildDisplayItems(
    aiGroup.steps,
    lastOutput,
    aiGroup.processes,
    aiGroup.responses,
    precedingSlash,
  );

  // 3. Attach mainSessionImpact to subagent processes
  attachMainSessionImpact(aiGroup.processes, linkedTools);

  // 4. Build summary
  const itemsSummary = buildSummary(displayItems);

  // 5. Extract models (from semantic steps, not raw messages)
  const mainModel = extractMainModel(aiGroup.steps);
  const subagentModels = extractSubagentModels(aiGroup.processes, mainModel);

  return {
    ...aiGroup,
    lastOutput,
    displayItems,
    linkedTools,
    itemsSummary,
    mainModel,
    subagentModels,
    claudeMdStats: claudeMdStats ?? null,
  };
}

/**
 * For each subagent with a parentTaskId, find the matching Task tool
 * and set mainSessionImpact (how many tokens the subagent cost in the parent context).
 */
function attachMainSessionImpact(
  processes: Process[],
  linkedTools: Map<string, LinkedToolItemData>,
): void {
  for (const proc of processes) {
    if (!proc.parentTaskId) continue;
    const taskTool = linkedTools.get(proc.parentTaskId);
    if (!taskTool) continue;

    const callTokens = taskTool.callTokens ?? 0;
    const resultTokens = taskTool.result?.tokenCount ?? 0;
    (proc as any).mainSessionImpact = {
      callTokens,
      resultTokens,
      totalTokens: callTokens + resultTokens,
    };
  }
}
```

Add `mainSessionImpact` to the `Process` type if not already present. Check if the server type already has it -- it does NOT (per our pipeline map). Add it to the client-side groups.ts:

```typescript
// Add to groups.ts
export interface MainSessionImpact {
  callTokens: number;
  resultTokens: number;
  totalTokens: number;
}
```

And use a runtime property attachment (or extend the Process type in client types).

**Tests needed:**
- Produces EnhancedAIGroup with all fields populated
- lastOutput populated correctly for various step configurations
- displayItems exclude the lastOutput step
- itemsSummary string is correct
- mainModel extracted from tool_call steps' sourceModel
- subagentModels extracted and deduplicated
- mainSessionImpact attached to processes with parentTaskId
- precedingSlash passed through to buildDisplayItems and included in slash display items
- claudeMdStats included in EnhancedAIGroup output when provided (null when omitted)

---

## Task 9: Context Tracker (Client-Side)

**Files:**
- Create: `tools/web-server/src/client/utils/context-tracker.ts`
- Create: `tools/web-server/tests/client/context-tracker.test.ts`

**Action:** Implement `processSessionContextWithPhases()` that computes per-turn ContextStats with 6 categories.

**Dependencies:** Task 1 (types), Task 2 (group transformer -- needs ChatItem[])

**Reference:** Devtools pipeline map, Stage 10. Our server has `trackContext()` in `context-tracker.ts` but it operates on raw chunks and is never called. This client-side version operates on `ChatItem[]` which gives us richer data.

```typescript
// tools/web-server/src/client/utils/context-tracker.ts

import type { ChatItem, AIGroup, UserGroup, CompactGroup } from '../types/groups.js';
import type { TokensByCategory, ContextStats, ContextPhaseInfo } from '../types/session.js';
import { estimateTokens } from './tool-linking-engine.js';

export interface ContextResult {
  statsMap: Map<string, ContextStats>;
  phases: ContextPhaseInfo[];
}

/**
 * Process ChatItem[] to compute per-AI-group context stats with phase awareness.
 */
export function processSessionContextWithPhases(
  items: ChatItem[],
): ContextResult {
  const statsMap = new Map<string, ContextStats>();
  const phases: ContextPhaseInfo[] = [];

  let turnIndex = 0;
  let phaseIndex = 0;
  let phaseStartTurn = 0;
  let previousUserGroup: UserGroup | null = null;
  const cumulative: TokensByCategory = emptyCategory();

  for (const item of items) {
    if (item.type === 'compact') {
      // Close current phase
      if (turnIndex > phaseStartTurn) {
        phases.push({
          phaseIndex,
          startTurn: phaseStartTurn,
          endTurn: turnIndex - 1,
          compactedTokens: sumCategory(cumulative),
          label: `Phase ${phaseIndex + 1}`,
        });
      }
      phaseIndex++;
      phaseStartTurn = turnIndex;
      resetCategory(cumulative);
      continue;
    }

    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    if (item.type === 'ai') {
      const turnTokens = computeTurnTokens(item.group, previousUserGroup);
      addCategory(cumulative, turnTokens);

      statsMap.set(item.group.id, {
        turnIndex,
        cumulativeTokens: { ...cumulative },
        turnTokens,
        totalTokens: sumCategory(cumulative),
      });

      turnIndex++;
      previousUserGroup = null;
    }
  }

  // Close final phase
  if (turnIndex > phaseStartTurn) {
    phases.push({
      phaseIndex,
      startTurn: phaseStartTurn,
      endTurn: turnIndex - 1,
      compactedTokens: 0,
      label: `Phase ${phaseIndex + 1}`,
    });
  }

  return { statsMap, phases };
}

function computeTurnTokens(aiGroup: AIGroup, userGroup: UserGroup | null): TokensByCategory {
  const tokens = emptyCategory();

  // User message tokens
  if (userGroup?.content.text) {
    const text = userGroup.content.rawText ?? userGroup.content.text;
    if (text.includes('CLAUDE.md') || text.includes('<system-reminder>')) {
      tokens.claudeMd += estimateTokens(text);
    } else if (userGroup.content.fileReferences.length > 0) {
      tokens.mentionedFiles += estimateTokens(text);
    } else {
      tokens.userMessages += estimateTokens(text);
    }
  }

  // AI group tokens from steps
  for (const step of aiGroup.steps) {
    switch (step.type) {
      case 'thinking':
      case 'output':
        tokens.thinkingText += estimateTokens(step.content);
        break;
      case 'tool_call':
        if (isCoordinationTool(step.toolName)) {
          tokens.taskCoordination += estimateTokens(step.content);
        } else {
          tokens.toolOutputs += estimateTokens(step.content);
        }
        break;
      case 'tool_result':
        tokens.toolOutputs += estimateTokens(step.content);
        break;
    }
  }

  return tokens;
}

const COORD_TOOLS = new Set(['SendMessage', 'TeamCreate', 'TeamDelete', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

function isCoordinationTool(name?: string): boolean {
  return name ? COORD_TOOLS.has(name) : false;
}

// Token category helpers (same as server context-tracker)
function emptyCategory(): TokensByCategory {
  return { claudeMd: 0, mentionedFiles: 0, toolOutputs: 0, thinkingText: 0, taskCoordination: 0, userMessages: 0 };
}

function sumCategory(cat: TokensByCategory): number {
  return cat.claudeMd + cat.mentionedFiles + cat.toolOutputs + cat.thinkingText + cat.taskCoordination + cat.userMessages;
}

function addCategory(target: TokensByCategory, source: TokensByCategory): void {
  target.claudeMd += source.claudeMd;
  target.mentionedFiles += source.mentionedFiles;
  target.toolOutputs += source.toolOutputs;
  target.thinkingText += source.thinkingText;
  target.taskCoordination += source.taskCoordination;
  target.userMessages += source.userMessages;
}

function resetCategory(cat: TokensByCategory): void {
  cat.claudeMd = 0; cat.mentionedFiles = 0; cat.toolOutputs = 0;
  cat.thinkingText = 0; cat.taskCoordination = 0; cat.userMessages = 0;
}
```

**Tests needed:**
- Computes per-turn stats for a sequence of user + AI items
- Phase boundaries reset cumulative counts
- CLAUDE.md content attributed to claudeMd category
- Tool calls attributed to toolOutputs (or taskCoordination for coord tools: SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet)
- Empty items array produces empty map and no phases

---

## Task 10: Formatter Updates

**Files:**
- Modify: `tools/web-server/src/client/utils/session-formatters.ts`
- Modify: `tools/web-server/tests/client/session-formatters.test.ts`

**Action:** Add `formatTokensCompact()` (lowercase 'k' to match devtools), update `formatDuration` for decimal seconds, add `formatTimestampLong` for 12h format with seconds.

**Dependencies:** None

**Reference:** Devtools pipeline map, Stage 13

```typescript
// ADD to session-formatters.ts:

/**
 * Format tokens in compact format matching devtools style.
 * Uses lowercase 'k' (not 'K'): 50.0k, 1.5M
 */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

/**
 * Format timestamp in 12-hour format with seconds: "2:45:30 PM"
 */
export function formatTimestampLong(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}
```

Also update `formatDuration` to add decimal seconds for values < 60s:
```typescript
// Current: 12000 -> "12s"
// Devtools: 12000 -> "12.0s"
// Change: for < 60s, use one decimal place
export function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms > 0 && ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${minutes}m ${seconds}s`;
}
```

**IMPORTANT:** Changing `formatDuration` output format affects existing tests. Update the test file:
- `formatDuration(5000)` now returns `"5.0s"` instead of `"5s"`

**Tests needed:**
- `formatTokensCompact(50000)` returns `"50.0k"` (lowercase k)
- `formatTokensCompact(1500000)` returns `"1.5M"`
- `formatTokensCompact(500)` returns `"500"`
- `formatDuration(12500)` returns `"12.5s"` (decimal)
- `formatTimestampLong` returns `h:mm:ss a` format
- Update existing formatDuration tests for new decimal output

---

## Task 11: Update Zustand Store for Group-Based Expansion

**Files:**
- Modify: `tools/web-server/src/client/store/session-store.ts`

**Action:** Change `expandedChunks: Set<number>` to `expandedGroups: Set<string>` keyed by group ID instead of chunk index. This is needed because groups have stable IDs while chunk indices change during re-renders.

**Dependencies:** None (but components in Tasks 13+ will use the new store)

```typescript
// Modify session-store.ts

interface SessionViewState {
  expandedGroups: Set<string>;    // Was: expandedChunks: Set<number>
  expandedTools: Set<string>;     // Unchanged
  expandedSubagents: Set<string>; // Unchanged
  expandedSubagentTraces: Set<string>; // Unchanged
  isNearBottom: boolean;          // Unchanged

  toggleGroup: (groupId: string) => void;  // Was: toggleChunk
  toggleTool: (toolCallId: string) => void;
  toggleSubagent: (agentId: string) => void;
  toggleSubagentTrace: (agentId: string) => void;
  setIsNearBottom: (near: boolean) => void;
  resetView: () => void;
}
```

**Backward compatibility:** Keep `expandedChunks` and `toggleChunk` as aliases during transition so existing code doesn't break immediately. Remove after all components are migrated.

```typescript
export const useSessionViewStore = create<SessionViewState>((set) => ({
  expandedGroups: new Set(),
  // Alias for backward compatibility during migration
  get expandedChunks() { return this.expandedGroups; },
  expandedTools: new Set(),
  expandedSubagents: new Set(),
  expandedSubagentTraces: new Set(),
  isNearBottom: true,

  toggleGroup: (groupId) =>
    set((state) => {
      const next = new Set(state.expandedGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { expandedGroups: next };
    }),
  // Keep toggleChunk as alias
  toggleChunk: (index) => { /* delegate to toggleGroup with string index */ },
  // ... rest unchanged
}));
```

**Tests needed:**
- Type-check only; no runtime test file needed for store (UI integration testing covers this)

---

## Task 12: Refactor SessionDetail Page

**Files:**
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx`

**Action:** Add the enrichment pipeline between data fetch and rendering. Transform raw chunks into ChatItem groups, run context tracking, pass groups to ChatHistory.

**Dependencies:** Task 2 (group transformer), Task 9 (context tracker)

```typescript
// SessionDetail.tsx changes:

import { useMemo } from 'react';
import { transformChunksToConversation } from '../utils/group-transformer.js';
import { processSessionContextWithPhases } from '../utils/context-tracker.js';

// Inside the component, after data fetch:
const conversation = useMemo(() => {
  if (!session) return null;
  return transformChunksToConversation(session.chunks, session.isOngoing, session.sessionId);
}, [session]);

const contextResult = useMemo(() => {
  if (!conversation) return null;
  return processSessionContextWithPhases(conversation.items);
}, [conversation]);

// Pass to ChatHistory:
<ChatHistory
  items={conversation?.items ?? []}
  subagents={session?.subagents ?? []}
  contextStats={contextResult?.statsMap}
  phases={contextResult?.phases}
/>
```

Also update the model detection to use `extractMainModel`:
```typescript
import { extractMainModel } from '../utils/model-extractor.js';

const mainModel = useMemo(() => {
  if (!session) return null;
  const allSteps = session.chunks
    .filter((c): c is AIChunk => c.type === 'ai')
    .flatMap((c) => c.semanticSteps ?? []);
  return extractMainModel(allSteps);
}, [session]);
```

**Tests needed:**
- No unit tests (page component); verified via integration testing

---

## Task 13: Refactor ChatHistory for Groups

**Files:**
- Modify: `tools/web-server/src/client/components/chat/ChatHistory.tsx`

**Action:** Change from rendering raw `Chunk[]` to rendering `ChatItem[]`. Dispatch to new group components.

**Dependencies:** Task 1 (types), Task 12 (SessionDetail passes items)

```typescript
// ChatHistory.tsx changes:

import type { ChatItem } from '../../types/groups.js';
import type { Process, ContextStats, ContextPhaseInfo } from '../../types/session.js';

interface Props {
  items: ChatItem[];
  subagents: Process[];
  contextStats?: Map<string, ContextStats>;
  phases?: ContextPhaseInfo[];
}

// ChunkRenderer becomes ItemRenderer:
function ItemRenderer({ item, subagents, contextStats }: {
  item: ChatItem;
  subagents: Process[];
  contextStats?: Map<string, ContextStats>;
}) {
  switch (item.type) {
    case 'user':
      return <UserChatGroup userGroup={item.group} />;
    case 'ai':
      return (
        <AIChatGroup
          aiGroup={item.group}
          subagents={subagents}
          contextStats={contextStats?.get(item.group.id)}
        />
      );
    case 'system':
      return <SystemChatGroup systemGroup={item.group} />;
    case 'compact':
      return <CompactBoundary compactGroup={item.group} />;
    default:
      return null;
  }
}
```

**Virtualization:** The same threshold/config applies. Change `chunks.length` to `items.length`, `chunks[virtualItem.index]` to `items[virtualItem.index]`.

**Backward compatibility:** During transition, accept BOTH `chunks` prop (old) and `items` prop (new). If `items` is provided, use the new path. If only `chunks` is provided, fall back to the old rendering. This allows incremental migration.

```typescript
interface Props {
  chunks?: Chunk[];  // Legacy
  items?: ChatItem[];
  subagents?: Process[];
  contextStats?: Map<string, ContextStats>;
  phases?: ContextPhaseInfo[];
}

export function ChatHistory({ chunks, items, subagents = [], contextStats, phases }: Props) {
  // Use items if available, otherwise fall back to chunks
  if (items) {
    return <GroupBasedChatHistory items={items} subagents={subagents} contextStats={contextStats} />;
  }
  // Legacy path (unchanged from current implementation)
  return <LegacyChatHistory chunks={chunks ?? []} />;
}
```

**Tests needed:**
- No unit tests (component); verified via integration testing

---

## Task 14: AIChatGroup Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/AIChatGroup.tsx`

**Action:** New component that replaces AIChunk for rendering AI groups. Uses `enhanceAIGroup()` and renders header + DisplayItemList + LastOutputDisplay.

**Dependencies:** Task 1 (types), Task 8 (enhancer), Task 11 (store)

**Reference:** Devtools pipeline map, Stage 14 (AIChatGroup section)

```tsx
// tools/web-server/src/client/components/chat/AIChatGroup.tsx

import { useMemo } from 'react';
import { Bot, ChevronRight, Clock } from 'lucide-react';
import { enhanceAIGroup } from '../../utils/ai-group-enhancer.js';
import { DisplayItemList } from './DisplayItemList.js';
import { LastOutputDisplay } from './LastOutputDisplay.js';
import { ContextBadge } from './context/ContextBadge.js';
import { TokenUsageDisplay } from './TokenUsageDisplay.js';
import { useSessionViewStore } from '../../store/session-store.js';
import { formatDuration, formatTimestampLong } from '../../utils/session-formatters.js';
import type { AIGroup, SlashItem } from '../../types/groups.js';
import type { ContextStats, Process } from '../../types/session.js';

interface Props {
  aiGroup: AIGroup;
  subagents: Process[];
  contextStats?: ContextStats;
  precedingSlash?: SlashItem;
  claudeMdStats?: { paths: string[]; totalTokens: number };
}

const MODEL_COLORS: Record<string, string> = {
  opus: 'text-orange-700 bg-orange-100',
  sonnet: 'text-blue-700 bg-blue-100',
  haiku: 'text-emerald-700 bg-emerald-100',
};

export function AIChatGroup({ aiGroup, subagents, contextStats, precedingSlash, claudeMdStats }: Props) {
  const expanded = useSessionViewStore((s) => s.expandedGroups.has(aiGroup.id));
  const toggleGroup = useSessionViewStore((s) => s.toggleGroup);

  // Enhance the AI group with all enrichment
  const enhanced = useMemo(
    () => enhanceAIGroup(aiGroup, claudeMdStats, precedingSlash),
    [aiGroup, claudeMdStats, precedingSlash],
  );

  const modelColor = enhanced.mainModel
    ? MODEL_COLORS[enhanced.mainModel.family] ?? 'text-slate-700 bg-slate-100'
    : '';

  return (
    <div className="mb-4">
      {/* Header row */}
      <button
        type="button"
        onClick={() => toggleGroup(aiGroup.id)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-medium text-slate-600">Claude</span>
          {enhanced.mainModel && (
            <span className={`text-xs font-medium rounded px-1.5 py-0.5 ${modelColor}`}>
              {enhanced.mainModel.name}
            </span>
          )}
          {enhanced.subagentModels.map((m) => (
            <span key={m.name} className="text-xs text-slate-400">
              &rarr; {m.name}
            </span>
          ))}
          <span className="text-slate-300">.</span>
          <span className="text-xs text-slate-400 truncate">{enhanced.itemsSummary}</span>
          <ChevronRight
            className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {contextStats && (
            <ContextBadge
              totalNewTokens={contextStats.totalTokens}
              categories={categoryBreakdown(contextStats)}
            />
          )}
          <TokenUsageDisplay tokens={aiGroup.tokens} />
          {aiGroup.durationMs > 0 && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatDuration(aiGroup.durationMs)}
            </span>
          )}
          <span className="text-xs text-slate-400">
            {formatTimestampLong(aiGroup.startTime)}
          </span>
        </div>
      </button>

      {/* Expanded: display items */}
      {expanded && (
        <div className="pl-10 mt-1">
          <DisplayItemList items={enhanced.displayItems} />
        </div>
      )}

      {/* Always visible: last output */}
      <div className="pl-10">
        <LastOutputDisplay lastOutput={enhanced.lastOutput} />
      </div>
    </div>
  );
}

function categoryBreakdown(stats: ContextStats) {
  const cats = stats.turnTokens;
  return [
    { label: 'CLAUDE.md', tokens: cats.claudeMd },
    { label: 'Mentioned Files', tokens: cats.mentionedFiles },
    { label: 'Tool Outputs', tokens: cats.toolOutputs },
    { label: 'Thinking/Text', tokens: cats.thinkingText },
    { label: 'Task Coordination', tokens: cats.taskCoordination },
    { label: 'User Messages', tokens: cats.userMessages },
  ].filter((c) => c.tokens > 0);
}
```

**Tests needed:**
- No unit tests (component); verified via visual/integration testing

---

## Task 15: UserChatGroup Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/UserChatGroup.tsx`

**Action:** New component rendering UserGroup with markdown, @mention highlighting, command display, and collapse.

**Dependencies:** Task 1 (types)

**Reference:** Devtools pipeline map, Stage 14 (UserChatGroup section)

```tsx
// tools/web-server/src/client/components/chat/UserChatGroup.tsx

import { useState } from 'react';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatTimestampLong } from '../../utils/session-formatters.js';
import type { UserGroup } from '../../types/groups.js';

const COLLAPSE_THRESHOLD = 500;

interface Props {
  userGroup: UserGroup;
}

export function UserChatGroup({ userGroup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { content, timestamp } = userGroup;
  const text = content.text ?? '';
  const imageCount = content.images.length;
  const isLong = text.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '\u2026' : text;

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          {/* Commands (slash commands) */}
          {content.commands.length > 0 && (
            <div className="mb-1">
              {content.commands.map((cmd, i) => (
                <span key={i} className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mr-1">
                  /{cmd.name}{cmd.args ? ` ${cmd.args}` : ''}
                </span>
              ))}
            </div>
          )}

          {imageCount > 0 && (
            <span className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mb-1">
              [{imageCount} image{imageCount > 1 ? 's' : ''}]
            </span>
          )}

          <div className="prose prose-sm prose-invert max-w-none text-sm [&_p]:my-1 [&_pre]:bg-blue-700 [&_code]:bg-blue-700 [&_code]:text-blue-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayText}
            </ReactMarkdown>
          </div>

          {/* @file references */}
          {content.fileReferences.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {content.fileReferences.map((ref, i) => (
                <span key={i} className="text-xs bg-blue-500/50 text-blue-100 rounded px-1.5 py-0.5 font-mono">
                  @{ref.path}
                </span>
              ))}
            </div>
          )}

          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-200 hover:text-white underline mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          <div className="text-xs text-blue-200 mt-1 text-right">
            {formatTimestampLong(timestamp)}
          </div>
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <User className="w-4 h-4 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 16: CompactBoundary Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/CompactBoundary.tsx`

**Action:** New component rendering CompactGroup with token delta and phase badge.

**Dependencies:** Task 1 (types), Task 10 (formatTokensCompact)

**Reference:** Devtools pipeline map, Stage 14 (CompactBoundary section)

```tsx
// tools/web-server/src/client/components/chat/CompactBoundary.tsx

import { useState } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatTokensCompact, formatTimestampLong } from '../../utils/session-formatters.js';
import type { CompactGroup } from '../../types/groups.js';

interface Props {
  compactGroup: CompactGroup;
}

export function CompactBoundary({ compactGroup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { summary, tokenDelta, startingPhaseNumber, timestamp } = compactGroup;
  const hasSummary = !!summary;

  return (
    <div className="my-6 px-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-amber-300" />
        <button
          type="button"
          onClick={() => hasSummary && setExpanded(!expanded)}
          className={`flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 ${
            hasSummary ? 'cursor-pointer hover:bg-amber-100 transition-colors' : 'cursor-default'
          }`}
        >
          {hasSummary && (
            <ChevronRight
              className={`w-3 h-3 text-amber-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
          <Layers className="w-3 h-3" />
          <span className="font-medium">Compacted</span>

          {/* Token delta */}
          {tokenDelta && (
            <span className="text-amber-600">
              {formatTokensCompact(tokenDelta.preCompactionTokens)}
              {' \u2192 '}
              {formatTokensCompact(tokenDelta.postCompactionTokens)}
              <span className="text-green-600 ml-1">
                ({formatTokensCompact(Math.abs(tokenDelta.delta))} freed)
              </span>
            </span>
          )}

          {/* Phase badge */}
          {startingPhaseNumber != null && (
            <span className="text-indigo-600 bg-indigo-100 rounded-full px-2 py-0.5 text-xs font-medium">
              Phase {startingPhaseNumber}
            </span>
          )}

          <span className="text-amber-500">{formatTimestampLong(timestamp)}</span>
        </button>
        <div className="flex-1 h-px bg-amber-300" />
      </div>

      {expanded && hasSummary && (
        <div className="mt-3 mx-8 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 max-h-64 overflow-y-auto">
          <div className="prose prose-sm prose-amber max-w-none text-amber-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 17: DisplayItemList Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/DisplayItemList.tsx`

**Action:** Renders the flat chronological list of `AIGroupDisplayItem[]`, dispatching each to its appropriate component.

**Dependencies:** Task 1 (types), existing ThinkingItem/TextItem/LinkedToolItem/SubagentItem components

```tsx
// tools/web-server/src/client/components/chat/DisplayItemList.tsx

import { ThinkingItem } from './items/ThinkingItem.js';
import { TextItem } from './items/TextItem.js';
import { LinkedToolItemDisplay } from './items/LinkedToolItemDisplay.js';
import { SubagentItem } from './items/SubagentItem.js';
import type { AIGroupDisplayItem } from '../../types/groups.js';

interface Props {
  items: AIGroupDisplayItem[];
}

export function DisplayItemList({ items }: Props) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <DisplayItemRenderer key={i} item={item} />
      ))}
    </div>
  );
}

function DisplayItemRenderer({ item }: { item: AIGroupDisplayItem }) {
  switch (item.type) {
    case 'thinking':
      return <ThinkingItem content={item.content} tokenCount={item.tokenCount} />;

    case 'tool':
      return <LinkedToolItemDisplay tool={item.tool} />;

    case 'subagent':
      return <SubagentItem process={item.subagent} />;

    case 'output':
      return <TextItem content={item.content} />;

    case 'slash':
      return (
        <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-1 my-1">
          <span className="font-medium">/{item.slash.name}</span>
          {item.slash.args && <span className="text-purple-400">{item.slash.args}</span>}
        </div>
      );

    case 'teammate_message':
      return (
        <div className="text-xs border border-teal-200 bg-teal-50 rounded px-3 py-2 my-1">
          <span className="font-medium text-teal-700">
            Teammate {item.teammateMessage.teammateId}
          </span>
          {item.teammateMessage.summary && (
            <span className="text-teal-500 ml-2">{item.teammateMessage.summary}</span>
          )}
          <div className="mt-1 text-teal-800">{item.teammateMessage.content}</div>
        </div>
      );

    case 'subagent_input':
      return (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1.5 my-1">
          <span className="font-medium">Input:</span> {item.content}
        </div>
      );

    case 'compact_boundary':
      return (
        <div className="flex items-center gap-2 text-xs text-amber-600 my-2">
          <div className="flex-1 h-px bg-amber-200" />
          <span>Phase {item.phaseNumber}</span>
          <div className="flex-1 h-px bg-amber-200" />
        </div>
      );

    default:
      return null;
  }
}
```

**Note:** The `LinkedToolItemDisplay` is a new wrapper that accepts `LinkedToolItemData` instead of `ToolExecution`. See Task 18.

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 18: LinkedToolItemDisplay Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/items/LinkedToolItemDisplay.tsx`

**Action:** New component that renders `LinkedToolItemData` (from the enrichment pipeline). Wraps the existing tool renderers but accepts the new data shape.

**Dependencies:** Task 1 (types), existing tool renderers

**Reference:** Devtools pipeline map, Stage 14 (LinkedToolItem section)

```tsx
// tools/web-server/src/client/components/chat/items/LinkedToolItemDisplay.tsx

import {
  ChevronRight, CheckCircle2, AlertCircle, Clock,
  FileText, Pencil, FilePlus, TerminalSquare,
  FolderSearch, Search, Zap, Wrench,
} from 'lucide-react';
import { generateToolSummary, formatDuration } from '../../../utils/session-formatters.js';
import { formatTokensCompact } from '../../../utils/session-formatters.js';
import { getToolRenderer } from '../../tools/index.js';
import { useSessionViewStore } from '../../../store/session-store.js';
import type { LinkedToolItemData } from '../../../types/groups.js';

interface Props {
  tool: LinkedToolItemData;
}

const toolIcons: Record<string, typeof FileText> = {
  Read: FileText, Edit: Pencil, Write: FilePlus, Bash: TerminalSquare,
  Glob: FolderSearch, Grep: Search, Skill: Zap,
};

export function LinkedToolItemDisplay({ tool }: Props) {
  const expanded = useSessionViewStore((s) => s.expandedTools.has(tool.id));
  const toggleTool = useSessionViewStore((s) => s.toggleTool);

  // Special case: teammate_spawned — render as inline team member badge, not a collapsible card
  if (tool.result?.toolUseResult?.status === 'teammate_spawned') {
    const memberName = (tool.input as any)?.name ?? 'teammate';
    const memberColor = (tool.input as any)?.color ?? '#6366f1';
    return (
      <div className="flex items-center gap-2 text-xs my-1 px-2 py-1">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white"
          style={{ backgroundColor: memberColor }}
        >
          {memberName}
        </span>
        <span className="text-slate-500">spawned as teammate</span>
      </div>
    );
  }

  // Special case: SendMessage shutdown — render as inline shutdown indicator, not a collapsible card
  if (tool.name === 'SendMessage' && (tool.input as any)?.type === 'shutdown_request') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 my-1 px-2 py-1">
        <span className="text-red-400 font-medium">Shutdown requested</span>
      </div>
    );
  }

  const Icon = toolIcons[tool.name] || Wrench;
  const summary = generateToolSummary(tool.name, tool.input);
  const isError = tool.result?.isError ?? false;

  // Adapt LinkedToolItemData to ToolExecution for existing renderers
  const executionCompat = {
    toolCallId: tool.id,
    toolName: tool.name,
    input: tool.input,
    result: tool.result ? {
      toolUseId: tool.id,
      content: tool.result.content,
      isError: tool.result.isError,
    } : undefined,
    startTime: tool.startTime,
    endTime: tool.endTime,
    durationMs: tool.durationMs,
    isOrphaned: tool.isOrphaned,
  };

  const ToolRenderer = getToolRenderer(tool.name);

  return (
    <div className={`border rounded-lg overflow-hidden my-2 ${
      isError ? 'border-red-300 bg-red-50/30'
      : tool.isOrphaned ? 'border-amber-300 bg-amber-50/30'
      : 'border-slate-200 bg-white'
    }`}>
      <button
        onClick={() => toggleTool(tool.id)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <Icon className={`w-4 h-4 flex-shrink-0 ${isError ? 'text-red-500' : 'text-slate-500'}`} />
        <span className="font-medium text-slate-700 text-xs">{tool.name}</span>
        <span className="text-xs text-slate-500 truncate flex-1 text-left">{summary}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {tool.callTokens != null && tool.callTokens > 0 && (
            <span className="text-xs text-slate-400 font-mono">
              {formatTokensCompact(tool.callTokens)}
            </span>
          )}
          {tool.durationMs != null && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatDuration(tool.durationMs)}
            </span>
          )}
          {isError ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : tool.result ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : null}
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-200">
          <ToolRenderer execution={executionCompat} />
          {tool.skillInstructions && (
            <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded p-2">
              <div className="font-medium mb-1">Skill Instructions ({formatTokensCompact(tool.skillInstructionsTokenCount ?? 0)} tokens)</div>
              <pre className="whitespace-pre-wrap text-slate-600">{tool.skillInstructions}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 19: TokenUsageDisplay Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/TokenUsageDisplay.tsx`

**Action:** Compact token display with hover popover showing breakdown.

**Dependencies:** Task 1 (types), Task 10 (formatTokensCompact)

```tsx
// tools/web-server/src/client/components/chat/TokenUsageDisplay.tsx

import { useState, useRef } from 'react';
import { formatTokensCompact } from '../../utils/session-formatters.js';
import type { AIGroupTokens } from '../../types/groups.js';

interface Props {
  tokens: AIGroupTokens;
  phaseNumber?: number;
  totalPhases?: number;
}

export function TokenUsageDisplay({ tokens, phaseNumber, totalPhases }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (tokens.total === 0) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className="text-xs text-slate-500 font-mono hover:text-slate-700 transition-colors"
      >
        {formatTokensCompact(tokens.total)}
      </button>
      {showPopover && (
        <div className="absolute z-50 bottom-full right-0 mb-1 w-52 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Token Usage</div>
          <div className="space-y-1 text-xs">
            <Row label="Input" value={tokens.input} />
            {tokens.cacheRead > 0 && <Row label="Cache Read" value={tokens.cacheRead} />}
            {tokens.cacheCreation > 0 && <Row label="Cache Write" value={tokens.cacheCreation} />}
            <Row label="Output" value={tokens.output} />
            <div className="border-t border-slate-100 pt-1 mt-1">
              <Row label="Total" value={tokens.total} bold />
            </div>
          </div>
          {phaseNumber != null && totalPhases != null && (
            <div className="mt-2 text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-0.5 text-center">
              Phase {phaseNumber} of {totalPhases}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTokensCompact(value)}</span>
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 19B: Update ContextBadge Component

**Files:**
- Modify: `tools/web-server/src/client/components/chat/context/ContextBadge.tsx` (or create if not exists)

**Action:** Update the existing ContextBadge component to use the new context tracker data from `processSessionContextWithPhases()`. Task 14 (AIChatGroup) renders `<ContextBadge>` but the component itself must be updated to accept and display the enriched data.

**Dependencies:** Task 1 (types), Task 9 (context tracker)

**Reference:** Devtools pipeline map, Stage 14 (ContextBadge section)

**Props interface:**
```typescript
interface ContextBadgeProps {
  totalNewTokens: number;
  categories: Array<{ label: string; tokens: number }>;
}
```

**Behavior:**
1. **Badge display**: Shows total new context tokens for this turn (from `contextStats.totalTokens`). Uses `formatTokensCompact()` for the display value.
2. **Click/hover popover**: On click or hover, opens a popover that breaks down the context by the 6 categories from `processSessionContextWithPhases()`:
   - `claude-md` — CLAUDE.md file injections
   - `mentioned-file` — User @file references
   - `tool-output` — Tool call/result tokens (excluding coordination tools)
   - `thinking-text` — Thinking blocks + text output
   - `task-coordination` — SendMessage, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet + teammate messages
   - `user-message` — User input text
3. Each category row shows the label and token count. Categories with zero tokens are filtered out (already done by `categoryBreakdown()` in Task 14).
4. Use the same popover pattern as `TokenUsageDisplay` (hover-based, positioned above the badge).

```tsx
import { useState } from 'react';
import { Database } from 'lucide-react';
import { formatTokensCompact } from '../../../utils/session-formatters.js';

interface ContextBadgeProps {
  totalNewTokens: number;
  categories: Array<{ label: string; tokens: number }>;
}

export function ContextBadge({ totalNewTokens, categories }: ContextBadgeProps) {
  const [showPopover, setShowPopover] = useState(false);

  if (totalNewTokens === 0) return null;

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className="flex items-center gap-1 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 hover:bg-violet-100 transition-colors"
      >
        <Database className="w-3 h-3" />
        <span className="font-mono">{formatTokensCompact(totalNewTokens)}</span>
      </button>
      {showPopover && (
        <div className="absolute z-50 bottom-full right-0 mb-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Context Breakdown</div>
          <div className="space-y-1 text-xs">
            {categories.map((cat) => (
              <div key={cat.label} className="flex justify-between text-slate-600">
                <span>{cat.label}</span>
                <span className="font-mono">{formatTokensCompact(cat.tokens)}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-1 mt-1">
              <div className="flex justify-between font-medium text-slate-800">
                <span>Total</span>
                <span className="font-mono">{formatTokensCompact(totalNewTokens)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 20: Update LastOutputDisplay for New Types

**Files:**
- Modify: `tools/web-server/src/client/components/chat/LastOutputDisplay.tsx`

**Action:** Accept `AIGroupLastOutput` type and add `plan_exit` rendering.

**Dependencies:** Task 1 (types), Task 4 (updated detector)

```tsx
// Update LastOutputDisplay.tsx to accept AIGroupLastOutput

import type { AIGroupLastOutput } from '../../types/groups.js';

interface Props {
  lastOutput: AIGroupLastOutput | null;
}

// Add plan_exit case:
case 'plan_exit':
  return (
    <div className="mt-2">
      {lastOutput.planPreamble && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mb-2">
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{lastOutput.planPreamble}</ReactMarkdown>
          </div>
        </div>
      )}
      <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 flex items-start gap-2">
        <FileCheck className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium text-indigo-700 mb-1">Plan Ready for Approval</div>
          <div className="prose prose-sm prose-indigo max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{lastOutput.planContent ?? ''}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
```

Also update the `text` field mapping: `lastOutput.content` -> `lastOutput.text` to match new type.

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 21: SystemChatGroup Component

**Files:**
- Create: `tools/web-server/src/client/components/chat/SystemChatGroup.tsx`

**Action:** Wrapper that renders SystemGroup. Very similar to existing SystemChunk but accepts the new type.

**Dependencies:** Task 1 (types)

```tsx
// Minimal component -- wraps the existing SystemChunk pattern with new type

import { Terminal } from 'lucide-react';
import { formatTimestampLong } from '../../utils/session-formatters.js';
import type { SystemGroup } from '../../types/groups.js';

interface Props {
  systemGroup: SystemGroup;
}

export function SystemChatGroup({ systemGroup }: Props) {
  const { commandOutput, timestamp } = systemGroup;
  const cleaned = commandOutput.replace(/\x1B\[[0-9;]*m/g, '');
  if (!cleaned.trim()) return null;

  return (
    <div className="flex items-start gap-2 mb-4 px-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
        <Terminal className="w-4 h-4 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <pre className="text-xs text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">
          {cleaned}
        </pre>
        <div className="text-xs text-slate-400 mt-1">{formatTimestampLong(timestamp)}</div>
      </div>
    </div>
  );
}
```

**Tests needed:**
- No unit tests (component); verified visually

---

## Task 22: Integration Wiring and Cleanup

**Files:**
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx` (final wiring)
- Modify: `tools/web-server/src/client/components/chat/ChatHistory.tsx` (remove legacy path once all components work)
- Delete: None (old components kept for backward compatibility until verified)

**Action:** Final integration: wire all new components together, remove the backward-compatibility shims from Tasks 11 and 13, clean up unused imports.

**Dependencies:** All previous tasks (12-21)

**Steps:**
1. Remove the `chunks` prop from `ChatHistory` (keep only `items`)
2. Remove the `expandedChunks`/`toggleChunk` aliases from the store
3. Remove the old `ChunkRenderer` function from `ChatHistory`
4. Update `SessionDetail` to only pass `items`, not `chunks`
5. Verify all imports use `.js` extensions
6. Run `npx tsc --noEmit` to verify no type errors

**Tests needed:**
- Run full test suite: `npx vitest run`
- Manual verification: load a session and verify all group types render correctly

---

## Task 23: End-to-End Testing

**Files:**
- Create: `tools/web-server/tests/client/group-transformer.test.ts` (if not created in Task 2)
- Create: `tools/web-server/tests/client/pipeline-integration.test.ts`

**Action:** Integration test that runs the full pipeline: raw chunks -> transformChunksToConversation -> enhanceAIGroup -> verify output shape.

**Dependencies:** All utility tasks (2-9)

```typescript
// tools/web-server/tests/client/pipeline-integration.test.ts

import { describe, it, expect } from 'vitest';
import { transformChunksToConversation } from '../../src/client/utils/group-transformer.js';
import { enhanceAIGroup } from '../../src/client/utils/ai-group-enhancer.js';
import { processSessionContextWithPhases } from '../../src/client/utils/context-tracker.js';
import type { Chunk, AIChunk, UserChunk, CompactChunk, ParsedMessage } from '../../src/server/types/jsonl.js';

// Helper to create minimal test fixtures
function makeUserChunk(text: string): UserChunk { /* ... */ }
function makeAIChunk(messages: ParsedMessage[]): AIChunk { /* ... */ }
function makeCompactChunk(summary: string): CompactChunk { /* ... */ }
function makeAssistantMessage(opts: { model?: string; usage?: object; content?: any[] }): ParsedMessage { /* ... */ }

describe('pipeline integration', () => {
  it('transforms chunks to conversation and enhances AI groups', () => {
    const chunks: Chunk[] = [
      makeUserChunk('Hello, Claude'),
      makeAIChunk([makeAssistantMessage({
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 1000, output_tokens: 200 },
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
      })]),
    ];

    const conversation = transformChunksToConversation(chunks, false);
    expect(conversation.items).toHaveLength(2);
    expect(conversation.items[0].type).toBe('user');
    expect(conversation.items[1].type).toBe('ai');

    const aiItem = conversation.items[1];
    if (aiItem.type === 'ai') {
      const enhanced = enhanceAIGroup(aiItem.group);
      expect(enhanced.mainModel?.family).toBe('sonnet');
      expect(enhanced.lastOutput?.type).toBe('text');
      expect(enhanced.itemsSummary).toContain('message');
    }
  });

  it('computes context stats with phase boundaries', () => {
    const chunks: Chunk[] = [
      makeUserChunk('First question'),
      makeAIChunk([makeAssistantMessage({ usage: { input_tokens: 5000, output_tokens: 500 } })]),
      makeCompactChunk('Summary of phase 1'),
      makeUserChunk('Second question'),
      makeAIChunk([makeAssistantMessage({ usage: { input_tokens: 2000, output_tokens: 300 } })]),
    ];

    const conversation = transformChunksToConversation(chunks, false);
    const { statsMap, phases } = processSessionContextWithPhases(conversation.items);

    expect(phases).toHaveLength(2);
    expect(phases[0].label).toBe('Phase 1');
    expect(phases[1].label).toBe('Phase 2');
    expect(statsMap.size).toBe(2); // Two AI groups
  });
});
```

**Tests needed:**
- Full pipeline: chunks -> conversation -> enhanced groups
- Context tracking with phase boundaries
- Token snapshot from last assistant message (not sum)
- Compact group enrichment with tokenDelta

---

## Edge Cases to Handle

1. **Empty sessions**: No chunks -> empty conversation with zero counts
2. **AI chunks without semanticSteps**: Fall back to basic rendering (non-enhanced path)
3. **Missing usage on assistant messages**: Default to zero tokens
4. **Subagents not attached to AI chunks**: Session-level subagents array is the source of truth; match via `parentTaskId`
5. **Compact chunks with no surrounding AI groups**: tokenDelta is undefined
6. **ExitPlanMode tool with no plan content**: plan_exit lastOutput with empty content
7. **Multiple models in one AI group**: Use most common (extractMainModel logic)
8. **Date serialization**: Timestamps from JSON API are strings, not Date objects -- use `new Date()` conversion

---

## Verification Checklist

- [ ] All new utility files have corresponding test files
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] All tests pass (`npx vitest run`)
- [ ] ESM imports use `.js` extensions
- [ ] No circular dependencies between new modules
- [ ] SessionDetail page loads and renders groups
- [ ] AI groups show: model badge, items summary, token display, duration, timestamp
- [ ] Compact boundaries show: token delta, phase badge, expandable summary
- [ ] User groups show: markdown, @mentions, commands, image count, collapse
- [ ] Tool items show: name, summary, duration, tokens, expand to viewer
- [ ] Last output always visible below collapsed AI groups
- [ ] Ongoing sessions show pulsing indicator on last AI group
- [ ] Context badge shows with popover breakdown
