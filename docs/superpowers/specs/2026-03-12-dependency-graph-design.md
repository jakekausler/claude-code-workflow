# Dependency Graph Visualization Redesign

**Date**: 2026-03-12
**Status**: Approved

## Problem

The current dependency graph has three major issues:
1. **Flat row layout** — All epics in one row, tickets in another, stages in a third. With many nodes, this creates a single long horizontal line per type that's impossible to follow.
2. **Edges behind nodes** — Bezier curves go from source to target with no routing, passing behind intermediate nodes.
3. **No connection highlighting** — Selecting a node opens a detail panel but doesn't visually highlight the dependency subgraph.

## Requirements

- **Scale**: Dozens of epics, each with ~24 tickets, each with 5+ stages (potentially hundreds to low thousands of nodes)
- **Use cases**: Full-picture overview, filtered-to-epic view, trace-from-specific-item exploration
- **Selection highlighting**: Full transitive chain with visual distinction — direct connections strong, transitive connections subtle, unrelated nodes dimmed
- **Edge routing**: Minimize crossings through layout algorithm; don't need pixel-perfect routing but edges should not pass through unrelated nodes
- **Interaction**: Read-only (view and explore, no drag-to-rearrange or edge editing)

## Approach

**React Flow + ELK** — Replace the custom SVG rendering with React Flow for the graph canvas and ELK (via elkjs) for hierarchical layout computation.

### Why React Flow + ELK

- React Flow handles zoom, pan, selection, minimap, accessibility, and performance virtualization out of the box
- ELK's layered (Sugiyama) algorithm provides superior edge routing, crossing minimization, and hierarchical grouping
- ELK handles grouping/nesting natively — tickets belonging to the same epic cluster together
- Scales well to 500+ nodes
- Swapping layout engines later (e.g., to Dagre for simpler cases) is a one-file change since React Flow abstracts the layout

## Architecture

### Component Structure

```
DependencyGraphPage (page shell — filters, controls, layout)
├── GraphCanvas (React Flow wrapper — zoom/pan/viewport)
│   ├── EpicNode (custom node type — purple)
│   ├── TicketNode (custom node type — blue)
│   ├── StageNode (custom node type — green)
│   └── DependencyEdge (custom edge — resolved/unresolved styling)
├── GraphControls (zoom buttons, minimap toggle)
├── GraphFilters (epic/status/dep-type dropdowns — reuses existing filter logic)
└── DetailPanel (existing right sidebar — unchanged)
```

### Data Flow

Unchanged from current implementation:

```
useGraph() hook → GET /api/graph → buildGraph() in kanban-cli → GraphOutput
```

The only change is on the frontend: transform `GraphNode[]`/`GraphEdge[]` into React Flow's node/edge format, then let ELK compute positions.

## Node Design

| Type | Color | Size | Content |
|------|-------|------|---------|
| Epic | Purple accent | 200×56px | Title + status badge |
| Ticket | Blue accent | 180×48px | Title + status badge |
| Stage | Green accent | 160×40px | Title + status badge |

Status badges use the same color coding as the kanban board (in_progress=amber, completed=green, blocked=red).

## Selection & Highlighting

When a node is selected:
- **Selected node**: Bold ring/glow
- **Direct dependencies** (immediate parents/children): Highlighted border, elevated opacity
- **Transitive dependencies** (full ancestor/descendant chain): Subtler highlight — dashed border or reduced-intensity accent
- **Unrelated nodes**: Dim to ~30% opacity
- **Connected edges**: Stay full color; direct edges get thicker (2.5px)
- **Unrelated edges**: Dim to ~15% opacity

Clicking empty canvas deselects, restoring full opacity.

## ELK Layout Configuration

- **Algorithm**: Layered (Sugiyama) — `elk.algorithm: layered`
- **Direction**: Top-to-bottom — `elk.direction: DOWN`
- **Layer constraints**: Epics always above tickets, tickets above stages
- **Node spacing**: ~40px horizontal, ~80px vertical between layers
- **Edge routing**: ELK's built-in orthogonal/spline routing
- **Crossing minimization**: Enabled by default in layered algorithm
- **Grouping**: Tickets sharing a parent epic cluster together via partition constraints; stages cluster below their parent tickets
- **Performance**: Layout computed async via elkjs. Cached per filter set. Skeleton/spinner shown during computation.

## Edge Styling

| Type | Color | Stroke | Pattern |
|------|-------|--------|---------|
| Resolved | Gray (#94a3b8) | 1.5px | Solid |
| Unresolved | Amber (#f59e0b) | 2px | Solid |
| Critical path | Red (#ef4444) | 2.5px | Solid |
| Cross-repo | Same as above | Same | Dashed |

Arrow direction: A → B means "B depends on A". Triangular arrowhead markers.

No edge labels by default. Tooltip on hover shows dependency type and resolved/unresolved status.

## Feature Parity

Everything the current graph does must still work:

- Epic dropdown filter, status filter, dependency type filter (client-side, applied before layout)
- Cycle warning banner (amber, top of page)
- Zoom/pan (React Flow native, replaces custom viewBox)
- Zoom in/out/reset buttons (top-right, via `useReactFlow()`)
- Detail panel (right sidebar, 380px, unchanged components)
- Tooltips on hover (title, status, dependency count)

### New additions

- **Minimap**: React Flow's built-in minimap in bottom-right corner
- **Selection highlighting**: Full transitive dependency visualization

### What gets removed

- Custom SVG rendering
- ViewBox state management
- Manual zoom/pan math (wheel handler, mouse drag)
- `layoutNodes()` function (replaced by ELK)

## Files Changed

- `tools/web-server/src/client/pages/DependencyGraph.tsx` — Full rewrite
- New files:
  - `tools/web-server/src/client/components/graph/GraphCanvas.tsx`
  - `tools/web-server/src/client/components/graph/nodes/EpicNode.tsx`
  - `tools/web-server/src/client/components/graph/nodes/TicketNode.tsx`
  - `tools/web-server/src/client/components/graph/nodes/StageNode.tsx`
  - `tools/web-server/src/client/components/graph/edges/DependencyEdge.tsx`
  - `tools/web-server/src/client/components/graph/GraphControls.tsx`
  - `tools/web-server/src/client/components/graph/GraphFilters.tsx`
  - `tools/web-server/src/client/components/graph/useElkLayout.ts`
  - `tools/web-server/src/client/components/graph/useGraphHighlight.ts`
  - `tools/web-server/src/client/components/graph/types.ts`

## Dependencies Added

- `@xyflow/react` (React Flow v12)
- `elkjs`
