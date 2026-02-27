---
title: "Tool renderer audit + enrichment"
phase: 14
labels: [enhancement, ui]
depends_on: []
---

# Tool Renderer Audit + Enrichment

Full audit of all tool types with comparison to claude-devtools, enrichment opportunities, and extensible MCP tool support.

## Audit Scope

### Comparison with claude-devtools
- For every tool type Claude can use, compare our renderer against claude-devtools
- Document parity gaps and missing features
- Identify where our renderers exceed claude-devtools (keep those)

### Task Tool Enrichment (Priority)
- `TaskCreate` and `TaskUpdate` tool calls should match with task list files from Claude sessions
- Render task details inline with enriched context from the actual task data
- Show task status progression when multiple TaskUpdate calls exist

### Enrichment Opportunities Beyond claude-devtools
- File references in tool results could link to actual file content
- Bash output could have syntax highlighting based on command type
- Edit tool could show unified diff view
- Grep/Glob results could be clickable to open file context

### Extensible Tool Component Repository
- Design a plugin/registry pattern for tool renderers
- MCP tools should be displayable via an extensible component system
- Third-party MCP tools can register custom renderers
- Fallback renderer for unknown tool types (show raw JSON with formatting)

## Deliverables

- Audit document comparing every tool type: ours vs claude-devtools
- Updated renderers for parity gaps
- Task tool enrichment implementation
- Extensible tool renderer registry for MCP tools
- Documentation for adding custom MCP tool renderers
