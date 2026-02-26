# Stage 10E: Drawer Session Integration

**Parent:** Stage 10 (Orchestrator & Live Features)
**Dependencies:** 9F (session detail display), 9D (detail views/drawer system), 10C (live session status)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Embed session viewing directly in stage and ticket detail drawers as a tab, with dropdown navigation between current and past sessions (one per phase/column transition). Replaces the current "View Session" link with an integrated experience.

## What Ships

Session tab in stage/ticket drawers + session history dropdown + read-only mode for past sessions.

## Stage Drawer: Session Tab

**Tab system:**
- Add tab navigation to StageDetailContent: "Details" (current view) | "Session" (new)
- Session tab is only visible when stage has at least one session_id
- Default to Details tab; user clicks Session to view

**Session dropdown:**
- Each phase/column a stage passes through may have its own Claude session
- Dropdown at top of session tab lists all sessions: label = phase name + timestamp
- Current/active session shown with "Live" indicator
- Past sessions shown with "Read Only" badge
- Selecting a session loads it in the embedded viewer

**Embedded viewer:**
- Reuse ChatHistory + SessionContextPanel from 9F
- Adapt layout for drawer width (single column, context panel collapses to accordion)
- Read-only indicator for completed sessions

## Ticket Drawer: Convert Session Tab

**Similar pattern for tickets:**
- Tickets have a "convert" session (when the orchestrator converts a ticket into stages)
- Add Session tab to TicketDetailContent
- Simpler than stages: typically one session, no dropdown needed initially
- Same embedded viewer, always read-only (convert sessions are completed)

## Data Requirements

**New API endpoints or modifications:**
- `GET /api/stages/:stageId/sessions` — List ALL sessions for a stage (not just current), with phase/column labels
- `GET /api/tickets/:ticketId/session` — Get the convert session for a ticket

**Database considerations:**
- Current schema stores single `session_id` per stage
- Need session history: either a `stage_sessions` junction table or a JSON array column
- Each entry: session_id, phase/column at time of session, started_at, ended_at, is_current

## Components

### DrawerTabs (`components/detail/DrawerTabs.tsx`)
- Reusable tab strip for detail drawers
- Props: tabs array with label + content + optional badge
- Controlled by parent component

### EmbeddedSessionViewer (`components/chat/EmbeddedSessionViewer.tsx`)
- Wrapper around ChatHistory + SessionContextPanel
- Adapts layout for drawer width (responsive)
- Shows read-only overlay/badge for past sessions
- Accepts projectId + sessionId props

### SessionHistoryDropdown (`components/chat/SessionHistoryDropdown.tsx`)
- Dropdown selector for stage sessions
- Shows phase label, timestamp, live/read-only status
- Emits selected sessionId

## State Management

**Extend session-store or create drawer-session-store:**
```typescript
{
  activeDrawerSession: { projectId: string; sessionId: string } | null,
  sessionHistory: Array<{ sessionId: string; phase: string; startedAt: string; isCurrent: boolean }>,
  isReadOnly: boolean,
}
```

## Success Criteria

- Stage drawer has Details and Session tabs
- Session tab shows embedded session viewer with full chat history
- Dropdown lists all sessions for the stage with phase labels
- Past sessions display with read-only indicator
- Ticket drawer has Session tab for convert session
- Layout adapts to drawer width without horizontal scrolling
- Virtual scrolling works within drawer context
