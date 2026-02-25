# Stage 9C: Dashboard + Board Views — Session Prompt

## Context

Stages 9A and 9B are complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9C: Dashboard + Board Views** — the Dashboard home page and three board views (Epic Board, Ticket Board, Stage Pipeline Board) that consume the REST API built in 9B.

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
                                ├── Stage 9C (Dashboard + Board Views) ← THIS STAGE
                                ├── Stage 9D (Detail Views) — depends on 9B, 9C
                                ├── Stage 9E (Session JSONL Engine) — depends on 9A
                                ├── Stage 9F (Session Detail Display) — depends on 9E
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
```

### What Has Been Built (Stages 0-9B)

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

**REST API Layer** (`tools/web-server/`) — Stage 9B:
- 16 REST endpoints across 6 route plugin files in `src/server/routes/`
- `DataService` class wrapping kanban-cli database and repositories (`src/server/services/data-service.ts`)
- Board/stats endpoints using `buildBoard()` from kanban-cli with Zod query parameter validation
- Epic, ticket, stage, graph endpoints with full CRUD-read and filtering
- Session listing endpoint scanning `~/.claude/projects/` for JSONL files
- Session detail endpoints returning `501 Not Implemented` (stubs for 9E)
- React Query hooks for all endpoints in `src/client/api/hooks.ts`
- Full response types exported from hooks.ts
- 9 test files covering all endpoints using Fastify `inject()` + seed data helpers

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design for Stages 9 and 10 (Section 8 covers 9C specifically)
- @docs/plans/stage-9-10-substages/stage-9c-dashboard-board-views.md — Detailed specification for this substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `research-vibe-kanban.md` — Kanban board patterns, CSS Grid layout
- `stage-9-10-research-synthesis.md` — Unified synthesis with recommended patterns

---

## What Stage 9C Delivers

### Goal

Dashboard home page with stats and activity feed, plus three board views (Epic Board, Ticket Board, Stage Pipeline Board). 4 pages total, plus shared `BoardColumn` and `BoardCard` components.

### Pages

#### Dashboard (`/`)

- **Pipeline summary stats**: total stages, stages per column (stat grid), overall completion percentage
- **Active sessions indicator**: count of active sessions (placeholder count until 9E/9G wire up live detection)
- **Recent activity feed**: last 20 stage status transitions — each entry shows timestamp, stage ID, old status -> new status, ticket/epic context
- **Blocked items alert**: count of stages in backlog column; amber alert if > 0
- **Quick-link cards**: cards linking to /epics, /graph

**API calls**: `useStats()` for pipeline stats, `useBoard({ column: 'backlog' })` for blocked count, `useStages()` for recent activity feed.

#### Epic Board (`/epics`)

- Three columns: Not Started | In Progress | Complete
- Cards show: epic ID, title, ticket count, completion % bar
- Click card navigates to `/epics/:epicId/tickets`

**API call**: `useEpics()`

#### Ticket Board (`/epics/:epicId/tickets`)

- Breadcrumb: Epics > EPIC-001 (title)
- Three columns: Not Started | In Progress | Complete
- Fourth column "To Convert" shown if any tickets have `has_stages: false` (i.e., `stages: []`)
- Cards show: ticket ID, title, stage count, completion % bar, Jira key badge (if set), source indicator (local/jira)
- Click card navigates to `/epics/:epicId/tickets/:ticketId/stages`

**API call**: `useTickets({ epic: epicId })`, `useEpic(epicId)` for breadcrumb title

#### Stage Pipeline Board (`/epics/:epicId/tickets/:ticketId/stages`)

- Breadcrumb: Epics > EPIC-001 > TICKET-001-001 (title)
- Columns are dynamic from pipeline config (not hardcoded). Default pipeline: Backlog | Ready for Work | Design | User Design Feedback | Build | Automatic Testing | Manual Testing | Finalize | PR Created | Addressing Comments | Done
- Cards show: stage ID, title, refinement type badges, `session_active` indicator (green dot), dependency count if blocked
- Click card navigates to `/stages/:stageId`

**API call**: `useBoard({ ticket: ticketId })` — the board API returns columns keyed by slug (e.g., `ready_for_work`, `build`, `design`). The UI must format these as display names (replace underscores with spaces, title case).

### Shared Components

#### `BoardColumn`
```
Props: { title: string, color: string, count: number, children: ReactNode }
```
Column with sticky header showing title + count badge. Scrollable card area. Empty state: "No items" message.

#### `BoardCard`
```
Props: { id: string, title: string, subtitle?: string, badges?: Badge[], progress?: number, onClick: () => void }
```
Card with hover effect. Badges are small colored pills. Progress is an optional thin bar at bottom.

Place these in `src/client/components/board/BoardColumn.tsx` and `src/client/components/board/BoardCard.tsx`.

### What Stage 9C Does NOT Include

- Detail page content — epics, tickets, stages, graph detail pages (9D)
- Session JSONL parsing engine (9E)
- Session detail display (9F)
- SSE real-time updates (9G) — boards refresh on navigation only
- Drag-and-drop — all boards are read-only
- Any connection to the orchestrator (10A)

---

## Implementation Notes from 9A and 9B

These are specific lessons and patterns established during 9A and 9B that you MUST follow.

### 1. ESM Module Requirements

This project uses `"type": "module"` in package.json. This means:
- **All local imports must use `.js` extensions** — `import { foo } from './bar.js'`
- **Use `fileURLToPath(import.meta.url)` instead of `__dirname`** — already done in `app.ts`
- **Top-level `await` works** — used in `src/server/index.ts`
- npm package imports do NOT need `.js` extensions

### 2. Existing Layout Shell

The layout is already built in `src/client/components/layout/`:
- **`Layout.tsx`**: flex container with `<Sidebar />` and `<Header />` + `<main>` area
- **`Sidebar.tsx`**: nav with links to `/` (Dashboard), `/epics` (Epics), `/graph` (Dependency Graph)
- **`Header.tsx`**: breadcrumb nav built from `useLocation()` pathname segments

The breadcrumb in `Header.tsx` currently auto-generates from URL segments. This may need updating to show human-readable labels (e.g., "EPIC-001 (User Authentication)" instead of just the raw segment). Consider whether to enhance Header.tsx or add page-level breadcrumb overrides.

### 3. Existing Routes and Placeholder Pages

All 9 routes exist in `App.tsx` with React Router:
```
/                                           → Dashboard
/epics                                      → EpicBoard
/epics/:epicId                              → EpicDetail
/epics/:epicId/tickets                      → TicketBoard
/epics/:epicId/tickets/:ticketId/stages     → StageBoard
/tickets/:ticketId                          → TicketDetail
/stages/:stageId                            → StageDetail
/sessions/:projectId/:sessionId             → SessionDetail
/graph                                      → DependencyGraph
```

Each placeholder page is a minimal component with an `<h1>` and optional `useParams()`. Replace the placeholder content with the real implementations.

### 4. Available React Query Hooks

All hooks are ready in `src/client/api/hooks.ts`:

| Hook | Returns | Use In |
|------|---------|--------|
| `useBoard(filters?)` | `BoardResponse` (columns keyed by slug, stats) | StageBoard, Dashboard blocked count |
| `useStats()` | `BoardStats` (total_stages, total_tickets, by_column) | Dashboard |
| `useEpics()` | `EpicListItem[]` (id, title, status, ticket_count) | EpicBoard |
| `useEpic(id)` | `EpicDetail` (with tickets array) | TicketBoard breadcrumb |
| `useTickets(filters?)` | `TicketListItem[]` (id, title, status, epic_id, stage_count, jira_key) | TicketBoard |
| `useTicket(id)` | `TicketDetail` (with stages array) | StageBoard breadcrumb |
| `useStages(filters?)` | `StageListItem[]` (id, title, status, kanban_column, refinement_type[]) | Dashboard activity |
| `useStage(id)` | `StageDetail` (full detail with dependencies) | Not used in 9C |

### 5. Response Types Available

All exported from `src/client/api/hooks.ts`:

- `BoardResponse` — `{ generated_at, repo, repos?, columns: Record<string, BoardItem[]>, stats: BoardStats }`
- `BoardStats` — `{ total_stages, total_tickets, by_column: Record<string, number> }`
- `BoardItem` — union of `BoardTicketItem | BoardStageItem`
- `BoardStageItem` — `{ type: 'stage', id, ticket, epic, title, blocked_by?, session_active?, worktree_branch?, ... }`
- `BoardTicketItem` — `{ type: 'ticket', id, epic, title, jira_key, source, ... }`
- `EpicListItem` — `{ id, title, status, jira_key, file_path, ticket_count }`
- `EpicDetail` — `{ id, title, status, jira_key, file_path, tickets: TicketSummary[] }`
- `TicketListItem` — `{ id, title, status, epic_id, jira_key, source, has_stages, file_path, stage_count }`
- `TicketDetail` — `{ id, title, status, epic_id, jira_key, source, has_stages, file_path, stages: StageSummary[] }`
- `StageListItem` — `{ id, title, status, ticket_id, epic_id, kanban_column, refinement_type: string[], worktree_branch, session_active, priority, due_date, pr_url, file_path }`
- `SessionListItem` — `{ sessionId, filePath, lastModified, fileSize }`

### 6. Zustand Stores

Three stores exist in `src/client/store/`:

- **`board-store.ts`**: `{ selectedEpic: string | null, setSelectedEpic }` — tracks selected epic for filtering
- **`session-store.ts`**: `{ activeSessionIds: string[], setActiveSessionIds }` — tracks active session IDs
- **`settings-store.ts`**: `{ sidebarCollapsed: boolean, toggleSidebar }` — sidebar collapse state

The board store's `selectedEpic` could be useful for cross-page state but the primary data flow should be through URL params and React Query hooks.

### 7. Board API Column Keys Are Slugs

The board API (`GET /api/board`) returns `columns` as `Record<string, BoardItem[]>` where keys are slug-format column names from the pipeline config (e.g., `ready_for_work`, `build`, `design`, `user_design_feedback`, `done`).

The Stage Pipeline Board must:
1. Read the column keys from the board response (they come from pipeline config — do not hardcode)
2. Format slugs into display names: replace `_` with spaces, apply title case (e.g., `ready_for_work` → "Ready For Work")
3. Preserve the order from the API response (columns are ordered by pipeline definition)

### 8. Styling with Tailwind CSS 3.4

Use Tailwind utility classes throughout. Key patterns for boards:

**Board layout** (CSS Grid, horizontal scroll):
```html
<div class="grid grid-flow-col auto-cols-[280px] gap-4 overflow-x-auto pb-4">
```

**Card styling**:
```html
<div class="bg-white rounded-lg shadow-sm border border-slate-200 p-3 hover:shadow-md transition-shadow cursor-pointer">
```

**Column header** (sticky):
```html
<div class="sticky top-0 bg-slate-50 z-10 pb-2">
```

Reference: vibe-kanban `packages/ui/src/components/KanbanBoard.tsx` for CSS Grid layout patterns.

### 9. Server Factory Pattern

The server is built via `createServer(options)` in `src/server/app.ts`. Route plugins are registered via `app.register()`. The `DataService` is decorated onto the Fastify instance as `app.dataService`. Stage 9C does NOT touch the server — it only modifies client-side code.

### 10. Testing

- **Vitest 3** for all tests. Config at `tools/web-server/vitest.config.ts`: `globals: true`, includes `tests/**/*.test.ts`
- **Existing tests are server-side only** (Fastify `inject()` pattern). There are currently no client-side component tests.
- **React Testing Library** is NOT currently installed. If component tests are needed, add `@testing-library/react` and `@testing-library/jest-dom` as dev dependencies. However, given that 9C is primarily about rendering data from hooks, integration tests via the existing server test patterns may be sufficient — consider whether component tests add enough value.
- Run tests: `npm run test`, lint: `npm run lint`, both: `npm run verify`

### 11. lucide-react for Icons

`lucide-react` is already installed and used in Sidebar.tsx and Header.tsx. Use it for all icons (e.g., activity indicators, badges, navigation icons).

### 12. React Query Setup

`QueryClient` is created inside `App()` with `useState(() => new QueryClient())` — not at module scope. This ensures HMR resets work and per-test isolation is possible.

### 13. Zod 4

Zod is available as a dependency (version ^4.3.6). Use it for any runtime validation if needed on the client side (e.g., validating API response shapes).

---

## Session Workflow Rules

### Main Agent Responsibilities

The main agent (coordinator) **CAN and SHOULD** directly:
- **Read design docs, research docs, and plan files** — these are documentation, not code files. Do NOT delegate reading `docs/plans/`, `docs/research/`, or `CLAUDE.md` to subagents.
- **Write and update the implementation plan** — the 9C plan at `docs/plans/stage-9-10-substages/stage-9c-dashboard-board-views.md` should be updated by the main agent directly using the writing-plans skill, not by a subagent.
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

**Address ALL review comments, no matter how minor.** We need to avoid accumulating tech debt. If a reviewer flags something as a "suggestion" or "nice to have," fix it anyway. The cost of fixing now is low; the cost of tech debt compounds across 9C-9G and 10A-10D.

---

## Instructions

Start by reading the design doc Section 8 and the 9C substage plan referenced above (read them with the main agent, not subagents). Then update the 9C plan with the full implementation plan using the **writing-plans** skill (main agent writes the plan directly). After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Implementation Order

Suggested phasing:

1. **Shared components first** — `BoardColumn` and `BoardCard` in `src/client/components/board/`. These are used by all three boards.
2. **Epic Board** — simplest board (3 fixed columns, simple card content). Proves the board layout pattern works.
3. **Ticket Board** — adds breadcrumb context, "To Convert" column, Jira badge. Builds on Epic Board pattern.
4. **Stage Pipeline Board** — dynamic columns from API, refinement badges, session_active indicator. Most complex board.
5. **Dashboard** — composes stats, activity feed, blocked alert, quick links. Uses hooks established in steps 2-4.

### Key Constraints

- **All boards are read-only** — no drag-and-drop, no mutations, no POST/PUT/DELETE calls
- **Pipeline columns are dynamic** — the Stage Pipeline Board must read column names from the board API response, not hardcode them
- **Board API returns columns keyed by slug** — format `ready_for_work` as "Ready For Work" for display
- **ESM imports require `.js` extensions** — `import { BoardCard } from './BoardCard.js'`
- **Use existing hooks** — all data fetching hooks are ready in `hooks.ts`; do NOT create new API endpoints
- **Navigation via React Router** — use `useNavigate()` for card clicks, `useParams()` for reading route params
- **Tailwind only** — no CSS modules, no styled-components, no inline style objects
- **No new npm dependencies** unless absolutely necessary — everything needed (React, React Router, Zustand, React Query, Tailwind, lucide-react, Zod) is already installed
- **Follow existing code patterns** — match the style of existing components (Sidebar.tsx, Header.tsx, Layout.tsx)

### Verification

After implementation:

```bash
cd tools/web-server && npm run verify   # lint + all tests pass
cd tools/web-server && npm run dev
# Open http://localhost:3100/ in browser
# Verify: Dashboard shows stats, activity feed, blocked alert
# Verify: /epics shows epic cards in 3 columns
# Verify: clicking an epic navigates to /epics/:epicId/tickets
# Verify: ticket board shows ticket cards with Jira badges
# Verify: clicking a ticket navigates to /epics/:epicId/tickets/:ticketId/stages
# Verify: stage pipeline board shows dynamic columns from pipeline config
# Verify: breadcrumbs work at all board levels
# Verify: empty columns show "No items" state
# Verify: horizontal scroll works when columns overflow
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 888 tests still pass
cd tools/orchestrator && npm run verify  # ~396 tests still pass
```
