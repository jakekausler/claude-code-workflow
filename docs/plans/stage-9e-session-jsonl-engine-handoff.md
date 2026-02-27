# Stage 9E: Session JSONL Engine — Session Prompt

## Context

Stages 9A through 9D are complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9E: Session JSONL Engine** — the backend parsing pipeline that transforms raw Claude Code JSONL session files into structured data for the session detail view (9F).

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
                                ├── Stage 9E (Session JSONL Engine) ← THIS STAGE
                                ├── Stage 9F (Session Detail Display) — depends on 9E
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
```

### What Has Been Built (Stages 0-9D)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):
- 12 commands: board, graph, next, validate, validate-pipeline, sync, summary, migrate, jira-import, jira-sync, learnings-count, enrich
- All support `--output/-o`, `--repo`, `--pretty`, and `--global` (where applicable)
- 888 tests across 58 test files

**MCP Server** (`tools/mcp-server/`):
- Jira, PR/MR, Slack, Confluence, enrichment tools
- Mock mode via `KANBAN_MOCK=true`

**Orchestrator** (`tools/orchestrator/`):
- Session spawning, exit gates, completion cascade, MR chain management, cron loops
- 396 tests across 25 test files

**Web Server Foundation** (`tools/web-server/`) — Stage 9A:
- Fastify 5 server on port 3100, Vite 6 dev server on 3101
- `createServer(options)` factory in `src/server/app.ts` (CORS, health endpoint, dev proxy, SPA fallback)
- React 19 SPA with BrowserRouter, layout shell (sidebar + breadcrumb header)
- 3 Zustand stores (board, session, settings) + drawer store, API client (`apiFetch<T>`), React Query hooks
- Tailwind CSS 3.4, vitest 3, TypeScript 5 (strict, NodeNext, ES2022)

**REST API Layer** (`tools/web-server/`) — Stage 9B:
- 17 REST endpoints across 7 route plugin files in `src/server/routes/`
- `DataService` class wrapping kanban-cli database and repositories (`src/server/services/data-service.ts`)
- Board/stats endpoints using `buildBoard()` from kanban-cli with Zod query parameter validation
- Epic, ticket, stage, graph, repo endpoints with full CRUD-read and filtering
- Session listing endpoint scanning `~/.claude/projects/` for JSONL files
- Session detail endpoints returning `501 Not Implemented` (stubs for 9E)
- React Query hooks for all endpoints in `src/client/api/hooks.ts`
- 9 test files, 79 tests covering all endpoints using Fastify `inject()` + seed data helpers

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
- Synthetic Epics column (from `useEpics()`) and Converted tickets column (from `useTickets()`) on board
- Column ordering: Epics → Converted → To Convert → Backlog → Ready for Work → Pipeline columns → Done
- Dynamic pipeline phase display in StageDetailContent (derived from stage status, not hardcoded)
- Selected card highlighting (blue ring) when drawer is open
- Auto-scroll board to keep selected card's column visible beside drawer

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design for Stages 9 and 10 (Section on 9E covers the JSONL engine)
- @docs/plans/stage-9-10-substages/stage-9e-session-jsonl-engine.md — Detailed specification for this substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `deep-dive-jsonl-hooks.md` — JSONL format deep-dive with type definitions (Section 11 has full type specs)
- `deep-dive-session-parsing.md` — Session parsing pipeline from claude-devtools
- `research-claude-devtools.md` — claude-devtools architecture and patterns
- `stage-9-10-research-synthesis.md` — Unified synthesis with recommended patterns

---

## What Stage 9E Delivers

### Goal

Port the claude-devtools parsing pipeline to the web server. This is a **server-side only** stage — 8 services that transform raw JSONL session files into structured data, plus 3 API endpoints to serve that data.

### Services (all in `src/server/services/`)

1. **FileWatcher** — Watch `~/.claude/projects/` for JSONL changes via `fs.watch()` with incremental byte-offset parsing, 100ms debouncing, and 30-second catch-up scans
2. **SessionParser** — Line-by-line JSONL parsing into `ParsedMessage[]` with tool call/result extraction
3. **ChunkBuilder** — Group messages into visualization chunks (UserChunk, AIChunk, SystemChunk, CompactChunk) with semantic step extraction
4. **ToolExecutionBuilder** — Match `tool_use` blocks to `tool_result` blocks via `sourceToolUseID` with duration calculation
5. **SubagentResolver** — Discover subagent JSONL files and link to parent Task tool calls via 3-phase matching (result-based → description-based → positional)
6. **ContextTracker** — Track token attribution across 7 categories (claudeMd, mentionedFiles, toolOutputs, thinkingText, taskCoordination, userMessages) per conversation turn
7. **PricingEngine** — Calculate per-session costs with tiered pricing for different Claude models
8. **DataCache** — LRU cache (50MB default) for parsed session data, invalidated on file changes

### API Endpoints (completing 9B stubs)

- `GET /api/sessions/:projectId/:sessionId` — Full parsed session: chunks, metrics, subagents
- `GET /api/sessions/:projectId/:sessionId/metrics` — SessionMetrics + cost
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Parsed subagent Process

### Type Definitions

Port to `src/server/types/jsonl.ts`:
- Entry types: `UserEntry`, `AssistantEntry`, `SystemEntry`, `SummaryEntry`, `FileHistorySnapshotEntry`, `QueueOperationEntry`
- Content blocks: `TextContent`, `ThinkingContent`, `ToolUseContent`, `ToolResultContent`, `ImageContent`
- Parsed types: `ParsedMessage`, `ToolCall`, `ToolResult`
- Chunk types: `UserChunk`, `AIChunk`, `SystemChunk`, `CompactChunk`, `EnhancedAIChunk`
- Analysis types: `SemanticStep`, `ToolExecution`, `Process`, `SessionMetrics`
- Context types: `ContextStats`, `ContextPhaseInfo`, `TokensByCategory`

### What Stage 9E Does NOT Include

- Session detail UI display (9F) — this stage builds the data pipeline only
- SSE real-time push to client (9G) — FileWatcher will be extended in 9G
- Any client-side React components
- Any modifications to existing kanban-cli or orchestrator packages

---

## Implementation Notes from 9A–9D

These are specific lessons and patterns established during 9A–9D that you MUST follow.

### 1. ESM Module Requirements

This project uses `"type": "module"` in package.json. This means:
- **All local imports must use `.js` extensions** — `import { foo } from './bar.js'`
- **Use `fileURLToPath(import.meta.url)` instead of `__dirname`** — already done in `app.ts`
- **Top-level `await` works** — used in `src/server/index.ts`
- npm package imports do NOT need `.js` extensions

### 2. Server Factory Pattern

The server is built via `createServer(options)` in `src/server/app.ts`. Route plugins are registered via `app.register()`. The `DataService` is decorated onto the Fastify instance as `app.dataService`.

For 9E, you'll need to:
- Create new services in `src/server/services/` following the `DataService` pattern
- Register the FileWatcher as a Fastify lifecycle hook (start on `listen`, stop on `close`)
- The 3 API endpoints should go in the existing `src/server/routes/sessions.ts` route plugin, replacing the current `501` stubs

### 3. Existing Session Route Stubs

`src/server/routes/sessions.ts` already has:
- `GET /api/sessions` — Lists sessions by scanning `~/.claude/projects/` for JSONL files (working)
- `GET /api/sessions/:projectId/:sessionId` — Returns `501 Not Implemented` (stub for 9E)
- `GET /api/sessions/:projectId/:sessionId/metrics` — Not yet stubbed (add in 9E)
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Not yet stubbed (add in 9E)

### 4. Testing

- **Vitest 3** for all tests. Config at `tools/web-server/vitest.config.ts`: `globals: true`, includes `tests/**/*.test.ts`
- **Existing tests are server-side only** (Fastify `inject()` pattern, 9 test files, 79 tests)
- **JSONL fixtures**: Create test fixtures with real-world-representative JSONL data in `tests/fixtures/`. Include edge cases: empty files, malformed lines, compact summaries, subagent files, multi-turn conversations
- Run tests: `npm run test`, lint: `npm run lint`, both: `npm run verify`

### 5. Claude JSONL File Locations

Session files live at `~/.claude/projects/`. The directory structure:
```
~/.claude/projects/
  {projectId}/                    # URL-encoded project path
    {sessionId}.jsonl             # Main session file
    {sessionId}/
      subagents/
        agent-{agentId}.jsonl     # New-style subagent files
    agent-{agentId}.jsonl         # Legacy subagent files
```

The `projectId` is typically a URL-encoded absolute path (e.g., `-storage-programs-claude-code-workflow`). The `sessionId` is a UUID.

### 6. Performance Considerations

- **Incremental parsing is essential** — Session files can grow to 10MB+ during active sessions. The FileWatcher must track byte offsets and only re-parse new content.
- **LRU cache sizing** — 50MB default accommodates ~20-30 parsed sessions in memory. Make configurable via `CACHE_SIZE_MB` env var.
- **Streaming readline** — Use `readline.createInterface()` on `fs.createReadStream()` for memory-efficient line-by-line parsing, not `readFileSync()`.

### 7. Existing Dependencies Available

These are already in `package.json` and can be used:
- `fastify` 5, `@fastify/cors`
- `zod` for validation
- `better-sqlite3` (for kanban data, not session data)
- Node.js built-ins: `fs`, `path`, `readline`, `events`, `crypto`

New dependencies to consider:
- None expected — the JSONL engine should use Node.js built-ins only

---

## Session Workflow Rules

### Main Agent Responsibilities

The main agent (coordinator) **CAN and SHOULD** directly:
- **Read design docs, research docs, and plan files** — these are documentation, not code files. Do NOT delegate reading `docs/plans/`, `docs/research/`, or `CLAUDE.md` to subagents.
- **Write and update the implementation plan** — the 9E plan at `docs/plans/stage-9-10-substages/stage-9e-session-jsonl-engine.md` should be updated by the main agent directly using the writing-plans skill, not by a subagent.
- **Run simple git commands** (`git status`, `git log`, `git diff`)
- **Communicate with user and coordinate subagents**

The main agent **MUST delegate** to subagents:
- All code file reads, writes, and edits
- Codebase exploration (Glob, Grep)
- Test execution
- Build commands

### Use Existing Research — Don't Re-Read Source Repos

Research for Stage 9-10 has already been gathered in `docs/research/stage-9-10-web-ui/`. **Read those docs instead of exploring the claude-devtools repo directly.** The research docs contain the extracted patterns, code snippets, and architectural decisions. Re-reading the source repos wastes context and time.

### Review Every Task — Address ALL Comments

After every implementation task, run **both** reviews:
1. **Spec compliance review** — verify code matches the plan (nothing missing, nothing extra)
2. **Code quality review** — verify code is clean, tested, and follows patterns

**Address ALL review comments, no matter how minor.**

---

## Instructions

Start by reading the design doc (9E section) and the 9E substage plan referenced above (read them with the main agent, not subagents). Then update the 9E plan with the full implementation plan using the **writing-plans** skill (main agent writes the plan directly). After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Implementation Order

Suggested phasing:

1. **Type definitions first** — `src/server/types/jsonl.ts` with all JSONL-related types. This establishes the data contract for all services.
2. **SessionParser** — Core parsing logic. Tests with JSONL fixtures. This is the foundation everything else builds on.
3. **ToolExecutionBuilder** — Depends on ParsedMessage from SessionParser. Pair tool_use with tool_result.
4. **ChunkBuilder** — Depends on ParsedMessage and ToolExecution. Groups messages into visualization chunks.
5. **SubagentResolver** — Depends on SessionParser. Discovers and links subagent files.
6. **ContextTracker + PricingEngine** — Depends on ChunkBuilder output. Can be built in parallel.
7. **DataCache** — LRU cache wrapping the parsing pipeline. Straightforward data structure.
8. **FileWatcher** — File system watcher with incremental parsing integration. Register as Fastify lifecycle hook.
9. **API endpoints** — Replace 501 stubs in sessions.ts. Wire up the full parsing pipeline.

### Key Constraints

- **Server-side only** — no React components, no client-side code changes
- **ESM imports require `.js` extensions** — `import { SessionParser } from './session-parser.js'`
- **Node.js built-ins only** — no new npm dependencies expected
- **Test with real-world fixtures** — create JSONL test fixtures that cover: normal conversations, tool calls, subagents, compact summaries, malformed lines, empty files
- **Incremental parsing** — FileWatcher must track byte offsets, not re-parse entire files
- **Follow existing patterns** — match the style of `DataService`, route plugin registration, Fastify `inject()` tests

### Verification

After implementation:

```bash
cd tools/web-server && npm run verify   # lint + all tests pass (79 existing + new 9E tests)
```

Test the API endpoints manually:
```bash
# List sessions
curl http://localhost:3100/api/sessions

# Get parsed session (should return full structured data instead of 501)
curl http://localhost:3100/api/sessions/{projectId}/{sessionId}

# Get session metrics
curl http://localhost:3100/api/sessions/{projectId}/{sessionId}/metrics

# Get subagent data
curl http://localhost:3100/api/sessions/{projectId}/{sessionId}/subagents/{agentId}
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 888 tests still pass
cd tools/orchestrator && npm run verify  # 396 tests still pass
```
