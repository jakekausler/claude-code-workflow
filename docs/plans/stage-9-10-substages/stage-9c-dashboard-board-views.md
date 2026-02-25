# Stage 9C: Dashboard + Board Views — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Dashboard home page and three board views (Epic Board, Ticket Board, Stage Pipeline Board) consuming the REST API hooks built in Stage 9B.

**Architecture:** Pure client-side implementation. All data flows through existing React Query hooks in `hooks.ts`. Shared `BoardColumn` and `BoardCard` components provide consistent board rendering across all three board views. Pages replace existing placeholder stubs. No server changes.

**Tech Stack:** React 19, React Router 6, React Query 5, Zustand 5, Tailwind CSS 3.4, lucide-react, TypeScript 5 (strict, NodeNext/ESM)

**CRITICAL ESM RULE:** All relative imports MUST use `.js` extensions — e.g., `import { BoardCard } from './BoardCard.js'`

---

## Task 1: Create BoardColumn Component

**Files:**
- Create: `tools/web-server/src/client/components/board/BoardColumn.tsx`

**Step 1: Create the BoardColumn component**

```tsx
import type { ReactNode } from 'react';

interface BoardColumnProps {
  title: string;
  color: string;
  count: number;
  children: ReactNode;
}

export function BoardColumn({ title, color, count, children }: BoardColumnProps) {
  return (
    <div className="flex flex-col rounded-lg bg-slate-100 min-h-0">
      <div className="sticky top-0 z-10 rounded-t-lg bg-slate-100 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          </div>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
            {count}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {count === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No items</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors related to BoardColumn

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/board/BoardColumn.tsx
git commit -m "feat(web-server): add BoardColumn component for board views"
```

---

## Task 2: Create BoardCard Component

**Files:**
- Create: `tools/web-server/src/client/components/board/BoardCard.tsx`

**Step 1: Create the BoardCard component**

```tsx
interface Badge {
  label: string;
  color: string;
}

interface BoardCardProps {
  id: string;
  title: string;
  subtitle?: string;
  badges?: Badge[];
  progress?: number;
  statusDot?: string;
  onClick: () => void;
}

export type { Badge };

export function BoardCard({
  id,
  title,
  subtitle,
  badges,
  progress,
  statusDot,
  onClick,
}: BoardCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {statusDot && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statusDot }}
              />
            )}
            <span className="text-xs font-medium text-slate-500">{id}</span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-slate-900 truncate">{title}</p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
      </div>
      {badges && badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: badge.color + '20', color: badge.color }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors related to BoardCard

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/board/BoardCard.tsx
git commit -m "feat(web-server): add BoardCard component for board views"
```

---

## Task 3: Create Board Layout Utility

**Files:**
- Create: `tools/web-server/src/client/components/board/BoardLayout.tsx`

**Step 1: Create the BoardLayout wrapper**

This provides the CSS Grid container and loading/error states shared across all board views.

```tsx
import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface BoardLayoutProps {
  children: ReactNode;
  isLoading: boolean;
  error: Error | null;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function BoardLayout({ children, isLoading, error, emptyMessage, isEmpty }: BoardLayoutProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertCircle size={20} />
        <span className="ml-2 text-sm">Failed to load data: {error.message}</span>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        {emptyMessage ?? 'No data available.'}
      </div>
    );
  }

  return (
    <div className="grid auto-cols-[280px] grid-flow-col gap-4 overflow-x-auto pb-4">
      {children}
    </div>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/board/BoardLayout.tsx
git commit -m "feat(web-server): add BoardLayout wrapper with loading/error states"
```

---

## Task 4: Create formatters utility

**Files:**
- Create: `tools/web-server/src/client/utils/formatters.ts`

**Step 1: Create utility functions**

```ts
/**
 * Convert a slug like "ready_for_work" to title case "Ready For Work".
 */
export function slugToTitle(slug: string): string {
  return slug
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Compute completion percentage from a count and total.
 * Returns 0 if total is 0.
 */
export function completionPercent(complete: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((complete / total) * 100);
}

/**
 * Map a column slug to a display color for the BoardColumn dot.
 */
const COLUMN_COLORS: Record<string, string> = {
  backlog: '#94a3b8',
  ready_for_work: '#3b82f6',
  design: '#8b5cf6',
  user_design_feedback: '#a855f7',
  build: '#f59e0b',
  automatic_testing: '#10b981',
  manual_testing: '#14b8a6',
  finalize: '#06b6d4',
  pr_created: '#6366f1',
  addressing_comments: '#ec4899',
  done: '#22c55e',
};

export function columnColor(slug: string): string {
  return COLUMN_COLORS[slug] ?? '#64748b';
}

/**
 * Map an epic/ticket status to a display color.
 */
export function statusColor(status: string): string {
  switch (status) {
    case 'not_started':
      return '#94a3b8';
    case 'in_progress':
      return '#3b82f6';
    case 'complete':
      return '#22c55e';
    default:
      return '#64748b';
  }
}

/**
 * Map a refinement type to a badge color.
 */
const REFINEMENT_COLORS: Record<string, string> = {
  frontend: '#3b82f6',
  backend: '#f59e0b',
  cli: '#8b5cf6',
  api: '#10b981',
  database: '#ef4444',
  infrastructure: '#6366f1',
  documentation: '#64748b',
  testing: '#14b8a6',
};

export function refinementColor(type: string): string {
  return REFINEMENT_COLORS[type] ?? '#64748b';
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/utils/formatters.ts
git commit -m "feat(web-server): add formatter utilities for slugs, colors, and percentages"
```

---

## Task 5: Implement Epic Board Page

**Files:**
- Modify: `tools/web-server/src/client/pages/EpicBoard.tsx`

**Step 1: Replace the placeholder with the full implementation**

```tsx
import { useNavigate } from 'react-router-dom';
import { useEpics } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { completionPercent, statusColor } from '../utils/formatters.js';
import type { EpicListItem } from '../api/hooks.js';

function categorizeEpics(epics: EpicListItem[]) {
  const notStarted: EpicListItem[] = [];
  const inProgress: EpicListItem[] = [];
  const complete: EpicListItem[] = [];

  for (const epic of epics) {
    switch (epic.status) {
      case 'complete':
        complete.push(epic);
        break;
      case 'in_progress':
        inProgress.push(epic);
        break;
      default:
        notStarted.push(epic);
        break;
    }
  }

  return { notStarted, inProgress, complete };
}

export function EpicBoard() {
  const navigate = useNavigate();
  const { data: epics, isLoading, error } = useEpics();

  const { notStarted, inProgress, complete } = categorizeEpics(epics ?? []);

  const columns = [
    { title: 'Not Started', color: statusColor('not_started'), items: notStarted },
    { title: 'In Progress', color: statusColor('in_progress'), items: inProgress },
    { title: 'Complete', color: statusColor('complete'), items: complete },
  ];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Epic Board</h1>
      <BoardLayout isLoading={isLoading} error={error ?? null}>
        {columns.map((col) => (
          <BoardColumn key={col.title} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((epic) => (
              <BoardCard
                key={epic.id}
                id={epic.id}
                title={epic.title}
                subtitle={`${epic.ticket_count} ticket${epic.ticket_count !== 1 ? 's' : ''}`}
                badges={epic.jira_key ? [{ label: epic.jira_key, color: '#3b82f6' }] : undefined}
                progress={epic.status === 'complete' ? 100 : epic.status === 'in_progress' ? 50 : 0}
                onClick={() => navigate(`/epics/${epic.id}/tickets`)}
              />
            ))}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
```

**NOTE on progress:** The `EpicListItem` type does NOT include a "completed ticket count" — only `ticket_count`. The progress bar will show 0% for now. A future enhancement could add `completed_ticket_count` to the API response. For epics with status `complete`, we can infer 100%.

Actually, let's adjust the progress calculation to use the epic's status as a heuristic:

```tsx
// Replace the progress line in the BoardCard with:
progress={epic.status === 'complete' ? 100 : epic.status === 'in_progress' ? 50 : 0}
```

This is imprecise but better than always 0. The handoff doc says completion % bar but the API doesn't provide granular data. This is a reasonable placeholder.

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/EpicBoard.tsx
git commit -m "feat(web-server): implement Epic Board with 3-column layout"
```

---

## Task 6: Implement Ticket Board Page

**Files:**
- Modify: `tools/web-server/src/client/pages/TicketBoard.tsx`

**Step 1: Replace the placeholder with the full implementation**

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { useTickets, useEpic } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { statusColor } from '../utils/formatters.js';
import type { TicketListItem } from '../api/hooks.js';

function categorizeTickets(tickets: TicketListItem[]) {
  const notStarted: TicketListItem[] = [];
  const inProgress: TicketListItem[] = [];
  const complete: TicketListItem[] = [];
  const toConvert: TicketListItem[] = [];

  for (const ticket of tickets) {
    if (!ticket.has_stages) {
      toConvert.push(ticket);
      continue;
    }
    switch (ticket.status) {
      case 'complete':
        complete.push(ticket);
        break;
      case 'in_progress':
        inProgress.push(ticket);
        break;
      default:
        notStarted.push(ticket);
        break;
    }
  }

  return { notStarted, inProgress, complete, toConvert };
}

export function TicketBoard() {
  const { epicId } = useParams<{ epicId: string }>();
  const navigate = useNavigate();
  const { data: tickets, isLoading: ticketsLoading, error: ticketsError } = useTickets({ epic: epicId });
  const { data: epic } = useEpic(epicId ?? '');

  const { notStarted, inProgress, complete, toConvert } = categorizeTickets(tickets ?? []);

  const columns = [
    { title: 'Not Started', color: statusColor('not_started'), items: notStarted },
    { title: 'In Progress', color: statusColor('in_progress'), items: inProgress },
    { title: 'Complete', color: statusColor('complete'), items: complete },
  ];

  // Only show "To Convert" column if there are tickets without stages
  if (toConvert.length > 0) {
    columns.push({ title: 'To Convert', color: '#f59e0b', items: toConvert });
  }

  const pageTitle = epic ? `${epic.id} — ${epic.title}` : epicId ?? 'Tickets';

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{pageTitle}</h1>
      <p className="mb-4 text-sm text-slate-500">Tickets for this epic</p>
      <BoardLayout isLoading={ticketsLoading} error={ticketsError ?? null}>
        {columns.map((col) => (
          <BoardColumn key={col.title} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((ticket) => {
              const badges: { label: string; color: string }[] = [];
              if (ticket.jira_key) badges.push({ label: ticket.jira_key, color: '#3b82f6' });
              if (ticket.source === 'jira') badges.push({ label: 'Jira', color: '#0052cc' });

              return (
                <BoardCard
                  key={ticket.id}
                  id={ticket.id}
                  title={ticket.title}
                  subtitle={`${ticket.stage_count} stage${ticket.stage_count !== 1 ? 's' : ''}`}
                  badges={badges.length > 0 ? badges : undefined}
                  progress={ticket.status === 'complete' ? 100 : ticket.status === 'in_progress' ? 50 : 0}
                  onClick={() => navigate(`/epics/${epicId}/tickets/${ticket.id}/stages`)}
                />
              );
            })}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/TicketBoard.tsx
git commit -m "feat(web-server): implement Ticket Board with dynamic To Convert column"
```

---

## Task 7: Implement Stage Pipeline Board Page

**Files:**
- Modify: `tools/web-server/src/client/pages/StageBoard.tsx`

**Step 1: Replace the placeholder with the full implementation**

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { useBoard, useEpic, useTicket } from '../api/hooks.js';
import { BoardLayout } from '../components/board/BoardLayout.js';
import { BoardColumn } from '../components/board/BoardColumn.js';
import { BoardCard } from '../components/board/BoardCard.js';
import { slugToTitle, columnColor, refinementColor } from '../utils/formatters.js';
import type { BoardStageItem } from '../api/hooks.js';

export function StageBoard() {
  const { epicId, ticketId } = useParams<{ epicId: string; ticketId: string }>();
  const navigate = useNavigate();
  const { data: board, isLoading, error } = useBoard({ ticket: ticketId });
  const { data: epic } = useEpic(epicId ?? '');
  const { data: ticket } = useTicket(ticketId ?? '');

  const columns = board
    ? Object.entries(board.columns).map(([slug, items]) => ({
        slug,
        title: slugToTitle(slug),
        color: columnColor(slug),
        items: items.filter((item): item is BoardStageItem => item.type === 'stage'),
      }))
    : [];

  const pageTitle = ticket
    ? `${ticket.id} — ${ticket.title}`
    : ticketId ?? 'Stages';

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{pageTitle}</h1>
      {epic && (
        <p className="mb-4 text-sm text-slate-500">
          {epic.id} — {epic.title}
        </p>
      )}
      <BoardLayout isLoading={isLoading} error={error ?? null}>
        {columns.map((col) => (
          <BoardColumn key={col.slug} title={col.title} color={col.color} count={col.items.length}>
            {col.items.map((stage) => {
              const badges = (stage.blocked_by && stage.blocked_by.length > 0)
                ? [{ label: `${stage.blocked_by.length} blocked`, color: '#ef4444' }]
                : [];

              // Add refinement type badges if available
              // Note: BoardStageItem does not include refinement_type directly.
              // The stage pipeline board shows stage data from the board API which
              // does NOT include refinement_type. This is a known limitation.

              return (
                <BoardCard
                  key={stage.id}
                  id={stage.id}
                  title={stage.title}
                  badges={badges.length > 0 ? badges : undefined}
                  statusDot={stage.session_active ? '#22c55e' : undefined}
                  onClick={() => navigate(`/stages/${stage.id}`)}
                />
              );
            })}
          </BoardColumn>
        ))}
      </BoardLayout>
    </div>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/StageBoard.tsx
git commit -m "feat(web-server): implement Stage Pipeline Board with dynamic columns"
```

---

## Task 8: Implement Dashboard Page

**Files:**
- Modify: `tools/web-server/src/client/pages/Dashboard.tsx`

**Step 1: Replace the placeholder with the full implementation**

```tsx
import { Link } from 'react-router-dom';
import { useStats, useBoard, useStages } from '../api/hooks.js';
import { Layers, GitBranch, AlertTriangle, Activity, Loader2 } from 'lucide-react';
import { slugToTitle } from '../utils/formatters.js';

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: board } = useBoard({ column: 'backlog' });
  const { data: stages } = useStages();

  const blockedCount = board
    ? Object.values(board.columns).reduce((sum, items) => sum + items.length, 0)
    : 0;

  const recentStages = (stages ?? []).slice(0, 20);

  const totalStages = stats?.total_stages ?? 0;
  const byColumn = stats?.by_column ?? {};
  const doneCount = byColumn['done'] ?? 0;
  const completionPct = totalStages > 0 ? Math.round((doneCount / totalStages) * 100) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Stages" value={statsLoading ? '...' : String(totalStages)} />
        <StatCard label="Total Tickets" value={statsLoading ? '...' : String(stats?.total_tickets ?? 0)} />
        <StatCard label="Completion" value={statsLoading ? '...' : `${completionPct}%`} />
        <StatCard label="Active Sessions" value="—" subtitle="Available in 9E" />
      </div>

      {/* Blocked Alert */}
      {blockedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="text-amber-600" />
          <span className="text-sm font-medium text-amber-800">
            {blockedCount} stage{blockedCount !== 1 ? 's' : ''} in backlog
          </span>
        </div>
      )}

      {/* Column Breakdown */}
      {stats && Object.keys(byColumn).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Stages by Column</h2>
          <div className="space-y-2">
            {Object.entries(byColumn).map(([slug, count]) => (
              <div key={slug} className="flex items-center gap-3">
                <span className="w-40 text-xs text-slate-600 truncate">{slugToTitle(slug)}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: totalStages > 0 ? `${(count / totalStages) * 100}%` : '0%' }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-slate-500">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Recent Activity</h2>
        </div>
        {recentStages.length === 0 ? (
          <p className="text-sm text-slate-400">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {recentStages.map((stage) => (
              <div key={stage.id} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 text-slate-400 truncate">{stage.id}</span>
                <span className="truncate text-slate-700">{stage.title}</span>
                <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                  {slugToTitle(stage.kanban_column)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <QuickLink to="/epics" icon={Layers} label="Epic Board" description="View all epics and their progress" />
        <QuickLink to="/graph" icon={GitBranch} label="Dependency Graph" description="Visualize dependencies across stages" />
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <Icon size={20} />
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </Link>
  );
}
```

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/Dashboard.tsx
git commit -m "feat(web-server): implement Dashboard with stats, activity feed, and quick links"
```

---

## Task 9: Enhance Header Breadcrumbs

**Files:**
- Modify: `tools/web-server/src/client/components/layout/Header.tsx`

**Step 1: Update buildBreadcrumbs for better labels**

The current `buildBreadcrumbs` shows raw URL segments. Enhance it to show human-readable labels for known path patterns.

```tsx
import { useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Known route segment labels. Dynamic segments (IDs) are left as-is since
 * we don't have API data in the header. The board pages provide their own
 * contextual titles via page headers.
 */
const SEGMENT_LABELS: Record<string, string> = {
  epics: 'Epics',
  tickets: 'Tickets',
  stages: 'Stages',
  sessions: 'Sessions',
  graph: 'Dependency Graph',
};

function buildBreadcrumbs(pathname: string): { label: string; to: string }[] {
  if (pathname === '/') return [{ label: 'Dashboard', to: '/' }];

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; to: string }[] = [
    { label: 'Dashboard', to: '/' },
  ];

  let path = '';
  for (const segment of segments) {
    path += `/${segment}`;
    const label = SEGMENT_LABELS[segment] ?? segment;
    crumbs.push({ label, to: path });
  }
  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-slate-600">
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

**Step 2: Verify lint passes**

Run: `cd tools/web-server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/layout/Header.tsx
git commit -m "feat(web-server): enhance breadcrumbs with human-readable segment labels"
```

---

## Task 10: Full Verification

**Step 1: Run verify (lint + tests)**

Run: `cd tools/web-server && npm run verify`
Expected: All existing tests pass, no lint errors.

**Step 2: Verify other tools are unaffected**

Run: `cd tools/kanban-cli && npm run verify`
Expected: All 888+ tests pass.

Run: `cd tools/orchestrator && npm run verify`
Expected: All ~396 tests pass.

**Step 3: Manual smoke test**

Run: `cd tools/web-server && npm run dev`
Open http://localhost:3100/ in browser.

Verify:
- Dashboard shows stats cards, column breakdown, activity feed, quick links
- `/epics` shows epic cards in 3 columns
- Clicking an epic navigates to `/epics/:epicId/tickets`
- Ticket board shows ticket cards with Jira badges, "To Convert" column if applicable
- Clicking a ticket navigates to `/epics/:epicId/tickets/:ticketId/stages`
- Stage pipeline board shows dynamic columns from pipeline config
- Breadcrumbs work at all board levels
- Empty columns show "No items" state
- Horizontal scroll works when columns overflow

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(web-server): address verification issues from 9C implementation"
```

---

## Known Limitations & Design Decisions

### 1. Epic completion percentage
The `EpicListItem` API type includes `ticket_count` but not `completed_ticket_count`. The Epic Board uses a status-based heuristic (not_started=0%, in_progress=50%, complete=100%). A future API enhancement could return granular completion data.

### 2. Ticket completion percentage
Same limitation. Uses status-based heuristic.

### 3. Refinement type badges on Stage Pipeline Board
The `BoardStageItem` from the board API does NOT include `refinement_type`. The handoff spec asks for refinement badges. The implementer should check if the board API actually returns this data. If not, a supplementary `useStages({ ticket })` call can provide it.

### 4. Active sessions count on Dashboard
Placeholder showing "—" until 9E/9G wire up live session detection.

### 5. No component tests
The handoff doc notes that React Testing Library is NOT installed. Given that 9C is primarily about rendering data from hooks, the existing server-side tests provide coverage for the data layer. Component tests can be added in a future stage if needed.

### 6. Header breadcrumbs show raw IDs
The Header component doesn't have access to API data for resolving IDs to titles. The board pages provide their own contextual page headers with resolved titles. The breadcrumb shows the raw ID (e.g., "EPIC-001") which is acceptable since the page header shows the full title.
