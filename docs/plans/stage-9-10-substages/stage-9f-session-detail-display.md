# Stage 9F: Session Detail Display

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9A (scaffold), 9E (JSONL engine provides data)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Full claude-devtools-quality session viewer in the browser with chat history, tool renderers, subagent trees, context tracking, and cost display.

## What Ships

SessionDetail page + ~20 React components for rendering session data.

## Page: SessionDetail (`/sessions/:projectId/:sessionId`)

**Layout:**
- Left panel (main, ~70%): ChatHistory with virtual scrolling
- Right panel (sidebar, ~30%): SessionContextPanel with metrics and context tracking
- Top bar: session metadata (model, duration, total tokens, cost, git branch)

**API calls:**
- `GET /api/sessions/:projectId/:sessionId` — Full parsed session (chunks + subagents)
- SSE subscription for live updates (9G)

## Components

### ChatHistory (`components/chat/ChatHistory.tsx`)

The main scrollable conversation view.

**Virtual scrolling:**
- Use `@tanstack/react-virtual` with `useVirtualizer()`
- Conditional: only virtualize when item count > 120 (below that, render all)
- `estimateSize: () => 260` (estimated chunk height in pixels)
- `overscan: 8` (render 8 items beyond viewport)
- `measureElement` for actual height measurement after render

**Auto-scroll:**
- Track if user is within 100px of bottom
- If near bottom: auto-scroll on new chunks
- If scrolled up: preserve position, show "New messages" indicator

**Chunk rendering:**
- UserChunks: right-aligned, user avatar, message text, timestamp
- AIChunks: left-aligned, contains SemanticSteps (tool calls, thinking, text, subagents)
- SystemChunks: centered, gray, command output
- CompactChunks: divider line with "Context compacted" label and token delta

**Reference:** `claude-devtools/src/renderer/components/chat/ChatHistory.tsx` for the virtualization setup. `claude-code-monitor/packages/dashboard/src/components/ActivityTimeline.tsx` for the Virtua approach (reference only, we're using @tanstack).

### UserChunk (`components/chat/UserChunk.tsx`)
- Right-aligned message bubble
- User text with markdown rendering
- Timestamp
- Permission mode indicator if present

### AIChunk (`components/chat/AIChunk.tsx`)
- Left-aligned response area
- Renders SemanticSteps in order:
  - ThinkingItem for thinking blocks
  - TextItem for text output
  - LinkedToolItem for tool calls
  - SubagentItem for Task tool calls with resolved subagent data
- Footer: chunk-level metrics (tokens, duration, cost)

### ThinkingItem (`components/chat/items/ThinkingItem.tsx`)
- Collapsible "Thinking..." header
- Expanded: monospace text with thinking content
- Token count badge

### TextItem (`components/chat/items/TextItem.tsx`)
- Rendered markdown (react-markdown + remark-gfm)
- Syntax highlighting for code blocks (Shiki)

### LinkedToolItem (`components/chat/items/LinkedToolItem.tsx`)
- Collapsible card with tool icon, name, summary, status, duration
- Expanded: tool-specific renderer (see below)
- Error state: red border, error message display
- Token count (call tokens + result tokens)

**Tool summary generation:** Port from claude-devtools `toolSummaryHelpers.ts`:
- Edit: "filename.ts - 3 -> 5 lines"
- Read: "filename.ts - lines 1-100"
- Bash: truncated command or description
- Grep: '"pattern" in *.ts'
- Task: "Explore - description..."

**Reference:** `claude-devtools/src/renderer/components/chat/items/LinkedToolItem.tsx`

### Tool-Specific Renderers (`components/tools/`)

Port from claude-devtools renderer patterns:

| Renderer | What it shows | Reference |
|----------|-------------|-----------|
| **ReadRenderer** | File path, syntax-highlighted content with line numbers | claude-devtools ReadToolViewer |
| **EditRenderer** | Diff view with green (added) / red (removed) lines, file path | claude-devtools EditToolViewer |
| **WriteRenderer** | File path, syntax-highlighted content, optional markdown preview | claude-devtools WriteToolViewer |
| **BashRenderer** | Command text, stdout (green), stderr (red), exit code, duration | claude-code-monitor BashRenderer |
| **GlobRenderer** | Pattern, matched files list, match count | claude-code-monitor GlobRenderer |
| **GrepRenderer** | Pattern, matched files with context lines, match count | claude-code-monitor GrepRenderer |
| **TaskRenderer** | Delegates to SubagentItem | — |
| **SkillRenderer** | Skill name, instructions in code viewer, result text | claude-devtools SkillToolViewer |
| **DefaultRenderer** | Key-value input params, raw output section | claude-devtools DefaultToolViewer |

Additional renderers for MCP tools and others can use DefaultRenderer initially.

**Syntax highlighting:** Use Shiki for code blocks. Load language grammars lazily. claude-code-monitor uses Shiki 3.22.0.

### SubagentItem (`components/chat/items/SubagentItem.tsx`)

Multi-level expandable card for subagent/Task execution.

**Level 1 (collapsed):**
- Expand chevron
- Icon (colored by type: Explore=blue, Plan=purple, Code=green, general=gray)
- Type badge (subagent type or team member name)
- Model info (e.g., "Opus 4.6")
- Description (truncated to 60 chars)
- Status indicator (spinner if ongoing, checkmark if complete)
- MetricsPill: `[12.3K | 45.7K]` showing main session impact | subagent context
- Duration

**Level 1 (expanded):**
- Meta info: Type, Duration, Model, Agent ID (first 8 chars)
- Context usage: Main Context tokens, Subagent Context tokens, per-phase breakdown

**Level 2 (execution trace):**
- Toggle within expanded subagent
- Full rendering of subagent's conversation: ThinkingItems, TextItems, LinkedToolItems
- Recursive: subagents within subagents render nested SubagentItems
- CompactBoundary markers if compaction occurred within subagent

**Reference:** `claude-devtools/src/renderer/components/chat/items/SubagentItem.tsx`

### MetricsPill (`components/chat/MetricsPill.tsx`)
- Compact pill: `[main | subagent]` token counts
- Tooltip on hover: breakdown per category
- Format: K for thousands (e.g., 12.3K)

### ContextBadge (`components/chat/context/ContextBadge.tsx`)
- Appears per AIChunk turn
- Shows "Context +N" where N = new context tokens for this turn
- Hover popover with expandable sections:
  - User Messages (count, tokens)
  - CLAUDE.md Files (paths, tokens per file)
  - Mentioned Files (paths, tokens)
  - Tool Outputs (per-tool breakdown)
  - Task Coordination (SendMessage, TaskCreate tokens)
  - Thinking + Text (per-turn)
  - Total footer

**Reference:** `claude-devtools/src/renderer/components/chat/ContextBadge.tsx`

### SessionContextPanel (`components/chat/context/ContextPanel.tsx`)
- Right sidebar panel
- Session summary: model, total tokens, cost, duration, message count
- Cumulative context tracking across all turns
- Compaction timeline: visual markers showing where compaction occurred
- Phase breakdown: tokens per phase (pre/post compaction)
- Category pie chart or bar chart showing token distribution

**Reference:** `claude-devtools/src/renderer/components/chat/SessionContextPanel/`

## State Management

**Zustand session-store:**
```typescript
{
  currentSession: ParsedSession | null,
  isLoading: boolean,
  expandedChunks: Set<string>,       // Which chunks are expanded
  expandedTools: Set<string>,         // Which tool items are expanded
  expandedSubagents: Set<string>,     // Which subagents are expanded (level 1 vs 2)
  scrollPosition: number,
  isNearBottom: boolean,
}
```

## Success Criteria

- Session detail renders full conversation with all chunk types
- All 9 tool renderers display correct content
- Subagent trees expand recursively
- Virtual scrolling handles 1000+ chunk sessions without lag
- Context tracking shows accurate 7-category breakdown
- Cost calculation matches claude-devtools output
- Compaction boundaries are visible with token deltas
- Auto-scroll works for live sessions, manual scroll is preserved
