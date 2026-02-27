---
title: "Improved dependency graph page"
phase: 14
labels: [feature, ui]
depends_on: []
---

# Improved Dependency Graph Page

Upgrade the existing DependencyGraph.tsx with better visualization and drawer integration.

## Requirements

### Visualization
- Improved layout algorithm (hierarchical or force-directed, better than current)
- Zoom and pan controls
- Filter by epic, status, dependency type
- Color coding by status or entity type (epic, ticket, stage)
- Edge labels showing dependency type

### Drawer Integration
- Click any node to open its detail drawer (epic, ticket, or stage drawer)
- Drawer opens alongside the graph (doesn't replace it)
- Selected node highlighted in the graph while drawer is open

### Interaction
- Hover tooltips showing node details (title, status, dependency count)
- Collapse/expand subtrees for complex graphs
- Search/highlight specific nodes

## Technical Notes

- Current `DependencyGraph.tsx` exists but needs significant improvement
- Consider using a dedicated graph library (e.g., `reactflow`, `d3-force`, `elkjs`)
- Graph data comes from the existing `/api/graph` endpoint
- Must handle cross-repo dependencies (format: `repo:name/ITEM-ID`)
