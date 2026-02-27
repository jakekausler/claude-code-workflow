# Stage 9B: REST API Layer — Session Prompt

## Context

Stage 9A is complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9B: REST API Layer** — all REST endpoints consuming kanban-cli internals, serving JSON to the frontend.

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
                                ├── Stage 9B (REST API Layer) ← THIS STAGE
                                ├── Stage 9C (Dashboard + Board Views) — depends on 9B
                                ├── Stage 9D (Detail Views) — depends on 9B, 9C
                                ├── Stage 9E (Session JSONL Engine) — depends on 9A
                                ├── Stage 9F (Session Detail Display) — depends on 9E
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
```

### What Has Been Built (Stages 0-9A)

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

**Web Server Foundation** (`tools/web-server/`) — Stage 9A:
- Fastify 5 server on port 3100, Vite 6 dev server on 3101
- `createServer(options)` factory in `src/server/app.ts` (CORS, health endpoint, dev proxy, SPA fallback)
- React 19 SPA with BrowserRouter, 9 routes, layout shell (sidebar + breadcrumb header)
- 9 placeholder pages with route param display
- 3 Zustand stores (board, session, settings), API client (`apiFetch<T>`), React Query health hook
- Tailwind CSS 3.4, vitest 3, TypeScript 5 (strict, NodeNext, ES2022)
- 2 server tests

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-16-kanban-workflow-redesign-design.md — Overall design for the kanban workflow
- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design for Stages 9 and 10 (Section 7 covers 9B specifically)
- @docs/plans/stage-9-10-substages/stage-9b-rest-api-layer.md — Detailed specification for this substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `research-claude-devtools.md` — JSONL parsing, session display patterns
- `stage-9-10-research-synthesis.md` — Unified synthesis with recommended patterns

---

## What Stage 9B Delivers

### Goal

All REST endpoints consuming kanban-cli internals, serving JSON to the React frontend. 16 endpoints total, though session detail endpoints (4 of them) are placeholder stubs until Stage 9E builds the JSONL parsing engine.

### Endpoints

| Method | Path | Description | Source |
|--------|------|-------------|--------|
| GET | `/api/board` | Full kanban board JSON | kanban-cli board internals |
| GET | `/api/board?epic=EPIC-001` | Filtered by epic | kanban-cli with filter |
| GET | `/api/board?ticket=TICKET-001-001` | Filtered by ticket | kanban-cli with filter |
| GET | `/api/stats` | Pipeline statistics | kanban-cli board stats |
| GET | `/api/epics` | List all epics | SQLite via kanban-cli repos |
| GET | `/api/epics/:id` | Epic detail with tickets | SQLite + file parsing |
| GET | `/api/tickets` | List tickets (filterable) | SQLite query |
| GET | `/api/tickets/:id` | Ticket detail with stages | SQLite + file parsing |
| GET | `/api/stages` | List stages (filterable) | SQLite query |
| GET | `/api/stages/:id` | Stage detail with phases | SQLite + stage file parsing |
| GET | `/api/graph` | Dependency graph JSON | kanban-cli graph internals |
| GET | `/api/graph?mermaid=true` | Mermaid format | kanban-cli graph --mermaid |
| GET | `/api/sessions/:projectId` | List sessions for project | Scan ~/.claude/projects/ |
| GET | `/api/sessions/:projectId/:sessionId` | Full parsed session | **Stub** (9E) |
| GET | `/api/sessions/:projectId/:sessionId/metrics` | Session metrics | **Stub** (9E) |
| GET | `/api/sessions/:projectId/:sessionId/subagents/:agentId` | Subagent detail | **Stub** (9E) |

### What Stage 9B Does NOT Include

- Board rendering or card components (9C)
- Detail page content (9D)
- Session JSONL parsing engine (9E) — session detail endpoints return stubs
- SSE real-time updates (9G)
- Any connection to the orchestrator (10A)

---

## Implementation Notes from Stage 9A

These are specific lessons and patterns established during 9A that you MUST follow.

### 1. Server Factory Pattern

The server is built via `createServer(options)` in `src/server/app.ts`. **Do NOT restructure this.** Add new routes inside the factory function, after the health endpoint and before the static serving / dev proxy section. The function currently looks like:

```
CORS registration
→ /api/health route
→ [ADD NEW 9B ROUTES HERE]
→ Production static serving + SPA fallback / Dev proxy
```

You'll likely want to extract routes into separate files under `src/server/routes/` (e.g., `board.ts`, `epics.ts`, `tickets.ts`, `stages.ts`, `sessions.ts`, `graph.ts`) and register them as Fastify plugins. The 9A plan's directory structure shows this layout.

### 2. ESM Module Requirements

This project uses `"type": "module"` in package.json. This means:
- **All local imports must use `.js` extensions** — `import { foo } from './bar.js'`
- **Use `fileURLToPath(import.meta.url)` instead of `__dirname`** — already done in `app.ts`
- **Top-level `await` works** — used in `src/server/index.ts`
- npm package imports do NOT need `.js` extensions

### 3. Importing from kanban-cli

The 9B plan says to import kanban-cli repository classes via relative paths:
```typescript
import { EpicRepository } from '../../../kanban-cli/src/db/epic-repository.js';
```

**Investigate before implementing.** The kanban-cli codebase uses the `createXxx(deps)` factory pattern extensively. You need to understand:
- Where the SQLite database is initialized (`~/.config/kanban-workflow/kanban.db`)
- How repositories are instantiated (they likely need a `Database` instance from `better-sqlite3`)
- Whether to open the database read-only from the web server or share the initialization code
- The exact export names and paths — the CLI entry at `tools/kanban-cli/src/cli/index.ts` imports commands, not repositories directly. Look in `tools/kanban-cli/src/db/` for the repository classes.

### 4. Testing Pattern

Server tests use Fastify's `inject()` method — no actual port binding needed:

```typescript
import { createServer } from '../../src/server/app.js';

describe('board API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer({ logger: false, isDev: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/board returns board JSON', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/board' });
    expect(response.statusCode).toBe(200);
    // ...
  });
});
```

**Critical patterns from 9A review:**
- **Always `app.close()` in `afterEach`** — prevents resource leaks
- **Always pass `isDev: true` (or `false`) explicitly** — makes tests deterministic
- **Always pass `logger: false`** — suppresses noise in test output
- **Check `content-type` header** in response assertions
- **Assert response body shape** (exact keys) to catch unexpected fields

### 5. Dependency Injection for Testing

The `createServer` factory accepts `ServerOptions`. For 9B, you'll likely need to inject the database connection or repository instances so tests can use an in-memory SQLite database or mock data. Extend `ServerOptions` following the existing DI pattern:

```typescript
export interface ServerOptions {
  logger?: boolean;
  vitePort?: number;
  isDev?: boolean;
  db?: Database;  // inject SQLite connection for testing
}
```

### 6. apiFetch Client Pattern

The frontend API client at `src/client/api/client.ts` uses:
```typescript
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>
```
- Prepends `/api` to the path
- Only sets `Content-Type: application/json` when there's a body (POST/PUT/PATCH), not on GETs
- Headers are properly merged so callers can add custom headers without losing defaults

Add new React Query hooks in `src/client/api/hooks.ts` following the `useHealth()` pattern.

### 7. Vitest Configuration

- Config at `tools/web-server/vitest.config.ts`: `globals: true`, includes `tests/**/*.test.ts`
- Uses Vitest 3 (kanban-cli/orchestrator use Vitest 2 — this is intentional for Vite 6 compatibility)
- Run tests: `npm run test`, lint: `npm run lint`, both: `npm run verify`

### 8. Build Structure

- `npm run build` produces `dist/client/` (Vite) and `dist/server/` (tsc)
- `tsconfig.server.json` compiles only `src/server/` → `dist/server/`
- Server code references client dist via `join(__dirname, '../client')`
- `.gitignore` covers `node_modules/`, `dist/`, `*.tsbuildinfo`

### 9. React Query Setup

`QueryClient` is created inside `App()` with `useState(() => new QueryClient())` — not at module scope. This ensures HMR resets work and per-test isolation is possible.

### 10. Production 404 Handling

The SPA fallback in production mode handles two cases:
- `/api/*` routes that don't match → `404 { error: 'Not found' }`
- All other routes → serves `index.html` for client-side routing (if built client exists)
- If `dist/client/` doesn't exist → also returns `404 { error: 'Not found' }`

New API routes registered BEFORE the not-found handler will take precedence automatically.

---

## Session Workflow Rules

### Main Agent Responsibilities

The main agent (coordinator) **CAN and SHOULD** directly:
- **Read design docs, research docs, and plan files** — these are documentation, not code files. Do NOT delegate reading `docs/plans/`, `docs/research/`, or `CLAUDE.md` to subagents.
- **Write and update the implementation plan** — the 9B plan at `docs/plans/stage-9-10-substages/stage-9b-rest-api-layer.md` should be updated by the main agent directly using the writing-plans skill, not by a subagent.
- **Run simple git commands** (`git status`, `git log`, `git diff`)
- **Communicate with user and coordinate subagents**

The main agent **MUST delegate** to subagents:
- All code file reads, writes, and edits
- Codebase exploration (Glob, Grep)
- Test execution
- Build commands

### Use Existing Research — Don't Re-Read Source Repos

Research for Stage 9-10 has already been gathered in `docs/research/stage-9-10-web-ui/`. **Read those docs instead of exploring the claude-devtools, vibe-kanban, or claude-code-monitor repos directly.** The research docs contain the extracted patterns, code snippets, and architectural decisions from those repos. Re-reading the source repos wastes context and time.

### Review Every Task — Address ALL Comments

After every implementation task, run **both** reviews:
1. **Spec compliance review** — verify code matches the plan (nothing missing, nothing extra)
2. **Code quality review** — verify code is clean, tested, and follows patterns

**Address ALL review comments, no matter how minor.** We need to avoid accumulating tech debt. If a reviewer flags something as a "suggestion" or "nice to have," fix it anyway. The cost of fixing now is low; the cost of tech debt compounds across 9B-9G and 10A-10D.

---

## Instructions

Start by reading the design doc Section 7 and the 9B substage plan referenced above (read them with the main agent, not subagents). Then update the 9B plan with the full implementation plan using the **writing-plans** skill (main agent writes the plan directly). After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Key Constraints

- Follow the existing DI pattern — all I/O (database, file reads) should be injectable
- Import kanban-cli internals via relative paths (investigate the actual export structure first)
- Use Zod for query parameter validation on endpoints that accept filters
- Session detail endpoints (3 of 4) should be stubs returning `501 Not Implemented` until 9E
- Session listing endpoint should scan `~/.claude/projects/` for JSONL files
- All new endpoints need tests using `app.inject()`
- Route files should go in `src/server/routes/` as Fastify plugins

### Verification

After implementation:

```bash
cd tools/web-server && npm run verify   # lint + all tests pass
cd tools/web-server && npm run dev
# Test each endpoint via curl:
# curl http://localhost:3100/api/board
# curl http://localhost:3100/api/epics
# curl http://localhost:3100/api/graph
# etc.
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 888 tests still pass
cd tools/orchestrator && npm run verify  # ~396 tests still pass
```
