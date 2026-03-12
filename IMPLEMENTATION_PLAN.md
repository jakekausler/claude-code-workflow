# Implementation Plan: Dependency Graph Redesign (React Flow + ELK)

**Spec**: docs/superpowers/specs/2026-03-12-dependency-graph-design.md

## Stage 1: Install Dependencies & Create Type Definitions

**Goal**: Add React Flow and ELK packages, create shared types
**Success Criteria**: Packages installed, types compile, `npm run verify` passes
**Files**:
- `tools/web-server/package.json` — add `@xyflow/react`, `elkjs`
- `tools/web-server/src/client/components/graph/types.ts` — shared types for graph nodes, edges, highlight state
**Status**: Complete

## Stage 2: ELK Layout Hook

**Status**: Complete

## Stage 3: Custom Node & Edge Components

**Status**: Complete

## Stage 4: Highlight Hook

**Status**: Complete

## Stage 5: Assemble & Replace DependencyGraph Page

**Status**: Complete
