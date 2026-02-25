# Stage 9D: Detail Views

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9A (scaffold), 9B (API endpoints), 9C (navigation from boards)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Detail pages for epics, tickets, stages, and a dependency graph visualization.

## What Ships

4 pages: EpicDetail, TicketDetail, StageDetail, DependencyGraph.

## Pages

### Epic Detail (`/epics/:epicId`)

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

**API call:** `GET /api/epics/:id`

### Ticket Detail (`/tickets/:ticketId`)

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

**API call:** `GET /api/tickets/:id`

### Stage Detail (`/stages/:stageId`)

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

**API call:** `GET /api/stages/:id`

### Dependency Graph (`/graph`)

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

**API call:** `GET /api/graph`, `GET /api/graph?mermaid=true`

## Shared Components

### StatusBadge
```
Props: { status: string, type: 'epic' | 'ticket' | 'stage' }
```
Colored pill: Not Started=gray, In Progress=blue, Complete=green. Stage statuses get pipeline-specific colors (Design=purple, Build=orange, etc.).

### DependencyList
```
Props: { dependencies: { id: string, type: string, resolved: boolean }[] }
```
Renders a list of dependency links with resolved/unresolved indicators.

### MarkdownContent
```
Props: { content: string }
```
Renders markdown with react-markdown + remark-gfm. Syntax highlighting for code blocks via Shiki.

### PhaseSection
```
Props: { title: string, content: string, isComplete: boolean, defaultExpanded: boolean }
```
Collapsible section with completion indicator. Renders markdown content inside.

## Success Criteria

- All detail pages render correct data from API
- Breadcrumb navigation works at all levels
- Markdown content renders correctly (code blocks, tables, lists)
- Dependency graph renders and is navigable
- Phase sections are collapsible with correct completion state
- Links between detail pages work (epic -> ticket -> stage -> session)
