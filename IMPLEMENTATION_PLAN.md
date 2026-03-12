# Implementation Plan: Dependency Graph Redesign (React Flow + ELK)

**Spec**: docs/superpowers/specs/2026-03-12-dependency-graph-design.md

## Stage 1: Install Dependencies & Create Type Definitions

**Goal**: Add React Flow and ELK packages, create shared types
**Success Criteria**: Packages installed, types compile, `npm run verify` passes
**Files**:
- `tools/web-server/package.json` — add `@xyflow/react`, `elkjs`
- `tools/web-server/src/client/components/graph/types.ts` — shared types for graph nodes, edges, highlight state
**Status**: Not Started

## Stage 2: ELK Layout Hook

**Goal**: Create `useElkLayout` hook that transforms API data into React Flow positioned nodes/edges
**Success Criteria**: Hook takes GraphNode[]/GraphEdge[], returns React Flow nodes/edges with ELK-computed positions
**Tests**: Unit test for layout transformation
**Files**:
- `tools/web-server/src/client/components/graph/useElkLayout.ts`
**Status**: Not Started

## Stage 3: Custom Node & Edge Components

**Goal**: Create custom React Flow node components (Epic, Ticket, Stage) and edge component
**Success Criteria**: Nodes render with correct colors, sizes, status badges. Edge renders with correct styling per type.
**Tests**: Components render without errors
**Files**:
- `tools/web-server/src/client/components/graph/nodes/EpicNode.tsx`
- `tools/web-server/src/client/components/graph/nodes/TicketNode.tsx`
- `tools/web-server/src/client/components/graph/nodes/StageNode.tsx`
- `tools/web-server/src/client/components/graph/edges/DependencyEdge.tsx`
**Status**: Not Started

## Stage 4: Highlight Hook

**Goal**: Create `useGraphHighlight` hook for selection-based highlighting
**Success Criteria**: Selecting a node computes direct deps, transitive deps, and unrelated nodes. Returns opacity/style maps.
**Tests**: Unit test for highlight computation (direct vs transitive vs unrelated)
**Files**:
- `tools/web-server/src/client/components/graph/useGraphHighlight.ts`
**Status**: Not Started

## Stage 5: Assemble & Replace DependencyGraph Page

**Goal**: Wire everything together, replace the existing DependencyGraph.tsx
**Success Criteria**: Graph renders with ELK layout, selection highlighting works, filters work, detail panel works, zoom/pan/minimap work. `npm run verify` passes.
**Files**:
- `tools/web-server/src/client/components/graph/GraphCanvas.tsx`
- `tools/web-server/src/client/components/graph/GraphControls.tsx`
- `tools/web-server/src/client/components/graph/GraphFilters.tsx`
- `tools/web-server/src/client/pages/DependencyGraph.tsx` — full rewrite
**Status**: Not Started
