# Stage 10E: Drawer Session Integration — Design

## Overview

Embed session viewing directly in stage and ticket detail drawers as a tab, with dropdown navigation between current and past sessions. The existing standalone session page (`/sessions/:projectId/:sessionId`) remains unchanged.

**Approach:** Decomposed Embedding — a lightweight `EmbeddedSessionViewer` wrapper composes existing `ChatHistory` and context panel components with a drawer-optimized single-column layout.

**Key decisions:**
- Full multi-session design (junction table, dropdown, phase labeling)
- Both stage and ticket drawer tabs included
- Context panel rendered as collapsible accordion in drawer
- Junction table for session history (not JSON column)

## Data Model

### `stage_sessions` Junction Table

```sql
CREATE TABLE stage_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    TEXT NOT NULL REFERENCES stages(id),
  session_id  TEXT NOT NULL,
  phase       TEXT NOT NULL,        -- e.g. "Design", "Build", "Refinement"
  started_at  TEXT NOT NULL,        -- ISO timestamp
  ended_at    TEXT,                 -- NULL if still active
  is_current  INTEGER DEFAULT 0,   -- boolean: 1 = active session
  UNIQUE(stage_id, session_id)
);
```

### `ticket_sessions` Table

```sql
CREATE TABLE ticket_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  session_id  TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'convert',  -- future: 'convert', 'other'
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  UNIQUE(ticket_id, session_id)
);
```

### Migration Strategy
- New migration creates both tables
- Migrate existing `session_id` from stages table into `stage_sessions` (phase = current column status)
- Keep `session_id` and `session_active` on stages table for backward compatibility during transition
- New API endpoints read from junction tables

### New API Endpoints
- `GET /api/stages/:stageId/sessions` — returns `StageSession[]` from junction table
- `GET /api/tickets/:ticketId/sessions` — returns `TicketSession[]`

## Component Architecture

### New Components

**1. `DrawerTabs`** (`components/detail/DrawerTabs.tsx`)

Reusable tab strip for any detail drawer. Not session-specific.

```typescript
interface TabDef {
  id: string;
  label: string;
  badge?: string;          // e.g. "Live", "3 sessions"
  badgeVariant?: 'info' | 'success' | 'warning';
}

interface DrawerTabsProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}
```

- Horizontal tab bar at top of drawer content
- Active tab has underline/highlight styling
- Badge renders as small pill next to label
- Parent component controls content rendering based on `activeTab`

**2. `EmbeddedSessionViewer`** (`components/chat/EmbeddedSessionViewer.tsx`)

Layout wrapper composing existing components for drawer width.

```typescript
interface EmbeddedSessionViewerProps {
  projectId: string;
  sessionId: string;
  isReadOnly?: boolean;
}
```

Layout (top to bottom, single column):
```
┌─ Read-only badge (if applicable) ────────────┐
├─ Context accordion (collapsed by default) ───┤
│  ▸ Token Usage                                │
│  ▸ Session Summary                            │
│  ▸ Compactions                                │
├─ ChatHistory (flex-1, fills remaining) ──────┤
│  [virtualized chat messages]                  │
│  [full drawer width ~640px]                   │
└──────────────────────────────────────────────┘
```

- Fetches data via existing `useSessionDetail(projectId, sessionId)` hook
- Passes `items` to `ChatHistory`, `metrics`/`chunks` to context sections
- Context sections rendered as individual accordion items (extracted from SessionContextPanel)
- Manages its own scoped `useSessionViewStore` instance (not the global singleton)

**3. `SessionHistoryDropdown`** (`components/chat/SessionHistoryDropdown.tsx`)

```typescript
interface SessionHistoryEntry {
  sessionId: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
}

interface SessionHistoryDropdownProps {
  sessions: SessionHistoryEntry[];
  selectedSessionId: string;
  onSelect: (sessionId: string) => void;
}
```

- Dropdown with each option showing `"{phase} — {date}"` with Live/Read Only indicator
- Current session sorted to top

**4. `ContextAccordion`** (`components/chat/context/ContextAccordion.tsx`)

Extracts individual sections from `SessionContextPanel` into collapsible accordion items.

```typescript
interface ContextAccordionProps {
  metrics: SessionMetrics;
  chunks: Chunk[];
  model?: string;
}
```

- Reuses rendering logic from SessionContextPanel sections
- Each section (Summary, Token Usage, Compactions, Activity) is an accordion item
- All collapsed by default to maximize chat viewing area

### Modified Components

- **`StageDetailContent`** — Add `DrawerTabs` with "Details" and "Session" tabs. Session tab only visible when stage has sessions. Current section content moves under Details tab.
- **`TicketDetailContent`** — Same pattern. Session tab visible when ticket has a convert session. No dropdown needed (single session per ticket).

## State Management & Data Flow

### Drawer Session Store

New Zustand store: `store/drawer-session-store.ts`

```typescript
interface DrawerSessionState {
  activeStageSession: { projectId: string; sessionId: string } | null;
  activeTicketSession: { projectId: string; sessionId: string } | null;
  stageActiveTab: string;   // 'details' | 'session'
  ticketActiveTab: string;  // 'details' | 'session'

  setStageSession: (projectId: string, sessionId: string) => void;
  setTicketSession: (projectId: string, sessionId: string) => void;
  setStageActiveTab: (tab: string) => void;
  setTicketActiveTab: (tab: string) => void;
  reset: () => void;
}
```

- Resets when drawer closes (wired to `useDrawerStore`'s `closeAll`)
- Tab defaults to `'details'` on open
- Session selection persists while drawer is open

### Data Flow

```
Stage Drawer Open
  └─ StageDetailContent receives stageId
       ├─ "Details" tab: existing content (unchanged)
       └─ "Session" tab:
            ├─ useStageSessionHistory(stageId)  ← NEW hook
            │    └─ GET /api/stages/:stageId/sessions
            │         └─ Returns SessionHistoryEntry[]
            ├─ SessionHistoryDropdown
            │    └─ User selects → setStageSession(projectId, sessionId)
            └─ EmbeddedSessionViewer
                 ├─ useSessionDetail(projectId, sessionId)  ← EXISTING hook
                 ├─ ContextAccordion ← metrics, chunks
                 └─ ChatHistory ← items
```

### React Query Integration

- `useStageSessionHistory(stageId)` — new hook, query key `['stage', stageId, 'sessions']`
- `useTicketSessions(ticketId)` — new hook, query key `['ticket', ticketId, 'sessions']`
- Both use existing `apiFetch` pattern
- Session detail data uses existing `useSessionDetail` hook

### Session View Store Scoping

The existing `useSessionViewStore` is a global singleton. The `EmbeddedSessionViewer` creates a scoped store instance using Zustand's `createStore` (not global `create`), so:
- Drawer session has its own expand/collapse state
- Main page session viewer is unaffected
- Store is garbage collected when drawer unmounts

## Server-Side Changes

### New Repository: `StageSessionRepository`

```typescript
interface StageSessionRecord {
  id: number;
  stage_id: string;
  session_id: string;
  phase: string;
  started_at: string;
  ended_at: string | null;
  is_current: number;
}

// Methods:
getSessionsByStageId(stageId: string): StageSessionRecord[]
addSession(stageId: string, sessionId: string, phase: string): void
endSession(stageId: string, sessionId: string): void
getCurrentSession(stageId: string): StageSessionRecord | null
```

### New Repository: `TicketSessionRepository`

```typescript
interface TicketSessionRecord {
  id: number;
  ticket_id: string;
  session_id: string;
  session_type: string;
  started_at: string;
  ended_at: string | null;
}

// Methods:
getSessionsByTicketId(ticketId: string): TicketSessionRecord[]
addSession(ticketId: string, sessionId: string, type: string): void
```

### New Route Handlers

- **`GET /api/stages/:stageId/sessions`** — Returns sessions with projectId derivation (same logic as existing endpoint). Returns `{ sessions: StageSession[] }` ordered by current first, then by `started_at` desc.
- **`GET /api/tickets/:ticketId/sessions`** — Same pattern for ticket sessions.

### Migration

Single migration file:
1. Creates `stage_sessions` table
2. Creates `ticket_sessions` table
3. Migrates existing `session_id` from stages into `stage_sessions`
4. Keeps existing columns for backward compat

### Unchanged

- Session parsing (chunk-builder, JSONL engine)
- `/api/sessions/:projectId/:sessionId` endpoint
- `/api/stages/:stageId/session` endpoint (kept for backward compat)

## Testing Strategy

### Unit Tests

**Data layer:**
- `StageSessionRepository` — CRUD operations, migration correctness, `is_current` constraint
- `TicketSessionRepository` — CRUD operations, type filtering
- Migration test — verify existing `session_id` data migrates correctly

**API routes:**
- `GET /api/stages/:stageId/sessions` — returns sessions with projectId derivation, empty array when none, ordering
- `GET /api/tickets/:ticketId/sessions` — same pattern
- 404 handling for invalid IDs

**Client utilities:**
- `DrawerTabs` — tab count, active state, badge rendering, change callback
- `SessionHistoryDropdown` — entries with phase labels, live/read-only indicators, selection
- `ContextAccordion` — sections render, expand/collapse, handles empty data
- `drawer-session-store` — state transitions, reset, tab persistence

### Integration Tests

- `EmbeddedSessionViewer` — renders ChatHistory + ContextAccordion with mock data, read-only badge
- `StageDetailContent` with tabs — tab switching, session tab hidden when no sessions
- `TicketDetailContent` with tabs — same pattern, single session

### Not Tested (existing coverage)

- ChatHistory and SessionContextPanel internals (9F tests)
- Virtual scrolling within drawer
- Session parsing / chunk building
