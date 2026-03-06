# Credits

This project builds heavily on the work of others. We are grateful to the following projects.

## claude-devtools

The session viewer and analysis capabilities in this project are derived from or heavily inspired by [claude-devtools](https://github.com/anthropics/claude-devtools). The following core subsystems originate from that work:

- **Session JSONL parsing** — Reading and interpreting Claude Code session files in JSONL format, including handling of message types, roles, and metadata
- **Chunk building** — Assembling raw session events into structured conversation chunks with proper turn boundaries
- **Tool rendering** — Displaying tool use invocations and tool result blocks in the session viewer UI
- **Subagent tree resolution** — Walking the hierarchy of agent invocations to reconstruct the full execution tree from a session
- **Context tracking** — Measuring and surfacing context window usage across the lifetime of a session
- **Cost calculation** — Computing per-turn and per-session token costs using model-specific pricing

## vibe-kanban

The kanban board design and deployment approach were inspired by [vibe-kanban](https://github.com/mckaywrigley/vibe-kanban):

- **Kanban board design** — Column-based stage visualization, card layout patterns, and drag-and-drop interaction model
- **Hosted deployment architecture** — The approach to packaging and deploying the web server for shared team access
