# Stage 9A: Web Server Foundation — Session Prompt

## Context

Stages 0-8 are complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9A: Web Server Foundation** — the Fastify + Vite React scaffold that all subsequent Stage 9/10 substages build on.

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
                                ├── Stage 9A (Web Server Foundation) ← THIS STAGE
                                ├── Stage 9B (REST API Layer) — depends on 9A
                                ├── Stage 9C (Dashboard + Board Views) — depends on 9A, 9B
                                ├── Stage 9D (Detail Views) — depends on 9A, 9B, 9C
                                ├── Stage 9E (Session JSONL Engine) — depends on 9A
                                ├── Stage 9F (Session Detail Display) — depends on 9A, 9E
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
```

### What Has Been Built (Stages 0-8)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):
- 12 commands: board, graph, next, validate, validate-pipeline, sync, summary, migrate, jira-import, jira-sync, learnings-count, enrich
- All support `--output/-o`, `--repo`, `--pretty`, and `--global` (where applicable)
- 888 tests across 58 test files

**MCP Server** (`tools/mcp-server/`):
- Jira, PR/MR, Slack, Confluence, enrichment tools
- Mock mode via `KANBAN_MOCK=true`

**Orchestrator** (`tools/orchestrator/`):
- Session spawning, exit gates, completion cascade, MR chain management, cron loops
- ~396 tests across 25 test files

**No web UI code exists yet.** Stage 9A creates it from scratch.

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design for Stages 9 and 10 (architecture, tech stack, directory structure, all 11 substages)
- @docs/plans/stage-9-10-substages/stage-9a-web-server-foundation.md — Detailed implementation plan for this specific substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `research-vibe-kanban.md` — Tech stack, architecture, kanban board, auth patterns
- `research-claude-code-monitor.md` — Hook system, WebSocket protocol, tool renderers
- `research-claude-devtools.md` — JSONL parsing, session display, deployment
- `deep-dive-session-display.md` — How all three repos display sessions in browser
- `deep-dive-realtime-patterns.md` — WebSocket vs SSE patterns
- `stage-9-10-research-synthesis.md` — Unified synthesis

### Key Source References (existing repos to model after)

- **claude-devtools standalone server**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/standalone.ts` — Fastify server entry point without Electron, CORS, static serving
- **claude-devtools HttpServer**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/HttpServer.ts` — Fastify setup with CORS, routes, SSE
- **claude-devtools vite config**: `/home/jakekausler/dev/localenv/claude-devtools/vite.standalone.config.ts` — Vite build config for standalone mode
- **claude-devtools package.json**: `/home/jakekausler/dev/localenv/claude-devtools/package.json` — Dependencies and versions

---

## What Stage 9A Delivers

### Goal

A working Fastify server + Vite React SPA scaffold. Navigating to `http://localhost:3100` shows the React app with sidebar navigation and placeholder pages. `/api/health` returns JSON.

### What Ships

1. **`tools/web-server/package.json`** with all dependencies:
   - Server: fastify, @fastify/cors, @fastify/static
   - Client: react, react-dom, react-router-dom (or @tanstack/react-router), zustand, @tanstack/react-query, tailwindcss, lucide-react, react-markdown, remark-gfm, shiki, @tanstack/react-virtual
   - Build: vite, @vitejs/plugin-react, typescript
   - Dev: vitest, tsx, concurrently

2. **Fastify server entry** (`src/server/index.ts`):
   - Binds to `localhost:3100` (configurable via `PORT` env var)
   - In production: serves Vite-built static assets from `dist/client/`
   - In development: proxies non-API requests to Vite dev server (port 3101)
   - CORS configured for local development
   - `/api/health` endpoint returning `{ status: 'ok', timestamp: ISO }`

3. **Vite configuration** (`vite.config.ts`):
   - React plugin
   - Path aliases: `@client/` → `src/client/`, `@server/` → `src/server/`
   - Dev server port: 3101
   - Build output: `dist/client/`

4. **React SPA scaffold** with:
   - Router with placeholder routes:
     - `/` — Dashboard
     - `/epics` — Epic Board
     - `/epics/:epicId/tickets` — Ticket Board
     - `/epics/:epicId/tickets/:ticketId/stages` — Stage Pipeline Board
     - `/epics/:epicId` — Epic Detail
     - `/tickets/:ticketId` — Ticket Detail
     - `/stages/:stageId` — Stage Detail
     - `/sessions/:projectId/:sessionId` — Session Detail
     - `/graph` — Dependency Graph
   - Layout shell: sidebar (fixed left ~250px, navigation links) + header (breadcrumb area) + main content (router outlet)
   - Zustand store boilerplate (empty slices: board-store, session-store, settings-store)
   - Tailwind CSS configured
   - React Query provider wrapping the app

5. **Dev scripts**:
   - `npm run dev` — concurrent Fastify + Vite dev server
   - `npm run build` — Vite build + TypeScript compile server
   - `npm run start` — run production server
   - `npm run test` — vitest

6. **TypeScript configuration**:
   - `tsconfig.json` for the full project
   - Separate `tsconfig.server.json` for server-only compilation (exclude client)
   - Path aliases matching Vite config

### What Stage 9A Does NOT Include

- Real API endpoints consuming kanban-cli data (9B)
- Board rendering or card components (9C)
- Detail page content (9D)
- Session JSONL parsing (9E)
- Session display components (9F)
- SSE real-time updates (9G)
- Any connection to the orchestrator (10A)

---

## Instructions

Start by reading the design doc and the 9A implementation plan referenced above. Then fill in the full implementation plan using the **writing-plans** skill. After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Key Constraints

- Follow the existing DI pattern used throughout `tools/kanban-cli/` and `tools/orchestrator/`
- Match the existing TypeScript/Vitest/Zod conventions
- The web server lives at `tools/web-server/` alongside the existing tools
- Port patterns directly from claude-devtools and vibe-kanban rather than inventing new approaches — these repos are best-in-class
- All placeholder pages should render a heading with the page name and any route params, so navigation can be visually verified
- The sidebar should have working navigation links to all routes
- `npm run dev` must work end-to-end: start server, start Vite, navigate in browser

### Verification

After implementation:

```bash
cd tools/web-server && npm run dev
# Navigate to http://localhost:3100
# Verify: SPA loads, sidebar shows, all routes render placeholder content
# Verify: GET http://localhost:3100/api/health returns JSON

cd tools/web-server && npm run build && npm run start
# Verify: Production build serves the SPA correctly
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 888 tests still pass
cd tools/orchestrator && npm run verify  # ~396 tests still pass
```
