---
title: "UserScopedSSE event broadcaster"
phase: 12
labels: [hosted, infrastructure]
depends_on: [019]
---

# UserScopedSSE Event Broadcaster

Per-user SSE event channels for hosted mode — each user only receives events for their own sessions.

## Design (from HOSTED-DESIGN.md)

- `Map<string, Set<FastifyReply>>` — per-user connection tracking
- Each user only receives events for their own sessions/stages
- Supports unscoped broadcast for admin/system-wide events

## Requirements

- Implement `EventBroadcaster` interface from `types.ts`
- User identification from JWT auth context
- Route SSE events only to the authenticated user's connections
- Handle connection lifecycle (add on connect, remove on disconnect/error)
- Admin broadcast capability for system-wide events
- Graceful handling of connection drops and reconnects

## Technical Notes

- Current SSE implementation broadcasts to all connected clients
- Hosted mode wraps this with user scoping based on auth context
- Local mode continues with unscoped broadcast (single user)
