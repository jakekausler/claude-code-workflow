---
title: "Stage 10B/10C/10D Testing Plan"
date: 2026-02-27
branch: worktree-stage-10d
status: draft
---

# Stage 10B/10C/10D Testing Plan

All testing should be done on the `worktree-stage-10d` branch, which contains the full stack of 10b + 10c + 10d.

## Testing Phases

Testing is split into three phases based on what's runnable now vs what's blocked:

| Phase | What | Runnable Now? | Blocker |
|-------|------|---------------|---------|
| **Phase 1** | Unit tests | Yes | None |
| **Phase 2** | Integration tests with mocked orchestrator | Yes (with mock setup) | None |
| **Phase 3** | E2E tests with real orchestrator | No | Orchestrator phase lifecycle must work |

---

## Phase 1: Unit Tests (Runnable Now)

### 10B — Bidirectional Interaction

#### ProtocolPeer (`tools/orchestrator/src/protocol-peer.ts`)

Existing tests in `tests/protocol-peer.test.ts` (13 tests passing). Additional tests to write:

- [ ] Outbound message ordering — send multiple messages in sequence, verify order preserved
- [ ] Concurrent send handling — multiple callers send simultaneously, no corruption
- [ ] Large message handling — payloads > 64KB sent/received without truncation
- [ ] Stream teardown — stdin closes cleanly, readLoop exits
- [ ] Malformed JSON recovery — mix valid/invalid lines, continues on next valid

#### ApprovalService (`tools/orchestrator/src/approval-service.ts`)

Existing tests in `tests/approval-service.test.ts` (11 tests passing). Additional tests to write:

- [ ] Race condition: two approve calls for same requestId — second should throw
- [ ] Race condition: resolve after clearForStage — should throw
- [ ] Memory cleanup — 1000 approvals created and resolved, Map is empty
- [ ] Multiple stages — approvals from different stageIds coexist and filter correctly
- [ ] Answer injection edge cases — null input, undefined answers, empty answers object

#### MessageQueue (`tools/orchestrator/src/message-queue.ts`)

Existing tests in `tests/message-queue.test.ts` (4 tests passing). Additional tests to write:

- [ ] Queue overwrites — queue for stageId, queue again, second overwrites first
- [ ] Concurrent queue/take — multiple stageIds simultaneously
- [ ] Empty queue after take — next take returns undefined

#### Interaction Store (`tools/web-server/src/client/store/interaction-store.ts`)

Existing tests (4 tests passing). Additional:

- [ ] FIFO ordering — multiple approvals returned in insertion order
- [ ] Duplicate requestId — second add overwrites first
- [ ] Subscription updates — Zustand subscribers notified on state change

### 10C — Live Session Status

#### SessionStatusIndicator (`src/client/components/board/SessionStatusIndicator.tsx`)

Existing tests (6 tests passing). Additional:

- [ ] CSS animation class `animate-pulse` present for active status
- [ ] Accessibility — aria-label or title attribute present
- [ ] Compact mode — hides label text when compact=true

#### BoardCard Session Integration

Existing tests (3 tests passing). Additional:

- [ ] Card still clickable when status=waiting
- [ ] Status indicator hidden when session is null/undefined
- [ ] Visual emphasis (shadow/highlight) when status=waiting

#### useSessionMap Hook (`src/client/api/use-session-map.ts`)

Existing tests (4 tests passing). Additional:

- [ ] REST → SSE transition — initial load from REST, then update via SSE event
- [ ] Stale data merge — SSE arrives before REST response, merged correctly
- [ ] Memory cleanup — hook unsubscribes from SSE on unmount

#### Dashboard Activity Feed

Existing tests (5 tests passing). Additional:

- [ ] Click event item navigates to stage detail
- [ ] Events sorted by most recent first
- [ ] Feed limited to reasonable count (20 events)

#### LiveSessionSection (`src/client/components/stage/LiveSessionSection.tsx`)

Existing tests (7 tests passing). Additional:

- [ ] Status transition — section updates when status changes (active → waiting → active)
- [ ] Real-time duration — timer increments
- [ ] Message input submit — sends message, shows confirmation

### 10D — Deployment Abstraction

#### DirectFileSystemProvider (`src/server/deployment/local/direct-fs-provider.ts`)

Existing tests (6 tests passing). Additional:

- [ ] Error: ENOENT on nonexistent file
- [ ] Error: EISDIR on directory
- [ ] Symlink handling — readFile follows symlinks
- [ ] Concurrent reads — 10 parallel readFile calls succeed

#### NoopAuthProvider (`src/server/deployment/local/noop-auth-provider.ts`)

Existing tests (3 tests passing). Additional:

- [ ] Prehandler calls next() (doesn't block requests)
- [ ] No 401 responses even without Authorization header

#### BroadcastAllSSE (`src/server/deployment/local/broadcast-all-sse.ts`)

Existing tests (6 tests passing). Additional:

- [ ] SSE format — writes proper `event: name\ndata: {...}\n\n` format
- [ ] Dead client cleanup — client that errors on write is removed
- [ ] Empty broadcast — no clients connected, doesn't crash
- [ ] JSON encoding — data serialized as valid JSON

#### LocalDeploymentContext (`src/server/deployment/local/local-deployment-context.ts`)

Existing tests (5 tests passing). Additional:

- [ ] mode property === 'local'
- [ ] CLAUDE_ROOT env var overrides default
- [ ] Providers cached (same instance on repeated calls)

---

## Phase 2: Integration Tests with Mocked Orchestrator

These test the interaction between components using mocked WebSocket messages.

### 10B — Interaction Endpoints

Test files: `tests/server/interaction-routes.test.ts`, `tests/server/orchestrator-client-bidirectional.test.ts`

Existing tests cover basic happy paths. Additional:

- [ ] POST /api/sessions/:stageId/message when WebSocket is disconnected → 503
- [ ] POST with invalid stageId → 404 or 400
- [ ] POST without required body fields → 400
- [ ] Concurrent requests from multiple clients → all received
- [ ] Large message payload → proper rejection or handling

### 10C — SSE Session Status Events

- [ ] Mock orchestrator sends `session_registered` WS event → SSE broadcasts `session-status` to browser
- [ ] Event payload contains `{ stageId, status, waitingType? }`
- [ ] Status values: active, waiting, starting, ended
- [ ] waitingType values when waiting: user_input, permission, idle
- [ ] Multiple stages — different stages receive independent status updates

### 10C — Orchestrator Client Session Map

Test file: `tests/server/orchestrator-client-pending.test.ts`

- [ ] Full session lifecycle: registered → active → waiting → active → ended
- [ ] Concurrent WS events — no lost updates
- [ ] Disconnect and reconnect — registry refresh requested
- [ ] GET /api/orchestrator/sessions returns current session map

### 10D — Server Integration with DeploymentContext

- [ ] DEPLOYMENT_MODE=local selects LocalDeploymentContext
- [ ] Default mode (no env var) defaults to 'local'
- [ ] All file reads go through FileSystemProvider (no direct fs.readFile calls)
- [ ] All SSE broadcasts go through EventBroadcaster
- [ ] Auth middleware applied to routes (no-op in local mode)

### Cross-Stage Integration

- [ ] User approves tool (10B) → ApprovalService resolves → status updates to active (10C)
- [ ] Session enters waiting:user_input → MessageInput appears in LiveSessionSection (10B + 10C)
- [ ] All operations use DeploymentContext abstractions (10D) — no direct fs or SSE calls

---

## Phase 3: E2E Tests (Blocked Until Orchestrator Works)

These require the orchestrator to actually move sessions through phases.

### Prerequisites
1. Orchestrator picks up a stage from the seed repo
2. Orchestrator spawns a Claude session with `--input-format=stream-json --output-format=stream-json`
3. Session progresses through Design → Build → Refinement → Finalize
4. WebSocket events are sent to the web server at each transition

### Full Stage Progression
- [ ] Orchestrator picks up a "Not Started" stage
- [ ] Session starts — board card shows green pulsing indicator (active)
- [ ] Session requests tool approval — card shows yellow indicator (waiting:permission)
- [ ] User approves from browser — card returns to green (active)
- [ ] Session requests user input — card shows yellow indicator (waiting:user_input)
- [ ] User sends message from browser — session resumes
- [ ] Session completes phase — stage moves to next phase
- [ ] Session completes all phases — stage marked complete

### Multi-Session Handling
- [ ] 3+ stages running simultaneously
- [ ] Dashboard shows all active sessions
- [ ] Switching between stage drawers shows correct session for each
- [ ] Each interaction overlay is scoped to the correct stage

### Session Follow-Up Messages
- [ ] Session reaches waiting:user_input
- [ ] User sends follow-up from MessageInput
- [ ] If Claude is busy, message queued (MessageQueue)
- [ ] Message consumed on next session cycle

### Deployment Context (Local Mode)
- [ ] All file reads work through DirectFileSystemProvider
- [ ] SSE broadcasts via BroadcastAllSSE
- [ ] No auth checks block local users (NoopAuthProvider)

---

## Browser Component Testing Gaps

The following interaction components have minimal test stubs (< 25 lines each) that need expansion:

### ApprovalDialog
- [ ] Renders tool name and formatted input
- [ ] Allow button sends approval with `{ decision: 'allow' }`
- [ ] Deny button reveals reason input
- [ ] Deny with reason sends `{ decision: 'deny', reason: '...' }`
- [ ] Escape key closes dialog
- [ ] Buttons disabled while mutation pending

### MessageInput
- [ ] Text captured on input
- [ ] Submit sends message via hook
- [ ] Enter sends, Shift+Enter inserts newline
- [ ] Disabled when stageId is null
- [ ] Input cleared after successful send
- [ ] Empty input prevents submit

### QuestionAnswerForm
- [ ] Each question rendered as separate section
- [ ] Single-select shows option buttons
- [ ] Multi-select shows checkboxes
- [ ] "Other" text input available
- [ ] Submit sends answers object
- [ ] All required questions must be answered before submit

### InteractionOverlay
- [ ] ApprovalDialog shown on `approval-requested` event
- [ ] QuestionAnswerForm shown on `question-requested` event
- [ ] Multiple pending requests queued (one visible at a time)
- [ ] Overlay dismissed after resolution

### PendingBadge
- [ ] Shows count when pending > 0
- [ ] Hidden when pending === 0

---

## Known Gotchas

1. **10b/10c/10d were based on an older Stage 9 state** — expect merge conflicts in `app.ts`, `file-watcher.ts`, and session-related stores. The 10d branch is now up to date with kanban, but conflicts may have been resolved imperfectly.

2. **ProtocolPeer vs ProtocolHandler** — ProtocolPeer is the I/O wrapper; the event processor is ApprovalService. Tests must mock the handler and verify handler methods are called.

3. **WebSocket reconnect during approval** — If orchestrator-client reconnects mid-approval, pending approvals must survive. This is an edge case to verify.

4. **No approval timeout** — Current design waits forever for user decision. May need a configurable timeout in practice.

5. **MessageQueue is not FIFO** — It's one-message-per-stage (overwrites). It's a "latest pending message" store, not a queue despite the name.

6. **Session status encoding** — `status` and `waitingType` are separate fields. Invalid combinations (e.g., status=ended with waitingType set) should be rejected or ignored.

---

## Execution

```bash
# Run all existing unit tests on the 10d branch
cd /storage/programs/claude-code-workflow/.claude/worktrees/stage-10d

# Orchestrator tests
cd tools/orchestrator && npm test

# Web server tests
cd tools/web-server && npm test

# Full verify (lint + test)
cd tools/orchestrator && npm run verify
cd tools/web-server && npm run verify
```
