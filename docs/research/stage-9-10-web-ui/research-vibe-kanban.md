# Vibe-Kanban Research Notes

## 1. TECH STACK

**Frontend:**
- React 18.2.0 with TypeScript 5.9.2
- Vite 7.3.1 as build tool
- TailwindCSS 3.4.0 for styling
- React Router v1 (@tanstack/react-router 1.161.1) for routing
- React Query (@tanstack/react-query 5.85.5) for server state management
- Zustand 4.5.4 for client state management
- Lexical 0.36.2 for rich text editing
- @hello-pangea/dnd 18.0.1 for drag-and-drop (kanban board)
- Radix UI components for UI primitives
- Electric SQL (@tanstack/electric-db-collection 0.2.6) for local-first sync
- React i18next for internationalization
- Framer Motion for animations
- PostHog for analytics
- xterm.js for terminal emulation in browser

**Backend:**
- Rust with Cargo (Axum 0.8.4, Tokio, SQLx 0.8.6)
- SQLite for database with pre-update hooks
- ts-rs for auto-generating TypeScript types from Rust structs
- Git2 0.20.3 for git operations

**Build:** pnpm 10.13.1, Docker (Alpine multi-stage), Node.js >=20

## 2. ARCHITECTURE

Monorepo structure:
- `packages/local-web/` - Main web UI (React/TypeScript)
- `packages/ui/` - Shared UI component library
- `packages/web-core/` - Shared business logic & hooks
- `packages/remote-web/` - Remote deployment web UI
- `crates/server/` - Main Axum server
- `crates/api-types/` - Shared API types (Rust→TS code generation)
- `crates/db/` - Database layer (SQLx models & migrations)
- `crates/services/` - Business logic services
- `crates/executors/` - Executor/agent orchestration
- `crates/deployment/` - Deployment abstraction trait
- `crates/mcp/` - MCP support

Pattern: Monolithic client-server. Backend serves API + frontend static assets. WebSocket for terminal, SSE for streaming logs.

## 3. KANBAN BOARD IMPLEMENTATION

- `/packages/ui/src/components/KanbanBoard.tsx` - Main container
- Uses `@hello-pangea/dnd` (wraps Atlassian's react-beautiful-dnd)
- Components: KanbanProvider → KanbanCards → KanbanCard → KanbanHeader
- Drag-and-drop between columns, sticky headers, CSS Grid layout
- Status indicator dots colored by column status

## 4. DATA MODEL

Core entities: Projects → Workspaces → Sessions → ExecutionProcess
- **Projects**: id, name, git_repo_path, setup_script
- **Workspaces**: id, project_id, owner_user_id, issue_id, name, archived, pinned
- **Sessions**: id, workspace_id, executor (Claude/Gemini/etc), status
- **ExecutionProcess**: id, session_id, status, stdout, stderr
- **Issues**: id, project_id, status_id, title, priority, sort_order, parent_issue_id

## 5. REAL-TIME UPDATES

1. **WebSocket for Terminal Output** - xterm.js, `/api/terminal` endpoint
2. **SSE for Execution Logs** - `/api/events` endpoint, streams history + live events
3. **Electric SQL for Database Sync** - Local-first sync, optimistic updates
4. **React Query** - API polling with stale-while-revalidate
5. **WebSocket for Scratch Pad** - `/api/scratch/{type}/{id}/stream/ws`

## 6. SESSION INTEGRATION

- `sessionsApi.create()` - Create session with executor choice
- `sessionsApi.followUp()` - Send follow-up message to coding agent
- `sessionsApi.startReview()` - Trigger code review
- Supports multiple coding agents: Claude Code, Gemini CLI, Codex, Amp
- Sessions track status: queued, running, paused, completed, failed

## 7. MULTI-USER & AUTH

- OAuth handoff flow with token auto-refresh
- Organizations with roles (Admin, Member)
- Project-level access, owner tracking
- Each user has isolated workspaces (no real-time collaboration)

## 8. DEPLOYMENT

- **Local**: Self-contained binary, SQLite, localhost:3000
- **Docker**: Alpine multi-stage, compiled binary + built frontend
- **Remote**: Separate `remote` crate, reverse proxy support, SSH for editor access
- Key env vars: PORT, HOST, VK_ALLOWED_ORIGINS, RUST_LOG

## 9. NOTABLE PATTERNS

- Type-safe Rust→TS code generation (ts-rs)
- Trait-based deployment abstraction (swap local/remote)
- Git worktree management for isolated workspaces
- MCP integration for tool discovery
- Stateless API design enabling horizontal scaling

## KEY OBSERVATIONS FOR OUR PROJECT

1. **Terminal in browser via xterm.js + WebSocket** is the proven pattern for showing live agent output
2. **SSE for streaming events** works well for progress/log display
3. **Electric SQL for local-first sync** is interesting but may be overkill for our needs
4. **Rust backend** is very performant but our project is TypeScript - we can use Node.js/Express/Fastify instead
5. **The kanban board uses @hello-pangea/dnd** which is a maintained fork of react-beautiful-dnd
6. **Multi-user is organization-based** with OAuth - good model for our hosted EC2 scenario
7. **Deployment trait abstraction** is a good pattern: design for local, swap implementation for remote
