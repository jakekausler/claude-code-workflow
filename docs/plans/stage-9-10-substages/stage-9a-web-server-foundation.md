# Stage 9A: Web Server Foundation

**Parent:** Stage 9 (Web UI)
**Dependencies:** None (first substage)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Fastify server + Vite React SPA scaffold with all tooling working. A hello-world page served at `localhost:3100`.

## What Ships

1. `tools/web-server/package.json` with all dependencies
2. Fastify server entry point (`src/server/index.ts`)
3. Vite configuration for React SPA
4. React SPA scaffold with router and layout shell
5. Dev tooling (concurrent dev, build, start scripts)
6. `/api/health` endpoint

## Implementation Details

### Package setup

Create `tools/web-server/` with these key dependencies:

**Server:** fastify, @fastify/cors, @fastify/static
**Client:** react, react-dom, @tanstack/react-router (or react-router-dom), zustand, @tanstack/react-query, tailwindcss, lucide-react
**Build:** vite, @vitejs/plugin-react, typescript
**Dev:** vitest, tsx, concurrently

### Fastify server (`src/server/index.ts`)

- Bind to `localhost:3100` (configurable via `PORT` env var)
- In production: serve Vite-built static assets from `dist/client/`
- In development: proxy non-API requests to Vite dev server (port 3101)
- Register CORS (allow localhost origins)
- Register `/api/health` returning `{ status: 'ok', timestamp: ISO }`

**Reference pattern:** claude-devtools `src/main/standalone.ts` lines 1-100, `src/main/services/infrastructure/HttpServer.ts` for Fastify setup.

### Vite configuration (`vite.config.ts`)

- React plugin
- Path aliases: `@client/` -> `src/client/`, `@server/` -> `src/server/`
- Dev server port: 3101 (proxied by Fastify in dev)
- Build output: `dist/client/`

### React SPA scaffold

**Routes (placeholder pages):**
- `/` — Dashboard
- `/epics` — Epic Board
- `/epics/:epicId/tickets` — Ticket Board
- `/epics/:epicId/tickets/:ticketId/stages` — Stage Pipeline Board
- `/epics/:epicId` — Epic Detail
- `/tickets/:ticketId` — Ticket Detail
- `/stages/:stageId` — Stage Detail
- `/sessions/:projectId/:sessionId` — Session Detail

**Layout shell:**
- Sidebar (fixed left, ~250px): navigation links to boards, collapsible
- Header: breadcrumb area
- Main content area: router outlet

**Zustand store:** Empty slices for `board-store.ts`, `session-store.ts`, `settings-store.ts`.

**Tailwind:** Configure with `content` pointing to `src/client/**/*.tsx`.

### Dev scripts

```json
{
  "dev": "concurrently \"tsx watch src/server/index.ts\" \"vite --port 3101\"",
  "build": "vite build && tsc -p tsconfig.server.json",
  "start": "node dist/server/index.js",
  "test": "vitest"
}
```

## Success Criteria

- `npm run dev` starts both Fastify and Vite dev server
- Navigating to `http://localhost:3100` shows the React SPA with sidebar and placeholder pages
- `GET /api/health` returns JSON
- All routes render their placeholder content
- `npm run build && npm run start` serves the built SPA

## Does NOT Include

- Real API endpoints (9B)
- Board rendering (9C)
- Session parsing (9E)
- Any data from kanban-cli
