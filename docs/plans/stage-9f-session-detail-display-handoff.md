# Stage 9F: Session Detail Display — Session Prompt

## Context

Stages 9A through 9E and 10A are complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9F: Session Detail Display** — the client-side React components that render parsed session data as a full claude-devtools-quality session viewer.

### Dependency Graph

```
Stage 0 (Pipeline Config) ✅
  └── Stage 1 (Foundation + SQLite) ✅
        ├── Stage 2 (Migration) ✅
        ├── Stage 3 (Remote Mode) ✅
        ├── Stage 4 (Jira) ✅
        ├── Stage 5 (Auto-Design) ✅
        └── Stage 5.5A-5.5C ✅
              └── Stage 6A-6E ✅
                    ├── Stage 7 (Slack) ✅
                    └── Stage 8 (Global CLI + Multi-Repo) ✅
                          └── Stage 9 (Web UI)
                                ├── Stage 9A (Web Server Foundation) ✅
                                ├── Stage 9B (REST API Layer) ✅
                                ├── Stage 9C (Dashboard + Board Views) ✅
                                ├── Stage 9D (Detail Views + Board UX) ✅
                                ├── Stage 9E (Session JSONL Engine) ✅
                                ├── Stage 9F (Session Detail Display) ← THIS STAGE
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
                          └── Stage 10
                                └── Stage 10A (Orchestrator Communication) ✅
```

### What Has Been Built (Stages 0–9E, 10A)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):
- 12 commands: board, graph, next, validate, validate-pipeline, sync, summary, migrate, jira-import, jira-sync, learnings-count, enrich
- All support `--output/-o`, `--repo`, `--pretty`, and `--global` (where applicable)
- `session_id` column on stages table with migration and index
- 894 tests across 58 test files

**MCP Server** (`tools/mcp-server/`):
- Jira, PR/MR, Slack, Confluence, enrichment tools
- Mock mode via `KANBAN_MOCK=true`

**Orchestrator** (`tools/orchestrator/`):
- Session spawning, exit gates, completion cascade, MR chain management, cron loops
- Stream-JSON stdout parser for session ID capture
- SessionRegistry mapping stage → session with WebSocket broadcast
- 437 tests across 28 test files

**Web Server Foundation** (`tools/web-server/`) — Stage 9A:
- Fastify 5 server on port 3100, Vite 6 dev server on 3101
- `createServer(options)` factory in `src/server/app.ts` (CORS, health endpoint, dev proxy, SPA fallback)
- React 19 SPA with BrowserRouter, layout shell (sidebar + breadcrumb header)
- 3 Zustand stores (board, session, settings) + drawer store, API client (`apiFetch<T>`), React Query hooks
- Tailwind CSS 3.4, vitest 3, TypeScript 5 (strict, NodeNext, ES2022)

**REST API Layer** (`tools/web-server/`) — Stage 9B:
- 22 REST endpoints across 7 route plugin files in `src/server/routes/`
- `DataService` class wrapping kanban-cli database and repositories (`src/server/services/data-service.ts`)
- Board/stats endpoints using `buildBoard()` from kanban-cli with Zod query parameter validation
- Epic, ticket, stage, graph, repo endpoints with full CRUD-read and filtering
- React Query hooks for all endpoints in `src/client/api/hooks.ts`

**Dashboard + Board Views** (`tools/web-server/`) — Stage 9C:
- Dashboard home page with pipeline stats, activity feed, blocked alert, quick links
- Unified `/board` page with cascading filter dropdowns (Repo, Epic, Ticket)
- `FilterBar` component with `useRepos()` hook and Zustand store for filter state
- Shared board components: `BoardLayout`, `BoardColumn`, `BoardCard`
- Utility formatters: `slugToTitle`, `columnColor`, `statusColor`, `completionPercent`

**Detail Views + Board UX** (`tools/web-server/`) — Stage 9D:
- Slide-over drawer system with `DrawerHost`, `DetailDrawer`, and `drawer-store.ts` (Zustand stack-based navigation)
- Detail content components: `EpicDetailContent`, `TicketDetailContent`, `StageDetailContent` rendered inside drawers
- Shared detail components: `StatusBadge`, `DependencyList`, `MarkdownContent`, `PhaseSection`
- `DependencyGraph` page with Mermaid.js rendering, filter controls, and cycle warnings
- Board cards open drawers on click; drawers support back navigation and close-on-Escape
- Selected card highlighting (blue ring) when drawer is open
- Auto-scroll board to keep selected card's column visible beside drawer

**Session JSONL Engine** (`tools/web-server/`) — Stage 9E:
- 8 server-side services in `src/server/services/`:
  - **SessionParser** — Line-by-line JSONL parsing into `ParsedMessage[]`, streaming via createReadStream + readline, entry type validation
  - **ToolExecutionBuilder** — 3-pass algorithm matching `tool_use` to `tool_result` blocks via `sourceToolUseID` with duration calculation and orphan detection
  - **ChunkBuilder** — Groups messages into UserChunk/AIChunk/SystemChunk/CompactChunk with 4-category classification (user/system/hardNoise/ai); extracts SemanticSteps from AI chunks
  - **SubagentResolver** — Discovers subagent JSONL files (new-style + legacy directories), 3-phase linking (result-based → description-based → positional), parallel detection
  - **ContextTracker** — Tracks token attribution across 6 categories (claudeMd, mentionedFiles, toolOutputs, thinkingText, taskCoordination, userMessages) per turn, with compaction-aware phase boundaries
  - **PricingEngine** — Per-session cost calculation with tiered pricing for opus/sonnet/haiku models, prefix matching for versioned model names
  - **DataCache** — Generic LRU cache bounded by memory size (50MB default, configurable via `CACHE_SIZE_MB`), oversized entry protection
  - **FileWatcher** — `fs.watch` with recursive monitoring, 100ms debouncing per-file, 30-second catch-up scans, max depth guard, byte-offset tracking for incremental parsing
- **SessionPipeline** — Orchestration facade wiring all services into `parseSession()` → `ParsedSession`
- 5 API endpoints (replacing 501 stubs):
  - `GET /api/sessions` — Lists sessions by scanning `~/.claude/projects/`
  - `GET /api/sessions/:projectId/:sessionId` — Full parsed session (chunks, metrics, subagents)
  - `GET /api/sessions/:projectId/:sessionId/metrics` — SessionMetrics
  - `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Single subagent Process
  - `GET /api/stages/:stageId/session` — Stage-to-session convenience endpoint
- `session_id` exposed in stage list, detail, and ticket detail API responses
- JSONL type definitions in `src/server/types/jsonl.ts` (~350 lines covering all entry types, content blocks, parsed types, chunk types, analysis types)
- JSONL fixtures in `tests/fixtures/` (6 main fixtures + 2 subagent fixtures)
- 248 tests across 20 test files (including 9 integration tests)

**Orchestrator Communication** — Stage 10A:
- WebSocket server in orchestrator broadcasting session registry events
- OrchestratorClient in web-server consuming session state via WebSocket

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design (Section 11 covers 9F session detail display)
- @docs/plans/stage-9-10-substages/stage-9f-session-detail-display.md — Detailed specification for this substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `deep-dive-jsonl-hooks.md` — JSONL format deep-dive with type definitions
- `deep-dive-session-parsing.md` — Session parsing pipeline from claude-devtools
- `research-claude-devtools.md` — claude-devtools architecture and patterns
- `stage-9-10-research-synthesis.md` — Unified synthesis with recommended patterns

---

## What Stage 9F Delivers

### Goal

Full claude-devtools-quality session viewer in the browser: chat history with virtual scrolling, 9 tool-specific renderers, recursive subagent trees, context tracking, and cost display. This is a **client-side only** stage — all data comes from 9E API endpoints.

### Session Detail Integration

Session detail should be accessible as a **tab in the existing stage drawer** (from 9D). When a stage has a linked `session_id`, the `StageDetailContent` component should show a "Session" tab alongside the existing stage info. The session detail can also be accessed via direct URL at `/sessions/:projectId/:sessionId`.

The stage API already includes `session_id: string | null` in responses (added in 9E). Use this to determine if a session tab should be shown.

### Components (~20 new React components)

**Page/Layout:**
1. **SessionDetail** — Top-level page/drawer-tab with left panel (ChatHistory ~70%) + right panel (SessionContextPanel ~30%) + top bar (metadata)

**Chat components** (in `src/client/components/chat/`):
2. **ChatHistory** — Main scrollable conversation view with `@tanstack/react-virtual` virtualization (threshold: >120 items, estimateSize: 260px, overscan: 8)
3. **UserChunk** — Right-aligned message bubble with markdown rendering and timestamp
4. **AIChunk** — Left-aligned response area rendering SemanticSteps (thinking, text, tool calls, subagents) with footer metrics
5. **SystemChunk** — Centered gray command output
6. **CompactChunk** — Divider line with "Context compacted" label and token delta

**Item components** (in `src/client/components/chat/items/`):
7. **ThinkingItem** — Collapsible thinking block with monospace text and token count badge
8. **TextItem** — Rendered markdown via react-markdown + remark-gfm, syntax highlighting for code blocks
9. **LinkedToolItem** — Collapsible tool card with icon, name, summary, status, duration; delegates to tool-specific renderer when expanded
10. **SubagentItem** — Multi-level expandable card (Level 1: header with metrics pill; Level 1 expanded: meta info + context usage; Level 2: full execution trace with recursive subagent rendering)
11. **MetricsPill** — Compact `[main | subagent]` token count pill with tooltip

**Tool renderers** (in `src/client/components/tools/`):
12. **ReadRenderer** — File path, syntax-highlighted content with line numbers
13. **EditRenderer** — Diff view with green (added) / red (removed) lines
14. **WriteRenderer** — File path, syntax-highlighted content, optional markdown preview toggle
15. **BashRenderer** — Command text, stdout (green), stderr (red), exit code, duration
16. **GlobRenderer** — Pattern, matched files list, match count
17. **GrepRenderer** — Pattern, matched files with context lines, match count
18. **SkillRenderer** — Skill name, instructions in code viewer, result text
19. **DefaultRenderer** — Key-value input params, raw output section (fallback for MCP tools and others)

**Context components** (in `src/client/components/chat/context/`):
20. **ContextBadge** — Per-turn "Context +N" badge with hover popover showing 6-category breakdown
21. **SessionContextPanel** — Right sidebar with session summary, cumulative context tracking, compaction timeline, phase breakdown

### API Endpoints Available (from 9E)

All data comes from existing 9E endpoints:
- `GET /api/sessions/:projectId/:sessionId` → `ParsedSession { chunks, metrics, subagents, isOngoing }`
- `GET /api/sessions/:projectId/:sessionId/metrics` → `SessionMetrics`
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` → `Process`
- `GET /api/stages/:stageId/session` → `{ sessionId, stageId }`

### Data Types (from 9E, already defined)

All types are in `src/server/types/jsonl.ts`:
- **Chunk types**: `UserChunk`, `AIChunk`, `SystemChunk`, `CompactChunk`, `EnhancedAIChunk` (with `semanticSteps`)
- **SemanticStep**: `{ type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'subagent' | 'output', ... }`
- **ToolExecution**: `{ toolName, toolCallId, input, output, startTime, endTime, duration, isOrphaned }`
- **Process** (subagent): `{ id, filePath, messages, chunks, metrics, linkedToolCallId, isParallel, isOngoing }`
- **SessionMetrics**: `{ turnCount, toolCallCount, totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalCost, duration }`
- **ParsedSession**: `{ chunks, metrics, subagents, isOngoing }`

These types need to be importable on the client side. You may need to create a shared types file or re-export the relevant types from a client-accessible location (since `src/server/types/` may not be importable by client code due to build configuration).

### What Stage 9F Does NOT Include

- Server-side changes (all backend work is done in 9E)
- SSE real-time push to client (9G) — auto-scroll preparation is fine, but live updates come in 9G
- Modifications to kanban-cli or orchestrator packages
- Session list page (already exists from 9B, just needs link to detail)

---

## Implementation Notes from 9A–9E

These are specific lessons and patterns established during earlier stages that you MUST follow.

### 1. ESM Module Requirements

This project uses `"type": "module"` in package.json. This means:
- **All local imports must use `.js` extensions** — `import { foo } from './bar.js'`
- **Use `fileURLToPath(import.meta.url)` instead of `__dirname`** — already done in `app.ts`
- npm package imports do NOT need `.js` extensions

### 2. Client-Side Architecture

The React app lives in `src/client/`:
- **Entry point**: `src/client/main.tsx` with `BrowserRouter`
- **Layout**: `src/client/components/Layout.tsx` with sidebar + breadcrumb header
- **Pages**: `src/client/pages/` (Dashboard, Board, DependencyGraph)
- **Components**: `src/client/components/` (shared components, board components, detail components)
- **State**: Zustand stores in `src/client/stores/` (board-store, session-store, settings-store, drawer-store)
- **API**: `src/client/api/client.ts` (`apiFetch<T>`) + `src/client/api/hooks.ts` (React Query hooks)
- **Styling**: Tailwind CSS 3.4 utility classes

### 3. Existing Drawer System (from 9D)

The drawer system in 9D provides the foundation for session detail integration:
- `DrawerHost` in `src/client/components/drawers/DrawerHost.tsx` renders the current drawer
- `drawer-store.ts` manages a stack of drawer states with push/pop navigation
- `DetailDrawer` renders content based on type (epic, ticket, stage)
- Add a new drawer content type for session detail, OR add a tab to `StageDetailContent`

### 4. React Query Hooks Pattern

Existing hooks in `src/client/api/hooks.ts` follow this pattern:
```typescript
export function useSessionDetail(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => apiFetch<ParsedSession>(`/api/sessions/${projectId}/${sessionId}`),
    enabled: !!projectId && !!sessionId,
  });
}
```

### 5. New Dependencies Likely Needed

Check what's already in `package.json` before adding. Likely needs:
- `@tanstack/react-virtual` — Virtual scrolling for ChatHistory (may already be present)
- `react-markdown` + `remark-gfm` — Markdown rendering in TextItem (may already be present)
- `shiki` — Syntax highlighting for code blocks in tool renderers

### 6. Testing

- **Vitest 3** for all tests: `globals: true`, includes `tests/**/*.test.ts`
- **Client component tests**: Use `@testing-library/react` if available, or snapshot tests
- **Server tests**: 248 existing tests must not break
- Run: `npm run test`, lint: `npm run lint`, both: `npm run verify`

### 7. Tool Summary Generation

Port tool summary helpers from claude-devtools patterns:
- **Edit**: `"filename.ts - 3 → 5 lines"`
- **Read**: `"filename.ts - lines 1-100"`
- **Bash**: Truncated command or description field
- **Grep**: `'"pattern" in *.ts'`
- **Task**: `"Explore - description..."`

These summaries appear in the collapsed state of `LinkedToolItem`.

---

## Session Workflow Rules

### Main Agent Responsibilities

The main agent (coordinator) **CAN and SHOULD** directly:
- **Read design docs, research docs, and plan files** — these are documentation, not code files. Do NOT delegate reading `docs/plans/`, `docs/research/`, or `CLAUDE.md` to subagents.
- **Write and update the implementation plan** — use the writing-plans skill, main agent writes the plan directly.
- **Run simple git commands** (`git status`, `git log`, `git diff`)
- **Communicate with user and coordinate subagents**

The main agent **MUST delegate** to subagents:
- All code file reads, writes, and edits
- Codebase exploration (Glob, Grep)
- Test execution
- Build commands

### Use Existing Research — Don't Re-Read Source Repos

Research for Stage 9-10 has already been gathered in `docs/research/stage-9-10-web-ui/`. **Read those docs instead of exploring the claude-devtools repo directly.** The research docs contain the extracted patterns, code snippets, and architectural decisions.

### Review Every Task — Address ALL Comments

After every implementation task, run **both** reviews:
1. **Spec compliance review** — verify code matches the plan (nothing missing, nothing extra)
2. **Code quality review** — verify code is clean, tested, and follows patterns

**Address ALL review comments, no matter how minor.**

---

## Instructions

Start by reading the design doc (9F section) and the 9F substage plan referenced above (read them with the main agent, not subagents). Then create the full implementation plan using the **writing-plans** skill (main agent writes the plan directly). After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Suggested Implementation Order

1. **Shared types + React Query hooks** — Client-accessible session types, `useSessionDetail()`, `useSessionMetrics()` hooks
2. **Simple chunk components** — UserChunk, SystemChunk, CompactChunk (static rendering, no interactivity)
3. **TextItem + ThinkingItem** — Markdown rendering, collapsible thinking blocks
4. **DefaultRenderer** — Fallback tool renderer (key-value display)
5. **Specialized tool renderers** — Read, Edit, Write, Bash, Glob, Grep, Skill renderers
6. **LinkedToolItem** — Collapsible tool card with summary generation, delegates to renderers
7. **AIChunk** — Renders SemanticSteps using the items built above
8. **ChatHistory** — Virtual scrolling container, auto-scroll logic, chunk rendering
9. **MetricsPill + ContextBadge** — Compact metrics display components
10. **SubagentItem** — Multi-level expandable card (recursive rendering)
11. **SessionContextPanel** — Right sidebar with session summary and context tracking
12. **SessionDetail page/tab** — Top-level composition, wire into drawer system or router
13. **Integration + polish** — Wire session tab into StageDetailContent, update routing, final testing

### Key Constraints

- **Client-side only** — no server-side changes, no new API endpoints
- **ESM imports require `.js` extensions** — even in client code
- **Reuse existing patterns** — Zustand stores, React Query hooks, Tailwind classes, drawer system
- **Virtual scrolling** — Required for sessions with 1000+ chunks
- **Recursive rendering** — SubagentItem must support arbitrary nesting depth
- **No new npm dependencies without justification** — check what's already available first

### Verification

After implementation:

```bash
cd tools/web-server && npm run verify   # lint + all tests pass (248 existing + new 9F tests)
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 894 tests still pass
cd tools/orchestrator && npm run verify  # 437 tests still pass
```
