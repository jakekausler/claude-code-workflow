# Devtools-Parity SSE Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace our data-bearing incremental SSE merge pipeline with devtools' proven "lightweight signal + full re-fetch" pattern to eliminate flaky grouped item rendering.

**Architecture:** File changes invalidate the server cache and broadcast a lightweight SSE signal (`{projectId, sessionId}`). The client receives the signal, schedules a throttled refresh, re-fetches the full session from the server (which does a fresh parse on cache miss), and surgically updates state while preserving UI state (expansion, scroll, visible group). No client-side chunk merging, semantic step concatenation, or metrics aggregation.

**Tech Stack:** Fastify (server), React + React Query (client), Vitest (tests)

---

## Context: How Devtools Does It (Source of Truth)

Devtools pipeline:
1. **FileWatcher** detects change → debounce 100ms
2. **Cache invalidated immediately** (`dataCache.invalidateSession()`) BEFORE emitting event
3. **SSE broadcast**: lightweight `file-change` event with `{type, path, projectId, sessionId, isSubagent}` — NO parsed data
4. **Client receives event** → `scheduleSessionRefresh()` with 150ms **throttle** (at most 1 pending per session, drops duplicates)
5. **`refreshSessionInPlace()`**: generation tracking + in-flight coalescing + queue
   - Calls `api.getSessionDetail()` → HTTP GET → cache miss → fresh full parse
   - Transforms chunks → conversation
   - Updates store state preserving: expansion levels, expanded step IDs, visible AI group (if still exists)
   - Auto-expands genuinely new AI groups
6. **AI Group IDs**: stable `chunk.id` from chunk builder (NOT `ai-${turnIndex}-${timestamp}`)
7. **React keys**: `key={item.group.id}` (no array index)
8. **Display item IDs**: deterministic from message UUIDs + counters

---

## Task 1: SSE Events Become Lightweight Signals

**Goal:** Change server SSE broadcasts from data-bearing events to lightweight signals matching devtools' `FileChangeEvent` shape.

**Files:**
- Modify: `tools/web-server/src/server/app.ts` (lines 98-284: file watcher handler)
- Modify: `tools/web-server/src/server/routes/events.ts` (broadcastEvent — no changes needed, already generic)
- Modify: `tools/web-server/src/client/utils/session-merger.ts` (will be simplified/removed in Task 4)
- Test: `tools/web-server/tests/server/sse.test.ts`

**Step 1: Simplify the file-change handler in app.ts**

Replace the entire `fw.on('file-change', ...)` handler (lines 119-284) with:

```typescript
// Per-session SSE broadcast debouncing (100ms window, matching devtools)
const sseDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

fw.on('file-change', (event: FileChangeEvent) => {
  const key = `${event.projectId}/${event.sessionId}`;
  const existing = sseDebounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Invalidate cache IMMEDIATELY (before debounce), matching devtools
  if (sessionPipeline) {
    const fullProjectDir = join(claudeProjectsDir, event.projectId);
    sessionPipeline.invalidateSession(fullProjectDir, event.sessionId);
  }

  const timer = setTimeout(() => {
    sseDebounceTimers.delete(key);

    // Broadcast lightweight signal — NO parsed data
    broadcastEvent('session-update', {
      projectId: event.projectId,
      sessionId: event.sessionId,
      type: event.isSubagent ? 'subagent-change' : 'session-change',
    });
  }, 100); // 100ms debounce matching devtools FileWatcher

  sseDebounceTimers.set(key, timer);
});
```

This eliminates:
- All incremental parsing in the event handler
- The `subagentCache` map and offset tracking
- The `parentTaskIdCache` map
- The `sseDebounceOffsets` map
- The `CachedSubagent` interface
- All `parseSessionFile`, `buildProcessFromFile`, `resolveParentTaskId` calls from the handler
- The `calculateAgentMetrics`, `detectOngoing` imports (if unused elsewhere)

**Step 2: Remove unused imports from app.ts**

Remove these imports that are no longer used by the simplified handler:
```typescript
// REMOVE these:
import { buildProcessFromFile, calculateAgentMetrics, detectOngoing, resolveParentTaskId } from './services/subagent-resolver.js';
import { parseSessionFile } from './services/session-parser.js';
import type { Process } from './types/jsonl.js';
```

**Step 3: Update SSESessionUpdate type**

In `tools/web-server/src/client/utils/session-merger.ts`, update the SSE event type to reflect the new lightweight shape:

```typescript
export interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
  type: 'session-change' | 'subagent-change';
}
```

Remove all the optional data fields (`newChunks`, `metrics`, `isOngoing`, `newOffset`, `subagentProcess`).

**Step 4: Run tests**

Run: `cd tools/web-server && npx vitest run tests/server/sse.test.ts -v`
Expected: PASS (SSE infrastructure unchanged, just payloads simplified)

**Step 5: Commit**

```bash
git add tools/web-server/src/server/app.ts tools/web-server/src/client/utils/session-merger.ts
git commit -m "refactor(web-server): simplify SSE to lightweight signals matching devtools"
```

---

## Task 2: Client-Side Throttled Refresh with Generation Tracking

**Goal:** Replace client-side merge logic with devtools' `scheduleSessionRefresh` + `refreshSessionInPlace` pattern. On SSE signal, the client re-fetches the full session from the server.

**Files:**
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx` (lines 29-61: SSE handler)
- Modify: `tools/web-server/src/client/api/hooks.ts` (useSessionDetail hook)
- Test: `tools/web-server/tests/client/session-detail-sse.test.ts`

**Step 1: Write the session refresh scheduler utility**

Create: `tools/web-server/src/client/utils/session-refresh.ts`

```typescript
/**
 * Session refresh scheduler matching devtools' pattern:
 * - 150ms throttle (at most 1 pending per session, drops duplicates)
 * - Generation tracking to drop stale responses
 * - In-flight coalescing with queuing
 */

const SESSION_REFRESH_DEBOUNCE_MS = 150;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshGeneration = new Map<string, number>();
const refreshInFlight = new Set<string>();
const refreshQueued = new Set<string>();

export function scheduleSessionRefresh(
  key: string,
  refreshFn: () => Promise<void>,
): void {
  // Throttle: at most 1 pending refresh per session (drop duplicates)
  if (pendingTimers.has(key)) {
    return;
  }

  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void executeRefresh(key, refreshFn);
  }, SESSION_REFRESH_DEBOUNCE_MS);

  pendingTimers.set(key, timer);
}

async function executeRefresh(
  key: string,
  refreshFn: () => Promise<void>,
): Promise<void> {
  // In-flight coalescing: if already refreshing, queue instead
  if (refreshInFlight.has(key)) {
    refreshQueued.add(key);
    return;
  }

  const generation = (refreshGeneration.get(key) ?? 0) + 1;
  refreshGeneration.set(key, generation);
  refreshInFlight.add(key);

  try {
    await refreshFn();

    // Drop stale: if generation changed while we were fetching, discard
    if (refreshGeneration.get(key) !== generation) {
      return;
    }
  } finally {
    refreshInFlight.delete(key);

    // If queued during in-flight, re-run
    if (refreshQueued.has(key)) {
      refreshQueued.delete(key);
      void executeRefresh(key, refreshFn);
    }
  }
}

/** Clean up timers when component unmounts */
export function cancelSessionRefresh(key: string): void {
  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
}
```

**Step 2: Rewrite the SSE handler in SessionDetail.tsx**

Replace the current handler (lines 29-61) with:

```typescript
import { scheduleSessionRefresh, cancelSessionRefresh } from '../utils/session-refresh.js';

// Inside the component:
const refreshKey = `${projectId}/${sessionId}`;

const handleSSE = useCallback(
  (_channel: string, data: unknown) => {
    const event = data as SSESessionUpdate;
    if (event.sessionId !== sessionId || event.projectId !== projectId) return;

    // Schedule a throttled full re-fetch (matching devtools)
    scheduleSessionRefresh(refreshKey, async () => {
      await queryClient.invalidateQueries({
        queryKey: ['session', projectId, sessionId],
      });
    });
  },
  [queryClient, projectId, sessionId, refreshKey],
);

// Cleanup on unmount
useEffect(() => {
  return () => cancelSessionRefresh(refreshKey);
}, [refreshKey]);
```

**Step 3: Update useSessionDetail to allow background refetch**

In `hooks.ts`, change `staleTime` from `Infinity` to a large value so invalidation triggers refetch but normal usage doesn't spam:

```typescript
export function useSessionDetail(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () =>
      apiFetch<ParsedSession>(
        `/sessions/${encodeURIComponent(projectId)}/${sessionId}`,
      ),
    enabled: !!projectId && !!sessionId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
```

Note: `staleTime: Infinity` is fine — `invalidateQueries()` forces refetch regardless of staleTime. This matches devtools where data is only refreshed on explicit triggers.

**Step 4: Remove merge imports from SessionDetail.tsx**

Remove:
```typescript
import { mergeIncrementalUpdate, mergeSubagentUpdate } from '../utils/session-merger.js';
import type { SSESessionUpdate } from '../utils/session-merger.js';
```

Add:
```typescript
import type { SSESessionUpdate } from '../utils/session-merger.js';
```

(Keep the type import for the event shape check, or inline the type.)

**Step 5: Run tests**

Run: `cd tools/web-server && npx vitest run tests/client/session-detail-sse.test.ts tests/client/use-sse.test.ts -v`
Expected: May need test updates to match new SSE handler behavior.

**Step 6: Commit**

```bash
git add tools/web-server/src/client/utils/session-refresh.ts tools/web-server/src/client/pages/SessionDetail.tsx tools/web-server/src/client/api/hooks.ts
git commit -m "feat(web-server): add devtools-parity throttled refresh with generation tracking"
```

---

## Task 3: Stable Chunk IDs and React Keys

**Goal:** Match devtools' stable ID strategy: AI Group ID = `chunk.id` (stable from chunk builder), React key = `item.group.id` (no array index), display item IDs from message UUIDs.

**Files:**
- Modify: `tools/web-server/src/server/services/chunk-builder.ts` (chunk ID generation)
- Modify: `tools/web-server/src/client/utils/group-transformer.ts` (AI group ID)
- Modify: `tools/web-server/src/client/components/chat/ChatHistory.tsx` (React keys)
- Modify: `tools/web-server/src/client/components/chat/DisplayItemList.tsx` (display item keys)
- Test: `tools/web-server/tests/client/group-transformer.test.ts`
- Test: `tools/web-server/tests/server/services/chunk-builder.test.ts`

**Step 1: Add stable IDs to chunks in chunk-builder.ts**

Devtools generates chunk IDs in the chunk builder (server-side). Each chunk gets a stable ID based on its first message UUID.

Find where AIChunk objects are created in chunk-builder.ts and add a stable `id` field:

```typescript
// For AIChunk:
id: `ai-${messages[0]?.uuid ?? crypto.randomUUID()}`,

// For UserChunk:
id: `user-${message.uuid}`,

// For SystemChunk:
id: `system-${message.uuid ?? crypto.randomUUID()}`,

// For CompactChunk:
id: `compact-${message.uuid ?? crypto.randomUUID()}`,
```

If the Chunk type doesn't have an `id` field yet, add it to the base type in `types/jsonl.ts`:

```typescript
interface BaseChunk {
  id: string;        // Stable identifier for React reconciliation
  type: string;
  timestamp: Date;
  messages: ParsedMessage[];
}
```

**Step 2: Update group-transformer.ts to use chunk.id**

Replace the AI group ID generation (currently `ai-${turnIndex}-${toDate(startTime).getTime()}`):

```typescript
// BEFORE:
id: `ai-${turnIndex}-${toDate(startTime).getTime()}`,

// AFTER (matching devtools):
id: chunk.id,
```

Do the same for user, system, and compact groups — use `chunk.id` directly.

**Step 3: Update ChatHistory.tsx React keys**

Replace the itemKey function:

```typescript
// BEFORE:
function itemKey(item: ChatItem, index: number): string {
  return `${item.type}-${item.group.id}-${index}`;
}

// AFTER (matching devtools — no index):
function itemKey(item: ChatItem): string {
  return item.group.id;
}
```

Update the usage:
```typescript
// BEFORE:
{items.map((item, i) => (
  <ItemRenderer key={itemKey(item, i)} ... />
))}

// AFTER:
{items.map((item) => (
  <ItemRenderer key={itemKey(item)} ... />
))}
```

**Step 4: Update DisplayItemList.tsx keys**

Replace index-based keys with deterministic IDs from the display item data:

```typescript
// BEFORE:
function displayItemKey(item: AIGroupDisplayItem, index: number): string {
  switch (item.type) {
    case 'tool': return `tool-${item.tool.id}`;
    case 'subagent': return `sub-${item.subagent.id}`;
    default: return `${item.type}-${index}`;
  }
}

// AFTER (matching devtools — all keys from data, no index):
function displayItemKey(item: AIGroupDisplayItem): string {
  switch (item.type) {
    case 'tool': return `tool-${item.tool.id}`;
    case 'subagent': return `sub-${item.subagent.id}`;
    case 'thinking': return `thinking-${item.timestamp.getTime()}`;
    case 'output': return `output-${item.timestamp.getTime()}`;
    case 'subagent_input': return `input-${item.timestamp.getTime()}`;
    case 'compact_boundary': return `compact-${item.phaseNumber}`;
    case 'slash': return `slash-${item.slash.id}`;
    case 'teammate_message': return `tm-${item.teammateMessage.teammateId}-${item.teammateMessage.timestamp.getTime()}`;
  }
}
```

**Step 5: Update tests**

Update group-transformer.test.ts assertions that check AI group IDs to match the new `chunk.id` pattern.
Update chunk-builder.test.ts to verify chunks have stable `id` fields.

**Step 6: Run tests**

Run: `cd tools/web-server && npx vitest run tests/client/group-transformer.test.ts tests/server/services/chunk-builder.test.ts tests/client/display-item-builder.test.ts -v`

**Step 7: Commit**

```bash
git add tools/web-server/src/server/services/chunk-builder.ts tools/web-server/src/server/types/jsonl.ts tools/web-server/src/client/utils/group-transformer.ts tools/web-server/src/client/components/chat/ChatHistory.tsx tools/web-server/src/client/components/chat/DisplayItemList.tsx
git commit -m "fix(web-server): stable chunk IDs and React keys matching devtools"
```

---

## Task 4: Remove Client-Side Merge Infrastructure

**Goal:** Remove all client-side incremental merge logic that is no longer needed. The client now does full re-fetches, matching devtools.

**Files:**
- Modify: `tools/web-server/src/client/utils/session-merger.ts` (gut the file)
- Modify: `tools/web-server/src/client/pages/SessionDetail.tsx` (remove merge imports)
- Modify: `tools/web-server/tests/client/session-merger.test.ts` (update tests)
- Modify: any other files that import merge functions

**Step 1: Simplify session-merger.ts**

The file currently exports: `mergeIncrementalUpdate`, `mergeSubagentUpdate`, `SSESessionUpdate`, `MergeableSession`.

After this change, it should only export the SSE type (or move it elsewhere):

```typescript
// ─── SSE update payload shape ─────────────────────────────────────────────────

/**
 * Lightweight SSE signal from server indicating a session file changed.
 * The client responds by re-fetching the full session data.
 * Matches devtools' FileChangeEvent pattern.
 */
export interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
  type: 'session-change' | 'subagent-change';
}
```

Remove all of:
- `MergeableSession` interface
- `mergeMetrics()` function
- `rehydrateChunkDates()` function
- `rehydrateProcessDates()` function
- `deduplicateProcesses()` function
- `mergeBoundaryChunks()` function
- `mergeIncrementalUpdate()` function
- `mergeSubagentUpdate()` function

**Step 2: Update session-merger.test.ts**

Remove all tests for the removed merge functions. Add a simple test for the SSESessionUpdate type shape if desired, or delete the file entirely and move the type to a types file.

**Step 3: Search for and remove any remaining merge imports**

Check all files that import from `session-merger.ts` and remove unused imports.

**Step 4: Run full test suite**

Run: `cd tools/web-server && npx vitest run -v`
Expected: All tests pass (some tests may need updating if they reference removed functions)

**Step 5: Commit**

```bash
git add -u tools/web-server/src/ tools/web-server/tests/
git commit -m "refactor(web-server): remove client-side merge infrastructure, devtools uses full re-fetch"
```

---

## Task 5: Remove Server-Side Incremental Parse for SSE

**Goal:** Remove `parseIncremental()` from session-pipeline since the SSE pipeline no longer needs it. The server only needs `parseSession()` (full parse with caching). Keep the incremental test infrastructure for now since the function may still have value for future optimization.

**Files:**
- Modify: `tools/web-server/src/server/services/session-pipeline.ts`
- Modify: `tools/web-server/tests/server/services/session-pipeline-incremental.test.ts`

**Step 1: Evaluate parseIncremental usage**

Search for all callers of `parseIncremental`. If the ONLY caller was the SSE handler in `app.ts` (which was removed in Task 1), then `parseIncremental()` is now dead code.

**Decision:** If dead code, remove it. If used elsewhere, keep it.

**Step 2: If removing, update session-pipeline.ts**

Remove the `parseIncremental()` method and its `IncrementalUpdate` return type. Keep `parseSession()` and all cache infrastructure.

**Step 3: Update or remove incremental tests**

If `parseIncremental` is removed, remove `session-pipeline-incremental.test.ts`.

**Step 4: Run tests**

Run: `cd tools/web-server && npx vitest run -v`

**Step 5: Commit**

```bash
git add -u tools/web-server/src/ tools/web-server/tests/
git commit -m "refactor(web-server): remove parseIncremental, SSE uses full re-fetch pattern"
```

---

## Task 6: Add Global JSON Date Reviver

**Goal:** Match devtools' global date revival strategy. Instead of per-function `rehydrateChunkDates()`/`rehydrateProcessDates()`, add a JSON reviver to the API fetch layer that converts all ISO-8601 date strings to Date objects.

**Files:**
- Modify: `tools/web-server/src/client/api/fetch.ts` (or wherever `apiFetch` is defined)
- Test: `tools/web-server/tests/client/` (add date revival test)

**Step 1: Find the apiFetch implementation**

Locate the `apiFetch<T>()` function used by hooks.ts.

**Step 2: Add date reviver matching devtools**

```typescript
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/;

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  // Use text + JSON.parse with reviver to convert ISO date strings to Date objects
  // (matching devtools' HttpAPIClient.parseJson pattern)
  const text = await res.text();
  return JSON.parse(text, reviveDates) as T;
}
```

**Step 3: Remove per-function date rehydration**

After global reviver is in place, the `rehydrateChunkDates()` and `rehydrateProcessDates()` functions in session-merger.ts are no longer needed (already removed in Task 4). Verify no other code does manual date string conversion.

**Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest';

describe('apiFetch date revival', () => {
  it('converts ISO-8601 strings to Date objects', () => {
    const reviver = /* extract or export for testing */;
    const result = JSON.parse(
      '{"ts":"2026-02-27T15:30:45.123Z","name":"test"}',
      reviver,
    );
    expect(result.ts).toBeInstanceOf(Date);
    expect(result.ts.getTime()).toBe(new Date('2026-02-27T15:30:45.123Z').getTime());
    expect(result.name).toBe('test'); // Non-date strings unchanged
  });

  it('preserves non-date strings', () => {
    const reviver = /* extract or export for testing */;
    const result = JSON.parse('{"id":"not-a-date","count":42}', reviver);
    expect(result.id).toBe('not-a-date');
    expect(result.count).toBe(42);
  });
});
```

**Step 5: Run tests**

Run: `cd tools/web-server && npx vitest run -v`

**Step 6: Commit**

```bash
git add tools/web-server/src/client/api/ tools/web-server/tests/client/
git commit -m "feat(web-server): global JSON date reviver matching devtools"
```

---

## Task 7: Verify and Clean Up

**Goal:** Run full verification, fix any remaining issues, remove dead code.

**Files:**
- Various cleanup across modified files

**Step 1: Run full verify**

Run: `cd tools/web-server && npm run verify`
Expected: All linting and tests pass.

**Step 2: Search for dead code**

Check for any remaining references to:
- `mergeIncrementalUpdate`
- `mergeSubagentUpdate`
- `mergeBoundaryChunks`
- `rehydrateChunkDates`
- `rehydrateProcessDates`
- `parseIncremental`
- `IncrementalUpdate`
- `subagentCache`
- `parentTaskIdCache`
- `sseDebounceOffsets`
- `CachedSubagent`

Remove any dead imports or references.

**Step 3: Check that exported functions from subagent-resolver.ts that were previously only used by the SSE handler are either still used or removed**

Functions to check: `buildProcessFromFile`, `resolveParentTaskId`, `calculateAgentMetrics`, `detectOngoing`. If still used by `resolveSubagents()` or `parseSession()`, keep them. If only used by removed SSE handler code, remove exports (or the functions themselves if unused internally).

**Step 4: Live test**

1. Start the server: `cd tools/web-server && npm run dev`
2. Open the session detail page in browser
3. Start a new Claude session and verify:
   - User messages appear live
   - AI responses appear live (tool calls, thinking, output)
   - Subagents appear and update live
   - No flicker or "No items" flash
   - Expansion state preserved across updates
   - No console errors

**Step 5: Final commit**

```bash
git add -u tools/web-server/
git commit -m "chore(web-server): clean up dead code from SSE refactor"
```

---

## Summary: What Changes

| Layer | Before (our approach) | After (devtools approach) |
|-------|----------------------|--------------------------|
| **SSE payload** | Full chunks + metrics + processes | Lightweight signal: `{projectId, sessionId, type}` |
| **Server on file change** | Incremental parse → send data | Invalidate cache → send signal |
| **Client on SSE** | Merge chunks/metrics/subagents | Throttled full re-fetch |
| **Concurrency** | None | Generation tracking + in-flight coalescing + queue |
| **Chunk IDs** | Generated from turnIndex+timestamp | Stable from first message UUID |
| **React keys** | `${type}-${id}-${index}` | `${group.id}` (no index) |
| **Display item keys** | `${type}-${index}` fallback | All from data (UUID+timestamp) |
| **Date handling** | Per-function rehydration | Global JSON reviver |
| **Client merge code** | ~280 lines (session-merger.ts) | 0 lines (removed) |
| **Server SSE handler** | ~165 lines (incremental parse) | ~20 lines (invalidate + signal) |

## What We Keep

- `parseSession()` with caching (this IS what devtools does)
- `resolveSubagents()` three-phase linking (same as devtools)
- `linkSubagentsToChunks()` (same as devtools)
- `enhanceAIChunks()` with `extractSemanticSteps()` (same as devtools)
- `buildChunks()` from chunk-builder (same as devtools)
- `transformChunksToConversation()` (same as devtools)
- `buildDisplayItems()` (same as devtools)
- FileWatcher infrastructure (same pattern as devtools)
- SSE endpoint infrastructure (same pattern as devtools)
- All existing tests for the above
