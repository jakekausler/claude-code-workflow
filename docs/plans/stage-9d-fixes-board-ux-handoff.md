# Stage 9D Fixes: Board UX Improvements — Session Handoff

## Context

Stage 9D (Detail Views) was complete on the `feat/stage-9-web-view` branch. This session implemented **5 board UX improvements** — column ordering, dynamic pipeline phases, synthetic Epics/Converted columns, selected-item highlighting, and auto-scroll to selected column — plus a cleanup task removing refinement badges.

### Dependency Graph

```
Stage 9A (Web Server Foundation) ✅
  └── Stage 9B (REST API Layer) ✅
        └── Stage 9C (Dashboard + Board Views) ✅
              └── Stage 9D (Detail Views) ✅
                    └── Stage 9D Fixes (Board UX Improvements) ✅ ← THIS SESSION
                          └── Stage 9E (Session JSONL Engine) — next
```

---

## What This Session Delivered

### Summary

All changes are client-side only — no backend/API modifications. 6 files changed, 248 insertions, 142 deletions (board UX commit) + additional deletions for refinement cleanup.

### Deliverables

| # | Deliverable | Files Modified | Description |
|---|------------|----------------|-------------|
| 1 | Column reordering | `Board.tsx` | `COLUMN_ORDER` priority map + `columnSortKey()` — Done column always at far right, system columns in fixed positions, pipeline columns preserve API order |
| 2 | Dynamic pipeline phases | `StageDetailContent.tsx` | Replaced 4 hardcoded phases (Design, Build, Refinement, Finalize) with `getVisiblePhases(status)` driven by `PIPELINE_PHASES` array and stage status field |
| 3 | Synthetic Epics column | `Board.tsx`, `formatters.ts` | `useEpics()` hook fetches all epics, rendered as `BoardCard` with status badges, sorted by status (Not Started → In Progress → Complete) |
| 4 | Synthetic Converted column | `Board.tsx`, `formatters.ts` | `useTickets()` hook filtered to `has_stages === true`, rendered as `BoardCard` with stage count subtitles and status badges |
| 5 | Selected-item highlighting | `BoardCard.tsx`, `Board.tsx` | `isSelected` prop on `BoardCard` with `border-blue-500 ring-2 ring-blue-200` style; derived from drawer store stack |
| 6 | Auto-scroll to column | `BoardLayout.tsx`, `Board.tsx` | `selectedColumnIndex` prop triggers `useEffect` smooth-scroll, accounting for 672px drawer width |
| 7 | Refinement badge removal | `StageDetailContent.tsx`, `TicketDetailContent.tsx`, `formatters.ts` | Removed `refinementColor()`, `REFINEMENT_COLORS`, refinement table column from ticket view, refinement badges from stage view |

### Commits

```
0dbfd70 feat(web-server): board UX improvements — column order, phases, epics, highlighting, scroll
[next]  fix(web-server): remove refinement column and badges from detail views
```

### Test Results

- **web-server**: 79/79 tests pass, lint clean, types clean
- **kanban-cli**: 888/888 tests pass
- **orchestrator**: 396/396 tests pass
- **Total**: 1,363 tests passing

---

## Architecture Decisions

### Column Ordering via Priority Map

The `COLUMN_ORDER` record maps column slugs to numeric priorities. System columns have fixed positions; pipeline columns get `100 + index` to preserve their API-defined order. This is more robust than string sorting because it respects the server's intentional ordering.

```typescript
const COLUMN_ORDER: Record<string, number> = {
  epics: -3, converted: -2, to_convert: -1,
  backlog: 0, ready_for_work: 1,
  done: 9999,  // always last
};
// Pipeline columns: 100 + their Object.entries() index
```

### Synthetic Columns Pattern

Epics and Converted columns don't come from the board API. They're constructed client-side from separate hooks (`useEpics()`, `useTickets()`) and injected into the columns array before sorting. The column items are rendered via dedicated render functions (`renderEpicCard`, `renderConvertedTicketCard`) that check `col.slug` in the JSX.

### Dynamic Phases from Stage Status

Instead of hardcoding 4 phases, `getVisiblePhases(status)` uses the `PIPELINE_PHASES` array (matching the default pipeline config) and the stage's `status` string to compute which phases to show:
- `"Not Started"` → empty (no phases)
- `"Complete"` → all phases shown as completed
- Any pipeline phase name → show phases 0..currentIndex, with prior phases marked complete

### Drawer-Driven Selection State

The `useDrawerStore().stack` drives both highlighting and scrolling. `stack[stack.length - 1].id` gives the current drawer item's ID. This is passed to every `BoardCard` as `isSelected` and used to compute `selectedColumnIndex` via `useMemo`.

---

## Files Changed

### `tools/web-server/src/client/pages/Board.tsx`
- Added `COLUMN_ORDER`, `columnSortKey()`, `STATUS_SORT`, `statusSortKey()`
- Added `useEpics()`, `useTickets()` hooks
- Built synthetic epics/converted columns with status-sorted cards
- Added `selectedColumnIndex` computation via `useMemo`
- Added `currentDrawerId` derivation from drawer store stack
- Added `renderEpicCard()`, `renderConvertedTicketCard()` functions
- All render functions accept and propagate `currentDrawerId` for `isSelected`

### `tools/web-server/src/client/components/board/BoardCard.tsx`
- Added `isSelected?: boolean` prop
- Conditional `border-blue-500 ring-2 ring-blue-200` vs `border-slate-200`

### `tools/web-server/src/client/components/board/BoardLayout.tsx`
- Added `selectedColumnIndex?: number | null` prop
- Added `gridRef` + `useEffect` for smooth-scrolling grid container
- Scroll accounts for 672px drawer width + 16px padding

### `tools/web-server/src/client/components/detail/StageDetailContent.tsx`
- Removed `COLUMN_ORDER`, `columnToPhase()`, `isPastPhase()` (old hardcoded phase logic)
- Removed refinement type badge section
- Added `PIPELINE_PHASES` array and `getVisiblePhases()` function
- Dynamic phase rendering via `phases.map()`

### `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`
- Removed "Refinement" table column header and cell
- Removed `refinementColor` import

### `tools/web-server/src/client/utils/formatters.ts`
- Added `epics: '#6366f1'`, `converted: '#8b5cf6'`, `to_convert: '#a855f7'` to `COLUMN_COLORS`
- Removed `REFINEMENT_COLORS` constant and `refinementColor()` export

---

## What Has Been Built (Stages 0-9D + Fixes)

**Web Server** (`tools/web-server/`):

| Feature | Status |
|---------|--------|
| Fastify 5 server + Vite 6 dev server | ✅ (9A) |
| 17 REST endpoints, DataService, React Query hooks | ✅ (9B) |
| Dashboard, unified Board with FilterBar | ✅ (9C) |
| Detail views (Epic, Ticket, Stage, Graph) | ✅ (9D) |
| Drawer system (DrawerHost, store, push/pop navigation) | ✅ (9D) |
| Board: Epics + Converted synthetic columns | ✅ (9D Fixes) |
| Board: Done-at-right column ordering | ✅ (9D Fixes) |
| Board: Selected-item highlighting + auto-scroll | ✅ (9D Fixes) |
| Stage detail: Dynamic pipeline phases | ✅ (9D Fixes) |
| 9 test files, 79 tests | ✅ |

**Other packages** (unchanged):
- **kanban-cli**: 12 commands, 888 tests
- **orchestrator**: Cron scheduler, exit gates, MR chain management, 396 tests
- **MCP server**: Jira, PR/MR, Slack, Confluence tools

---

## Next Steps

### Stage 9E: Session JSONL Engine

The next substage builds the session discovery and JSONL parsing engine. See `docs/plans/stage-9-10-substages/stage-9e-session-jsonl-engine.md` for the full specification.

**What 9E delivers:**
- Session discovery by scanning `~/.claude/projects/` for JSONL files
- JSONL parser that extracts conversation turns, tool calls, and metadata
- API endpoints to serve parsed session data (replacing the 501 stubs from 9B)
- Foundation for 9F (Session Detail Display)

**Dependencies on current work:**
- The "View Latest Session" button on `StageDetailContent` is a placeholder — 9E will provide the session matching logic (worktree branch → session JSONL)
- Session listing endpoint (`/api/sessions/:projectId`) already returns basic data; 9E enriches it with parsed content

### Stage 9F: Session Detail Display
- Depends on 9E
- Renders parsed session conversations in the web UI

### Stage 9G: Real-Time Updates
- Depends on 9B + 9E
- SSE-based live updates for board and session views
