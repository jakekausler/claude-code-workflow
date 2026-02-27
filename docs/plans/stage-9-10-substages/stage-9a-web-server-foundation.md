# Stage 9A: Web Server Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the Fastify + Vite React SPA scaffold at `tools/web-server/` — the foundation all Stage 9/10 substages build on.

**Architecture:** Fastify server on port 3100 serves the API and proxies non-API requests to Vite in dev mode (or serves static assets in production). React SPA with react-router-dom handles client routing. Zustand stores and React Query provider are wired but empty. Tailwind CSS for styling.

**Tech Stack:** Fastify 5, Vite 5, React 19, react-router-dom 6, Zustand 5, TanStack React Query 5, Tailwind CSS 3.4, TypeScript 5, Vitest

---

## Existing Patterns to Match

**tsconfig**: ES2022 target, NodeNext modules, strict mode, declaration maps, source maps.

**vitest**: `globals: true`, include `tests/**/*.test.ts`.

**DI pattern**: Factory functions `createXxx(deps)` returning interfaces. Server uses `createServer()` factory exported from `app.ts`, startup in `index.ts`.

**Package scripts**: `build`, `test` (`vitest run`), `lint` (`tsc --noEmit`), `verify` (`lint && test`).

---

### Task 1: Project Scaffold + Config Files

**Files:**
- Create: `tools/web-server/package.json`
- Create: `tools/web-server/tsconfig.json`
- Create: `tools/web-server/tsconfig.server.json`
- Create: `tools/web-server/vite.config.ts`
- Create: `tools/web-server/vitest.config.ts`
- Create: `tools/web-server/tailwind.config.js`
- Create: `tools/web-server/postcss.config.js`

**Step 1: Create `tools/web-server/package.json`**

```json
{
  "name": "@kanban-workflow/web-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,vite -c blue,green \"tsx watch src/server/index.ts\" \"vite --port 3101\"",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "verify": "npm run lint && npm run test"
  },
  "dependencies": {
    "@fastify/cors": "^11.0.0",
    "@fastify/static": "^8.0.0",
    "@tanstack/react-query": "^5.0.0",
    "@tanstack/react-virtual": "^3.10.0",
    "fastify": "^5.0.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^10.0.0",
    "react-router-dom": "^6.28.0",
    "remark-gfm": "^4.0.0",
    "shiki": "^3.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "concurrently": "^9.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create `tools/web-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@client/*": ["./src/client/*"],
      "@server/*": ["./src/server/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create `tools/web-server/tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "src/server",
    "jsx": "preserve",
    "declaration": false,
    "declarationMap": false,
    "paths": {}
  },
  "include": ["src/server/**/*"],
  "exclude": ["src/client/**/*", "node_modules", "dist", "tests"]
}
```

**Step 4: Create `tools/web-server/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@client': resolve(__dirname, 'src/client'),
      '@server': resolve(__dirname, 'src/server'),
    },
  },
  root: '.',
  server: {
    port: 3101,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3101,
      clientPort: 3101,
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
```

Note: Vite HMR is configured to connect directly to port 3101 (Vite), bypassing the Fastify proxy on 3100. HTTP requests for assets go through Fastify's proxy; WebSocket for HMR connects directly to Vite.

**Step 5: Create `tools/web-server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 6: Create `tools/web-server/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

**Step 7: Create `tools/web-server/postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 8: Run `npm install`**

```bash
cd tools/web-server && npm install
```

**Step 9: Commit**

```bash
git add tools/web-server/package.json tools/web-server/package-lock.json \
  tools/web-server/tsconfig.json tools/web-server/tsconfig.server.json \
  tools/web-server/vite.config.ts tools/web-server/vitest.config.ts \
  tools/web-server/tailwind.config.js tools/web-server/postcss.config.js \
  tools/web-server/node_modules
git commit -m "feat(web-server): scaffold project with configs and dependencies"
```

Note: Check if `node_modules/` is gitignored (it should be). Only commit lock file, not node_modules.

---

### Task 2: Fastify Server + Health Endpoint

**Files:**
- Create: `tools/web-server/src/server/app.ts`
- Create: `tools/web-server/src/server/index.ts`

**Step 1: Create `tools/web-server/src/server/app.ts`**

This is the server factory function (matching the project's DI pattern). Exports `createServer()` for both production use and testing via `app.inject()`.

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  logger?: boolean;
  vitePort?: number;
}

export async function createServer(
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const { logger = true, vitePort = 3101 } = options;
  const isDev = process.env.NODE_ENV !== 'production';

  const app = Fastify({ logger });

  // CORS — allow localhost origins
  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  // --- API routes ---
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // --- Static serving / dev proxy ---
  if (!isDev) {
    // Production: serve built client assets
    const clientDir = join(__dirname, '../client');
    if (existsSync(clientDir)) {
      const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf-8');

      await app.register(fastifyStatic, {
        root: clientDir,
        prefix: '/',
        wildcard: false,
      });

      // SPA fallback — serve index.html for non-API routes
      app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/')) {
          return reply.status(404).send({ error: 'Not found' });
        }
        return reply.type('text/html').send(indexHtml);
      });
    }
  } else {
    // Development: proxy non-API requests to Vite dev server
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      try {
        const viteUrl = `http://localhost:${vitePort}${request.url}`;
        const response = await fetch(viteUrl, {
          headers: { host: `localhost:${vitePort}` },
        });

        reply.status(response.status);
        const contentType = response.headers.get('content-type');
        if (contentType) {
          reply.header('content-type', contentType);
        }

        const body = Buffer.from(await response.arrayBuffer());
        return reply.send(body);
      } catch {
        return reply
          .status(502)
          .send({ error: 'Vite dev server not available' });
      }
    });
  }

  return app;
}
```

**Step 2: Create `tools/web-server/src/server/index.ts`**

```typescript
import { createServer } from './app.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || 'localhost';

const app = await createServer();

await app.listen({ port, host });

console.log(`Server running at http://${host}:${port}`);

// Graceful shutdown
function shutdown(): void {
  app.close().then(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**Step 3: Commit**

```bash
git add tools/web-server/src/server/
git commit -m "feat(web-server): add Fastify server with health endpoint and dev proxy"
```

---

### Task 3: Server Health Endpoint Test

**Files:**
- Create: `tools/web-server/tests/server/health.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/server/app.js';

describe('GET /api/health', () => {
  it('returns ok status with timestamp', async () => {
    const app = await createServer({ logger: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    // Verify timestamp is valid ISO string
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

describe('GET /api/unknown', () => {
  it('returns 404 for unknown API routes', async () => {
    const app = await createServer({ logger: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not found');
  });
});
```

**Step 2: Run tests**

```bash
cd tools/web-server && npm run test
```

Expected: 2 tests pass.

**Step 3: Run lint**

```bash
cd tools/web-server && npm run lint
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add tools/web-server/tests/
git commit -m "test(web-server): add health endpoint tests"
```

---

### Task 4: HTML Entry + CSS + React App + Layout

**Files:**
- Create: `tools/web-server/index.html`
- Create: `tools/web-server/src/client/index.css`
- Create: `tools/web-server/src/client/main.tsx`
- Create: `tools/web-server/src/client/App.tsx`
- Create: `tools/web-server/src/client/components/layout/Layout.tsx`
- Create: `tools/web-server/src/client/components/layout/Sidebar.tsx`
- Create: `tools/web-server/src/client/components/layout/Header.tsx`

**Step 1: Create `tools/web-server/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kanban Workflow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

**Step 2: Create `tools/web-server/src/client/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 3: Create `tools/web-server/src/client/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

**Step 4: Create `tools/web-server/src/client/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { EpicBoard } from './pages/EpicBoard.js';
import { TicketBoard } from './pages/TicketBoard.js';
import { StageBoard } from './pages/StageBoard.js';
import { EpicDetail } from './pages/EpicDetail.js';
import { TicketDetail } from './pages/TicketDetail.js';
import { StageDetail } from './pages/StageDetail.js';
import { SessionDetail } from './pages/SessionDetail.js';
import { DependencyGraph } from './pages/DependencyGraph.js';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/epics" element={<EpicBoard />} />
            <Route path="/epics/:epicId" element={<EpicDetail />} />
            <Route path="/epics/:epicId/tickets" element={<TicketBoard />} />
            <Route
              path="/epics/:epicId/tickets/:ticketId/stages"
              element={<StageBoard />}
            />
            <Route path="/tickets/:ticketId" element={<TicketDetail />} />
            <Route path="/stages/:stageId" element={<StageDetail />} />
            <Route
              path="/sessions/:projectId/:sessionId"
              element={<SessionDetail />}
            />
            <Route path="/graph" element={<DependencyGraph />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

**Step 5: Create `tools/web-server/src/client/components/layout/Layout.tsx`**

```tsx
import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Step 6: Create `tools/web-server/src/client/components/layout/Sidebar.tsx`**

```tsx
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, GitBranch } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/epics', label: 'Epics', icon: Layers },
  { to: '/graph', label: 'Dependency Graph', icon: GitBranch },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex w-64 flex-col bg-slate-900 text-white">
      <div className="border-b border-slate-700 px-6 py-4">
        <h1 className="text-lg font-semibold">Kanban Workflow</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

**Step 7: Create `tools/web-server/src/client/components/layout/Header.tsx`**

```tsx
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Build breadcrumb segments from the current path. */
function buildBreadcrumbs(pathname: string): { label: string; to: string }[] {
  if (pathname === '/') return [{ label: 'Dashboard', to: '/' }];

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; to: string }[] = [
    { label: 'Home', to: '/' },
  ];

  let path = '';
  for (const segment of segments) {
    path += `/${segment}`;
    crumbs.push({ label: segment, to: path });
  }
  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3">
      <nav className="flex items-center gap-1 text-sm text-slate-600">
        {crumbs.map((crumb, i) => (
          <span key={crumb.to} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-slate-400" />}
            {i === crumbs.length - 1 ? (
              <span className="font-medium text-slate-900">{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="hover:text-slate-900">
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </header>
  );
}
```

**Step 8: Commit**

```bash
git add tools/web-server/index.html tools/web-server/src/client/
git commit -m "feat(web-server): add React SPA entry, router, and layout shell"
```

---

### Task 5: Placeholder Pages

**Files:**
- Create: `tools/web-server/src/client/pages/Dashboard.tsx`
- Create: `tools/web-server/src/client/pages/EpicBoard.tsx`
- Create: `tools/web-server/src/client/pages/TicketBoard.tsx`
- Create: `tools/web-server/src/client/pages/StageBoard.tsx`
- Create: `tools/web-server/src/client/pages/EpicDetail.tsx`
- Create: `tools/web-server/src/client/pages/TicketDetail.tsx`
- Create: `tools/web-server/src/client/pages/StageDetail.tsx`
- Create: `tools/web-server/src/client/pages/SessionDetail.tsx`
- Create: `tools/web-server/src/client/pages/DependencyGraph.tsx`

Each page displays its name and any route params so navigation can be visually verified.

**Step 1: Create `tools/web-server/src/client/pages/Dashboard.tsx`**

```tsx
export function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-2 text-slate-600">Pipeline overview and activity feed.</p>
    </div>
  );
}
```

**Step 2: Create `tools/web-server/src/client/pages/EpicBoard.tsx`**

```tsx
export function EpicBoard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Epic Board</h1>
      <p className="mt-2 text-slate-600">All epics across the workflow.</p>
    </div>
  );
}
```

**Step 3: Create `tools/web-server/src/client/pages/TicketBoard.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function TicketBoard() {
  const { epicId } = useParams<{ epicId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Ticket Board</h1>
      <p className="mt-2 text-slate-600">
        Tickets for epic <code className="rounded bg-slate-200 px-1">{epicId}</code>
      </p>
    </div>
  );
}
```

**Step 4: Create `tools/web-server/src/client/pages/StageBoard.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function StageBoard() {
  const { epicId, ticketId } = useParams<{
    epicId: string;
    ticketId: string;
  }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">
        Stage Pipeline Board
      </h1>
      <p className="mt-2 text-slate-600">
        Stages for ticket{' '}
        <code className="rounded bg-slate-200 px-1">{ticketId}</code> in epic{' '}
        <code className="rounded bg-slate-200 px-1">{epicId}</code>
      </p>
    </div>
  );
}
```

**Step 5: Create `tools/web-server/src/client/pages/EpicDetail.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function EpicDetail() {
  const { epicId } = useParams<{ epicId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Epic Detail</h1>
      <p className="mt-2 text-slate-600">
        Details for <code className="rounded bg-slate-200 px-1">{epicId}</code>
      </p>
    </div>
  );
}
```

**Step 6: Create `tools/web-server/src/client/pages/TicketDetail.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Ticket Detail</h1>
      <p className="mt-2 text-slate-600">
        Details for{' '}
        <code className="rounded bg-slate-200 px-1">{ticketId}</code>
      </p>
    </div>
  );
}
```

**Step 7: Create `tools/web-server/src/client/pages/StageDetail.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Stage Detail</h1>
      <p className="mt-2 text-slate-600">
        Details for{' '}
        <code className="rounded bg-slate-200 px-1">{stageId}</code>
      </p>
    </div>
  );
}
```

**Step 8: Create `tools/web-server/src/client/pages/SessionDetail.tsx`**

```tsx
import { useParams } from 'react-router-dom';

export function SessionDetail() {
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId: string;
  }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Session Detail</h1>
      <p className="mt-2 text-slate-600">
        Session{' '}
        <code className="rounded bg-slate-200 px-1">{sessionId}</code> in
        project{' '}
        <code className="rounded bg-slate-200 px-1">{projectId}</code>
      </p>
    </div>
  );
}
```

**Step 9: Create `tools/web-server/src/client/pages/DependencyGraph.tsx`**

```tsx
export function DependencyGraph() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dependency Graph</h1>
      <p className="mt-2 text-slate-600">
        Interactive dependency visualization.
      </p>
    </div>
  );
}
```

**Step 10: Commit**

```bash
git add tools/web-server/src/client/pages/
git commit -m "feat(web-server): add placeholder pages for all routes"
```

---

### Task 6: Zustand Stores + API Boilerplate

**Files:**
- Create: `tools/web-server/src/client/store/board-store.ts`
- Create: `tools/web-server/src/client/store/session-store.ts`
- Create: `tools/web-server/src/client/store/settings-store.ts`
- Create: `tools/web-server/src/client/api/client.ts`
- Create: `tools/web-server/src/client/api/hooks.ts`

**Step 1: Create `tools/web-server/src/client/store/board-store.ts`**

```typescript
import { create } from 'zustand';

export interface BoardState {
  selectedEpic: string | null;
  setSelectedEpic: (id: string | null) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  selectedEpic: null,
  setSelectedEpic: (id) => set({ selectedEpic: id }),
}));
```

**Step 2: Create `tools/web-server/src/client/store/session-store.ts`**

```typescript
import { create } from 'zustand';

export interface SessionState {
  activeSessionIds: string[];
  setActiveSessionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionIds: [],
  setActiveSessionIds: (ids) => set({ activeSessionIds: ids }),
}));
```

**Step 3: Create `tools/web-server/src/client/store/settings-store.ts`**

```typescript
import { create } from 'zustand';

export interface SettingsState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
```

**Step 4: Create `tools/web-server/src/client/api/client.ts`**

```typescript
const API_BASE = '/api';

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
```

**Step 5: Create `tools/web-server/src/client/api/hooks.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client.js';

export interface HealthResponse {
  status: string;
  timestamp: string;
}

/** Health check — useful for verifying connectivity. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
  });
}
```

**Step 6: Commit**

```bash
git add tools/web-server/src/client/store/ tools/web-server/src/client/api/
git commit -m "feat(web-server): add Zustand stores and API client boilerplate"
```

---

### Task 7: Verification

**Step 1: Run tests**

```bash
cd tools/web-server && npm run verify
```

Expected: Type check passes, 2 tests pass.

**Step 2: Run production build**

```bash
cd tools/web-server && npm run build
```

Expected: Vite builds client to `dist/client/`, tsc compiles server to `dist/server/`.

**Step 3: Verify production mode**

```bash
cd tools/web-server && NODE_ENV=production npm run start
```

Navigate to `http://localhost:3100`:
- SPA loads with sidebar and header
- `/api/health` returns JSON
- All placeholder routes render

Stop the server (Ctrl+C).

**Step 4: Verify dev mode**

```bash
cd tools/web-server && npm run dev
```

Navigate to `http://localhost:3100`:
- SPA loads via Fastify's Vite proxy
- Click sidebar links — all routes render with correct content
- `/api/health` returns JSON
- Vite HMR works (edit a page component, see hot reload)

Stop dev servers (Ctrl+C).

**Step 5: Verify existing tools unaffected**

```bash
cd tools/kanban-cli && npm run verify
cd tools/orchestrator && npm run verify
```

Expected: All existing tests still pass.

**Step 6: Final commit (if any fixes were needed)**

```bash
git add -A tools/web-server/
git commit -m "feat(web-server): Stage 9A complete — web server foundation"
```

---

## Success Criteria

- [ ] `npm run dev` starts both Fastify (3100) and Vite (3101)
- [ ] `http://localhost:3100` shows the React SPA with sidebar and placeholder pages
- [ ] `GET /api/health` returns `{ status: 'ok', timestamp: '...' }`
- [ ] All 9 routes render their placeholder content with route params displayed
- [ ] Sidebar navigation works across all top-level routes
- [ ] Breadcrumbs update on route changes
- [ ] `npm run build && NODE_ENV=production npm run start` serves the built SPA
- [ ] `npm run verify` passes (lint + tests)
- [ ] Existing kanban-cli and orchestrator tests unaffected

## Does NOT Include

- Real API endpoints consuming kanban-cli data (9B)
- Board rendering or card components (9C)
- Detail page content (9D)
- Session JSONL parsing (9E)
- Session display components (9F)
- SSE real-time updates (9G)
- Any connection to the orchestrator (10A)
