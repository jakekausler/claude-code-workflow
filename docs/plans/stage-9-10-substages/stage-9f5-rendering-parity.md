# Stage 9F.5: Rendering Parity with claude-devtools

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9F (session detail display — provides base components to upgrade)
**Reference:** `/storage/programs/claude-devtools/src/renderer/` (MIT licensed, use as reference only — recreate, don't import)

## Goal

Upgrade all session rendering components to match claude-devtools quality exactly. Fix critical bugs, add missing features, and align rendering behavior. After this stage, the session viewer should be indistinguishable from claude-devtools for in-session display.

## Approach

Recreate matching logic using claude-devtools as reference. Our existing type system (`src/server/types/jsonl.ts`) stays as-is. Components are upgraded in-place. No forking, no importing from devtools.

## Reference Files in claude-devtools

Key files to study when implementing each task:
- Types: `src/renderer/types/groups.ts`, `src/shared/types/data.ts`
- Enhancement pipeline: `src/renderer/utils/aiGroupEnhancer.ts`, `src/renderer/utils/toolLinkingEngine.ts`, `src/renderer/utils/displayItemBuilder.ts`, `src/renderer/utils/lastOutputDetector.ts`
- Syntax highlighting: `src/renderer/components/chat/viewers/syntaxHighlighter.ts`
- Diff: `src/renderer/components/chat/viewers/DiffViewer.tsx`
- Code viewer: `src/renderer/components/chat/viewers/CodeBlockViewer.tsx`
- Markdown: `src/renderer/components/chat/viewers/MarkdownViewer.tsx`, `src/renderer/components/chat/markdownComponents.tsx`
- Tool summaries: `src/renderer/utils/toolRendering/toolSummaryHelpers.ts`
- Tool tokens: `src/renderer/utils/toolRendering/toolTokens.ts`
- Tool content checks: `src/renderer/utils/toolRendering/toolContentChecks.ts`
- Items: `src/renderer/components/chat/items/BaseItem.tsx`, `LinkedToolItem.tsx`, `SubagentItem.tsx`, `ThinkingItem.tsx`, `TextItem.tsx`
- AI group: `src/renderer/components/chat/AIChatGroup.tsx`, `DisplayItemList.tsx`, `LastOutputDisplay.tsx`
- User: `src/renderer/components/chat/UserChatGroup.tsx`
- System: `src/renderer/components/chat/SystemChatGroup.tsx`
- Compaction: `src/renderer/components/chat/CompactBoundary.tsx`
- Context: `src/renderer/components/chat/ContextBadge.tsx`
- Token formatting: `src/shared/utils/tokenFormatting.ts`
- Formatters: `src/renderer/utils/formatters.ts`

---

## Task 1: Fix tool execution linking — compute durationMs and isOrphaned

**Problem:** `AIChunk.tsx` builds `ToolExecution` objects but hardcodes `isOrphaned: false` and never computes `durationMs` or `endTime`.

**Reference:** `claude-devtools/src/renderer/utils/toolLinkingEngine.ts`

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — fix the tool execution building logic

**What to do:**
1. When building the `ToolExecution` map, set `isOrphaned = !matchingResult` (instead of hardcoded `false`)
2. Compute `endTime` from the tool result's message timestamp
3. Compute `durationMs = endTime.getTime() - startTime.getTime()` when both timestamps exist
4. For `startTime`, use the timestamp of the message containing the `tool_use` block

**Verification:** Tool calls with no results should show amber orphaned state. Tool calls with results should show duration.

---

## Task 2: Wire SubagentItem into AIChunk

**Problem:** `AIChunk.tsx` renders `'subagent'` semantic steps as a placeholder div. `SubagentItem` component exists but is never used.

**Reference:** `claude-devtools/src/renderer/components/chat/items/SubagentItem.tsx`, `DisplayItemList.tsx`

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — import and use `SubagentItem` for `'subagent'` steps

**What to do:**
1. Import `SubagentItem` from `../items/SubagentItem.js`
2. In the `'subagent'` case of `AIStepRenderer`, find the matching `Process` from `chunk.subagents` using `step.subagentId`
3. If found, render `<SubagentItem process={matchedProcess} />`
4. If not found, keep the placeholder (graceful degradation)

**Verification:** Sessions with subagent/Task tool calls should show expandable subagent cards with type badges, metrics, and execution traces.

---

## Task 3: Pass tokenCount to ThinkingItem

**Problem:** `AIChunk.tsx` never passes `tokenCount` to `ThinkingItem`. The prop exists but is always undefined.

**Reference:** `claude-devtools/src/renderer/components/chat/items/ThinkingItem.tsx` uses `step.tokens?.output ?? step.content.tokenCount`

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — extract token count from thinking content blocks and pass to ThinkingItem

**What to do:**
1. For `'thinking'` semantic steps, estimate token count as `Math.ceil(step.content.length / 4)` (same heuristic as devtools' `estimateTokens`)
2. Pass this as `tokenCount` prop to `ThinkingItem`

**Verification:** Thinking blocks should show a token count badge (e.g., "~2.3K tokens").

---

## Task 4: Add syntax highlighting

**Problem:** No code blocks have syntax highlighting anywhere — TextItem, ReadRenderer, WriteRenderer all render plain monospace.

**Reference:** `claude-devtools/src/renderer/components/chat/viewers/syntaxHighlighter.ts`

**Files to create:**
- `src/client/utils/syntax-highlighter.ts` — port the character-scanning highlighter

**What to port:**
The devtools highlighter is a custom character-by-character scanner that produces `React.ReactNode[]` of styled spans. It supports:
- String literals (single/double/backtick quotes): one color
- Comments (`//`, `#`, `--`): one color
- Numbers: one color
- Keywords per language (typescript, javascript, python, rust, go, ruby, php, sql, r): one color
- Type names (UpperCase start): one color
- Operators/punctuation: one color

Port this as `highlightLine(line: string, language: string): React.ReactNode[]`

Also create `inferLanguage(filename: string): string` using a file extension map (devtools has 30+ extensions in `CodeBlockViewer.tsx`).

**Files to modify after creating the utility:**
- `src/client/components/chat/items/TextItem.tsx` — use `highlightLine` for code blocks instead of plain text
- `src/client/components/tools/ReadRenderer.tsx` — add line numbers and syntax highlighting
- `src/client/components/tools/WriteRenderer.tsx` — add syntax highlighting

**Verification:** Code blocks in AI responses should have colored syntax. Read/Write tool results should show line numbers and colored code.

---

## Task 5: Add LastOutputDisplay

**Problem:** All AI semantic steps render inline equally. No way to see the AI's final response without scrolling through everything.

**Reference:** `claude-devtools/src/renderer/components/chat/LastOutputDisplay.tsx`, `src/renderer/utils/lastOutputDetector.ts`

**Files to create:**
- `src/client/utils/last-output-detector.ts` — detect the last significant output from an AI chunk
- `src/client/components/chat/LastOutputDisplay.tsx` — render the last output as a persistent card

**What to implement:**

`findLastOutput(semanticSteps, isOngoing)` priority:
1. Check for `'interruption'` step → `{type: 'interruption'}`
2. If `isOngoing` → `{type: 'ongoing'}` (show spinner/typing indicator)
3. Reverse scan for last `'output'` step → `{type: 'text', content}`
4. Reverse scan for last `'tool_result'` step → `{type: 'tool_result', toolName, isError}`
5. Return `null`

`LastOutputDisplay` rendering:
- `text`: Markdown card with max-height, scroll, copy button
- `tool_result`: Colored card (red=error, green=success) with tool name badge
- `interruption`: Amber banner with warning icon
- `ongoing`: Pulsing "Claude is responding..." indicator

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — render `LastOutputDisplay` at the bottom of each AI chunk

**Verification:** Each AI chunk should show its final output/result as a visible card even without expanding individual items.

---

## Task 6: Add AI chunk collapse/expand

**Problem:** AI chunks show all semantic steps unconditionally. No way to collapse them.

**Reference:** `claude-devtools/src/renderer/components/chat/AIChatGroup.tsx`

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — add collapse/expand header with summary

**What to implement:**
1. Header bar showing: Bot icon, model name, item count summary (e.g., "3 tools, 1 thinking"), token count, duration, timestamp, chevron
2. Collapsed state: show only header + `LastOutputDisplay`
3. Expanded state: show header + all semantic steps + `LastOutputDisplay`
4. Default: collapsed (devtools default)
5. Use `useSessionViewStore.expandedChunks` for expansion state (it exists but is currently unused)

**Verification:** AI chunks should be collapsible. Collapsed view shows header summary + last output. Expanding reveals all steps.

---

## Task 7: Upgrade UserChunk to render markdown

**Problem:** UserChunk renders plain `whitespace-pre-wrap` text. No markdown, no collapse for long messages, no image indicator.

**Reference:** `claude-devtools/src/renderer/components/chat/UserChatGroup.tsx`

**Files to modify:**
- `src/client/components/chat/UserChunk.tsx`

**What to implement:**
1. Replace plain text with `ReactMarkdown + remarkGfm` (same as TextItem)
2. Add collapse at 500 characters with "Show more / Show less" toggle
3. Add image count indicator if `content` array contains `ImageContent` blocks (e.g., "[2 images]" badge — don't render actual images)
4. Skip `@mention` validation (requires backend endpoint we don't have — defer to future)

**Verification:** User messages should render markdown (bold, code, links, etc.) and collapse when long.

---

## Task 8: Upgrade EditRenderer with LCS diff

**Problem:** EditRenderer shows simple old/new blocks with no line-level diff.

**Reference:** `claude-devtools/src/renderer/components/chat/viewers/DiffViewer.tsx`

**Files to create:**
- `src/client/utils/diff.ts` — LCS diff algorithm

**What to port:**
The devtools diff uses a custom LCS (Longest Common Subsequence) algorithm:
1. Split old and new strings into lines
2. Build O(m*n) matrix
3. Backtrack to produce `DiffLine[]` with type `'added' | 'removed' | 'context'`
4. Render: red background for removed, green for added, neutral for context
5. Show line numbers on both sides
6. Header shows `+N -N` stats

**Files to modify:**
- `src/client/components/tools/EditRenderer.tsx` — use the new diff utility

**Verification:** Edit tool results should show a proper line-level diff with colors, line numbers, and stats.

---

## Task 9: Upgrade CompactChunk with token delta and expandable summary

**Problem:** CompactChunk shows a basic divider. No token delta, no expandable summary.

**Reference:** `claude-devtools/src/renderer/components/chat/CompactBoundary.tsx`

**Files to modify:**
- `src/client/components/chat/CompactChunk.tsx`

**What to implement:**
1. Show `preCompactionTokens → postCompactionTokens` if available in the chunk data
2. Show freed tokens in green (pre - post)
3. Make the summary expandable (click to expand, renders as markdown)
4. Add phase badge if phase information is available

**Note:** This may require checking whether the server-side CompactChunk type includes token counts. If not, the server parser may need updating too (check `src/server/services/chunk-builder.ts`).

**Verification:** Compaction boundaries should show token counts and expandable summaries.

---

## Task 10: Upgrade ReadRenderer with line numbers and CodeBlockViewer pattern

**Problem:** ReadRenderer shows a plain dark `<pre>` with no line numbers and no language detection.

**Reference:** `claude-devtools/src/renderer/components/chat/viewers/CodeBlockViewer.tsx`

**Files to modify:**
- `src/client/components/tools/ReadRenderer.tsx`

**What to implement:**
1. Infer language from `file_path` extension using `inferLanguage()` from Task 4
2. Show line numbers (starting from `offset` or 1)
3. Apply syntax highlighting per line using `highlightLine()` from Task 4
4. Show header with filename, line range badge, language badge

**Verification:** Read tool results should look like a code editor with line numbers and syntax coloring.

---

## Task 11: Strip ANSI codes from SystemChunk

**Problem:** System chunks render raw ANSI escape codes.

**Reference:** `claude-devtools/src/renderer/components/chat/SystemChatGroup.tsx`

**Files to modify:**
- `src/client/components/chat/SystemChunk.tsx`

**What to do:**
Add `text.replace(/\x1B\[[0-9;]*m/g, '')` to strip ANSI escape codes before rendering.

**Verification:** System messages should not show garbled escape sequences.

---

## Task 12: Expand tool summary coverage

**Problem:** `generateToolSummary` handles 8 tool types. Devtools handles 17+.

**Reference:** `claude-devtools/src/renderer/utils/toolRendering/toolSummaryHelpers.ts`

**Files to modify:**
- `src/client/utils/session-formatters.ts`

**What to add:**
- `Write`: `"{filename} - N lines"` (count newlines in content)
- `WebFetch`: extract hostname + pathname from URL
- `WebSearch`: `'"{query}"'` truncated to 40 chars
- `NotebookEdit`: `"{editMode} - {filename}"`
- `TodoWrite` / `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`: match devtools patterns
- Default fallback: try `name/path/file/query/command` fields before returning tool name

**Verification:** All tool types should show meaningful summaries instead of falling back to the tool name.

---

## Task 13: Wire ContextBadge into AIChunk

**Problem:** `ContextBadge` component exists but is not rendered anywhere.

**Reference:** `claude-devtools/src/renderer/components/chat/ContextBadge.tsx`, `AIChatGroup.tsx`

**Files to modify:**
- `src/client/components/chat/AIChunk.tsx` — add ContextBadge to the header area

**What to do:**
1. Compute `totalNewTokens` for the AI chunk from usage metadata
2. If available, break down into categories (thinking, output, tools, etc.)
3. Render `ContextBadge` in the AI chunk header

**Note:** The category breakdown depends on what data the server-side parser provides. Start with total tokens only, add categories if the data supports it.

**Verification:** AI chunks should show "Context +N" badges in their headers.

---

## Task 14: Fix ChatHistory React keys

**Problem:** ChatHistory uses array index as React key, causing potential stale renders.

**Files to modify:**
- `src/client/components/chat/ChatHistory.tsx`

**What to do:**
Use a stable key derived from chunk data: `{chunk.type}-{index}` minimum, or `{chunk.type}-{chunk.timestamp}-{index}` for better stability.

**Verification:** No React key warnings. Chunk list updates correctly when new chunks arrive.

---

## Task 15: Update formatDuration to include milliseconds

**Problem:** `formatDuration` floors sub-second durations to "0s".

**Reference:** `claude-devtools/src/renderer/utils/formatters.ts`

**Files to modify:**
- `src/client/utils/session-formatters.ts`

**What to do:**
For durations < 1000ms, show `"{N}ms"` instead of `"0s"`.

**Verification:** Fast tool calls should show "150ms" instead of "0s".

---

## Task 16: Use session view store for expansion state

**Problem:** `useSessionViewStore` defines `expandedTools` and `expandedSubagents` Sets but `LinkedToolItem` and `SubagentItem` use local `useState`. The store is dead code.

**Files to modify:**
- `src/client/components/chat/items/LinkedToolItem.tsx` — use store instead of local state
- `src/client/components/chat/items/SubagentItem.tsx` — use store instead of local state

**What to do:**
Replace local `useState` with `useSessionViewStore` toggle methods. This preserves expansion state across re-renders and enables "collapse all" / "expand all" functionality in the future.

**Verification:** Expansion state persists when the component re-renders (e.g., when new data arrives via SSE in the future).

---

## Success Criteria

After all tasks:
- [ ] Tool calls show duration and orphaned state correctly
- [ ] Subagent trees render with full expansion and execution traces
- [ ] Thinking blocks show token count badges
- [ ] Code blocks have syntax highlighting (9 languages minimum)
- [ ] AI chunks are collapsible with LastOutputDisplay visible when collapsed
- [ ] User messages render markdown and collapse when long
- [ ] Edit diffs show line-level LCS diff with colors and line numbers
- [ ] Compaction boundaries show token deltas and expandable summaries
- [ ] Read results show line numbers and syntax highlighting
- [ ] System messages strip ANSI escape codes
- [ ] All 17+ tool types have meaningful summaries
- [ ] ContextBadge shows in AI chunk headers
- [ ] Session viewer is visually indistinguishable from claude-devtools for standard sessions

## Task Dependencies

```
Task 4 (syntax highlighter) ← Task 10 (ReadRenderer upgrade)
Task 4 (syntax highlighter) ← Task 5 (LastOutputDisplay uses TextItem which uses highlighting)
Task 5 (LastOutputDisplay) ← Task 6 (AI collapse shows LastOutput when collapsed)
Task 8 (LCS diff) is independent
Tasks 1, 2, 3, 7, 9, 11, 12, 13, 14, 15, 16 are independent of each other

Suggested execution order:
Batch 1 (parallel): Tasks 1, 2, 3, 4, 7, 8, 11, 12, 14, 15
Batch 2 (after Task 4): Task 10
Batch 3 (after Tasks 4, 1): Tasks 5, 13, 16
Batch 4 (after Task 5): Tasks 6, 9
```
