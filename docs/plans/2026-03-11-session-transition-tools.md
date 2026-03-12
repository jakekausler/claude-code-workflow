# Session Transition MCP Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Claude sessions the ability to signal state transitions to the orchestrator via MCP tools — `conversion_complete` for ticket conversion and `transition_stage` for pipeline phase transitions — replacing the current approach of reading frontmatter after process exit.

**Architecture:** Register two permission-prompt tools via the `--permission-prompt-tool=stdio` mechanism. When Claude calls these tools, the orchestrator intercepts them in the ProtocolPeer (same way it handles approval requests), performs the transition, syncs the repo, and closes the session. The conversion prompt references the existing `convert-ticket` skill and instructs Claude to call `conversion_complete` when done instead of running sync manually.

**Tech Stack:** Node.js child process stdio protocol, orchestrator ProtocolPeer, pipeline config YAML, kanban-cli sync

---

## Task 1: Add `conversion_complete` tool handling to orchestrator

**Files:**
- Modify: `tools/orchestrator/src/session.ts`
- Modify: `tools/orchestrator/src/loop.ts`

### What to do

The ProtocolPeer handles `control_request` messages from Claude, which include tool permission requests. When Claude calls a tool, the orchestrator can intercept it before it executes.

However, `conversion_complete` isn't a real tool — it's a signal. The approach:

1. In the conversion session's prompt, tell Claude: "When all stages are created and the ticket frontmatter is updated, call the `conversion_complete` tool with no arguments to signal you are done."

2. In `session.ts`, the ProtocolPeer receives `control_request` messages for tool approval. Add handling: when the tool name is `conversion_complete`, don't route it for approval — instead emit a custom event or call a callback that the loop's conversion handler can listen for.

3. In `loop.ts`, when the conversion handler detects the `conversion_complete` signal:
   - Run `kanban-cli sync --repo <path>`
   - Update ticket status to "Converted" in frontmatter
   - Close stdin to terminate the session
   - `registry.end(ticketId)` to broadcast session-ended

### Step 1: Add tool interception in ProtocolPeer or ApprovalService

In the approval service (`approval-service.ts`), when a `can_use_tool` request comes in with tool name `conversion_complete` or `transition_stage`:
- Don't create a PendingApproval
- Instead, emit a new event: `'session-transition'` with `{ stageId, toolName, toolInput }`
- Respond to Claude with `{ behavior: 'deny', message: 'Handled by orchestrator' }` to prevent the tool from actually executing (since it's just a signal)

### Step 2: Handle the signal in loop.ts conversion handler

Wire a listener for `'session-transition'` events on the approval service. When received for a conversion session:
- Run sync
- Update ticket frontmatter: set `status: Converted`
- Close the session (stdin.end or kill the process)
- Call `registry.end(ticketId)`

### Step 3: Update the conversion prompt

Replace the hardcoded custom prompt in `loop.ts` with one that:
- Instructs Claude to invoke the `convert-ticket` skill
- Tells Claude to call `conversion_complete` when done (instead of running sync)
- Passes the ticket file path, epic ID, and repo path

### Step 4: Remove the `autoCloseOnEndTurn` approach

Since we now have explicit signaling, remove the `autoCloseOnEndTurn` logic from `session.ts` and `loop.ts`.

### Step 5: Build and commit

```bash
cd tools/orchestrator && npm run build
git add tools/orchestrator/
git commit -m "feat(orchestrator): add conversion_complete tool signal for session completion"
```

---

## Task 2: Add generic `transition_stage` tool handling

**Files:**
- Modify: `tools/orchestrator/src/loop.ts`
- Modify: `tools/orchestrator/src/approval-service.ts`

### What to do

For pipeline stage sessions (Design, Build, etc.), Claude calls `transition_stage` with a `target` parameter. The orchestrator validates the transition against the pipeline config.

### Step 1: Validate transition in the signal handler

When `'session-transition'` fires with `toolName === 'transition_stage'`:
1. Read the current stage's status from frontmatter
2. Look up the current phase in the pipeline config
3. Check if `toolInput.target` is in the phase's `transitions_to` array
4. If valid: update stage frontmatter with the new status, run exit gates, sync, close session
5. If invalid: log a warning and send an error response to Claude (don't close the session — let Claude try again)

### Step 2: Pass valid transitions in the session prompt

When the orchestrator spawns a stage session, include the valid transitions in the prompt:
```
You are working on stage STAGE-XXX-YYY-ZZZ which is currently in the "Design" phase.

When you are ready to transition, call the transition_stage tool with one of these targets:
- "Build" — proceed to implementation
- "User Design Feedback" — request user design review

Do NOT modify the stage's status field in the frontmatter directly.
```

This info comes from reading `pipelineConfig.workflow.phases` to find the current phase and its `transitions_to`.

### Step 3: Build and commit

```bash
cd tools/orchestrator && npm run build
git add tools/orchestrator/
git commit -m "feat(orchestrator): add generic transition_stage tool for pipeline phase transitions"
```

---

## Task 3: Wire conversion prompt to use convert-ticket skill

**Files:**
- Modify: `tools/orchestrator/src/loop.ts`

### What to do

Replace the hardcoded conversion prompt with one that references the `convert-ticket` skill:

```
You are converting ticket TICKET-XXX-YYY into implementable stages.

Ticket file: /path/to/TICKET-XXX-YYY.md
Epic: EPIC-XXX
Repository: /path/to/repo

Invoke the `convert-ticket` skill to guide your workflow.

IMPORTANT: Do NOT run kanban-cli sync or validate commands. When you have
finished creating all stage files and updating the ticket frontmatter,
call the `conversion_complete` tool to signal you are done. The system
will handle syncing automatically.

After conversion_complete, the system will:
- Sync the database
- Set the ticket status to "Converted"
- Compute stage readiness (stages with no dependencies → ready_for_work, stages with dependencies → backlog)
```

### Step 1: Update the prompt

### Step 2: Build and commit

```bash
cd tools/orchestrator && npm run build
git add tools/orchestrator/
git commit -m "feat(orchestrator): use convert-ticket skill in conversion prompt"
```

---

## Task 4: Handle post-conversion ticket and stage status

**Files:**
- Modify: `tools/orchestrator/src/loop.ts`

### What to do

After `conversion_complete` fires and sync runs:

1. Read the ticket's frontmatter
2. Set `status: Converted` (write to file)
3. The stages were already created with `status: Not Started` by Claude
4. Run sync again to recompute kanban columns (stages with no deps → `ready_for_work`, stages with deps → `backlog`)
5. Broadcast `board-update` event

The kanban column computation happens during sync (`kanban-columns.ts`), so we just need to ensure the ticket status is set correctly and sync runs.

### Step 1: Implement post-conversion status update

### Step 2: Build and commit

```bash
cd tools/orchestrator && npm run build
git add tools/orchestrator/
git commit -m "feat(orchestrator): set ticket to Converted and recompute stage columns after conversion"
```

---

## Task 5: Update web-server for "Converted" ticket status

**Files:**
- Modify: `tools/web-server/src/client/components/detail/TicketDetailContent.tsx`

### What to do

The ticket detail UI currently checks `status === 'to_convert'` to show the Convert button. After conversion, the status becomes "Converted". The UI should:
- Not show the Convert button for "Converted" tickets
- Show the stages list normally
- The "Converted" status should appear in the ticket header

This should already work since any status that isn't `to_convert` hides the Convert button and shows stages. Just verify no special handling is needed.

### Step 1: Verify and adjust if needed

### Step 2: Commit if changes were needed

---

## Task 6: Verify everything

```bash
cd tools/web-server && npm run verify
cd tools/orchestrator && npm run build && npm test
```

---

## Task 7: Reseed and restart

1. Kill all processes
2. Delete DB and test repo
3. Run seed script
4. Set TICKET-002-003 to `to_convert` and sync
5. Start web server
6. Start orchestrator (real mode, CLAUDECODE unset, --idle-seconds 9999)
