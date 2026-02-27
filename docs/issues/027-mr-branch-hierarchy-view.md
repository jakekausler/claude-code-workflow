---
title: "MR/branch hierarchy view"
phase: 14
labels: [feature, ui]
depends_on: []
---

# MR/Branch Hierarchy View

New page showing branch relationships as a DAG (directed acyclic graph) with multi-parent support.

## Requirements

### Visualization
- Display branches as nodes in a DAG (not a simple tree — branches can have multiple parents)
- Show parent/child relationships between feature branches
- Main/master branch as the root
- Branch nodes show: branch name, linked stage (if any), PR/MR status

### Multi-Parent Support
- Some branches merge from multiple parents (e.g., a branch that depends on two feature branches)
- The `pending_merge_parents` field in stage frontmatter tracks this
- Visualize merge points clearly

### Data Source
- Stage frontmatter contains `mr_target_branch` and `pending_merge_parents`
- `parent_branch_tracking` table in the database
- Combine filesystem and DB data for the full picture

### Interaction
- Click branch node to open the linked stage drawer (if linked)
- Highlight the critical path (branches blocking others)
- Filter by repo (multi-repo support)

## Technical Notes

- This is a new page, not an enhancement of an existing one
- DAG layout is more complex than tree layout — consider `dagre` or `elkjs`
- Must handle branches without linked stages (orphan branches)
