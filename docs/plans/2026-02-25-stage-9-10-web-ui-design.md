# Stage 9-10 Design: Web UI & Session Monitor Integration

**Date**: 2026-02-25
**Status**: Approved
**Branch**: feat/stage-9-web-view

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Directory Structure](#4-directory-structure)
5. [Substage Breakdown](#5-substage-breakdown)
6. [Stage 9A: Web Server Foundation](#6-stage-9a-web-server-foundation)
7. [Stage 9B: REST API Layer](#7-stage-9b-rest-api-layer)
8. [Stage 9C: Dashboard + Board Views](#8-stage-9c-dashboard--board-views)
9. [Stage 9D: Detail Views](#9-stage-9d-detail-views)
10. [Stage 9E: Session JSONL Engine](#10-stage-9e-session-jsonl-engine)
11. [Stage 9F: Session Detail Display](#11-stage-9f-session-detail-display)
12. [Stage 9G: Real-Time Updates](#12-stage-9g-real-time-updates)
13. [Stage 10A: Orchestrator Communication](#13-stage-10a-orchestrator-communication)
14. [Stage 10B: Bidirectional Interaction](#14-stage-10b-bidirectional-interaction)
15. [Stage 10C: Live Session Status](#15-stage-10c-live-session-status)
16. [Stage 10D: Deployment Abstraction](#16-stage-10d-deployment-abstraction)
17. [Key Design Decisions](#17-key-design-decisions)
18. [Research References](#18-research-references)

---

## 1. Overview

Stage 9 adds a web UI for the kanban workflow system. Stage 10 adds live session monitoring with bidirectional interaction and multi-user deployment planning.

### What we're building

**Stage 9 (Web UI):** A read-only web view with:
- Dashboard home page with stats and activity feed
- Epic board, ticket board, and stage pipeline board views
- Detail pages for epics, tickets, and stages
- Full claude-devtools-quality session viewer (JSONL parsing, chunking, tool renderers, subagent trees, context tracking, cost calculation)
- Real-time SSE updates

**Stage 10 (Session Monitor Integration):** Live interaction with:
- Bidirectional communication with running Claude Code sessions
- Tool approval/denial, question answering, follow-up messages from browser
- Live session status on kanban cards
- Deployment abstraction interfaces for future multi-user support

### Hybrid data architecture

Two complementary data paths serve different needs:

**Path 1 — Display (claude-devtools style):** Watch JSONL files at `~/.claude/projects/` for rich session history. Parse into chunks, tool executions, subagent trees. Powers the session detail view.

**Path 2 — Interaction (vibe-kanban style):** The orchestrator spawns Claude Code with `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio`. The web server relays user input to the orchestrator, which sends it to Claude's stdin. Claude writes JSONL as it works, which Path 1 picks up for display.

JSONL watching for reading. stdin/stdout protocol for writing.

---

## 2. Architecture

```
+-----------------------------------------------------------+
|                    Browser (React SPA)                     |
|  +----------+  +--------------+  +---------------------+  |
|  |  Kanban   |  |  Detail      |  |  Session Detail     |  |
|  |  Boards   |  |  Views       |  |  (devtools-quality) |  |
|  +-----+----+  +------+-------+  +----------+----------+  |
|        |               |                     |             |
|        +-------Zustand Store + React Query---+             |
|                        |                                   |
|               SSE (EventSource) + REST (fetch)             |
+------------------------+-----------------------------------+
                         |
+------------------------+-----------------------------------+
|            tools/web-server/ (Fastify)                     |
|                        |                                   |
|  +---------------------+---------------------+             |
|  | REST API            | SSE /api/events     |             |
|  | /api/board          | (file changes,      |             |
|  | /api/epics/:id      |  session updates,   |             |
|  | /api/sessions/:id   |  stage transitions) |             |
|  +---------+-----------+---------+-----------+             |
|            |                     |                         |
|  +---------+-------+  +---------+---------+                |
|  |  kanban-cli     |  |  FileWatcher +    |                |
|  |  (direct        |  |  SessionParser   |                |
|  |   imports)      |  |  (JSONL parsing) |                |
|  +-----------------+  +------------------+                 |
|                                                            |
|  SQLite DB (kanban.db)  +  ~/.claude/projects/ (JSONL)     |
+------------------------------------------------------------+

Stage 10 additions:
+------------------------------------------------------------+
|  + WebSocket to orchestrator for session interaction        |
|  + ProtocolPeer for stdin/stdout relay                      |
|  + DeploymentContext abstraction (local/hosted)             |
|  + Auth middleware (no-op local, OAuth hosted)              |
+------------------------------------------------------------+
```

---

## 3. Tech Stack

| Layer | Technology | Reference Repo |
|-------|-----------|----------------|
| Frontend framework | React 19 + TypeScript | claude-code-monitor, claude-devtools |
| Build tool | Vite 5.x | Both repos |
| State management | Zustand 5.x | Both repos |
| Server state | @tanstack/react-query | Standard |
| Styling | Tailwind CSS 3.x | Both repos |
| Icons | lucide-react | claude-devtools |
| Markdown rendering | react-markdown + remark-gfm | claude-devtools |
| Syntax highlighting | Shiki | claude-code-monitor |
| Virtual scrolling | @tanstack/react-virtual | claude-devtools |
| Routing | React Router (or @tanstack/react-router) | — |
| HTTP server | Fastify 5.x + @fastify/cors + @fastify/static | claude-devtools |
| SSE | Custom Fastify handler | claude-devtools |
| WebSocket (Stage 10) | ws | claude-code-monitor |
| Validation | Zod | Existing codebase |
| Testing | Vitest | Existing codebase |

---

## 4. Directory Structure

```
tools/web-server/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    server/                           # Fastify backend
      index.ts                        # Server entry point
      routes/
        board.ts                      # /api/board, /api/stats
        epics.ts                      # /api/epics
        tickets.ts                    # /api/tickets
        stages.ts                     # /api/stages
        sessions.ts                   # /api/sessions (JSONL-based)
        graph.ts                      # /api/graph
        events.ts                     # SSE /api/events
      services/
        file-watcher.ts               # JSONL file monitoring
        session-parser.ts             # JSONL -> ParsedMessage[]
        chunk-builder.ts              # ParsedMessage[] -> Chunk[]
        tool-execution-builder.ts     # tool_use <-> tool_result linking
        subagent-resolver.ts          # Subagent file discovery + linking
        context-tracker.ts            # 7-category context tracking
        pricing.ts                    # Cost calculation
        data-cache.ts                 # LRU cache
      middleware/
        auth.ts                       # No-op local, OAuth hosted (10D)
      types/
        jsonl.ts                      # JSONL entry types
        chunks.ts                     # Chunk types
        sessions.ts                   # Session/process types
        api.ts                        # API request/response types

    client/                           # React SPA
      main.tsx
      App.tsx                         # Router + layout
      store/
        board-store.ts
        session-store.ts
        settings-store.ts
      api/
        client.ts                     # Fetch + SSE wrapper
        hooks.ts                      # React Query hooks
      pages/
        Dashboard.tsx
        EpicBoard.tsx
        TicketBoard.tsx
        StageBoard.tsx
        EpicDetail.tsx
        TicketDetail.tsx
        StageDetail.tsx
        SessionDetail.tsx
      components/
        board/
          BoardColumn.tsx
          BoardCard.tsx
          BoardHeader.tsx
        chat/
          ChatHistory.tsx
          UserChunk.tsx
          AIChunk.tsx
          items/
            LinkedToolItem.tsx
            SubagentItem.tsx
            ThinkingItem.tsx
            TextItem.tsx
          context/
            ContextBadge.tsx
            ContextPanel.tsx
        tools/
          ReadRenderer.tsx
          EditRenderer.tsx
          WriteRenderer.tsx
          BashRenderer.tsx
          GlobRenderer.tsx
          GrepRenderer.tsx
          TaskRenderer.tsx
          SkillRenderer.tsx
          DefaultRenderer.tsx
        graph/
          DependencyGraph.tsx
        layout/
          Sidebar.tsx
          Breadcrumbs.tsx
          Header.tsx
      utils/
        formatters.ts
        tool-summaries.ts
```

---

## 5. Substage Breakdown

### Stage 9: Web UI (7 substages)

| Substage | Name | Goal |
|----------|------|------|
| 9A | Web Server Foundation | Fastify + Vite React scaffold, dev tooling, layout shell |
| 9B | REST API Layer | All endpoints consuming kanban-cli internals |
| 9C | Dashboard + Board Views | Dashboard home, epic/ticket/stage boards |
| 9D | Detail Views | Epic/ticket/stage detail pages, dependency graph |
| 9E | Session JSONL Engine | FileWatcher, SessionParser, ChunkBuilder, SubagentResolver |
| 9F | Session Detail Display | Chat history UI, tool renderers, subagent trees, context tracking |
| 9G | Real-Time Updates | SSE endpoint, live board/session updates |

### Stage 10: Session Monitor Integration (4 substages)

| Substage | Name | Goal |
|----------|------|------|
| 10A | Orchestrator Communication | WebSocket between web server and orchestrator |
| 10B | Bidirectional Interaction | stdin/stdout relay, approvals, question answering |
| 10C | Live Session Status | Real-time status on kanban cards |
| 10D | Deployment Abstraction | Interfaces for local/hosted, local implementations |

### Dependency Graph

```
9A -> 9B -> 9C -> 9D
              \
9A -> 9E -> 9F
              \
         9G (depends on 9B + 9E)

10A -> 10B -> 10C
10D (independent, can parallel with 10A-10C)
```

---

## 6. Stage 9A: Web Server Foundation

**Goal:** Fastify server + Vite React SPA scaffold with all tooling working.

**What ships:**
1. `tools/web-server/package.json` with all dependencies
2. Fastify server entry that serves static Vite-built assets (production) or proxies to Vite dev server (development)
3. Binds to `localhost:3100` (configurable via `PORT` env var)
4. CORS configured for local development
5. Vite config with React plugin, path aliases (`@server/`, `@client/`)
6. React SPA with router, placeholder routes, Zustand store boilerplate, Tailwind CSS, layout shell (sidebar + main content area)
7. Dev scripts: `npm run dev` (concurrent Fastify + Vite), `npm run build`, `npm run start`
8. `/api/health` endpoint

**Does NOT include:** Real API endpoints, session parsing, or board rendering.

**Key reference:** claude-devtools standalone server (`src/main/standalone.ts`), HttpServer.ts for Fastify + CORS + static serving.

---

## 7. Stage 9B: REST API Layer

**Goal:** All REST endpoints consuming kanban-cli internals.

**Endpoints:**

| Method | Path | Description | Source |
|--------|------|-------------|--------|
| GET | `/api/board` | Full kanban board JSON | kanban-cli `board` internals |
| GET | `/api/board?epic=EPIC-001` | Filtered by epic | kanban-cli with filter |
| GET | `/api/board?ticket=TICKET-001-001` | Filtered by ticket | kanban-cli with filter |
| GET | `/api/stats` | Pipeline statistics | kanban-cli board stats |
| GET | `/api/epics` | List all epics | SQLite via kanban-cli repos |
| GET | `/api/epics/:id` | Epic detail with tickets | SQLite + file parsing |
| GET | `/api/tickets` | List tickets (filterable) | SQLite query |
| GET | `/api/tickets/:id` | Ticket detail with stages | SQLite + file parsing |
| GET | `/api/stages` | List stages (filterable) | SQLite query |
| GET | `/api/stages/:id` | Stage detail with phases | SQLite + stage file parsing |
| GET | `/api/graph` | Dependency graph JSON | kanban-cli `graph` internals |
| GET | `/api/graph?mermaid=true` | Mermaid format | kanban-cli graph --mermaid |
| GET | `/api/sessions/:projectId` | List sessions for project | Scan ~/.claude/projects/ |
| GET | `/api/sessions/:projectId/:sessionId` | Full parsed session | SessionParser + ChunkBuilder |
| GET | `/api/sessions/:projectId/:sessionId/metrics` | Session metrics | Parsed from JSONL |
| GET | `/api/sessions/:projectId/:sessionId/subagents/:agentId` | Subagent detail | SubagentResolver |

**Implementation:** Import kanban-cli repository classes directly. Share SQLite database. Session endpoints built in 9E.

---

## 8. Stage 9C: Dashboard + Board Views

**Goal:** Dashboard home and three board views.

### Dashboard (`/`)
- Pipeline summary stats: stages by column, completion %
- Active sessions indicator
- Recent activity feed: last 20 stage transitions
- Blocked items alert
- Quick-link cards to boards

### Epic Board (`/epics`)
- Columns: Not Started, In Progress, Complete
- Cards: epic ID, title, ticket count, completion % bar
- Click card -> ticket board

### Ticket Board (`/epics/:epicId/tickets`)
- Breadcrumb navigation
- Columns: Not Started, In Progress, Complete
- Cards: ticket ID, title, stage count, Jira key badge
- "To Convert" section for tickets with `stages: []`
- Click card -> stage pipeline board

### Stage Pipeline Board (`/epics/:epicId/tickets/:ticketId/stages`)
- Breadcrumb navigation
- Columns from pipeline config (Backlog, Ready for Work, Design, Build, etc.)
- Cards: stage ID, title, refinement type badge, session_active indicator
- Click card -> stage detail

All boards are read-only (no drag-and-drop). Card component is shared across levels.

**Key reference:** vibe-kanban KanbanBoard.tsx for CSS Grid layout pattern.

---

## 9. Stage 9D: Detail Views

**Goal:** Detail pages for each hierarchy level.

### Epic Detail (`/epics/:epicId`)
- Header: ID, title, status badge, Jira key
- Ticket list table
- Dependencies section
- Markdown content from epic file

### Ticket Detail (`/tickets/:ticketId`)
- Header: ID, title, status, epic breadcrumb, Jira key, source badge
- Stage list with pipeline phases
- Dependencies, regression file, changelog
- Markdown content

### Stage Detail (`/stages/:stageId`)
- Header: ID, title, status, breadcrumbs, refinement type badges
- Phase sections (Design/Build/Refinement/Finalize) with checklists
- Session link to view active/latest session
- PR URL, dependencies, worktree branch info

### Dependency Graph (`/graph`)
- Interactive visualization from `graph` command output
- Nodes colored by type, edges by resolution status
- Critical path highlighted, cycle warnings
- Filter by epic/ticket

---

## 10. Stage 9E: Session JSONL Engine

**Goal:** Port claude-devtools parsing pipeline to our server.

### Services to build

All ported from claude-devtools patterns with reference files:

1. **FileWatcher** — Watch `~/.claude/projects/` with `fs.watch()`, 100ms debouncing, 30s catch-up scan, incremental append parsing via byte offsets.
   - Ref: `claude-devtools/src/main/services/infrastructure/FileWatcher.ts`

2. **SessionParser** — Line-by-line JSONL streaming, extract tool calls/results/metadata, filter progress entries.
   - Ref: `claude-devtools/src/main/services/parsing/SessionParser.ts`

3. **ChunkBuilder** — 4-category classification (user/system/hardNoise/ai), produce UserChunk/AIChunk/SystemChunk/CompactChunk, SemanticStep extraction.
   - Ref: `claude-devtools/src/main/services/analysis/ChunkBuilder.ts`

4. **ToolExecutionBuilder** — Two-pass tool_use/tool_result linking via sourceToolUseID, duration calculation, orphan detection.
   - Ref: `claude-devtools/src/main/services/analysis/ToolExecutionBuilder.ts`

5. **SubagentResolver** — Scan new + legacy directory structures, 3-phase linking (result-based, description-based, positional), parallel detection, filter warmup/compact/empty.
   - Ref: `claude-devtools/src/main/services/discovery/SubagentResolver.ts`

6. **ContextTracker** — 7 categories (CLAUDE.md, @-mentions, tool outputs, thinking/text, task coordination, user messages), compaction-aware phase tracking.
   - Ref: `claude-devtools/src/renderer/utils/contextTracker.ts`

7. **PricingEngine** — Tiered pricing above/below 200K tokens, LiteLLM data.
   - Ref: claude-devtools pricing module

8. **DataCache** — Size-bounded LRU, invalidated on FileWatcher changes.
   - Ref: `claude-devtools/src/main/services/infrastructure/DataCache.ts`

### Type definitions

Port complete JSONL types from research: `docs/research/stage-9-10-web-ui/deep-dive-jsonl-hooks.md` Section 11.

---

## 11. Stage 9F: Session Detail Display

**Goal:** Full claude-devtools-quality session viewer.

### ChatHistory component
- Virtual scrolling via `@tanstack/react-virtual` (threshold: >120 items)
- Auto-scroll when near bottom, preserve position when scrolled up
- UserChunks right-aligned, AIChunks left-aligned
- Expandable/collapsible chunks

### Tool renderers

| Tool | Display |
|------|---------|
| Read | File path, syntax-highlighted content, line numbers |
| Edit | Diff view (old -> new) with green/red highlighting |
| Write | File path, syntax-highlighted content, markdown preview toggle |
| Bash | Command, stdout (green), stderr (red), exit code, duration |
| Glob | Pattern, matched files list, count |
| Grep | Pattern, files with context, count |
| Task | SubagentItem (expandable, see below) |
| Skill | Skill name, instructions viewer, result text |
| Default | Key-value input display, raw output |

Ref: claude-devtools `src/renderer/components/chat/items/LinkedToolItem.tsx`, claude-code-monitor `packages/dashboard/src/toolRenderers/`

### SubagentItem
- Level 1 header: icon, type badge, model, description, status, MetricsPill, duration
- Level 1 expanded: meta info, context usage breakdown
- Level 2 (execution trace): nested tool calls, thinking, output, recursive subagents
- Color coding by type

Ref: claude-devtools `src/renderer/components/chat/items/SubagentItem.tsx`

### Context tracking UI
- ContextBadge: "Context +N" per turn with hover popover (7-category breakdown)
- SessionContextPanel: cumulative tracking with compaction visualization
- MetricsPill: `[main impact | subagent context]` with tooltip

Ref: claude-devtools `src/renderer/components/chat/ContextBadge.tsx`, `SessionContextPanel/`

---

## 12. Stage 9G: Real-Time Updates

**Goal:** SSE for live updates across all views.

### SSE endpoint (`GET /api/events`)
- Ported from claude-devtools pattern (Fastify + `Set<FastifyReply>`)
- Named events: `board-update`, `session-update`, `stage-transition`
- 30-second keepalive pings
- Client cleanup on disconnect

Ref: claude-devtools `src/main/http/events.ts`

### Triggers
- FileWatcher JSONL change -> `session-update`
- Stage status change (kanban-cli sync) -> `board-update`
- Stage frontmatter change -> `stage-transition`

### Client-side
- `useSSE()` hook wrapping EventSource with auto-reconnect
- Board pages re-fetch on `board-update`
- Session detail re-fetches on `session-update`
- Dashboard activity feed appends on `stage-transition`

---

## 13. Stage 10A: Orchestrator Communication

**Goal:** WebSocket channel between web server and orchestrator.

### Orchestrator changes
- Add lightweight WebSocket server (port 3101, configurable)
- Expose session process registry: maps stageId -> { processId, sessionId, status, worktreePath }

### Protocol messages
- `session_registered`: new session spawned (stageId, sessionId, worktreePath)
- `session_ended`: session completed/crashed (stageId, sessionId, exitReason)
- `session_status`: status change (stageId, waiting/active, waitingType)

### Web server
- Connects to orchestrator WebSocket on startup
- Maintains local session registry mirror
- Exposes session state via REST and SSE

---

## 14. Stage 10B: Bidirectional Interaction

**Goal:** Send messages, approve tools, answer questions from browser.

### Orchestrator modifications
- Spawn Claude with `--input-format=stream-json --output-format=stream-json --permission-prompt-tool=stdio`
- Implement ProtocolPeer (TypeScript port of vibe-kanban's `protocol.rs`)
- Hold stdin pipe reference per session

Ref: vibe-kanban `crates/executors/src/executors/claude/protocol.rs`, `types.rs`, `client.rs`

### Web server endpoints
- `POST /api/sessions/:stageId/message` — send follow-up message
- `POST /api/sessions/:stageId/approve` — approve/deny tool call
- `POST /api/sessions/:stageId/answer` — answer AskUserQuestion

### Approval service
- Queue pending approvals, wait for web UI response
- Timeout handling for unresponded approvals

### Message queue
- Buffer follow-up messages when Claude is busy
- Consume on session completion (via `--resume`)

Ref: vibe-kanban `crates/services/src/services/queued_message.rs`, `packages/web-core/src/shared/hooks/useApprovals.ts`

### Browser UI
- Message input box in session detail view
- Approval dialog (approve/deny with reason)
- Question answer form (renders AskUserQuestion options)

---

## 15. Stage 10C: Live Session Status

**Goal:** Real-time indicators on kanban cards.

### Status indicators on stage cards
- Green pulse: active (Claude is working)
- Yellow: waiting for user input
- Blue: waiting for permission approval
- Gray: ended/idle

### Session -> stage mapping
- Orchestrator communicates worktree path on session spawn
- worktree_branch in stage frontmatter maps to session

### Update flow
- Orchestrator WebSocket -> web server -> SSE -> browser
- Stage cards re-render status indicator on `session_status` events

---

## 16. Stage 10D: Deployment Abstraction

**Goal:** Interfaces for local/hosted deployment. Local implementations only.

### Interfaces

```typescript
interface DeploymentContext {
  getUserId(): string;
  getSessionStore(): SessionStore;
  getFileAccess(): FileSystemProvider;
  getEventBroadcaster(): EventBroadcaster;
}

interface FileSystemProvider {
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  exists(path: string): Promise<boolean>;
  createReadStream(path: string, opts?: StreamOptions): ReadStream;
}

interface AuthProvider {
  getAuthenticatedUser(request: FastifyRequest): Promise<User | null>;
  requireAuth(): FastifyMiddleware;
}

interface EventBroadcaster {
  broadcast(event: string, data: unknown, scope?: { userId?: string }): void;
  addClient(client: FastifyReply, scope?: { userId?: string }): void;
}
```

### Local implementations
- `LocalDeployment`: userId = 'local-user', direct filesystem, broadcast to all
- `NoopAuthProvider`: always returns null, middleware is pass-through
- `BroadcastSSE`: sends to all connected clients

### Hosted design (documented, not built)
- OAuth (GitHub) + JWT (short access token, long refresh token)
- PostgreSQL for users, auth_sessions, session index
- Per-user SSE channels
- User -> OS username mapping for file access scoping
- Docker compose with Postgres + reverse proxy

Ref: vibe-kanban `crates/deployment/src/lib.rs`, `crates/remote/src/auth/`, `docs/research/stage-9-10-web-ui/deep-dive-multi-user-deployment.md`

---

## 17. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend framework | Fastify | Production-grade, used by claude-devtools, built-in validation |
| Data capture for display | JSONL file watching | Richer than hooks, no hook installation needed, claude-devtools pattern |
| Data capture for interaction | stdin/stdout stream-JSON | Only way to send input to Claude programmatically, vibe-kanban proven |
| Virtual scrolling | @tanstack/react-virtual | Flexible, conditional virtualization support |
| Real-time transport (Stage 9) | SSE | Built-in reconnect, sufficient for one-way push |
| Real-time transport (Stage 10) | WebSocket | Needed for bidirectional session interaction |
| Board interactivity | Read-only | No drag-and-drop; potential manual transitions later |
| Session detail depth | Full claude-devtools parity | 7-category context tracking, cost calc, compaction, all tool renderers |
| Multi-user | Design interface, build local only | Follow vibe-kanban's trait pattern, defer hosted implementation |
| Approach to existing repos | Port patterns directly | claude-devtools and vibe-kanban are best-in-class; take what works |

---

## 18. Research References

All research files are in `docs/research/stage-9-10-web-ui/`:

| File | Content |
|------|---------|
| `research-vibe-kanban.md` | First-pass: tech stack, architecture, kanban board, data model, real-time, auth |
| `research-claude-code-monitor.md` | First-pass: hook system, WebSocket protocol, tool renderers, subagent tracking |
| `research-claude-devtools.md` | First-pass: JSONL parsing, chunk building, full detail display, deployment |
| `deep-dive-session-display.md` | How all three repos display sessions in browser (data sources, transport, rendering) |
| `deep-dive-user-interaction.md` | How to interact with Claude sessions (stdin/stdout protocol, approval flows) |
| `deep-dive-full-detail-display.md` | Complete tool/subagent/context display architecture from claude-devtools |
| `deep-dive-multi-user-deployment.md` | Auth, multi-tenancy, deployment patterns from all three repos |
| `deep-dive-jsonl-hooks.md` | Definitive JSONL format reference + Claude Code hook system |
| `deep-dive-realtime-patterns.md` | WebSocket vs SSE patterns, reconnection, caching, backpressure |
| `stage-9-10-research-synthesis.md` | Unified synthesis with recommendations |

### Key source file references

**vibe-kanban** (`/home/jakekausler/dev/localenv/vibe-kanban`):
- Kanban board: `packages/ui/src/components/KanbanBoard.tsx`
- Protocol peer: `crates/executors/src/executors/claude/protocol.rs`
- Protocol types: `crates/executors/src/executors/claude/types.rs`
- Approval handling: `crates/executors/src/executors/claude/client.rs`
- Session follow-up: `crates/server/src/routes/sessions/mod.rs`
- Deployment trait: `crates/deployment/src/lib.rs`
- Auth: `crates/remote/src/auth/`
- Terminal WebSocket: `crates/server/src/routes/terminal.rs`
- MsgStore: `crates/utils/src/msg_store.rs`

**claude-devtools** (`/home/jakekausler/dev/localenv/claude-devtools`):
- FileWatcher: `src/main/services/infrastructure/FileWatcher.ts`
- SessionParser: `src/main/services/parsing/SessionParser.ts`
- ChunkBuilder: `src/main/services/analysis/ChunkBuilder.ts`
- ToolExecutionBuilder: `src/main/services/analysis/ToolExecutionBuilder.ts`
- SubagentResolver: `src/main/services/discovery/SubagentResolver.ts`
- ContextTracker: `src/renderer/utils/contextTracker.ts`
- ChatHistory: `src/renderer/components/chat/ChatHistory.tsx`
- LinkedToolItem: `src/renderer/components/chat/items/LinkedToolItem.tsx`
- SubagentItem: `src/renderer/components/chat/items/SubagentItem.tsx`
- SSE server: `src/main/http/events.ts`
- HTTP client adapter: `src/renderer/api/httpClient.ts`
- Standalone entry: `src/main/standalone.ts`

**claude-code-monitor** (`/home/jakekausler/dev/localenv/claude-code-monitor`):
- Hook installation: `packages/cli/src/install.ts`
- Hook script: `packages/cli/templates/session-monitor.sh`
- WebSocket coordinator: `packages/server/src/primary/unified-websocket-coordinator.ts`
- Dashboard hub: `packages/server/src/primary/dashboard-hub.ts`
- Entity transformer: `packages/dashboard/src/utils/entityTransformer.ts`
- Tool renderers: `packages/dashboard/src/toolRenderers/renderers/`
- Activity timeline: `packages/dashboard/src/components/ActivityTimeline.tsx`
- LRU cache: `packages/server/src/primary/lru-cache.ts`
