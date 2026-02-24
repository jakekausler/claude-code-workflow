# Stage 6C: Completion Cascade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add completion cascade to exit gates — when all stages in a ticket are Complete, mark the ticket Complete; when all tickets in an epic are Complete, mark the epic Complete. Backlog re-evaluation is handled by existing sync infrastructure.

**Architecture:** Extend `exit-gates.ts` inline with `deriveEpicStatus()` function and ticket/epic `status` field updates. Extend `ExitGateResult` with `ticketCompleted` and `epicCompleted` booleans. Update `loop.ts` logging. No new modules.

**Tech Stack:** TypeScript, Vitest, gray-matter (frontmatter), DI pattern (factory + injectable deps)

**Design doc:** `docs/plans/2026-02-24-stage-6c-completion-cascade-design.md`

---

## Task 6C-1: Extend ExitGateResult Type & Add deriveEpicStatus

**Goal:** Add `ticketCompleted` and `epicCompleted` to `ExitGateResult`. Add `deriveEpicStatus()` pure function.

**Dependencies:** None

**Files to modify:**
- `tools/orchestrator/src/exit-gates.ts` — Add fields to `ExitGateResult`, add `deriveEpicStatus()` export
- `tools/orchestrator/tests/exit-gates.test.ts` — Add `deriveEpicStatus` unit tests

**Step 1: Write failing tests for deriveEpicStatus**

Add to `tools/orchestrator/tests/exit-gates.test.ts`:

```typescript
import { deriveEpicStatus } from '../src/exit-gates.js';

describe('deriveEpicStatus', () => {
  it('returns null for empty map', () => {
    expect(deriveEpicStatus({})).toBeNull();
  });

  it('returns Complete when all tickets are Complete', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'Complete',
    })).toBe('Complete');
  });

  it('returns Not Started when all tickets are Not Started', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Not Started',
      'TICKET-001-002': 'Not Started',
    })).toBe('Not Started');
  });

  it('returns In Progress for mixed statuses', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'In Progress',
    })).toBe('In Progress');
  });

  it('returns In Progress when some Complete and some Not Started', () => {
    expect(deriveEpicStatus({
      'TICKET-001-001': 'Complete',
      'TICKET-001-002': 'Not Started',
    })).toBe('In Progress');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: FAIL — `deriveEpicStatus` is not exported

**Step 3: Implement deriveEpicStatus and extend ExitGateResult**

In `tools/orchestrator/src/exit-gates.ts`:

1. Add `ticketCompleted: boolean` and `epicCompleted: boolean` to `ExitGateResult` interface
2. Add `deriveEpicStatus` function after the existing `deriveTicketStatus`:

```typescript
export function deriveEpicStatus(ticketStatuses: Record<string, string>): string | null {
  const values = Object.values(ticketStatuses);
  if (values.length === 0) return null;
  if (values.every(v => v === 'Complete')) return 'Complete';
  if (values.every(v => v === 'Not Started')) return 'Not Started';
  return 'In Progress';
}
```

3. Update the early-return result and any other `ExitGateResult` construction sites to include `ticketCompleted: false` and `epicCompleted: false`

**Step 4: Run tests to verify they pass**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: All pass (including existing tests)

**Step 5: Commit**

```bash
git add tools/orchestrator/src/exit-gates.ts tools/orchestrator/tests/exit-gates.test.ts
git commit -m "feat(exit-gates): add deriveEpicStatus and extend ExitGateResult with completion flags"
```

**Success criteria:**
- `deriveEpicStatus()` exported and tested (5 cases)
- `ExitGateResult` has `ticketCompleted` and `epicCompleted` fields
- All existing exit-gates tests still pass
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-2: Ticket Completion Cascade

**Goal:** When `deriveTicketStatus()` returns `'Complete'`, also set the ticket's own `status` field to `'Complete'`. Set `ticketCompleted = true` in result.

**Dependencies:** 6C-1

**Files to modify:**
- `tools/orchestrator/src/exit-gates.ts` — Update ticket write in `run()` to also set `ticket.status`
- `tools/orchestrator/tests/exit-gates.test.ts` — Add ticket completion tests

**Step 1: Write failing tests**

Add to the exit gate `run()` describe block in `tools/orchestrator/tests/exit-gates.test.ts`:

```typescript
it('sets ticket status to Complete when all stages are Complete', async () => {
  // Set up: ticket has two stages, both will be Complete after this update
  const store = makeFrontmatterStore({
    '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
      data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
      content: '',
    },
    '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
      data: {
        id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
        stage_statuses: { 'STAGE-001-001-001': 'Build', 'STAGE-001-001-002': 'Complete' },
      },
      content: '',
    },
    '/repo/epics/EPIC-001/EPIC-001.md': {
      data: {
        id: 'EPIC-001', status: 'In Progress',
        ticket_statuses: { 'TICKET-001-001': 'In Progress' },
      },
      content: '',
    },
  });

  const runner = createExitGateRunner({
    readFrontmatter: store.read,
    writeFrontmatter: store.write,
    runSync: vi.fn().mockResolvedValue({ success: true }),
    logger: makeLogger(),
  });

  const result = await runner.run(
    { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
    '/repo',
    'Complete',
  );

  expect(result.ticketCompleted).toBe(true);
  // Verify ticket's own status field was updated
  const ticket = await store.read('/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
  expect(ticket.data.status).toBe('Complete');
});

it('does not set ticketCompleted when some stages are still in progress', async () => {
  const store = makeFrontmatterStore({
    '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
      data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
      content: '',
    },
    '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
      data: {
        id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
        stage_statuses: { 'STAGE-001-001-001': 'Build', 'STAGE-001-001-002': 'Design' },
      },
      content: '',
    },
    '/repo/epics/EPIC-001/EPIC-001.md': {
      data: { id: 'EPIC-001', status: 'In Progress', ticket_statuses: { 'TICKET-001-001': 'In Progress' } },
      content: '',
    },
  });

  const runner = createExitGateRunner({
    readFrontmatter: store.read,
    writeFrontmatter: store.write,
    runSync: vi.fn().mockResolvedValue({ success: true }),
    logger: makeLogger(),
  });

  const result = await runner.run(
    { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
    '/repo',
    'Complete',
  );

  expect(result.ticketCompleted).toBe(false);
  const ticket = await store.read('/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
  expect(ticket.data.status).toBe('In Progress');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: FAIL — `ticketCompleted` is always `false`, ticket.status not updated

**Step 3: Implement ticket completion in exit gate run()**

In the `run()` method of `exit-gates.ts`, after deriving ticket status (around line 148-160):

```typescript
// After: const derivedStatus = deriveTicketStatus(ticketData.stage_statuses);
// Add: update ticket's own status field
if (derivedStatus !== null) {
  ticketData.status = derivedStatus;
}
const ticketCompleted = derivedStatus === 'Complete';

// Write ticket (already exists, just ensure ticketData.status is included)
await writeFrontmatter(ticketPath, ticketData, ticketContent);
```

Update the result object construction to include `ticketCompleted`.

**Step 4: Run tests to verify they pass**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: All pass

**Step 5: Commit**

```bash
git add tools/orchestrator/src/exit-gates.ts tools/orchestrator/tests/exit-gates.test.ts
git commit -m "feat(exit-gates): cascade ticket completion — update ticket.status when all stages Complete"
```

**Success criteria:**
- Ticket's own `status` field updated to derived status
- `ticketCompleted` is `true` only when derived status is `'Complete'`
- All existing tests still pass
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-3: Epic Completion Cascade

**Goal:** After updating epic's `ticket_statuses`, call `deriveEpicStatus()`. If all tickets are `'Complete'`, set `epic.status = 'Complete'` and `epicCompleted = true`.

**Dependencies:** 6C-1, 6C-2

**Files to modify:**
- `tools/orchestrator/src/exit-gates.ts` — Add epic completion check in `run()` after `ticket_statuses` update
- `tools/orchestrator/tests/exit-gates.test.ts` — Add epic completion tests

**Step 1: Write failing tests**

```typescript
it('sets epic status to Complete when all tickets are Complete', async () => {
  const store = makeFrontmatterStore({
    '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
      data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
      content: '',
    },
    '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
      data: {
        id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
        stage_statuses: { 'STAGE-001-001-001': 'Build' },
      },
      content: '',
    },
    '/repo/epics/EPIC-001/EPIC-001.md': {
      data: {
        id: 'EPIC-001', status: 'In Progress',
        ticket_statuses: { 'TICKET-001-001': 'In Progress', 'TICKET-001-002': 'Complete' },
      },
      content: '',
    },
  });

  const runner = createExitGateRunner({
    readFrontmatter: store.read,
    writeFrontmatter: store.write,
    runSync: vi.fn().mockResolvedValue({ success: true }),
    logger: makeLogger(),
  });

  // Completing the last stage of TICKET-001-001 should cascade to epic
  const result = await runner.run(
    { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
    '/repo',
    'Complete',
  );

  expect(result.ticketCompleted).toBe(true);
  expect(result.epicCompleted).toBe(true);
  const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
  expect(epic.data.status).toBe('Complete');
});

it('does not set epicCompleted when some tickets are still in progress', async () => {
  const store = makeFrontmatterStore({
    '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
      data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
      content: '',
    },
    '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
      data: {
        id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
        stage_statuses: { 'STAGE-001-001-001': 'Build' },
      },
      content: '',
    },
    '/repo/epics/EPIC-001/EPIC-001.md': {
      data: {
        id: 'EPIC-001', status: 'In Progress',
        ticket_statuses: { 'TICKET-001-001': 'In Progress', 'TICKET-001-002': 'In Progress' },
      },
      content: '',
    },
  });

  const runner = createExitGateRunner({
    readFrontmatter: store.read,
    writeFrontmatter: store.write,
    runSync: vi.fn().mockResolvedValue({ success: true }),
    logger: makeLogger(),
  });

  const result = await runner.run(
    { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
    '/repo',
    'Complete',
  );

  expect(result.epicCompleted).toBe(false);
  const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
  expect(epic.data.status).toBe('In Progress');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: FAIL — `epicCompleted` is always `false`, epic.status not updated

**Step 3: Implement epic completion in exit gate run()**

In the `run()` method, within the epic update block (where `ticket_statuses` is written):

```typescript
// After updating epic's ticket_statuses:
epicData.ticket_statuses[ticketId] = derivedStatus;

// NEW: Check if epic should be completed
const derivedEpicStatus = deriveEpicStatus(epicData.ticket_statuses);
if (derivedEpicStatus !== null) {
  epicData.status = derivedEpicStatus;
}
const epicCompleted = derivedEpicStatus === 'Complete';

await writeFrontmatter(epicPath, epicData, epicContent);
```

Update result construction to include `epicCompleted`.

**Step 4: Run tests to verify they pass**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: All pass

**Step 5: Commit**

```bash
git add tools/orchestrator/src/exit-gates.ts tools/orchestrator/tests/exit-gates.test.ts
git commit -m "feat(exit-gates): cascade epic completion — update epic.status when all tickets Complete"
```

**Success criteria:**
- Epic `status` updated to `'Complete'` when all `ticket_statuses` are `'Complete'`
- `epicCompleted` is `true` only when epic actually becomes Complete
- Reverse works: if ticket reverts, epic reverts to 'In Progress'
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-4: Reverse Cascade Tests

**Goal:** Verify that status reverts cascade correctly (stage un-completes → ticket/epic revert).

**Dependencies:** 6C-2, 6C-3

**Files to modify:**
- `tools/orchestrator/tests/exit-gates.test.ts` — Add reverse cascade tests

**Step 1: Write reverse cascade tests**

```typescript
describe('reverse cascade', () => {
  it('reverts ticket and epic from Complete to In Progress when stage un-completes', async () => {
    // Ticket and epic are both Complete, then a stage reverts
    const store = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
        data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Complete' },
        content: '',
      },
      '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
        data: {
          id: 'TICKET-001-001', epic: 'EPIC-001', status: 'Complete',
          stage_statuses: { 'STAGE-001-001-001': 'Complete', 'STAGE-001-001-002': 'Complete' },
        },
        content: '',
      },
      '/repo/epics/EPIC-001/EPIC-001.md': {
        data: {
          id: 'EPIC-001', status: 'Complete',
          ticket_statuses: { 'TICKET-001-001': 'Complete' },
        },
        content: '',
      },
    });

    const runner = createExitGateRunner({
      readFrontmatter: store.read,
      writeFrontmatter: store.write,
      runSync: vi.fn().mockResolvedValue({ success: true }),
      logger: makeLogger(),
    });

    // Stage reverts from Complete to Build
    const result = await runner.run(
      { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Complete', startTime: 0 },
      '/repo',
      'Build',
    );

    expect(result.ticketCompleted).toBe(false);
    expect(result.epicCompleted).toBe(false);

    const ticket = await store.read('/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
    expect(ticket.data.status).toBe('In Progress');
    expect(ticket.data.stage_statuses['STAGE-001-001-001']).toBe('Build');

    const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
    expect(epic.data.status).toBe('In Progress');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd tools/orchestrator && npx vitest run tests/exit-gates.test.ts --reporter=verbose`
Expected: All pass (reverse cascade should work with the forward cascade implementation)

**Step 3: Commit**

```bash
git add tools/orchestrator/tests/exit-gates.test.ts
git commit -m "test(exit-gates): add reverse cascade tests — status revert propagates correctly"
```

**Success criteria:**
- Reverse cascade test passes (stage revert → ticket/epic revert)
- All existing tests still pass
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-5: Loop Logging Updates

**Goal:** Extend exit gate logging in `loop.ts` with `ticketCompleted`/`epicCompleted` fields and dedicated completion log lines.

**Dependencies:** 6C-1

**Files to modify:**
- `tools/orchestrator/src/loop.ts` — Extend exit gate log in `handleSessionExit`
- `tools/orchestrator/tests/loop.test.ts` — Add logging tests

**Step 1: Write failing tests**

Add to `tools/orchestrator/tests/loop.test.ts`:

```typescript
it('logs ticket completion when ticketCompleted is true', async () => {
  // Set up exit gate runner mock to return ticketCompleted: true
  const mockExitGateRunner = {
    run: vi.fn().mockResolvedValue({
      statusChanged: true,
      statusBefore: 'Build',
      statusAfter: 'Complete',
      ticketUpdated: true,
      epicUpdated: true,
      ticketCompleted: true,
      epicCompleted: false,
      syncResult: { success: true },
    }),
  };
  // ... wire into orchestrator deps, trigger session exit with status change
  // Assert logger.info was called with 'Ticket completed — all stages done'
});

it('logs epic completion when epicCompleted is true', async () => {
  // Similar setup with epicCompleted: true
  // Assert logger.info was called with 'Epic completed — all tickets done'
});
```

Note: The exact test structure should follow the existing loop.test.ts patterns for mocking `handleSessionExit`. Study the existing exit gate tests in loop.test.ts for the mock setup pattern.

**Step 2: Implement logging updates**

In `tools/orchestrator/src/loop.ts`, in the `handleSessionExit` function where exit gate result is logged (around line 166-176):

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

**Step 3: Run tests**

Run: `cd tools/orchestrator && npx vitest run tests/loop.test.ts --reporter=verbose`
Expected: All pass

**Step 4: Commit**

```bash
git add tools/orchestrator/src/loop.ts tools/orchestrator/tests/loop.test.ts
git commit -m "feat(loop): add completion cascade logging for ticket and epic completion events"
```

**Success criteria:**
- `ticketCompleted` and `epicCompleted` appear in exit gate log
- Dedicated log lines emitted on completion
- All existing loop tests still pass
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-6: Integration Tests

**Goal:** End-to-end tests exercising the full cascade flow with mock file hierarchies.

**Dependencies:** 6C-2, 6C-3, 6C-4, 6C-5

**Files to modify:**
- `tools/orchestrator/tests/integration/exit-gate-flow.test.ts` — Add cascade integration tests

**Step 1: Write integration tests**

Add to the existing `exit-gate-flow.test.ts` (uses shared helpers from `helpers.ts`):

```typescript
describe('completion cascade', () => {
  it('cascades stage Complete through ticket to epic', async () => {
    // Multi-stage ticket, multi-ticket epic
    // Complete the last stage → ticket becomes Complete → epic becomes Complete
    const store = makeFrontmatterStore({
      // Stage file
      '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
        data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
        content: '',
      },
      // Ticket: one stage already Complete, this stage about to complete
      '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
        data: {
          id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
          stage_statuses: { 'STAGE-001-001-001': 'Build', 'STAGE-001-001-002': 'Complete' },
        },
        content: '',
      },
      // Epic: one ticket about to complete, another already Complete
      '/repo/epics/EPIC-001/EPIC-001.md': {
        data: {
          id: 'EPIC-001', status: 'In Progress',
          ticket_statuses: { 'TICKET-001-001': 'In Progress', 'TICKET-001-002': 'Complete' },
        },
        content: '',
      },
    });

    const syncMock = vi.fn().mockResolvedValue({ success: true });
    const runner = createExitGateRunner({
      readFrontmatter: store.read,
      writeFrontmatter: store.write,
      runSync: syncMock,
      logger: makeLogger(),
    });

    const result = await runner.run(
      { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
      '/repo',
      'Complete',
    );

    // Full cascade
    expect(result.ticketCompleted).toBe(true);
    expect(result.epicCompleted).toBe(true);

    // Verify all frontmatter updated
    const ticket = await store.read('/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
    expect(ticket.data.status).toBe('Complete');
    expect(ticket.data.stage_statuses['STAGE-001-001-001']).toBe('Complete');

    const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
    expect(epic.data.status).toBe('Complete');
    expect(epic.data.ticket_statuses['TICKET-001-001']).toBe('Complete');

    // Sync called once at the end
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('partial completion — ticket completes but epic does not', async () => {
    const store = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
        data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Build' },
        content: '',
      },
      '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
        data: {
          id: 'TICKET-001-001', epic: 'EPIC-001', status: 'In Progress',
          stage_statuses: { 'STAGE-001-001-001': 'Build' },
        },
        content: '',
      },
      '/repo/epics/EPIC-001/EPIC-001.md': {
        data: {
          id: 'EPIC-001', status: 'In Progress',
          ticket_statuses: { 'TICKET-001-001': 'In Progress', 'TICKET-001-002': 'In Progress' },
        },
        content: '',
      },
    });

    const runner = createExitGateRunner({
      readFrontmatter: store.read,
      writeFrontmatter: store.write,
      runSync: vi.fn().mockResolvedValue({ success: true }),
      logger: makeLogger(),
    });

    const result = await runner.run(
      { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Build', startTime: 0 },
      '/repo',
      'Complete',
    );

    expect(result.ticketCompleted).toBe(true);
    expect(result.epicCompleted).toBe(false);
    const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
    expect(epic.data.status).toBe('In Progress');
  });

  it('reverse cascade — revert stage un-completes ticket and epic', async () => {
    const store = makeFrontmatterStore({
      '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': {
        data: { id: 'STAGE-001-001-001', ticket: 'TICKET-001-001', epic: 'EPIC-001', status: 'Complete' },
        content: '',
      },
      '/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': {
        data: {
          id: 'TICKET-001-001', epic: 'EPIC-001', status: 'Complete',
          stage_statuses: { 'STAGE-001-001-001': 'Complete' },
        },
        content: '',
      },
      '/repo/epics/EPIC-001/EPIC-001.md': {
        data: {
          id: 'EPIC-001', status: 'Complete',
          ticket_statuses: { 'TICKET-001-001': 'Complete' },
        },
        content: '',
      },
    });

    const runner = createExitGateRunner({
      readFrontmatter: store.read,
      writeFrontmatter: store.write,
      runSync: vi.fn().mockResolvedValue({ success: true }),
      logger: makeLogger(),
    });

    const result = await runner.run(
      { stageId: 'STAGE-001-001-001', stageFilePath: '/repo/epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md', worktreePath: '', worktreeIndex: -1, statusBefore: 'Complete', startTime: 0 },
      '/repo',
      'Build',
    );

    expect(result.ticketCompleted).toBe(false);
    expect(result.epicCompleted).toBe(false);

    const ticket = await store.read('/repo/epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
    expect(ticket.data.status).toBe('In Progress');

    const epic = await store.read('/repo/epics/EPIC-001/EPIC-001.md');
    expect(epic.data.status).toBe('In Progress');
  });
});
```

**Step 2: Run tests**

Run: `cd tools/orchestrator && npx vitest run tests/integration/exit-gate-flow.test.ts --reporter=verbose`
Expected: All pass

**Step 3: Commit**

```bash
git add tools/orchestrator/tests/integration/exit-gate-flow.test.ts
git commit -m "test(integration): add completion cascade integration tests — full, partial, and reverse flows"
```

**Success criteria:**
- 3 integration tests pass: full cascade, partial, reverse
- All existing integration tests still pass
- `npm run verify` passes in orchestrator

**Status:** Complete

---

## Task 6C-7: Seed Script & Handoff Updates

**Goal:** Update handoff doc with completion notes. Verify seed script generates correct data.

**Dependencies:** 6C-6

**Files to modify:**
- `docs/plans/stage-6c-completion-cascade-handoff.md` — Mark complete, add handoff notes for 6D
- `docs/plans/stage-6c-completion-cascade/IMPLEMENTATION_PLAN.md` — Update task statuses

**Step 1: Update handoff doc**

Add completion summary section to the handoff doc:
- What was delivered (completion cascade, extended ExitGateResult, logging)
- Test results (total test count)
- Decisions that changed from handoff (if any)
- Handoff notes for 6D

**Step 2: Verify seed script works with E2E test**

Run: `cd tools/kanban-cli && KANBAN_MOCK=true bash scripts/seed-test-repo.sh /tmp/test-6c-repo`

Verify the seeded repo has correct `stage_statuses` and `ticket_statuses` fields. The seed script was already updated in 6B — no changes needed unless cascade reveals issues.

**Step 3: Final verification**

Run: `cd tools/orchestrator && npm run verify`
Run: `cd tools/kanban-cli && npm run verify`

**Step 4: Commit**

```bash
git add docs/plans/stage-6c-completion-cascade-handoff.md docs/plans/stage-6c-completion-cascade/IMPLEMENTATION_PLAN.md
git commit -m "docs(6C): mark completion cascade as complete, update handoff for 6D"
```

**Success criteria:**
- Handoff doc updated with completion summary
- All tests pass in both packages
- `npm run verify` passes in both packages

**Status:** Complete

---

## Dependency Graph

```
6C-1 (Types + deriveEpicStatus) ──┬──→ 6C-2 (Ticket Cascade) ──┬──→ 6C-4 (Reverse Tests) ──┐
                                   │                              │                            │
                                   └──→ 6C-5 (Loop Logging) ─────┴──→ 6C-6 (Integration) ──→ 6C-7 (Handoff)
                                                                  │
                                   6C-3 (Epic Cascade) ───────────┘
                                     (depends on 6C-1, 6C-2)
```

Tasks 6C-2, 6C-3 are sequential (epic depends on ticket cascade).
Task 6C-5 depends only on 6C-1 (types).
Task 6C-4 depends on 6C-2 and 6C-3.
Task 6C-6 depends on all implementation tasks.
Task 6C-7 is the final wrap-up.

## Verification

After each task: `npm run verify` in `tools/orchestrator`.
After all tasks: `npm run verify` in both `tools/kanban-cli` and `tools/orchestrator`.
