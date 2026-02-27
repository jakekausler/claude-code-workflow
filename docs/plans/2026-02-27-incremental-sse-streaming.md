# Incremental SSE Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current wasteful SSE architecture (signal → full refetch → full re-parse) with incremental streaming where SSE sends actual new data and the client appends it to existing state.

**Architecture:** Server tracks byte offsets per session. On file change, only new bytes are parsed into messages. New messages are classified into incremental chunks and broadcast via SSE with data payloads. Client receives new chunks and merges them into existing React Query cache without refetching. Initial page load still uses full parse; only live updates are incremental. Subagent file changes trigger targeted subagent-only refreshes.

**Tech Stack:** React 19, React Query (TanStack Query), Zustand 5, Fastify, Node.js fs streams, Server-Sent Events

---

### Task 1: Add Incremental Parse Method to SessionPipeline

**Files:**
- Modify: `tools/web-server/src/server/services/session-pipeline.ts`
- Modify: `tools/web-server/src/server/services/session-parser.ts`

**Step 1: Read the existing files**

Read `session-pipeline.ts` and `session-parser.ts` to understand current signatures and patterns.

**Step 2: Add `IncrementalUpdate` type to session-pipeline.ts**

At the top of `session-pipeline.ts`, after existing imports and before the class, add:

```typescript
export interface IncrementalUpdate {
  /** Newly parsed messages since last offset */
  newMessages: ParsedMessage[];
  /** New chunks built from the new messages */
  newChunks: Chunk[];
  /** Updated byte offset (store this for next incremental parse) */
  newOffset: number;
  /** Whether this is a subagent file change (triggers different client handling) */
  isSubagent: boolean;
  /** If true, client should do a full refresh instead (truncation detected, etc.) */
  requiresFullRefresh: boolean;
  /** Updated metrics reflecting the full session */
  metrics: SessionMetrics;
  /** Whether session is still ongoing */
  isOngoing: boolean;
}
```

**Step 3: Add `parseIncremental` method to SessionPipeline class**

Add this method to the `SessionPipeline` class, after the existing `parseSession` method:

```typescript
/**
 * Parse only new bytes from a session file since the given offset.
 * Returns new messages and chunks without re-parsing the entire file.
 * Falls back to requiresFullRefresh=true if incremental parse isn't safe.
 */
async parseIncremental(
  projectDir: string,
  sessionId: string,
  lastOffset: number,
): Promise<IncrementalUpdate> {
  const filePath = join(projectDir, `${sessionId}.jsonl`);

  // Safety check: if file shrank (truncation), require full refresh
  let fileSize: number;
  try {
    const stats = await stat(filePath);
    fileSize = stats.size;
  } catch {
    return {
      newMessages: [],
      newChunks: [],
      newOffset: lastOffset,
      isSubagent: false,
      requiresFullRefresh: true,
      metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0, turns: 0, durationMs: 0 },
      isOngoing: false,
    };
  }

  if (fileSize < lastOffset) {
    // File was truncated — full refresh needed
    return {
      newMessages: [],
      newChunks: [],
      newOffset: 0,
      isSubagent: false,
      requiresFullRefresh: true,
      metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0, turns: 0, durationMs: 0 },
      isOngoing: false,
    };
  }

  if (fileSize === lastOffset) {
    // No new data
    return {
      newMessages: [],
      newChunks: [],
      newOffset: lastOffset,
      isSubagent: false,
      requiresFullRefresh: false,
      metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0, turns: 0, durationMs: 0 },
      isOngoing: false,
    };
  }

  // Parse only new bytes
  const { messages: newMessages, bytesRead } = await parseSessionFile(filePath, {
    startOffset: lastOffset,
  });

  if (newMessages.length === 0) {
    return {
      newMessages: [],
      newChunks: [],
      newOffset: lastOffset + bytesRead,
      isSubagent: false,
      requiresFullRefresh: false,
      metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0, turns: 0, durationMs: 0 },
      isOngoing: false,
    };
  }

  // Build chunks from new messages only
  const newChunks = buildChunks(newMessages);

  // For metrics, we need the full cached session (if available) to compute deltas
  // For now, compute metrics from new messages only — client will merge
  const toolExecutions = buildToolExecutions(newMessages);
  const cost = calculateSessionCost(newMessages);
  const metrics = computeMetrics(newMessages, toolExecutions, cost);

  // Check if session is ongoing (last message is from user with no assistant reply)
  const lastMsg = newMessages[newMessages.length - 1];
  const isOngoing = lastMsg?.role === 'user';

  return {
    newMessages,
    newChunks,
    newOffset: lastOffset + bytesRead,
    isSubagent: false,
    requiresFullRefresh: false,
    metrics,
    isOngoing,
  };
}
```

You'll need to add the `stat` import at the top:

```typescript
import { stat } from 'fs/promises';
```

And ensure `parseSessionFile`, `buildChunks`, `buildToolExecutions`, `calculateSessionCost`, `computeMetrics` are all imported (most should already be).

**Step 4: Verify build**

```bash
cd tools/web-server && npx tsc --noEmit
```

Expected: No type errors.

**Step 5: Commit**

```bash
git add tools/web-server/src/server/services/session-pipeline.ts
git commit -m "feat(web-server): add incremental parse method to SessionPipeline"
```

---

### Task 2: Add Offset Tracking to Server-Side SSE Handler

**Files:**
- Modify: `tools/web-server/src/server/app.ts`
- Modify: `tools/web-server/src/server/services/file-watcher.ts`

**Step 1: Read the existing files**

Read `app.ts` and `file-watcher.ts` to understand the current event handling.

**Step 2: Update FileChangeEvent to include previous offset**

In `file-watcher.ts`, update the `FileChangeEvent` interface to include the byte offset information:

```typescript
export interface FileChangeEvent {
  projectId: string;
  sessionId: string;
  filePath: string;
  isSubagent: boolean;
  /** Byte offset before this change (for incremental parsing) */
  previousOffset: number;
  /** Current file size after this change */
  currentSize: number;
}
```

Then update `handleChange` to include these values. In the debounce callback where the event is emitted, the code already stats the file. Capture the previous offset before updating:

Find the section in `handleChange` where the event is emitted and update it to:

```typescript
const previousOffset = this.getOffset(fullPath);
// ... existing stat call to get fileSize ...
this.emit('file-change', {
  projectId: parsed.projectId,
  sessionId: parsed.sessionId,
  filePath: fullPath,
  isSubagent: parsed.isSubagent,
  previousOffset,
  currentSize: fileSize,
} satisfies FileChangeEvent);
this.setOffset(fullPath, fileSize);
```

Do the same for `catchUpScan` — capture `previousOffset` before emitting and include both fields.

**Step 3: Update app.ts to use incremental parsing**

Replace the current `file-change` handler in `app.ts` with one that does incremental parsing and broadcasts the result:

```typescript
fw.on('file-change', async (event: FileChangeEvent) => {
  const fullProjectDir = join(claudeProjectsDir, event.projectId);

  // Debounce SSE broadcast per session (300ms)
  const key = `${event.projectId}/${event.sessionId}`;
  const existing = sseDebounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    sseDebounceTimers.delete(key);

    if (event.isSubagent) {
      // Subagent changes: invalidate cache and signal full refresh
      sessionPipeline?.invalidateSession(fullProjectDir, event.sessionId);
      broadcastEvent('session-update', {
        projectId: event.projectId,
        sessionId: event.sessionId,
        type: 'full-refresh',
      });
      return;
    }

    // Main session: try incremental parse
    try {
      const update = await sessionPipeline?.parseIncremental(
        fullProjectDir,
        event.sessionId,
        event.previousOffset,
      );

      if (!update || update.requiresFullRefresh) {
        // Fall back to full refresh
        sessionPipeline?.invalidateSession(fullProjectDir, event.sessionId);
        broadcastEvent('session-update', {
          projectId: event.projectId,
          sessionId: event.sessionId,
          type: 'full-refresh',
        });
        return;
      }

      if (update.newChunks.length === 0 && update.newMessages.length === 0) {
        // No meaningful new data, skip broadcast
        return;
      }

      // Broadcast incremental update with actual data
      broadcastEvent('session-update', {
        projectId: event.projectId,
        sessionId: event.sessionId,
        type: 'incremental',
        newChunks: update.newChunks,
        metrics: update.metrics,
        isOngoing: update.isOngoing,
        newOffset: update.newOffset,
      });

      // Also invalidate the full cache so next full load is fresh
      sessionPipeline?.invalidateSession(fullProjectDir, event.sessionId);
    } catch (err) {
      // On any error, fall back to full refresh signal
      console.error('Incremental parse failed, falling back to full refresh:', err);
      sessionPipeline?.invalidateSession(fullProjectDir, event.sessionId);
      broadcastEvent('session-update', {
        projectId: event.projectId,
        sessionId: event.sessionId,
        type: 'full-refresh',
      });
    }
  }, 300);
  sseDebounceTimers.set(key, timer);
});
```

**Step 4: Verify build**

```bash
cd tools/web-server && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add tools/web-server/src/server/services/file-watcher.ts tools/web-server/src/server/app.ts
git commit -m "feat(web-server): wire incremental parsing into SSE broadcast pipeline"
```

---

### Task 3: Create Client-Side SSE Update Types and Merge Logic

**Files:**
- Create: `tools/web-server/src/client/utils/session-merger.ts`
- Modify: `tools/web-server/src/client/types/session.ts` (if it exists, or wherever ParsedSession client type lives)

**Step 1: Read existing client types**

Read the client-side types to understand the `ParsedSession` shape that React Query caches.

**Step 2: Create the SSE event type definitions**

First, check where the client session types live. The React Query hook `useSessionDetail` returns a `ParsedSession`. Find its definition and add the SSE event types near it.

Create `tools/web-server/src/client/utils/session-merger.ts`:

```typescript
import type { Chunk, EnhancedAIChunk } from '../types/chunks.js';
import type { SessionMetrics } from '../types/metrics.js';

/**
 * SSE event payload for session updates.
 * The server sends either 'incremental' (new data) or 'full-refresh' (signal to refetch).
 */
export interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
  type: 'incremental' | 'full-refresh';
  /** Only present when type === 'incremental' */
  newChunks?: Chunk[];
  metrics?: SessionMetrics;
  isOngoing?: boolean;
  newOffset?: number;
}

/**
 * Merge incremental chunks into an existing ParsedSession.
 *
 * Strategy:
 * - Append new chunks to the end of the existing chunks array
 * - If the last existing chunk and first new chunk are both AI chunks,
 *   merge them (the new messages extend the ongoing AI turn)
 * - Update metrics by adding incremental values
 * - Update isOngoing flag
 *
 * @param existing - The current cached ParsedSession
 * @param update - The incremental SSE update
 * @returns A new ParsedSession with merged data (immutable update)
 */
export function mergeIncrementalUpdate<T extends {
  chunks: Chunk[];
  metrics: SessionMetrics;
  isOngoing: boolean;
  subagents: unknown[];
}>(
  existing: T,
  update: SSESessionUpdate,
): T {
  if (update.type !== 'incremental' || !update.newChunks || update.newChunks.length === 0) {
    return existing;
  }

  const existingChunks = [...existing.chunks];
  const newChunks = update.newChunks;

  // Check if we need to merge the boundary chunks
  // (last existing AI chunk + first new AI chunk = same ongoing turn)
  const lastExisting = existingChunks[existingChunks.length - 1];
  const firstNew = newChunks[0];

  let mergedChunks: Chunk[];

  if (
    lastExisting &&
    firstNew &&
    lastExisting.type === 'ai' &&
    firstNew.type === 'ai'
  ) {
    // Merge: combine messages from both chunks into the existing one
    const mergedAIChunk: EnhancedAIChunk = {
      ...lastExisting as EnhancedAIChunk,
      messages: [
        ...(lastExisting as EnhancedAIChunk).messages,
        ...(firstNew as EnhancedAIChunk).messages,
      ],
    };

    // Replace last chunk with merged, then append remaining new chunks
    mergedChunks = [
      ...existingChunks.slice(0, -1),
      mergedAIChunk,
      ...newChunks.slice(1),
    ];
  } else {
    // Simple append
    mergedChunks = [...existingChunks, ...newChunks];
  }

  // Merge metrics (additive for tokens/cost, take latest for duration/ongoing)
  const mergedMetrics: SessionMetrics = {
    totalTokens: existing.metrics.totalTokens + (update.metrics?.totalTokens ?? 0),
    inputTokens: existing.metrics.inputTokens + (update.metrics?.inputTokens ?? 0),
    outputTokens: existing.metrics.outputTokens + (update.metrics?.outputTokens ?? 0),
    cacheCreationInputTokens: existing.metrics.cacheCreationInputTokens + (update.metrics?.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: existing.metrics.cacheReadInputTokens + (update.metrics?.cacheReadInputTokens ?? 0),
    totalCost: existing.metrics.totalCost + (update.metrics?.totalCost ?? 0),
    turns: existing.metrics.turns + (update.metrics?.turns ?? 0),
    durationMs: existing.metrics.durationMs + (update.metrics?.durationMs ?? 0),
  };

  return {
    ...existing,
    chunks: mergedChunks,
    metrics: mergedMetrics,
    isOngoing: update.isOngoing ?? existing.isOngoing,
  };
}
```

**Step 3: Verify build**

```bash
cd tools/web-server && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add tools/web-server/src/client/utils/session-merger.ts
git commit -m "feat(web-server): add client-side incremental session merge utility"
```

---

### Task 4: Update SessionDetail Page for Incremental Updates

**Files:**
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx`

**Step 1: Read the current SessionDetail page**

Read `SessionDetail.tsx` to understand the current SSE handler and React Query integration.

**Step 2: Replace the SSE handler with incremental merge logic**

The current handler debounces and then invalidates the React Query cache (triggering a full refetch). Replace it with logic that:
- On `type: 'incremental'`: merge new data into the React Query cache directly
- On `type: 'full-refresh'`: invalidate cache to trigger a full refetch (existing behavior)

Replace the `handleSSE` callback and related code:

```typescript
import { mergeIncrementalUpdate, type SSESessionUpdate } from '../utils/session-merger.js';

// Inside the component, replace the existing handleSSE + debounce logic with:

const handleSSE = useCallback(
  (_channel: string, data: unknown) => {
    const event = data as SSESessionUpdate;
    if (event.sessionId !== sessionId || event.projectId !== projectId) return;

    if (event.type === 'incremental') {
      // Merge new chunks directly into React Query cache — no refetch needed
      queryClient.setQueryData(
        ['session', projectId, sessionId],
        (old: unknown) => {
          if (!old) return old;
          return mergeIncrementalUpdate(old as any, event);
        },
      );
    } else {
      // Full refresh: invalidate cache to trigger refetch
      void queryClient.invalidateQueries({
        queryKey: ['session', projectId, sessionId],
      });
    }
  },
  [queryClient, projectId, sessionId],
);
```

Remove the `sseDebounceTimerRef` and its cleanup effect — debouncing now happens server-side (300ms in app.ts). The client applies updates immediately when they arrive.

Also remove the `useRef` import for the debounce timer if it's no longer used elsewhere.

**Step 3: Verify build**

```bash
cd tools/web-server && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add tools/web-server/src/client/pages/SessionDetail.tsx
git commit -m "feat(web-server): handle incremental SSE updates in SessionDetail"
```

---

### Task 5: Update Chunk Enhancement for Incremental Chunks

**Files:**
- Modify: `tools/web-server/src/server/services/session-pipeline.ts`

**Step 1: Read the enhancement pipeline**

The current `parseSession` method calls `enhanceAIChunks(chunks, toolExecutions)` which attaches semantic steps to AI chunks. The incremental path in `parseIncremental` builds chunks from new messages but doesn't enhance them. Fix this.

**Step 2: Add enhancement to incremental path**

In the `parseIncremental` method, after `const newChunks = buildChunks(newMessages);`, add:

```typescript
// Enhance AI chunks with semantic steps (tool calls, thinking, text, etc.)
const enhancedChunks = enhanceAIChunks(newChunks, toolExecutions);
```

Then use `enhancedChunks` instead of `newChunks` in the return value.

Update the return statement to use `enhancedChunks`:

```typescript
return {
  newMessages,
  newChunks: enhancedChunks,
  newOffset: lastOffset + bytesRead,
  isSubagent: false,
  requiresFullRefresh: false,
  metrics,
  isOngoing,
};
```

**Step 3: Verify build**

```bash
cd tools/web-server && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add tools/web-server/src/server/services/session-pipeline.ts
git commit -m "feat(web-server): enhance incremental chunks with semantic steps"
```

---

### Task 6: Handle Client-Side Chunk Transformation for Incremental Updates

**Files:**
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx`
- Modify: `tools/web-server/src/client/utils/session-merger.ts`

**Step 1: Understand the transformation gap**

The server returns `Chunk[]` (with types like `EnhancedAIChunk`, `UserChunk`, etc.), but the client renders `ChatItem[]` which are built by `groupTransformer.ts` via `transformChunksToConversation()`. Currently, the full path is: server returns chunks → client transforms all chunks into conversation → render.

For incremental updates, the client needs to transform only the NEW chunks and append the resulting `ChatItem[]` to the existing conversation.

**Step 2: Update session-merger to work with the conversation transformation**

The merger should trigger a re-transformation of the full chunk array after merging. This is simpler and safer than trying to incrementally transform chunks (which has complex state like counting user groups, AI groups, compact groups, etc.).

Update `mergeIncrementalUpdate` in `session-merger.ts` — the function already merges chunks. The key insight is that the `SessionDetail` page component will see the updated `chunks` array via React Query and the existing `useMemo` that calls `transformChunksToConversation` will re-run automatically.

Check if `SessionDetail.tsx` uses a `useMemo` or similar to transform chunks. If it does, the merge is sufficient — React will re-derive the conversation from the merged chunks.

If the transformation happens inside the React Query hook itself (in the API layer), then the `setQueryData` call in Task 4 will need to also re-transform. Adjust accordingly.

Read the current code flow to determine which path is used, then adjust the merger if needed.

**Step 3: Verify the data flow works end-to-end**

The critical check: when `queryClient.setQueryData` updates the cached `ParsedSession` with merged chunks, does the component re-render and re-transform the conversation? Verify by reading how `useSessionDetail` returns data and how the component consumes it.

**Step 4: Commit (if changes needed)**

```bash
git add tools/web-server/src/client/utils/session-merger.ts tools/web-server/src/client/pages/SessionDetail.tsx
git commit -m "feat(web-server): ensure incremental chunk merge triggers conversation re-transform"
```

---

### Task 7: Verify and Fix Edge Cases

**Files:**
- Modify: `tools/web-server/src/server/services/session-pipeline.ts` (if needed)
- Modify: `tools/web-server/src/client/utils/session-merger.ts` (if needed)
- Modify: `tools/web-server/src/server/app.ts` (if needed)

**Step 1: Test initial page load (full parse path)**

Start the server and load a session page. Verify it still does a full parse and renders correctly. The initial load should be unchanged — only live updates use incremental.

**Step 2: Test live session updates**

Open a session page for an active Claude session. Verify:
1. New messages appear incrementally (no full page flash)
2. Existing messages/chunks are preserved (no re-ordering)
3. Metrics update (token count, cost) as new messages arrive
4. "Live" indicator works correctly

**Step 3: Test subagent file changes**

Trigger a subagent file change. Verify it falls back to full refresh (not incremental).

**Step 4: Test file truncation**

If possible, simulate a file truncation (file gets smaller). Verify the `requiresFullRefresh` path kicks in.

**Step 5: Test rapid changes**

Type rapidly in a Claude session. Verify the 300ms server debounce prevents flooding and that incremental updates arrive smoothly.

**Step 6: Fix any issues found**

Address any edge cases discovered during testing.

**Step 7: Run verify**

```bash
cd tools/web-server && npm run verify
```

**Step 8: Commit**

```bash
git add -A
git commit -m "fix(web-server): address edge cases in incremental SSE streaming"
```

---

### Task 8: Update Tests

**Files:**
- Create or modify: `tools/web-server/tests/server/services/session-pipeline-incremental.test.ts`
- Create or modify: `tools/web-server/tests/client/session-merger.test.ts`

**Step 1: Write tests for `parseIncremental`**

Create `tests/server/services/session-pipeline-incremental.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
// Import SessionPipeline and create test fixtures

describe('SessionPipeline.parseIncremental', () => {
  it('returns empty update when file has not grown', async () => {
    // Create a fixture file, parse it fully, then call parseIncremental with current offset
    // Expect: newMessages=[], newChunks=[], requiresFullRefresh=false
  });

  it('returns new messages when file has grown', async () => {
    // Create fixture, parse partially, append new JSONL lines, call parseIncremental
    // Expect: newMessages contains only the appended messages
  });

  it('returns requiresFullRefresh when file has shrunk', async () => {
    // Create fixture, record offset, truncate file, call parseIncremental
    // Expect: requiresFullRefresh=true
  });

  it('builds enhanced chunks from new messages', async () => {
    // Append messages that form a complete AI turn with tool calls
    // Expect: newChunks contain enhanced AI chunk with semantic steps
  });

  it('detects ongoing session from last user message', async () => {
    // Append a user message as the last message
    // Expect: isOngoing=true
  });
});
```

**Step 2: Write tests for `mergeIncrementalUpdate`**

Create `tests/client/session-merger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeIncrementalUpdate, type SSESessionUpdate } from '../../src/client/utils/session-merger.js';

describe('mergeIncrementalUpdate', () => {
  const baseSession = {
    chunks: [/* ... mock user chunk, AI chunk ... */],
    metrics: { totalTokens: 100, inputTokens: 50, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0.01, turns: 1, durationMs: 5000 },
    isOngoing: true,
    subagents: [],
  };

  it('returns existing session for full-refresh type', () => {
    const update: SSESessionUpdate = {
      projectId: 'p', sessionId: 's', type: 'full-refresh',
    };
    const result = mergeIncrementalUpdate(baseSession, update);
    expect(result).toBe(baseSession); // Same reference, no merge
  });

  it('appends new chunks when types differ', () => {
    const update: SSESessionUpdate = {
      projectId: 'p', sessionId: 's', type: 'incremental',
      newChunks: [/* mock user chunk */],
      metrics: { totalTokens: 20, inputTokens: 20, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalCost: 0, turns: 1, durationMs: 1000 },
      isOngoing: false,
    };
    const result = mergeIncrementalUpdate(baseSession, update);
    expect(result.chunks.length).toBe(baseSession.chunks.length + 1);
    expect(result.metrics.totalTokens).toBe(120);
  });

  it('merges boundary AI chunks', () => {
    // Last existing chunk is AI, first new chunk is AI
    // Expect: merged into single AI chunk with combined messages
  });

  it('updates isOngoing flag', () => {
    const update: SSESessionUpdate = {
      projectId: 'p', sessionId: 's', type: 'incremental',
      newChunks: [],
      isOngoing: false,
    };
    const result = mergeIncrementalUpdate(baseSession, update);
    expect(result.isOngoing).toBe(false);
  });
});
```

**Step 3: Run tests**

```bash
cd tools/web-server && npx vitest run tests/server/services/session-pipeline-incremental.test.ts tests/client/session-merger.test.ts
```

**Step 4: Commit**

```bash
git add tools/web-server/tests/
git commit -m "test(web-server): add tests for incremental SSE parsing and client merge"
```

---

### Task 9: Final Verification and Cleanup

**Step 1: Run full verification**

```bash
cd tools/web-server && npm run verify
```

Expected: build passes, all tests pass, no lint errors.

**Step 2: Fix any issues**

If any tests or type checks fail, fix them.

**Step 3: Remove any dead code**

Check if the old client-side debounce logic in `SessionDetail.tsx` is fully removed (the `sseDebounceTimerRef` and its cleanup effect from the previous SSE debounce implementation).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(web-server): cleanup and final verification for incremental SSE"
```
