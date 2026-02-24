# Stage 6C: Completion Cascade — Design Document

## Date: 2026-02-24

## Overview

Stage 6C adds completion cascade to the orchestrator's exit gate module. When a stage reaches `'Complete'`, the cascade propagates upward: ticket status updates, and if all tickets in an epic are complete, the epic status updates. Backlog re-evaluation (unblocking dependent stages) is handled entirely by the existing sync infrastructure — no new code needed.

## Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Where does epic completion check live? | Inline in `exit-gates.ts` | Simple 3-line check. All propagation logic stays in one file. No new modules. |
| 2 | Active backlog re-evaluation or sync-only? | Sync-only | Sync already calls `isDependencyResolved()` and recomputes kanban columns. Adding active discovery would duplicate logic. |
| 3 | Recursive cascade? | No | Stage → ticket → epic, then stop. Sync + next tick handles downstream effects from epic completion. |
| 4 | Handle reverse cascade? | Yes, naturally | `deriveTicketStatus()` and `deriveEpicStatus()` return correct status regardless of direction. No special guards needed. |
| 5 | Update ticket's own `status` field? | Yes | Keeps ticket.status consistent with derived value. Previously only epic.ticket_statuses was updated. |
| 6 | Observability for cascade events? | Dedicated log lines | Log `ticketCompleted` and `epicCompleted` events in loop.ts for observability. |

## Architecture

### Approach: Minimal Inline Extension

No new modules. Extend `exit-gates.ts` with:
- `deriveEpicStatus()` function (mirrors `deriveTicketStatus()`)
- Epic completion check after `ticket_statuses` write
- Ticket `status` field update alongside `stage_statuses` update
- Extended `ExitGateResult` with `ticketCompleted` and `epicCompleted`

## Type Changes

### Extended `ExitGateResult`

```typescript
interface ExitGateResult {
  statusChanged: boolean;
  statusBefore: string;
  statusAfter: string;
  ticketUpdated: boolean;
  epicUpdated: boolean;
  ticketCompleted: boolean;   // NEW: ticket status became 'Complete'
  epicCompleted: boolean;     // NEW: epic status became 'Complete'
  syncResult: { success: boolean; error?: string };
}
```

Both new fields default to `false`.

## New Function: `deriveEpicStatus()`

```typescript
export function deriveEpicStatus(ticketStatuses: Record<string, string>): string | null {
  const values = Object.values(ticketStatuses);
  if (values.length === 0) return null;
  if (values.every(v => v === 'Complete')) return 'Complete';
  if (values.every(v => v === 'Not Started')) return 'Not Started';
  return 'In Progress';
}
```

Mirrors `deriveTicketStatus()` exactly but operates on ticket statuses instead of stage statuses.

## Modified Exit Gate Flow

Current flow (6B):
1. Return early if status unchanged
2. Read stage file → get ticket/epic IDs
3. Read ticket → update `stage_statuses[stageId] = statusAfter` → derive ticket status → write ticket
4. If derived ticket status not null → read epic → update `ticket_statuses[ticketId] = derivedStatus` → write epic
5. Sync with retry

New flow (6C additions in **bold**):
1. Return early if status unchanged
2. Read stage file → get ticket/epic IDs
3. Read ticket → update `stage_statuses[stageId] = statusAfter` → derive ticket status → **also set `ticket.status = derivedStatus`** → write ticket
4. **Set `ticketCompleted = (derivedStatus === 'Complete')`**
5. If derived ticket status not null → read epic → update `ticket_statuses[ticketId] = derivedStatus` → **call `deriveEpicStatus(epic.ticket_statuses)`** → **if `'Complete'`, set `epic.status = 'Complete'`, set `epicCompleted = true`** → write epic
6. Sync with retry

Key properties:
- Single write per entity (ticket written once with both `stage_statuses` and `status` updates)
- Epic written once with both `ticket_statuses` and potentially `status` updates
- No recursion — cascade stops at epic level
- Reverse cascade works naturally (revert → derive returns 'In Progress')

## Backlog Re-evaluation

**No new code needed.** The existing infrastructure handles this:

1. Exit gate calls `runSyncWithRetry()` at the end (already exists in 6B)
2. Sync calls `isDependencyResolved()` which checks if target status is `'Complete'`
3. Sync calls `computeKanbanColumn()` which assigns `backlog` vs `ready_for_work` based on `hasUnresolvedDeps`
4. Next orchestrator tick discovers newly-unblocked stages via SQLite query

The cascade ensures frontmatter statuses are correct before sync runs, which is all that's needed.

## Loop Integration

Extend existing exit gate logging in `handleSessionExit`:

```typescript
logger.info('Exit gate completed', {
  stageId,
  ticketUpdated: gateResult.ticketUpdated,
  epicUpdated: gateResult.epicUpdated,
  ticketCompleted: gateResult.ticketCompleted,
  epicCompleted: gateResult.epicCompleted,
  syncSuccess: gateResult.syncResult.success,
});

if (gateResult.ticketCompleted) {
  logger.info('Ticket completed — all stages done', { stageId });
}
if (gateResult.epicCompleted) {
  logger.info('Epic completed — all tickets done', { stageId });
}
```

Resolver-driven transitions (via `resolvers.ts` line 226) also call `exitGateRunner.run()`, so cascade + logging apply automatically.

## What Stage 6C Does NOT Include

- ❌ Active backlog discovery (sync handles it)
- ❌ Recursive cascade beyond epic level
- ❌ Immediate onboarding of newly-unblocked stages (next tick handles it)
- ❌ MR comment polling cron → Stage 6D
- ❌ Insights threshold cron → Stage 6E
- ❌ New resolver implementations

## Testing Strategy

All tests use injected dependencies — no real file I/O.

### Unit Tests — exit-gates.ts

1. Ticket completion cascade: all stages Complete → ticket.status = 'Complete', ticketCompleted = true
2. Ticket not yet complete: some stages in progress → ticket.status = 'In Progress', ticketCompleted = false
3. Epic completion cascade: all tickets Complete → epic.status = 'Complete', epicCompleted = true
4. Epic not yet complete: some tickets in progress → epicCompleted = false
5. Full cascade: single exit gate call triggers stage → ticket → epic completion
6. Reverse cascade: stage reverts from Complete → ticket/epic revert to In Progress
7. deriveEpicStatus unit tests: empty → null, all Complete → Complete, all Not Started → Not Started, mixed → In Progress

### Unit Tests — loop.ts

8. Completion logging: ticketCompleted = true → dedicated log line
9. Epic completion logging: epicCompleted = true → dedicated log line

### Integration Tests

10. Full cascade flow: multi-stage ticket, complete last stage → ticket and epic both complete
11. Partial completion: complete one stage of multi-stage ticket → ticket stays In Progress
12. Multi-ticket epic: one ticket completes, another doesn't → epic stays In Progress
13. Reverse cascade: stage reverts → ticket and epic revert
