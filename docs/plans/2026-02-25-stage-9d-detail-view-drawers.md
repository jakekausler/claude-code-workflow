# Stage 9D: Detail View Drawers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace placeholder detail pages with right-aligned slide-in drawers that display epic, ticket, and stage details while keeping the board/dashboard visible. Plus a full-page dependency graph visualization.

**Architecture:** A shared `DetailDrawer` shell component provides the slide-in panel + backdrop overlay. A Zustand `drawer-store` manages open/close state and a stack of drawer entries (type + ID) to support nested navigation (e.g., epic drawer → click ticket → ticket drawer). Board card clicks open drawers instead of navigating to separate pages. The `/graph` route remains a full page. Existing detail page routes (`/epics/:epicId`, etc.) redirect to `/board` with a query param that auto-opens the corresponding drawer on mount.

**Tech Stack:** React 19, React Router 6, Zustand 5, React Query 5, Tailwind CSS 3.4, react-markdown + remark-gfm, lucide-react, mermaid (new dependency for graph page)

---

## Glossary

- **Drawer**: A right-aligned slide-in panel overlaying the current page content
- **Drawer stack**: An ordered list of `{ type, id }` entries — only the top entry is visible, but closing it reveals the previous one
- **Detail content component**: The inner component (e.g., `EpicDetailContent`) that renders inside the drawer shell

---

## Task 1: Create Drawer Zustand Store

**Files:**
- Create: `tools/web-server/src/client/store/drawer-store.ts`

**Step 1: Write the store**

```typescript
import { create } from 'zustand';

export interface DrawerEntry {
  type: 'epic' | 'ticket' | 'stage';
  id: string;
}

interface DrawerState {
  /** Stack of open drawers — last entry is the visible one */
  stack: DrawerEntry[];
  /** Push a new drawer onto the stack */
  open: (entry: DrawerEntry) => void;
  /** Pop the top drawer off the stack (go back) */
  back: () => void;
  /** Close all drawers */
  closeAll: () => void;
  /** Replace the entire stack (used for deep-link entry) */
  setStack: (stack: DrawerEntry[]) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  stack: [],
  open: (entry) =>
    set((state) => ({ stack: [...state.stack, entry] })),
  back: () =>
    set((state) => ({ stack: state.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
  setStack: (stack) => set({ stack }),
}));
```

**Step 2: Commit**

```bash
git add tools/web-server/src/client/store/drawer-store.ts
git commit -m "feat(web-server): add drawer Zustand store for detail view navigation"
```

---

## Task 2: Create DetailDrawer Shell Component

**Files:**
- Create: `tools/web-server/src/client/components/detail/DetailDrawer.tsx`

This is the slide-in panel that wraps any detail content. It handles:
- Backdrop overlay (click to close all)
- Right-aligned panel with slide-in animation
- Header with back button (if stack depth > 1), title, and close button
- Scroll container for content

**Step 1: Write the component**

```tsx
import { useEffect, useCallback } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import { useDrawerStore } from '../../store/drawer-store.js';

interface DetailDrawerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DetailDrawer({ title, subtitle, children }: DetailDrawerProps) {
  const { stack, back, closeAll } = useDrawerStore();
  const canGoBack = stack.length > 1;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    },
    [closeAll],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity"
        onClick={closeAll}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          {canGoBack && (
            <button
              onClick={back}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Go back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && (
              <p className="truncate text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            onClick={closeAll}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/detail/DetailDrawer.tsx
git commit -m "feat(web-server): add DetailDrawer slide-in panel shell component"
```

---

## Task 3: Create Shared Detail Components — StatusBadge, DependencyList

**Files:**
- Create: `tools/web-server/src/client/components/detail/StatusBadge.tsx`
- Create: `tools/web-server/src/client/components/detail/DependencyList.tsx`

**Step 1: Write StatusBadge**

Uses `statusColor` and `columnColor` from formatters to determine badge color based on type.

```tsx
import { statusColor, columnColor } from '../../utils/formatters.js';

interface StatusBadgeProps {
  status: string;
  type: 'epic' | 'ticket' | 'stage';
  /** For stages, the kanban_column value — used for pipeline-specific colors */
  kanbanColumn?: string;
}

export function StatusBadge({ status, type, kanbanColumn }: StatusBadgeProps) {
  const color =
    type === 'stage' && kanbanColumn ? columnColor(kanbanColumn) : statusColor(status);

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color + '20', color }}
    >
      {formatStatus(status)}
    </span>
  );
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
```

**Step 2: Write DependencyList**

```tsx
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import { useDrawerStore } from '../../store/drawer-store.js';

interface DependencyItem {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

interface DependencyListProps {
  label: string;
  dependencies: DependencyItem[];
  /** Which end of the dependency to display as the linked item */
  displayField: 'from_id' | 'to_id';
}

export function DependencyList({ label, dependencies, displayField }: DependencyListProps) {
  const { open } = useDrawerStore();

  if (dependencies.length === 0) return null;

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h3>
      <ul className="space-y-1">
        {dependencies.map((dep) => {
          const targetId = dep[displayField];
          const targetType = displayField === 'to_id' ? dep.to_type : dep.from_type;
          return (
            <li key={dep.id} className="flex items-center gap-2 text-sm">
              {dep.resolved ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <AlertCircle size={14} className="text-red-500" />
              )}
              <button
                onClick={() => open({ type: targetType as 'epic' | 'ticket' | 'stage', id: targetId })}
                className="text-blue-600 hover:underline"
              >
                {targetId}
              </button>
              <span className="text-xs text-slate-400">
                {dep.resolved ? 'resolved' : 'unresolved'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/StatusBadge.tsx tools/web-server/src/client/components/detail/DependencyList.tsx
git commit -m "feat(web-server): add StatusBadge and DependencyList shared components"
```

---

## Task 4: Create Shared Detail Components — MarkdownContent, PhaseSection

**Files:**
- Create: `tools/web-server/src/client/components/detail/MarkdownContent.tsx`
- Create: `tools/web-server/src/client/components/detail/PhaseSection.tsx`

**Step 1: Write MarkdownContent**

Renders markdown using react-markdown + remark-gfm (both already installed). Applies Tailwind prose classes for clean rendering.

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
```

> **Note on @tailwindcss/typography:** The `prose` classes require the `@tailwindcss/typography` plugin. If it's not installed, install it and add it to `tailwind.config.js`. If the plugin isn't available, fall back to manual Tailwind styling on the markdown wrapper div. Check `tailwind.config.js` during implementation and add the plugin if missing.

**Step 2: Write PhaseSection**

Collapsible section with a completion indicator. Uses `<details>/<summary>` for native collapsibility (no JS state needed) with Tailwind styling.

```tsx
import { ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent.js';

interface PhaseSectionProps {
  title: string;
  content: string;
  isComplete: boolean;
  defaultExpanded?: boolean;
}

export function PhaseSection({
  title,
  content,
  isComplete,
  defaultExpanded = false,
}: PhaseSectionProps) {
  return (
    <details
      open={defaultExpanded || undefined}
      className="group rounded-lg border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={16}
          className="text-slate-400 transition-transform group-open:rotate-90"
        />
        {isComplete ? (
          <CheckCircle2 size={16} className="text-green-500" />
        ) : (
          <Circle size={16} className="text-slate-300" />
        )}
        <span>{title}</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        {content ? (
          <MarkdownContent content={content} />
        ) : (
          <p className="text-sm italic text-slate-400">
            Content available in future update
          </p>
        )}
      </div>
    </details>
  );
}
```

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/MarkdownContent.tsx tools/web-server/src/client/components/detail/PhaseSection.tsx
git commit -m "feat(web-server): add MarkdownContent and PhaseSection shared components"
```

---

## Task 5: Create EpicDetailContent Component

**Files:**
- Create: `tools/web-server/src/client/components/detail/EpicDetailContent.tsx`

This is the content rendered inside the `DetailDrawer` when viewing an epic.

**Step 1: Write the component**

```tsx
import { useEpic } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';

interface EpicDetailContentProps {
  epicId: string;
}

export function EpicDetailContent({ epicId }: EpicDetailContentProps) {
  const { data: epic, isLoading, error } = useEpic(epicId);
  const { open } = useDrawerStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !epic) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load epic: {error?.message ?? 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <StatusBadge status={epic.status} type="epic" />
          {epic.jira_key && (
            <a
              href={`https://jira.atlassian.net/browse/${epic.jira_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              {epic.jira_key}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Ticket list */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Tickets ({epic.tickets.length})
        </h3>
        {epic.tickets.length === 0 ? (
          <p className="text-sm italic text-slate-400">No tickets</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Stages</th>
                <th className="px-3 py-2">Jira</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {epic.tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => open({ type: 'ticket', id: ticket.id })}
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {ticket.id}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{ticket.title}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={ticket.status} type="ticket" />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {ticket.stage_count}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {ticket.jira_key ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Markdown content placeholder */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Content</h3>
        <p className="text-sm italic text-slate-400">
          Content available in future update
        </p>
      </div>
    </div>
  );
}
```

> **Note on markdown content:** The API returns `file_path` but does NOT serve file content. Per the handoff doc, show a clean placeholder. A future API enhancement could add a `/api/epics/:id/content` endpoint that reads and returns the markdown file.

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/detail/EpicDetailContent.tsx
git commit -m "feat(web-server): add EpicDetailContent component for drawer view"
```

---

## Task 6: Create TicketDetailContent Component

**Files:**
- Create: `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`

**Step 1: Write the component**

```tsx
import { useTicket } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { slugToTitle, columnColor, refinementColor } from '../../utils/formatters.js';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';

interface TicketDetailContentProps {
  ticketId: string;
}

export function TicketDetailContent({ ticketId }: TicketDetailContentProps) {
  const { data: ticket, isLoading, error } = useTicket(ticketId);
  const { open } = useDrawerStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load ticket: {error?.message ?? 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header metadata */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} type="ticket" />
          {ticket.epic_id && (
            <button
              onClick={() => open({ type: 'epic', id: ticket.epic_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {ticket.epic_id}
            </button>
          )}
          {ticket.source && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {ticket.source}
            </span>
          )}
          {ticket.jira_key && (
            <a
              href={`https://jira.atlassian.net/browse/${ticket.jira_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              {ticket.jira_key}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Stage list */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Stages ({ticket.stages.length})
        </h3>
        {ticket.stages.length === 0 ? (
          <p className="text-sm italic text-slate-400">No stages</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Refinement</th>
                <th className="px-3 py-2 text-center">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ticket.stages.map((stage) => (
                <tr
                  key={stage.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => open({ type: 'stage', id: stage.id })}
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {stage.id}
                  </td>
                  <td className="px-3 py-2 text-slate-900">{stage.title}</td>
                  <td className="px-3 py-2">
                    {stage.kanban_column ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: columnColor(stage.kanban_column) + '20',
                          color: columnColor(stage.kanban_column),
                        }}
                      >
                        {slugToTitle(stage.kanban_column)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {stage.refinement_type.map((rt) => (
                        <span
                          key={rt}
                          className="rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: refinementColor(rt) + '20',
                            color: refinementColor(rt),
                          }}
                        >
                          {rt}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {stage.session_active && (
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Session active" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Markdown content placeholder */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Content</h3>
        <p className="text-sm italic text-slate-400">
          Content available in future update
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/detail/TicketDetailContent.tsx
git commit -m "feat(web-server): add TicketDetailContent component for drawer view"
```

---

## Task 7: Create StageDetailContent Component

**Files:**
- Create: `tools/web-server/src/client/components/detail/StageDetailContent.tsx`

This is the most complex detail view — includes phase sections, dependencies, PR info, refinement badges, and a session link placeholder.

**Step 1: Write the component**

```tsx
import { useStage } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { DependencyList } from './DependencyList.js';
import { PhaseSection } from './PhaseSection.js';
import { slugToTitle, refinementColor } from '../../utils/formatters.js';
import {
  ExternalLink,
  GitBranch,
  Loader2,
  AlertCircle,
  FileCode,
} from 'lucide-react';

interface StageDetailContentProps {
  stageId: string;
}

export function StageDetailContent({ stageId }: StageDetailContentProps) {
  const { data: stage, isLoading, error } = useStage(stageId);
  const { open } = useDrawerStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !stage) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load stage: {error?.message ?? 'Not found'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header metadata */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge
            status={stage.status}
            type="stage"
            kanbanColumn={stage.kanban_column ?? undefined}
          />
          {stage.epic_id && (
            <button
              onClick={() => open({ type: 'epic', id: stage.epic_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {stage.epic_id}
            </button>
          )}
          {stage.ticket_id && (
            <button
              onClick={() => open({ type: 'ticket', id: stage.ticket_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {stage.ticket_id}
            </button>
          )}
        </div>

        {/* Refinement type badges */}
        {stage.refinement_type.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {stage.refinement_type.map((rt) => (
              <span
                key={rt}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: refinementColor(rt) + '20',
                  color: refinementColor(rt),
                }}
              >
                {rt}
              </span>
            ))}
          </div>
        )}

        {/* Worktree branch + PR link */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {stage.worktree_branch && (
            <span className="inline-flex items-center gap-1">
              <GitBranch size={12} />
              <code className="rounded bg-slate-100 px-1.5 py-0.5">
                {stage.worktree_branch}
              </code>
            </span>
          )}
          {stage.pr_url && (
            <a
              href={stage.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <FileCode size={12} />
              PR {stage.pr_number ? `#${stage.pr_number}` : 'Link'}
              {stage.is_draft && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                  Draft
                </span>
              )}
              <ExternalLink size={10} />
            </a>
          )}
          {stage.kanban_column && (
            <span>
              Column: <strong>{slugToTitle(stage.kanban_column)}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Phase sections — content not available from API, show placeholders */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Phases</h3>
        <PhaseSection
          title="Design"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'design')}
          defaultExpanded={stage.kanban_column === 'design'}
        />
        <PhaseSection
          title="Build"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'build')}
          defaultExpanded={stage.kanban_column === 'build'}
        />
        <PhaseSection
          title="Refinement"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'refinement')}
          defaultExpanded={stage.kanban_column === 'refinement'}
        />
        <PhaseSection
          title="Finalize"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'finalize')}
          defaultExpanded={stage.kanban_column === 'finalize'}
        />
      </div>

      {/* Session link placeholder */}
      <div>
        <button
          disabled
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
          title="Available after Stage 9E"
        >
          View Latest Session
          <span className="text-xs">(coming in 9E)</span>
        </button>
      </div>

      {/* Dependencies */}
      {(stage.depends_on.length > 0 || stage.depended_on_by.length > 0) && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Dependencies</h3>
          <DependencyList
            label="Blocked by"
            dependencies={stage.depends_on}
            displayField="to_id"
          />
          <DependencyList
            label="Blocks"
            dependencies={stage.depended_on_by}
            displayField="from_id"
          />
        </div>
      )}
    </div>
  );
}

/** Pipeline column order for determining phase completion */
const COLUMN_ORDER = [
  'backlog',
  'ready_for_work',
  'design',
  'build',
  'refinement',
  'finalize',
  'review',
  'done',
  'archived',
];

function isPastPhase(currentColumn: string | null, phase: string): boolean {
  if (!currentColumn) return false;
  const currentIdx = COLUMN_ORDER.indexOf(currentColumn);
  const phaseIdx = COLUMN_ORDER.indexOf(phase);
  if (currentIdx === -1 || phaseIdx === -1) return false;
  return currentIdx > phaseIdx;
}
```

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/detail/StageDetailContent.tsx
git commit -m "feat(web-server): add StageDetailContent component for drawer view"
```

---

## Task 8: Create DrawerHost and Wire Into Layout

**Files:**
- Create: `tools/web-server/src/client/components/detail/DrawerHost.tsx`
- Modify: `tools/web-server/src/client/components/layout/Layout.tsx`

The `DrawerHost` reads the drawer store stack, renders the `DetailDrawer` with the appropriate content component for the top-of-stack entry.

**Step 1: Write DrawerHost**

```tsx
import { useDrawerStore } from '../../store/drawer-store.js';
import { DetailDrawer } from './DetailDrawer.js';
import { EpicDetailContent } from './EpicDetailContent.js';
import { TicketDetailContent } from './TicketDetailContent.js';
import { StageDetailContent } from './StageDetailContent.js';
import { useEpic, useTicket, useStage } from '../../api/hooks.js';

export function DrawerHost() {
  const { stack } = useDrawerStore();

  if (stack.length === 0) return null;

  const current = stack[stack.length - 1];

  return <DrawerContent entry={current} />;
}

function DrawerContent({ entry }: { entry: { type: string; id: string } }) {
  // Fetch the title for the drawer header based on type
  const title = useDrawerTitle(entry.type, entry.id);

  return (
    <DetailDrawer title={title.label} subtitle={entry.id}>
      {entry.type === 'epic' && <EpicDetailContent epicId={entry.id} />}
      {entry.type === 'ticket' && <TicketDetailContent ticketId={entry.id} />}
      {entry.type === 'stage' && <StageDetailContent stageId={entry.id} />}
    </DetailDrawer>
  );
}

/**
 * Extracts a display title for the drawer header.
 * Uses the same hooks as the content components — React Query deduplicates the fetch.
 */
function useDrawerTitle(type: string, id: string): { label: string } {
  const epicQuery = useEpic(type === 'epic' ? id : '');
  const ticketQuery = useTicket(type === 'ticket' ? id : '');
  const stageQuery = useStage(type === 'stage' ? id : '');

  if (type === 'epic') {
    return { label: epicQuery.data?.title ?? 'Epic' };
  }
  if (type === 'ticket') {
    return { label: ticketQuery.data?.title ?? 'Ticket' };
  }
  if (type === 'stage') {
    return { label: stageQuery.data?.title ?? 'Stage' };
  }
  return { label: id };
}
```

> **Note on hook calls:** All three hooks are called unconditionally (React rules of hooks), but with empty string IDs for non-matching types. The hooks should handle empty IDs gracefully — either by returning quickly or by the API returning 404. The `enabled` option on React Query could be used instead; check the hook implementations during implementation and add `enabled: type === 'epic'` if the hooks support it. React Query's `useQuery` supports an `enabled` option that prevents the fetch entirely.

**Step 2: Modify Layout.tsx**

Add `<DrawerHost />` inside the Layout, after the `<main>` content area so it overlays correctly.

Current Layout.tsx structure:
```tsx
<div className="flex h-screen bg-slate-50">
  <Sidebar />
  <div className="flex flex-1 flex-col overflow-hidden">
    <Header />
    <main className="flex-1 overflow-auto p-6">{children}</main>
  </div>
</div>
```

Add `<DrawerHost />` as last child of the outermost div:
```tsx
import { DrawerHost } from '../detail/DrawerHost.js';

// ... existing code ...

<div className="flex h-screen bg-slate-50">
  <Sidebar />
  <div className="flex flex-1 flex-col overflow-hidden">
    <Header />
    <main className="flex-1 overflow-auto p-6">{children}</main>
  </div>
  <DrawerHost />
</div>
```

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/DrawerHost.tsx tools/web-server/src/client/components/layout/Layout.tsx
git commit -m "feat(web-server): add DrawerHost and wire into Layout for overlay drawers"
```

---

## Task 9: Update Board Card Click Handlers to Open Drawers

**Files:**
- Modify: `tools/web-server/src/client/pages/Board.tsx`

Change stage and ticket card `onClick` from `navigate('/stages/:id')` to `open({ type: 'stage', id })` from the drawer store.

**Step 1: Modify Board.tsx**

Replace the `useNavigate()` import and card click handlers:

- Remove `useNavigate` import (or keep if still needed elsewhere)
- Import `useDrawerStore` from the drawer store
- In the `Board` component, destructure `open` from `useDrawerStore()`
- In `renderStageCard()`: change `onClick: () => navigate(\`/stages/${item.id}\`)` to `onClick: () => open({ type: 'stage', id: item.id })`
- In `renderTicketCard()`: change `onClick: () => navigate(\`/tickets/${item.id}\`)` to `onClick: () => open({ type: 'ticket', id: item.id })`

The navigate import can be removed entirely if no other usages remain.

**Step 2: Run verify**

```bash
cd tools/web-server && npm run lint
```
Expected: no type errors.

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/Board.tsx
git commit -m "feat(web-server): board cards open detail drawers instead of navigating to pages"
```

---

## Task 10: Update Detail Page Routes to Redirect with Drawer Auto-Open

**Files:**
- Modify: `tools/web-server/src/client/App.tsx`
- Modify: `tools/web-server/src/client/pages/EpicDetail.tsx`
- Modify: `tools/web-server/src/client/pages/TicketDetail.tsx`
- Modify: `tools/web-server/src/client/pages/StageDetail.tsx`

The existing detail page routes (`/epics/:epicId`, `/tickets/:ticketId`, `/stages/:stageId`) should redirect to `/board` and auto-open the corresponding drawer. This preserves deep-link functionality.

**Step 1: Create a DrawerRedirect helper component**

Replace the contents of EpicDetail.tsx, TicketDetail.tsx, and StageDetail.tsx with redirect components that set the drawer stack and navigate to `/board`.

Each file follows the same pattern:

**EpicDetail.tsx:**
```tsx
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function EpicDetail() {
  const { epicId } = useParams<{ epicId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (epicId) {
      setStack([{ type: 'epic', id: epicId }]);
      navigate('/board', { replace: true });
    }
  }, [epicId, setStack, navigate]);

  return null;
}
```

**TicketDetail.tsx:**
```tsx
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (ticketId) {
      setStack([{ type: 'ticket', id: ticketId }]);
      navigate('/board', { replace: true });
    }
  }, [ticketId, setStack, navigate]);

  return null;
}
```

**StageDetail.tsx:**
```tsx
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (stageId) {
      setStack([{ type: 'stage', id: stageId }]);
      navigate('/board', { replace: true });
    }
  }, [stageId, setStack, navigate]);

  return null;
}
```

**Step 2: Run verify**

```bash
cd tools/web-server && npm run lint
```

**Step 3: Commit**

```bash
git add tools/web-server/src/client/pages/EpicDetail.tsx tools/web-server/src/client/pages/TicketDetail.tsx tools/web-server/src/client/pages/StageDetail.tsx
git commit -m "feat(web-server): detail page routes redirect to board with auto-open drawer"
```

---

## Task 11: Install Mermaid and Implement DependencyGraph Page

**Files:**
- Modify: `tools/web-server/package.json` (install mermaid)
- Modify: `tools/web-server/src/client/pages/DependencyGraph.tsx`

**Step 1: Install mermaid**

```bash
cd tools/web-server && npm install mermaid
```

**Step 2: Write the DependencyGraph page**

The page uses the `useGraphMermaid` hook for simple rendering, with filter controls and cycle warnings.

```tsx
import { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { useGraphMermaid, useGraph, useEpics, useTickets } from '../api/hooks.js';
import { AlertTriangle, Loader2, AlertCircle } from 'lucide-react';

// Initialize mermaid with a compatible config
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { useMaxWidth: true, htmlLabels: true },
});

export function DependencyGraph() {
  const [epicFilter, setEpicFilter] = useState<string>('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  const filters: Record<string, string | boolean | undefined> = {};
  if (epicFilter) filters.epic = epicFilter;

  const { data: mermaidData, isLoading: mermaidLoading, error: mermaidError } = useGraphMermaid(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  const { data: graphData } = useGraph(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  const { data: epics } = useEpics();

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mermaidData?.mermaid || !containerRef.current) return;

    const renderGraph = async () => {
      try {
        containerRef.current!.innerHTML = '';
        const { svg } = await mermaid.render('dep-graph', mermaidData.mermaid);
        containerRef.current!.innerHTML = svg;
      } catch {
        containerRef.current!.innerHTML =
          '<p class="text-sm text-red-500">Failed to render graph</p>';
      }
    };

    renderGraph();
  }, [mermaidData?.mermaid]);

  const cycles = graphData?.cycles ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Dependency Graph</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={epicFilter}
          onChange={(e) => setEpicFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Epics</option>
          {(epics ?? []).map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.id} — {ep.title}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="rounded border-slate-300"
          />
          Show completed
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showCriticalPath}
            onChange={(e) => setShowCriticalPath(e.target.checked)}
            className="rounded border-slate-300"
          />
          Critical path
        </label>
      </div>

      {/* Cycle warnings */}
      {cycles.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Dependency cycles detected:</strong>
            <ul className="mt-1 list-inside list-disc">
              {cycles.map((cycle, i) => (
                <li key={i}>{cycle.join(' → ')} → {cycle[0]}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Graph */}
      {mermaidLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      ) : mermaidError ? (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          Failed to load graph: {mermaidError.message}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="overflow-auto rounded-lg border border-slate-200 bg-white p-4"
        />
      )}
    </div>
  );
}
```

> **Note on show/hide completed and critical path:** The mermaid rendering from the API doesn't natively support filtering completed items or highlighting critical paths. The `showCompleted` and `showCriticalPath` controls are wired up as state but filtering requires either:
> (a) Post-processing the mermaid string (fragile), or
> (b) Using the JSON graph data (`useGraph`) and building mermaid strings client-side, or
> (c) Adding query params to the API (`?hideCompleted=true&criticalPath=true`).
>
> **For this initial implementation:** Keep the controls in the UI for forward-compatibility but only the `epicFilter` actually works (the API supports `?epic=`). Add a `// TODO: implement client-side filtering for completed/critical-path` comment. The graph will render all items regardless of the checkbox state.

**Step 3: Run verify**

```bash
cd tools/web-server && npm run verify
```
Expected: lint passes, all existing tests pass.

**Step 4: Commit**

```bash
git add tools/web-server/package.json tools/web-server/package-lock.json tools/web-server/src/client/pages/DependencyGraph.tsx
git commit -m "feat(web-server): implement dependency graph page with mermaid rendering"
```

---

## Task 12: Add @tailwindcss/typography Plugin (If Missing)

**Files:**
- Possibly modify: `tools/web-server/tailwind.config.js` (or `.cjs` / `.ts`)
- Possibly modify: `tools/web-server/package.json`

**Step 1: Check if @tailwindcss/typography is installed**

```bash
cd tools/web-server && grep -q typography package.json && echo "installed" || echo "not installed"
```

**Step 2: If not installed, install it**

```bash
cd tools/web-server && npm install -D @tailwindcss/typography
```

Then add it to the Tailwind config's plugins array:

```js
// tailwind.config.js
plugins: [require('@tailwindcss/typography')]
```

**Step 3: Commit (only if changes were made)**

```bash
git add tools/web-server/package.json tools/web-server/package-lock.json tools/web-server/tailwind.config.*
git commit -m "chore(web-server): add @tailwindcss/typography for markdown prose classes"
```

---

## Task 13: Handle Conditional Hook Calls in DrawerHost

**Files:**
- Modify: `tools/web-server/src/client/components/detail/DrawerHost.tsx`
- Modify: `tools/web-server/src/client/api/hooks.ts` (if hooks don't support `enabled` option)

**Step 1: Check if hooks accept options with `enabled`**

Read `hooks.ts` to see if the hooks pass through React Query options. If they do, update `useDrawerTitle` to use `enabled`:

```tsx
function useDrawerTitle(type: string, id: string): { label: string } {
  const epicQuery = useEpic(type === 'epic' ? id : '', { enabled: type === 'epic' });
  const ticketQuery = useTicket(type === 'ticket' ? id : '', { enabled: type === 'ticket' });
  const stageQuery = useStage(type === 'stage' ? id : '', { enabled: type === 'stage' });
  // ...
}
```

**If hooks don't support options:** Modify the hooks in `hooks.ts` to accept an optional second parameter for React Query options and merge it into the `useQuery` call. For example:

```typescript
export function useEpic(id: string, options?: { enabled?: boolean }) {
  return useQuery<EpicDetail>({
    queryKey: ['epic', id],
    queryFn: () => apiFetch<EpicDetail>(`/epics/${id}`),
    enabled: options?.enabled ?? true,
  });
}
```

Apply the same pattern to `useTicket` and `useStage`.

**Step 2: Run verify**

```bash
cd tools/web-server && npm run verify
```

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/DrawerHost.tsx tools/web-server/src/client/api/hooks.ts
git commit -m "fix(web-server): use enabled option for conditional hook calls in DrawerHost"
```

---

## Task 14: Update Dashboard Quick Links to Open Drawers

**Files:**
- Modify: `tools/web-server/src/client/pages/Dashboard.tsx`

If the Dashboard has any clickable items that navigate to detail pages (e.g., clicking a stage in the activity feed, or clicking a blocked item), update those to open drawers instead.

**Step 1: Examine Dashboard.tsx during implementation**

Look for any `navigate()` calls or `<Link>` elements that point to `/epics/:id`, `/tickets/:id`, or `/stages/:id`. Replace them with drawer store `open()` calls.

If the Dashboard only has `<Link>` quick-link cards to `/board` and `/graph`, no changes are needed.

**Step 2: Commit (only if changes were made)**

```bash
git add tools/web-server/src/client/pages/Dashboard.tsx
git commit -m "feat(web-server): dashboard activity items open detail drawers"
```

---

## Task 15: Final Verification and Cleanup

**Files:**
- All modified files

**Step 1: Run full verify**

```bash
cd tools/web-server && npm run verify
```
Expected: lint passes, all 79+ tests pass.

**Step 2: Verify other tools are unaffected**

```bash
cd tools/kanban-cli && npm run verify
cd tools/orchestrator && npm run verify
```

**Step 3: Manual smoke test checklist**

Start the dev server:
```bash
cd tools/web-server && npm run dev
```

Verify at http://localhost:3100/:
- [ ] Board page renders with cards
- [ ] Clicking a stage card opens a right-side drawer (not a page navigation)
- [ ] Drawer shows stage header, status badge, refinement badges, phase sections, dependencies
- [ ] Phase sections are collapsible (click to expand/collapse)
- [ ] Clicking "back" breadcrumb links in a stage drawer (e.g., ticket ID) opens that ticket's drawer
- [ ] Drawer stack works: epic → ticket → stage, then back button pops the stack
- [ ] Clicking backdrop (dark overlay) closes all drawers
- [ ] Pressing Escape closes all drawers
- [ ] Clicking a ticket card on the board opens the ticket drawer
- [ ] Ticket drawer shows stage list table; clicking a stage row opens stage drawer
- [ ] Navigating directly to `/epics/EPIC-001` redirects to `/board` with the epic drawer open
- [ ] Navigating directly to `/stages/STAGE-001-001-001` redirects to `/board` with the stage drawer open
- [ ] `/graph` page renders the mermaid dependency graph
- [ ] Graph epic filter dropdown works
- [ ] Cycle warnings display if cycles exist
- [ ] Dashboard still works correctly
- [ ] Sidebar navigation still works

**Step 4: Commit any final fixes**

---

## Architecture Notes for Implementer

### File Organization

```
src/client/
  store/
    drawer-store.ts          ← NEW: drawer open/close/stack state
  components/
    detail/
      DetailDrawer.tsx       ← NEW: slide-in panel shell
      DrawerHost.tsx          ← NEW: reads store, renders correct content
      StatusBadge.tsx         ← NEW: colored status pill
      DependencyList.tsx      ← NEW: resolved/unresolved dep links
      MarkdownContent.tsx     ← NEW: react-markdown wrapper
      PhaseSection.tsx        ← NEW: collapsible section with completion
      EpicDetailContent.tsx   ← NEW: epic detail rendered inside drawer
      TicketDetailContent.tsx ← NEW: ticket detail rendered inside drawer
      StageDetailContent.tsx  ← NEW: stage detail rendered inside drawer
  pages/
    EpicDetail.tsx           ← MODIFIED: redirects to /board + opens drawer
    TicketDetail.tsx          ← MODIFIED: redirects to /board + opens drawer
    StageDetail.tsx           ← MODIFIED: redirects to /board + opens drawer
    DependencyGraph.tsx       ← MODIFIED: full mermaid graph implementation
    Board.tsx                 ← MODIFIED: card clicks open drawers
    Dashboard.tsx             ← POSSIBLY MODIFIED: activity items open drawers
  components/layout/
    Layout.tsx                ← MODIFIED: adds <DrawerHost />
  api/
    hooks.ts                 ← POSSIBLY MODIFIED: add enabled option to hooks
```

### ESM Import Reminders

All local imports MUST use `.js` extensions:
```typescript
import { useDrawerStore } from '../../store/drawer-store.js';
import { DetailDrawer } from './DetailDrawer.js';
import { StatusBadge } from './StatusBadge.js';
```

### Data Not Available from API

The following data is referenced in the design doc but NOT available from the current API:
- **Epic markdown content** — API returns `file_path` but not file contents → show placeholder
- **Ticket regression.md content** — not served → show placeholder
- **Ticket changelog entries** — not served → show placeholder
- **Stage phase content** (design/build/refinement/finalize sections) — not parsed from stage files → show placeholder
- **Session discovery** (matching worktree_branch to JSONL files) — deferred to 9E → show disabled button

All of these get clean "Content available in future update" placeholders.
