# Stage 9G: Real-Time Updates

**Parent:** Stage 9 (Web UI)
**Dependencies:** 9B (REST API), 9E (FileWatcher + session parsing)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

SSE endpoint for live updates across all views — boards auto-refresh on stage transitions, session detail auto-updates on JSONL changes.

## What Ships

1. SSE server endpoint (`/api/events`)
2. Client-side `useSSE()` hook
3. Auto-refresh wiring for all pages

## Server: SSE Endpoint

### Implementation (`src/server/routes/events.ts`)

Port directly from claude-devtools pattern:

```typescript
const clients = new Set<FastifyReply>();

app.get('/api/events', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  clients.add(reply);
  const timer = setInterval(() => reply.raw.write(':ping\n\n'), 30_000);
  request.raw.on('close', () => {
    clearInterval(timer);
    clients.delete(reply);
  });
  await reply;
});
```

**Reference:** `claude-devtools/src/main/http/events.ts` — the full implementation.

### Broadcast function

```typescript
function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.raw.write(payload); }
    catch { clients.delete(client); }
  }
}
```

### Event channels

| Channel | Trigger | Payload | Consumers |
|---------|---------|---------|-----------|
| `session-update` | FileWatcher JSONL change | `{ projectId, sessionId, isSubagent }` | SessionDetail page |
| `board-update` | Stage status change in SQLite | `{ type: 'stage_transition', stageId, oldStatus, newStatus }` | All board pages, Dashboard |
| `stage-transition` | Stage frontmatter status change | `{ stageId, ticketId, epicId, oldStatus, newStatus, timestamp }` | Dashboard activity feed |

### Wiring triggers to broadcasts

**FileWatcher -> session-update:**
```typescript
fileWatcher.on('file-change', (event) => {
  broadcastEvent('session-update', event);
});
```

**SQLite change detection -> board-update:**
- After `kanban-cli sync` updates a stage's status in SQLite, detect the change
- Option A: Poll SQLite `stages.last_synced` periodically (every 2s)
- Option B: Watch stage markdown files for frontmatter changes (FileWatcher already watches ~/.claude, extend to watch epics/ directory)
- Option C: The orchestrator or skill that changes status calls a webhook/API to notify

Recommended: Option B — extend FileWatcher to also watch the `epics/` directory tree for `.md` file changes. Parse frontmatter to detect status changes. This is the most natural extension.

**Reference:** `claude-devtools/src/main/standalone.ts` for the wiring pattern (FileWatcher events -> SSE broadcast).

## Client: useSSE Hook

### Implementation (`src/client/api/hooks.ts`)

```typescript
function useSSE(channels: string[], onEvent: (channel: string, data: unknown) => void) {
  useEffect(() => {
    const source = new EventSource('/api/events');
    for (const channel of channels) {
      source.addEventListener(channel, (event: MessageEvent) => {
        onEvent(channel, JSON.parse(event.data));
      });
    }
    return () => source.close();
  }, [channels, onEvent]);
}
```

EventSource has built-in auto-reconnect — no manual reconnection code needed.

**Reference:** `claude-devtools/src/renderer/api/httpClient.ts` for the EventSource + addEventListener pattern.

## Page Integration

### Dashboard
- Subscribe to `stage-transition` and `board-update`
- On `stage-transition`: prepend to activity feed list (with animation)
- On `board-update`: re-fetch `/api/stats` to update summary cards

### Board pages (Epic, Ticket, Stage)
- Subscribe to `board-update`
- On `board-update`: re-fetch the board data via React Query's `invalidateQueries()`
- Optionally: highlight the card that changed (brief flash animation)

### Stage Detail
- Subscribe to `board-update` filtered to current stageId
- On update: re-fetch stage detail

### Session Detail
- Subscribe to `session-update` filtered to current sessionId
- On update: re-fetch session data
- Append new chunks to existing view (don't reset scroll)
- If auto-scroll is active (near bottom), scroll to new content

### React Query integration

Use React Query's `queryClient.invalidateQueries()` triggered by SSE events:

```typescript
const queryClient = useQueryClient();

useSSE(['board-update'], (channel, data) => {
  queryClient.invalidateQueries({ queryKey: ['board'] });
  queryClient.invalidateQueries({ queryKey: ['stats'] });
});
```

For session updates, use a more targeted approach:
```typescript
useSSE(['session-update'], (channel, data) => {
  if (data.sessionId === currentSessionId) {
    queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
  }
});
```

## Performance Considerations

- Debounce React Query invalidation (100ms) to batch rapid events
- For session updates: only re-fetch if the SessionDetail page is active
- Board updates: only invalidate if the update is for a stage in the current view's filter scope
- SSE keepalive at 30s prevents proxy timeouts

## Success Criteria

- SSE connection establishes on page load and auto-reconnects on disconnect
- Board pages update within 500ms of a stage status change
- Session detail view appends new content without resetting scroll
- Dashboard activity feed updates in real-time
- Multiple browser tabs all receive updates
- No memory leaks from SSE connections (cleanup on unmount)
