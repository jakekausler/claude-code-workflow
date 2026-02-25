# Stage 10C: Live Session Status

**Parent:** Stage 10 (Session Monitor Integration)
**Dependencies:** 10A (orchestrator communication), 10B (interaction provides status data)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Real-time session status indicators on kanban stage cards and throughout the UI.

## What Ships

1. Session status indicators on stage pipeline board cards
2. Session status on stage detail page
3. Global session activity summary on dashboard
4. Session-to-stage mapping logic

## Session Status Indicators

### Visual indicators on stage cards

When a stage has an active session (from the orchestrator registry), its BoardCard shows a status indicator:

| Status | Visual | Meaning |
|--------|--------|---------|
| `active` | Green pulsing dot | Claude is actively working |
| `waiting:user_input` | Yellow dot + "Needs input" text | Claude is waiting for user message |
| `waiting:permission` | Blue dot + "Needs approval" text | Claude is waiting for tool approval |
| `waiting:idle` | Gray dot | Session idle |
| `ended` | No indicator | Session finished |
| No session | No indicator | Stage not currently being worked on |

### Implementation on BoardCard

Extend the BoardCard component (from 9C) to accept optional session status:

```typescript
interface BoardCardProps {
  // ... existing props from 9C
  sessionStatus?: {
    status: 'active' | 'waiting' | 'ended';
    waitingType?: 'user_input' | 'permission' | 'idle';
  };
}
```

The stage pipeline board page queries the orchestrator session registry (via `GET /api/orchestrator/sessions`) and maps stageId to session status.

### Animated indicators

- **Active (green pulse):** CSS animation `@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }` applied to a green dot
- **Waiting (yellow/blue):** Static dot with text label
- Cards with `waiting:user_input` or `waiting:permission` should stand out — slightly larger card shadow or highlight border

## Session-to-Stage Mapping

### How it works

The orchestrator's session registry (10A) maps stageId -> session info. The web server mirrors this registry and exposes it via REST.

**Mapping chain:**
1. Orchestrator spawns session for a stage -> records `{ stageId, sessionId, worktreePath }`
2. Web server receives `session_registered` via WebSocket -> updates local mirror
3. Stage pipeline board fetches `GET /api/orchestrator/sessions` -> merges with board data
4. Each stage card checks if its stageId has an entry in the session map

### For stages without orchestrator

Some sessions may be running outside the orchestrator (manual Claude Code in a worktree). These can be detected by:
1. FileWatcher notices new JSONL activity in a path matching a known worktree
2. Match worktree path to stage via `worktree_branch` in stage frontmatter
3. Status is inferred from JSONL content (last entry type: assistant with tool_use = active, stop = waiting)

This secondary detection is lower priority — the orchestrator registry is the primary source.

## Stage Detail Page Updates

### Session status section

On the StageDetail page (9D), add a "Live Session" section when a session is active:

- Status indicator (same as card)
- Session ID (truncated)
- Duration since spawn
- "View Session" button -> navigates to SessionDetail
- If `waiting:user_input`: show message input inline
- If `waiting:permission`: show pending approval with approve/deny buttons

This section is hidden when no session is active for the stage.

## Dashboard Updates

### Active sessions card

The dashboard (9C) has a placeholder "Active sessions" card. Wire it to real data:

- Count of sessions where status = 'active' or 'waiting'
- List showing: stage ID, status indicator, duration
- Click item -> navigate to stage detail

### Activity feed enrichment

Enrich the activity feed (stage transitions) with session events:
- "Session started for STAGE-001-001-001" entries
- "Waiting for user input on STAGE-001-001-001" entries
- "Session completed for STAGE-001-001-001" entries

Source: orchestrator WebSocket events forwarded through SSE.

## SSE Events

Extend SSE from 9G with session-specific events:

| Event | Trigger | Payload |
|-------|---------|---------|
| `session-status` | Orchestrator session_status/registered/ended | `{ stageId, status, waitingType? }` |

Browser subscribes to `session-status` and updates the session map in Zustand store.

## Zustand Store Updates

```typescript
// Extend board-store.ts
interface BoardStore {
  // ... existing from 9C
  sessionMap: Map<string, SessionRegistryEntry>;
  setSessionMap: (map: Map<string, SessionRegistryEntry>) => void;
  updateSessionStatus: (stageId: string, status: SessionStatus) => void;
}
```

## Success Criteria

- Stage cards show correct session status indicators
- Indicators update within 1 second of status change
- Dashboard shows active session count and list
- Stage detail shows inline interaction when session is waiting
- Status persists across page navigation (Zustand store)
- Graceful handling when orchestrator is disconnected (no indicators shown)
