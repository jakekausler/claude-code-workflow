# Inline Tool Permissions & Zombie Session Detection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move tool permission prompts from a floating modal into the session drawer (persistent across close/reopen), and detect zombie sessions where the Claude process dies without cleanup.

**Architecture:** Tool approvals are stored in a Zustand store keyed by stageId. Currently rendered by a global InteractionOverlay modal. We move the approval UI into the EmbeddedSessionViewer so it's contextual to the session. Zombie detection uses a heartbeat check in the orchestrator's session registry.

**Tech Stack:** React/Zustand (client), Fastify/WebSocket (server), Node.js child process monitoring (orchestrator)

---

## Task 1: Move approval rendering from modal to session viewer

**Files:**
- Modify: `tools/web-server/src/client/components/chat/EmbeddedSessionViewer.tsx`
- Modify: `tools/web-server/src/client/components/interaction/InteractionOverlay.tsx`
- Modify: `tools/web-server/src/client/store/interaction-store.ts`

### What to do

The `InteractionOverlay` (rendered in `App.tsx`) currently shows a floating modal for ALL approvals. We need to:

1. **Keep InteractionOverlay as a fallback** for approvals that don't have an open session drawer — but skip rendering if the approval's stageId has an active session viewer open.

2. **Add approval rendering to EmbeddedSessionViewer** — when the viewer's `interactionId` matches a pending approval in the interaction store, render the approval UI inline at the bottom of the session (above the message input).

3. **The interaction store already has `pendingApprovals` keyed by requestId with a `stageId` field.** The EmbeddedSessionViewer can query the store for approvals matching its `interactionId`.

### Step 1: Add approval awareness to EmbeddedSessionViewer

In `EmbeddedSessionViewer.tsx`:
- Import the interaction store: `useInteractionStore`
- Query for pending approvals matching the current `interactionId`
- If an approval exists, render an inline approval component between the chat area and the message input
- The inline approval should show: tool name, tool input summary, Allow/Deny buttons
- Use the existing `useApproveToolCall(interactionId)` hook for the mutation
- After approval/denial, the store removes the entry automatically

### Step 2: Add question awareness to EmbeddedSessionViewer

Same pattern for `pendingQuestions` — render an inline question form when one exists for this session.

### Step 3: Skip modal for sessions with open viewers

In `InteractionOverlay.tsx`:
- Add a check: if the approval's stageId has an active EmbeddedSessionViewer mounted, don't render the modal
- The simplest way: add a Zustand set `activeSessionViewers` to the interaction store. EmbeddedSessionViewer registers/unregisters on mount/unmount. InteractionOverlay filters out approvals for active viewers.

### Step 4: Ensure persistence across drawer close/reopen

Approvals are already in the Zustand store (in-memory). They persist as long as the page is open. When the user closes and reopens the drawer, the EmbeddedSessionViewer re-mounts and queries the store again — the approval is still there. No additional work needed for persistence.

### Step 5: Commit

```bash
git add tools/web-server/src/client/
git commit -m "feat(ui): move tool permission prompts inline into session viewer"
```

---

## Task 2: Style the inline approval component

**Files:**
- Create: `tools/web-server/src/client/components/chat/InlineApproval.tsx`

### What to do

Create a compact approval component that fits in the session drawer between chat and input:

- Light theme (matching the drawer)
- Shows: tool icon, tool name, truncated command/input
- Expandable to show full tool input
- Allow (green) and Deny (red) buttons
- Loading state while the mutation is in flight
- For questions: text input field with submit button

This is a new component extracted from the patterns in `ApprovalDialog.tsx` but styled for inline use rather than a modal.

### Step 1: Create InlineApproval component

Props:
```typescript
interface InlineApprovalProps {
  stageId: string;
  approval: PendingApproval;  // from interaction store
  onResolved: () => void;
}
```

### Step 2: Create InlineQuestion component

Same pattern for questions.

### Step 3: Commit

```bash
git add tools/web-server/src/client/components/chat/
git commit -m "feat(ui): add InlineApproval and InlineQuestion components for session drawer"
```

---

## Task 3: Zombie session detection in orchestrator

**Files:**
- Modify: `tools/orchestrator/src/session.ts`
- Modify: `tools/orchestrator/src/loop.ts`
- Modify: `tools/orchestrator/src/session-registry.ts`

### What to do

The current problem: when a Claude child process dies unexpectedly (e.g., SIGKILL, crash), the session registry may not get the `end()` call because the `close` event handler's promise chain breaks.

### Step 1: Add process monitoring to session executor

In `session.ts`, after spawning the child process:
- Store a reference to the child process PID in the session registry entry
- Add a periodic heartbeat check (every 30s) that verifies the PID is still alive using `process.kill(pid, 0)` (signal 0 checks existence without killing)
- If the process is gone, reject the spawn promise with an error

### Step 2: Add zombie cleanup to session registry

In `session-registry.ts`:
- Add a `checkZombies()` method that iterates all active sessions
- For each session, check if its PID is still alive
- If not, call `end(stageId)` to clean up
- Emit a warning log

### Step 3: Wire zombie check into the orchestrator loop

In `loop.ts`:
- Call `registry.checkZombies()` at the start of each tick (before discovery)
- Also add a `setInterval` that runs `checkZombies()` every 60 seconds as a safety net

### Step 4: Store PID in session registry

In `session-registry.ts`, extend `SessionEntry` to include `pid?: number`.
In `session.ts`, after spawning, call `registry.setPid(stageId, child.pid)`.

### Step 5: Commit

```bash
git add tools/orchestrator/src/
git commit -m "feat(orchestrator): detect and clean up zombie sessions via PID heartbeat"
```

---

## Task 4: Conversion session completion handling

**Files:**
- Modify: `tools/orchestrator/src/loop.ts`
- Modify: `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`

### What to do

When a conversion session completes:
1. The orchestrator should sync the repo
2. Broadcast a board-update event so the UI refreshes
3. The ticket detail should transition from "converting" to showing stages

### Step 1: Improve conversion exit handling

In `loop.ts`, the conversion session completion handler should:
- Always run sync (already done)
- Broadcast board-update via the WS server (add a `broadcast` function call)
- Log whether stages were created

### Step 2: UI transition on conversion complete

In `TicketDetailContent.tsx`:
- Listen for `session-ended` SSE events matching the ticketId
- When received, set `isConverting = false` and invalidate ticket/board queries
- The UI should transition from the spinner/session view to the stages list

### Step 3: Commit

```bash
git add tools/orchestrator/src/ tools/web-server/src/client/
git commit -m "feat: improve conversion session completion with board update and UI transition"
```

---

## Task 5: Verify and commit

```bash
cd tools/web-server && npm run verify
cd tools/orchestrator && npm run build && npm test
```

Fix any issues, then final commit.

---

## Task 6: Reseed and restart

1. Kill all processes
2. Delete DB and test repo
3. Run seed script
4. Set TICKET-002-003 to `to_convert`
5. Sync
6. Start web server
7. Start orchestrator (real mode, CLAUDECODE unset)
