# Stage 9B: REST API Layer

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9A (server scaffold must exist)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

All REST endpoints consuming kanban-cli internals, serving JSON to the frontend.

## What Ships

16 REST API endpoints covering board, epics, tickets, stages, graph, and session listing.

## Endpoints

### Board & Stats
- `GET /api/board` — Full kanban board JSON (same format as `kanban-cli board --pretty`)
- `GET /api/board?epic=EPIC-001` — Board filtered by epic
- `GET /api/board?ticket=TICKET-001-001` — Board filtered by ticket
- `GET /api/stats` — Pipeline statistics (total stages, by_column counts, completion %)

### Epics
- `GET /api/epics` — List all epics with id, title, status, ticket count
- `GET /api/epics/:id` — Epic detail: full frontmatter + ticket list + markdown content

### Tickets
- `GET /api/tickets?epic=EPIC-001` — List tickets (filterable by epic)
- `GET /api/tickets/:id` — Ticket detail: frontmatter + stage list + markdown content

### Stages
- `GET /api/stages?ticket=TICKET-001-001` — List stages (filterable by ticket)
- `GET /api/stages/:id` — Stage detail: frontmatter + phase sections + markdown content

### Graph
- `GET /api/graph` — Dependency graph JSON (nodes + edges + cycles + critical_path)
- `GET /api/graph?mermaid=true` — Mermaid-formatted graph string

### Sessions (listing only — detail parsing is 9E)
- `GET /api/sessions/:projectId` — List session files for a project (scan ~/.claude/projects/)
- `GET /api/sessions/:projectId/:sessionId` — Placeholder; returns 501 until 9E builds the parser
- `GET /api/sessions/:projectId/:sessionId/metrics` — Placeholder
- `GET /api/sessions/:projectId/:sessionId/subagents/:agentId` — Placeholder

## Implementation Details

### Importing kanban-cli internals

The web server imports kanban-cli repository classes directly via relative path:
```typescript
import { EpicRepository } from '../../kanban-cli/src/db/epic-repository';
import { StageRepository } from '../../kanban-cli/src/db/stage-repository';
import { TicketRepository } from '../../kanban-cli/src/db/ticket-repository';
import { DependencyRepository } from '../../kanban-cli/src/db/dependency-repository';
```

The web server must share the same SQLite database path (`~/.config/kanban-workflow/kanban.db`). The database is opened read-only by the web server (kanban-cli sync writes to it).

### Board endpoint

Import the board command's internal logic that builds the board JSON. The CLI command wraps this with stdout printing; the API route returns it as JSON directly.

Look at `tools/kanban-cli/src/cli/board.ts` and the underlying functions it calls. Extract the board-building logic into a reusable function if it isn't already.

### Graph endpoint

Same approach as board — extract the graph-building logic from `tools/kanban-cli/src/cli/graph.ts`.

### Session listing

For `GET /api/sessions/:projectId`:
- Decode the project path from projectId (reverse of claude-devtools path encoding: dashes back to path separators)
- Scan `~/.claude/projects/{encoded-path}/` for `*.jsonl` files (exclude `agent-*.jsonl` at root level)
- Return list with: sessionId, filePath, lastModified, fileSize

**Reference:** claude-devtools `src/main/services/discovery/ProjectScanner.ts` for path encoding/decoding and session file discovery.

### Validation

Use Zod schemas for query parameter validation on each endpoint. Return 400 with structured error on invalid input.

## Success Criteria

- All endpoints return valid JSON
- Board endpoint matches `kanban-cli board --pretty` output format
- Epic/ticket/stage endpoints return data from SQLite
- Graph endpoint returns nodes, edges, cycles, critical_path
- Session listing returns files from ~/.claude/projects/
- Invalid parameters return 400 with Zod error details
- Tests cover each endpoint with fixture data
