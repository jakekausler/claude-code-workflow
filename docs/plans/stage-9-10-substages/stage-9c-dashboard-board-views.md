# Stage 9C: Dashboard + Board Views

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9A (scaffold), 9B (API endpoints)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Dashboard home page with stats/activity feed, plus three board views (epic, ticket, stage pipeline).

## What Ships

4 pages: Dashboard, EpicBoard, TicketBoard, StageBoard. Shared BoardColumn and BoardCard components.

## Pages

### Dashboard (`/`)

**Layout:** Grid of cards + activity feed.

**Stats card:** Pipeline summary — total stages, stages per column (horizontal bar chart or stat grid), overall completion percentage.

**Active sessions card:** Count of sessions with JSONL changes in last 5 minutes. (Placeholder until 9E/9G wire up live detection.)

**Recent activity feed:** Last 20 stage status transitions. Each entry shows: timestamp, stage ID, old status -> new status, ticket/epic context. Source: query stages table ordered by last_synced DESC.

**Blocked items alert:** Count of stages where kanban_column = 'backlog'. If >0, show amber alert with count.

**Quick links:** Cards linking to /epics, /graph.

**API calls:** `GET /api/stats`, `GET /api/board?column=backlog` (for blocked count), `GET /api/stages?sort=last_synced&limit=20` (for activity).

### Epic Board (`/epics`)

**Layout:** Three columns (CSS Grid, fixed 300px width per column, horizontal scroll if needed).

**Columns:** Not Started | In Progress | Complete

**Cards:** Each epic rendered as a BoardCard showing:
- Epic ID (e.g., EPIC-001)
- Title
- Ticket count (e.g., "3 tickets")
- Completion % bar (tickets complete / total)
- Click navigates to `/epics/:epicId/tickets`

**API call:** `GET /api/epics` — returns all epics with status and ticket counts.

### Ticket Board (`/epics/:epicId/tickets`)

**Header:** Breadcrumb — Epics > EPIC-001 (User Authentication)

**Layout:** Three columns same as epic board.

**Columns:** Not Started | In Progress | Complete | To Convert (if any tickets have `stages: []`)

**Cards:** Each ticket rendered as BoardCard showing:
- Ticket ID (e.g., TICKET-001-001)
- Title
- Stage count
- Completion % bar
- Jira key badge (if `jira_key` is set)
- Source indicator (local/jira)
- Click navigates to `/epics/:epicId/tickets/:ticketId/stages`

**API call:** `GET /api/tickets?epic=:epicId`

### Stage Pipeline Board (`/epics/:epicId/tickets/:ticketId/stages`)

**Header:** Breadcrumb — Epics > EPIC-001 > TICKET-001-001 (Login Flow)

**Layout:** Pipeline columns from workflow config. Use CSS Grid with horizontal scroll for many columns.

**Columns (default pipeline):** Backlog | Ready for Work | Design | User Design Feedback | Build | Automatic Testing | Manual Testing | Finalize | PR Created | Addressing Comments | Done

The column list is read from the pipeline config via kanban-cli's loadConfig(). System columns (Backlog, Ready for Work, Done) are always present.

**Cards:** Each stage rendered as BoardCard showing:
- Stage ID (e.g., STAGE-001-001-001)
- Title
- Refinement type badges (frontend/backend/cli/etc.)
- `session_active` indicator (green dot if true)
- Dependency count if blocked
- Click navigates to `/stages/:stageId`

**API call:** `GET /api/board?ticket=:ticketId`

## Shared Components

### BoardColumn
```
Props: { title: string, color: string, count: number, children: ReactNode }
```
Renders a column with sticky header showing title + count badge. Scrollable card area.

### BoardCard
```
Props: { id: string, title: string, subtitle?: string, badges?: Badge[], progress?: number, onClick: () => void }
```
Renders a card with hover effect. Badges are small colored pills. Progress is an optional thin bar at bottom.

### Breadcrumbs
```
Props: { items: { label: string, href: string }[] }
```
Renders breadcrumb trail with > separators. Last item is current (not a link).

## Styling

Use Tailwind utility classes. Board layout uses CSS Grid:
```css
.board { display: grid; grid-auto-flow: column; grid-auto-columns: 280px; gap: 1rem; overflow-x: auto; }
```

Cards use `bg-white dark:bg-gray-800 rounded-lg shadow-sm border p-3 hover:shadow-md transition-shadow cursor-pointer`.

**Reference:** vibe-kanban `packages/ui/src/components/KanbanBoard.tsx` for CSS Grid layout, sticky headers, and card styling patterns.

## Success Criteria

- Dashboard shows real stats from the API
- All three boards render cards in correct columns
- Clicking cards navigates to the next level
- Breadcrumbs work at all levels
- Pipeline columns come from workflow config (not hardcoded)
- Empty columns show "No items" state
- Responsive: horizontal scroll on small screens
