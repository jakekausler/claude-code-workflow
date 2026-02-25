# Stage 9D: Detail Views — Session Prompt

## Context

Stages 9A, 9B, and 9C are complete on the `feat/stage-9-web-view` branch. This session implements **Stage 9D: Detail Views** — detail pages for epics, tickets, stages, and a dependency graph visualization that consume the REST API built in 9B.

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
                                ├── Stage 9D (Detail Views) ← THIS STAGE
                                ├── Stage 9E (Session JSONL Engine) — depends on 9A
                                ├── Stage 9F (Session Detail Display) — depends on 9E
                                └── Stage 9G (Real-Time Updates) — depends on 9B, 9E
```

### What Has Been Built (Stages 0-9C)

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
- React 19 SPA with BrowserRouter, layout shell (sidebar + breadcrumb header)
- 3 Zustand stores (board, session, settings), API client (`apiFetch<T>`), React Query hooks
- Tailwind CSS 3.4, vitest 3, TypeScript 5 (strict, NodeNext, ES2022)

**REST API Layer** (`tools/web-server/`) — Stage 9B:
- 17 REST endpoints across 7 route plugin files in `src/server/routes/`
- `DataService` class wrapping kanban-cli database and repositories (`src/server/services/data-service.ts`)
- Board/stats endpoints using `buildBoard()` from kanban-cli with Zod query parameter validation
- Epic, ticket, stage, graph, repo endpoints with full CRUD-read and filtering
- Session listing endpoint scanning `~/.claude/projects/` for JSONL files
- Session detail endpoints returning `501 Not Implemented` (stubs for 9E)
- React Query hooks for all endpoints in `src/client/api/hooks.ts`
- Full response types exported from hooks.ts
- 9 test files, 79 tests covering all endpoints using Fastify `inject()` + seed data helpers

**Dashboard + Board Views** (`tools/web-server/`) — Stage 9C:
- Dashboard home page with pipeline stats, activity feed, blocked alert, quick links
- Unified `/board` page replacing separate Epic/Ticket/Stage boards with cascading filter dropdowns (Repo, Epic, Ticket)
- `FilterBar` component with `useRepos()` hook and Zustand store for filter state (`selectedRepo`, `selectedEpic`, `selectedTicket`)
- Shared board components: `BoardLayout`, `BoardColumn`, `BoardCard`
- Utility formatters: `slugToTitle`, `columnColor`, `statusColor`
- Old board routes (`/epics`, `/epics/:epicId/tickets`, `/epics/:epicId/tickets/:ticketId/stages`) redirect to `/board`
- Sidebar navigation updated: "Board" link replaces "Epics"

---

## Design Documents

Read these files to understand the full design before implementing:

- @docs/plans/2026-02-16-kanban-workflow-redesign-design.md — Overall design for the kanban workflow
- @docs/plans/2026-02-25-stage-9-10-web-ui-design.md — Full approved design for Stages 9 and 10 (Section 9 covers 9D specifically)
- @docs/plans/stage-9-10-substages/stage-9d-detail-views.md — Detailed specification for this substage

### Research References (read as needed during implementation)

These are in `docs/research/stage-9-10-web-ui/`:

- `research-vibe-kanban.md` — Kanban board patterns, CSS Grid layout
- `stage-9-10-research-synthesis.md` — Unified synthesis with recommended patterns

---

## What Stage 9D Delivers

### Goal

Detail pages for epics, tickets, stages, and a dependency graph visualization. 4 pages total, plus shared components (StatusBadge, DependencyList, MarkdownContent, PhaseSection).

### Pages

#### Epic Detail (`/epics/:epicId`)

**Header section:**
- Epic ID + title (large)
- Status badge (Not Started = gray, In Progress = blue, Complete = green)
- Jira key link (if set, opens Jira in new tab)
- Dependencies: list of epic-level depends_on items

**Ticket list:**
- Table with columns: ID, Title, Status, Stage Count, Jira Key
- Sortable by status or title
- Each row links to ticket detail

**Content section:**
- Render epic markdown file content (Overview, Notes sections)
- Use react-markdown + remark-gfm for rendering

**API call:** `useEpic(epicId)`

#### Ticket Detail (`/tickets/:ticketId`)

**Header section:**
- Ticket ID + title
- Status badge
- Epic breadcrumb link
- Jira key link + source badge (local/jira)
- Dependencies list

**Stage list:**
- Table/cards showing each stage's current pipeline phase
- Columns: ID, Title, Status (pipeline column), Refinement Type, Session Active
- Each row links to stage detail

**Additional sections:**
- Regression file content (if `regression.md` exists in ticket directory)
- Changelog entries (if `changelog/` directory has entries)
- Ticket markdown content (Overview, Notes)

**API call:** `useTicket(ticketId)`

#### Stage Detail (`/stages/:stageId`)

**Header section:**
- Stage ID + title
- Status badge (colored by pipeline column)
- Ticket + epic breadcrumb links
- Refinement type badges (frontend/backend/cli/database/infrastructure/custom)
- Worktree branch info
- PR URL link (if set)

**Phase sections (collapsible):**
- **Design Phase:** Approaches presented, user choice, seed data, session notes, completion checkbox
- **Build Phase:** Components created, API endpoints, placeholders, session notes, completion checkbox
- **Refinement Phase:** Checklist based on refinement_type (e.g., Desktop Approved, Mobile Approved for frontend)
- **Finalize Phase:** Code review, tests, documentation, commit hash, MR/PR URL, changelog entry

Each phase section renders the markdown content from the stage file's corresponding section.

**Session link:**
- Button: "View Latest Session" — links to `/sessions/:projectId/:sessionId`
- Determine session by matching the stage's worktree_branch to session JSONL files (via cwd/gitBranch fields)
- Placeholder until 9E builds session discovery

**Dependencies section:**
- "Blocked by" list with resolution status
- "Blocks" list

**API call:** `useStage(stageId)`

#### Dependency Graph (`/graph`)

**Graph visualization:**
- Render the graph JSON from `GET /api/graph` as an interactive diagram
- Options for visualization:
  - **Mermaid.js** (simplest): Use `GET /api/graph?mermaid=true` and render with mermaid library
  - **D3.js force-directed** (most interactive): Nodes + edges with drag, zoom, hover
  - **dagre-d3** or **@dagrejs/dagre** (good for DAGs): Automatic layout for directed graphs

**Recommended:** Start with Mermaid.js for simplicity. It handles the graph rendering with minimal code. Can upgrade to D3 later if needed.

**Node styling:**
- Epics: blue rectangles
- Tickets: green rectangles
- Stages: yellow/orange rectangles
- Completed items: dimmed

**Edge styling:**
- Resolved dependencies: gray/dashed
- Unresolved: red/solid
- Critical path: highlighted thick line

**Controls:**
- Filter by epic (dropdown)
- Filter by ticket (dropdown)
- Toggle: show/hide completed items
- Toggle: show/hide critical path

**Cycle warnings:** If `graph.cycles` is non-empty, show alert banner listing the cycle.

**API call:** `useGraph()`, `useGraphMermaid()`

### Shared Components

#### StatusBadge
```
Props: { status: string, type: 'epic' | 'ticket' | 'stage' }
```
Colored pill: Not Started=gray, In Progress=blue, Complete=green. Stage statuses get pipeline-specific colors (Design=purple, Build=orange, etc.).

#### DependencyList
```
Props: { dependencies: { id: string, type: string, resolved: boolean }[] }
```
Renders a list of dependency links with resolved/unresolved indicators.

#### MarkdownContent
```
Props: { content: string }
```
Renders markdown with react-markdown + remark-gfm. Syntax highlighting for code blocks via Shiki.

#### PhaseSection
```
Props: { title: string, content: string, isComplete: boolean, defaultExpanded: boolean }
```
Collapsible section with completion indicator. Renders markdown content inside.

Place these in `src/client/components/detail/`.

### What Stage 9D Does NOT Include

- Session JSONL parsing engine (9E)
- Session detail display (9F) — the session link on StageDetail is a placeholder
- SSE real-time updates (9G) — detail pages refresh on navigation only
- Drag-and-drop — all pages are read-only
- Any connection to the orchestrator (10A)
- Markdown file content serving from API — if the current API does not serve markdown file content, the markdown rendering sections should show a placeholder ("Content available in future update")

---

## Implementation Notes from 9A–9C

These are specific lessons and patterns established during 9A–9C that you MUST follow.

### 1. ESM Module Requirements

This project uses `"type": "module"` in package.json. This means:
- **All local imports must use `.js` extensions** — `import { foo } from './bar.js'`
- **Use `fileURLToPath(import.meta.url)` instead of `__dirname`** — already done in `app.ts`
- **Top-level `await` works** — used in `src/server/index.ts`
- npm package imports do NOT need `.js` extensions

### 2. Existing Layout Shell

The layout is already built in `src/client/components/layout/`:
- **`Layout.tsx`**: flex container with `<Sidebar />` and `<Header />` + `<main>` area
- **`Sidebar.tsx`**: nav with links to `/` (Dashboard), `/board` (Board), `/graph` (Dependency Graph)
- **`Header.tsx`**: breadcrumb nav built from `useLocation()` pathname segments, with `SEGMENT_LABELS` map for human-readable names

### 3. Current Routes

Routes exist in `App.tsx` with React Router:
```
/                                           → Dashboard
/board                                      → Board (unified kanban with filters)
/epics                                      → Navigate → /board (redirect)
/epics/:epicId                              → EpicDetail (placeholder)
/epics/:epicId/tickets                      → Navigate → /board (redirect)
/epics/:epicId/tickets/:ticketId/stages     → Navigate → /board (redirect)
/tickets/:ticketId                          → TicketDetail (placeholder)
/stages/:stageId                            → StageDetail (placeholder)
/sessions/:projectId/:sessionId             → SessionDetail (placeholder)
/graph                                      → DependencyGraph (placeholder)
```

The EpicDetail, TicketDetail, StageDetail, and DependencyGraph pages are currently placeholder components. Replace their content with the real implementations.

### 4. Available React Query Hooks

All hooks are ready in `src/client/api/hooks.ts`:

| Hook | Returns | Use In |
|------|---------|--------|
| `useBoard(filters?)` | `BoardResponse` (columns keyed by slug, stats) | Board page |
| `useStats()` | `BoardStats` (total_stages, total_tickets, by_column) | Dashboard |
| `useRepos()` | `RepoListItem[]` (id, name, path) | FilterBar |
| `useEpics()` | `EpicListItem[]` (id, title, status, ticket_count) | FilterBar, EpicDetail list |
| `useEpic(id)` | `EpicDetail` (with tickets array) | EpicDetail page |
| `useTickets(filters?)` | `TicketListItem[]` (id, title, status, epic_id, stage_count, jira_key) | FilterBar |
| `useTicket(id)` | `TicketDetail` (with stages array) | TicketDetail page |
| `useStages(filters?)` | `StageListItem[]` (id, title, status, kanban_column, refinement_type[]) | Dashboard activity |
| `useStage(id)` | `StageDetail` (full detail with dependencies) | StageDetail page |
| `useGraph(filters?)` | `GraphResponse` (nodes, edges, cycles, critical_path) | DependencyGraph |
| `useGraphMermaid(filters?)` | `MermaidResponse` (mermaid string) | DependencyGraph |
| `useSessions(projectId)` | `SessionListItem[]` | Not used in 9D |

### 5. Response Types Available

All exported from `src/client/api/hooks.ts`:

- `EpicDetail` — `{ id, title, status, jira_key, file_path, tickets: TicketSummary[] }`
- `TicketSummary` — `{ id, title, status, jira_key, source, has_stages, stage_count }`
- `TicketDetail` — `{ id, title, status, epic_id, jira_key, source, has_stages, file_path, stages: StageSummary[] }`
- `StageSummary` — `{ id, title, status, kanban_column, refinement_type: string[], worktree_branch, session_active, priority, due_date, pr_url }`
- `StageDetail` — extends `StageListItem` with `{ pr_number, is_draft, pending_merge_parents, mr_target_branch, depends_on: DependencyItem[], depended_on_by: DependencyItem[] }`
- `DependencyItem` — `{ id, from_id, to_id, from_type, to_type, resolved }`
- `GraphResponse` — `{ nodes: GraphNode[], edges: GraphEdge[], cycles: string[][], critical_path: string[] }`
- `GraphNode` — `{ id, type: 'epic'|'ticket'|'stage', status, title }`
- `GraphEdge` — `{ from, to, type, resolved }`
- `MermaidResponse` — `{ mermaid: string }`
- `RepoListItem` — `{ id: number, name: string, path: string }`

### 6. Zustand Stores

Three stores exist in `src/client/store/`:

- **`board-store.ts`**: `{ selectedRepo, selectedEpic, selectedTicket, setSelectedRepo, setSelectedEpic, setSelectedTicket }` — tracks filter state for unified board with cascading resets
- **`session-store.ts`**: `{ activeSessionIds: string[], setActiveSessionIds }` — tracks active session IDs
- **`settings-store.ts`**: `{ sidebarCollapsed: boolean, toggleSidebar }` — sidebar collapse state

### 7. Existing Board Components

Shared board components in `src/client/components/board/`:
- **`BoardLayout.tsx`**: Container with loading/error/empty states, CSS Grid layout
- **`BoardColumn.tsx`**: Column with sticky header, count badge, scrollable area
- **`BoardCard.tsx`**: Card with id, title, subtitle, badges, progress bar, statusDot, click handler
- **`FilterBar.tsx`**: Three cascading filter dropdowns (Repo, Epic, Ticket)

Utility formatters in `src/client/utils/formatters.ts`:
- `slugToTitle(slug)` — `"ready_for_work"` → `"Ready For Work"`
- `columnColor(slug)` — column slug to hex color
- `statusColor(status)` — status string to hex color
- `refinementColor(type)` — refinement type to hex color
- `completionPercent(complete, total)` — percentage calculation

### 8. Styling with Tailwind CSS 3.4

Use Tailwind utility classes throughout. Key patterns established in 9C:

**Detail page header:**
```html
<h1 class="mb-1 text-2xl font-bold text-slate-900">Title</h1>
<p class="mb-4 text-sm text-slate-500">Subtitle</p>
```

**Badge/pill:**
```html
<span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Badge</span>
```

**Table:**
```html
<table class="w-full text-sm">
  <thead class="bg-slate-50 text-left text-xs text-slate-500">
    <tr><th class="px-3 py-2">Column</th></tr>
  </thead>
  <tbody class="divide-y divide-slate-100">
    <tr class="hover:bg-slate-50 cursor-pointer"><td class="px-3 py-2">Cell</td></tr>
  </tbody>
</table>
```

### 9. Server Factory Pattern

The server is built via `createServer(options)` in `src/server/app.ts`. Route plugins are registered via `app.register()`. The `DataService` is decorated onto the Fastify instance as `app.dataService`. Stage 9D is primarily client-side — **only add new API endpoints if the current API doesn't provide the data needed** (it likely does for all detail pages).

### 10. Testing

- **Vitest 3** for all tests. Config at `tools/web-server/vitest.config.ts`: `globals: true`, includes `tests/**/*.test.ts`
- **Existing tests are server-side only** (Fastify `inject()` pattern, 9 test files, 79 tests). There are currently no client-side component tests.
- **React Testing Library** is NOT currently installed. If component tests are needed, add `@testing-library/react` and `@testing-library/jest-dom` as dev dependencies.
- Run tests: `npm run test`, lint: `npm run lint`, both: `npm run verify`

### 11. lucide-react for Icons

`lucide-react` is already installed and used in Sidebar.tsx, Header.tsx, and Dashboard.tsx. Use it for all icons (e.g., status indicators, external link icons, expand/collapse chevrons).

### 12. React Query Setup

`QueryClient` is created inside `App()` with `useState(() => new QueryClient())` — not at module scope. This ensures HMR resets work and per-test isolation is possible.

### 13. New Dependencies to Consider

- **react-markdown** + **remark-gfm** — for rendering markdown content in epic/ticket/stage detail pages
- **mermaid** — for rendering the dependency graph visualization
- **shiki** — for syntax highlighting in code blocks (optional, can start without)

Install only what's needed. Prefer starting simple and adding dependencies as needed.

---

## Session Workflow Rules

### Main Agent Responsibilities

The main agent (coordinator) **CAN and SHOULD** directly:
- **Read design docs, research docs, and plan files** — these are documentation, not code files. Do NOT delegate reading `docs/plans/`, `docs/research/`, or `CLAUDE.md` to subagents.
- **Write and update the implementation plan** — the 9D plan at `docs/plans/stage-9-10-substages/stage-9d-detail-views.md` should be updated by the main agent directly using the writing-plans skill, not by a subagent.
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

**Address ALL review comments, no matter how minor.** We need to avoid accumulating tech debt. If a reviewer flags something as a "suggestion" or "nice to have," fix it anyway. The cost of fixing now is low; the cost of tech debt compounds across 9D-9G and 10A-10D.

---

## Instructions

Start by reading the design doc Section 9 and the 9D substage plan referenced above (read them with the main agent, not subagents). Then update the 9D plan with the full implementation plan using the **writing-plans** skill (main agent writes the plan directly). After the plan is approved, implement using **subagent-driven development**.

Do NOT use epic-stage-workflow or brainstorming — the design is already approved.

### Implementation Order

Suggested phasing:

1. **Shared components first** — `StatusBadge`, `DependencyList`, `MarkdownContent`, `PhaseSection` in `src/client/components/detail/`. These are used by multiple detail pages.
2. **Epic Detail** — simplest detail page (header, ticket table, dependencies). Proves the detail page pattern works.
3. **Ticket Detail** — adds stage list table, source badge, epic breadcrumb. Builds on Epic Detail pattern.
4. **Stage Detail** — most complex detail page (phase sections, dependencies, session link, PR info). Requires PhaseSection component.
5. **Dependency Graph** — standalone visualization page. Install mermaid, render graph, add controls.

### Key Constraints

- **All detail pages are read-only** — no mutations, no POST/PUT/DELETE calls
- **ESM imports require `.js` extensions** — `import { StatusBadge } from '../components/detail/StatusBadge.js'`
- **Use existing hooks** — all data fetching hooks are ready in `hooks.ts`; only add new API endpoints if the current API doesn't serve needed data
- **Navigation via React Router** — use `useNavigate()` for clicks, `useParams()` for reading route params, `Link` for breadcrumbs
- **Tailwind only** — no CSS modules, no styled-components, no inline style objects
- **Minimize new npm dependencies** — only install react-markdown, remark-gfm, and mermaid if needed
- **Follow existing code patterns** — match the style of existing components (Dashboard.tsx, Board.tsx, BoardCard.tsx)
- **Markdown content may not be available via API** — if the API doesn't serve file content, show a clean placeholder rather than leaving sections empty

### Verification

After implementation:

```bash
cd tools/web-server && npm run verify   # lint + all tests pass
cd tools/web-server && npm run dev
# Open http://localhost:3100/ in browser
# Verify: /epics/:epicId shows epic header, ticket table, dependencies
# Verify: clicking a ticket row navigates to /tickets/:ticketId
# Verify: /tickets/:ticketId shows ticket header, stage list, epic breadcrumb
# Verify: clicking a stage row navigates to /stages/:stageId
# Verify: /stages/:stageId shows stage header, phase sections, dependencies, PR link
# Verify: phase sections are collapsible
# Verify: /graph shows dependency graph visualization
# Verify: graph filters work (epic, ticket, show/hide completed)
# Verify: breadcrumbs work on all detail pages
# Verify: StatusBadge colors match spec (gray/blue/green)
```

Existing tools must remain unaffected:
```bash
cd tools/kanban-cli && npm run verify   # 888 tests still pass
cd tools/orchestrator && npm run verify  # ~396 tests still pass
```
