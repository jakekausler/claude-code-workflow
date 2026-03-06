# Claude-Devtools Research Notes

## Tech Stack
- Frontend: React 18.3.1, Zustand 4.5.0, Tailwind CSS 3.4.1, @tanstack/react-virtual, @dnd-kit, react-markdown, lucide-react
- Backend: Fastify 5.7.4, ssh2 1.17.0, idb-keyval (IndexedDB)
- Desktop: Electron 40.3.0, electron-vite 2.3.0
- Build: Vite 5.4.2, TypeScript 5.9.3, pnpm 10.25.0
- Testing: Vitest 3.1.4

## Architecture
Three-tier: Renderer (React) ↔ Main Process/HTTP Server ↔ File System
- Adapter pattern: IPC (Electron) or HTTP+SSE (browser) — same interface
- Standalone mode: Headless Node.js server (no Electron) for Docker

## Key Capability: Session Monitoring (Post-Hoc)
- Reads ~/.claude/projects/{encoded-path}/{sessionId}.jsonl files
- Does NOT use hooks — pure post-hoc analysis of existing logs
- FileWatcher (fs.watch) detects changes, incremental parsing
- Parses into: UserChunk, AIChunk, SystemChunk, CompactChunk

## Key Capability: Full Detail Display
- 12+ specialized tool renderers (Read, Edit, Write, Bash, Glob, Grep, Task, Skill, etc.)
- Subagent tree visualization (recursive, with team coordination)
- Context window tracking (7 categories: CLAUDE.md, @-mentions, tool outputs, thinking, team, user)
- Compaction detection and visualization
- Cost calculation with LiteLLM pricing

## Key Capability: Multi-Pane Layout
- Multiple sessions side-by-side
- Drag tabs between panes
- Independent scroll/state per pane
- Command palette search (Cmd+K)

## Session Data Format (JSONL)
Entry types: user, assistant, system, summary, file-history-snapshot, queue-operation
Content blocks: text, thinking, tool_use, tool_result, image
Tool_use linked to tool_result by ID

## Real-Time Updates
- SSE endpoint: /api/events (file-change, todo-change)
- FileWatcher with 100ms debounce
- Append-only optimization (only parse new lines)
- LRU DataCache to avoid re-parsing

## Deployment
- Electron desktop app (macOS, Windows, Linux)
- Docker standalone server (Node 20-slim)
- SSH remote session access (SFTP-based)
- No built-in authentication (localhost or reverse proxy)

## User Interaction: READ-ONLY
- Cannot send messages to Claude sessions
- Cannot approve/deny tool calls
- Pure monitoring/analysis tool

## Multi-User: Limited
- No auth built in
- Docker: single user, mount shared ~/.claude volume
- SSH: per-host session switching
- Would need reverse proxy + auth for true multi-user
