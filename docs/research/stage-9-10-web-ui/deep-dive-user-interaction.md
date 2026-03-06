# Deep Dive: User Interaction with Claude Code Sessions from a Web Browser

## Executive Summary

Of the three repositories examined, only **vibe-kanban** implements full bidirectional interaction with Claude Code sessions from a web browser. It does so by wrapping Claude Code's **stdin/stdout stream-JSON protocol** -- not through any official API or SDK. The key insight is that Claude Code's `--input-format=stream-json --output-format=stream-json` flags expose a JSON-line protocol over stdin/stdout that vibe-kanban's Rust backend uses to send user messages, handle tool approvals, answer questions, and control permissions.

**claude-code-monitor** and **claude-devtools** are entirely read-only -- they observe Claude Code sessions through hook scripts and JSONL transcript files but cannot send any input back.

---

## 1. How Vibe-Kanban Enables Bidirectional Web-to-Claude Interaction

### 1.1 Architecture Overview

```
Browser (React)
    |
    | HTTP POST /api/sessions/{id}/follow-up
    | HTTP POST /api/approvals/{id}/respond
    | WebSocket /api/approvals/stream/ws
    |
    v
Axum Server (Rust)
    |
    | Spawns claude process with --input-format=stream-json --output-format=stream-json
    |
    v
ProtocolPeer (Rust) <--> Claude Code CLI (stdin/stdout)
    |                        |
    | send_user_message()    | CLIMessage::ControlRequest (CanUseTool, HookCallback)
    | send_hook_response()   | CLIMessage::Result
    | initialize()           |
    | interrupt()            |
    | set_permission_mode()  |
```

### 1.2 Spawning Claude Code with Bidirectional Protocol

**File:** `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude.rs` (lines 171-177)

The key flags that enable bidirectional communication:

```rust
builder = builder.extend_params([
    "--verbose",
    "--output-format=stream-json",      // Claude outputs JSON lines to stdout
    "--input-format=stream-json",        // Claude reads JSON lines from stdin
    "--include-partial-messages",
    "--replay-user-messages",
]);
```

Additionally, for permission/approval support (line 154):
```rust
builder = builder.extend_params(["--permission-prompt-tool=stdio"]);
```

The process is spawned with piped stdin/stdout (lines 589-616):
```rust
let mut command = Command::new(program_path);
command
    .kill_on_drop(true)
    .stdin(Stdio::piped())       // <-- We control stdin
    .stdout(Stdio::piped())      // <-- We read stdout
    .stderr(Stdio::piped())
    .current_dir(current_dir)
    .args(&args);
```

### 1.3 The Protocol Peer: Bidirectional JSON-Line Communication

**File:** `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/protocol.rs`

The `ProtocolPeer` is the heart of bidirectional communication. It wraps Claude Code's stdin and reads from stdout in a loop.

#### Sending Messages TO Claude Code (stdin)

All messages are sent as JSON lines through Claude's stdin:

```rust
// protocol.rs line 189-196
async fn send_json<T: serde::Serialize>(&self, message: &T) -> Result<(), ExecutorError> {
    let json = serde_json::to_string(message)?;
    let mut stdin = self.stdin.lock().await;
    stdin.write_all(json.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}
```

Methods available for sending to Claude:

| Method | Purpose | JSON Format |
|--------|---------|-------------|
| `send_user_message()` | Send follow-up user message | `{"type": "user", "message": {"role": "user", "content": "..."}}` |
| `initialize()` | Initialize SDK control protocol with hooks | `{"type": "control_request", "request_id": "...", "request": {"subtype": "initialize", "hooks": ...}}` |
| `interrupt()` | Interrupt current processing | `{"type": "control_request", "request_id": "...", "request": {"subtype": "interrupt"}}` |
| `set_permission_mode()` | Change permission mode | `{"type": "control_request", "request_id": "...", "request": {"subtype": "set_permission_mode", "mode": "..."}}` |
| `send_hook_response()` | Respond to hook/approval requests | `{"type": "control_response", "response": {"subtype": "success", "request_id": "...", "response": ...}}` |

#### Reading Messages FROM Claude Code (stdout)

The read loop (line 49-105) parses incoming JSON messages:

```rust
match serde_json::from_str::<CLIMessage>(line) {
    Ok(CLIMessage::ControlRequest { request_id, request }) => {
        self.handle_control_request(&client, request_id, request).await;
    }
    Ok(CLIMessage::Result(_)) => {
        break; // Session ended
    }
    _ => {} // Other messages logged
}
```

### 1.4 Message Types: The stream-JSON Protocol

**File:** `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/types.rs`

#### Messages from Claude Code to Backend (stdout):

```rust
// types.rs lines 9-25
enum CLIMessage {
    ControlRequest {              // Claude requesting permission/hook
        request_id: String,
        request: ControlRequestType,
    },
    ControlResponse {             // Response acknowledgment
        response: ControlResponseType,
    },
    ControlCancelRequest {        // Claude cancelling a request
        request_id: String,
    },
    Result(serde_json::Value),    // Final result (session complete)
    Other(serde_json::Value),     // Regular log entries
}
```

#### Control Request Types (Claude asking the backend):

```rust
// types.rs lines 67-85
enum ControlRequestType {
    CanUseTool {                  // "May I use this tool?"
        tool_name: String,
        input: Value,
        permission_suggestions: Option<Vec<PermissionUpdate>>,
        blocked_paths: Option<String>,
        tool_use_id: Option<String>,
    },
    HookCallback {                // Hook event callback
        callback_id: String,
        input: Value,
        tool_use_id: Option<String>,
    },
}
```

#### SDK Control Request Types (Backend commanding Claude):

```rust
// types.rs lines 191-202
enum SDKControlRequestType {
    SetPermissionMode { mode: PermissionMode },
    Initialize { hooks: Option<Value> },
    Interrupt {},
}
```

#### User Message Type:

```rust
// types.rs lines 168-189
enum Message {
    User { message: ClaudeUserMessage },
}
struct ClaudeUserMessage {
    role: String,    // Always "user"
    content: String, // The message text
}
```

### 1.5 How Follow-Up Messages Flow from Browser to Claude

The complete flow for a user typing a message in the web browser:

**Step 1: Frontend sends HTTP POST**

File: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/features/workspace-chat/model/hooks/useSessionSend.ts` (lines 87-94)

```typescript
await sessionsApi.followUp(sessionId, {
    prompt: trimmed,
    executor_config: executorConfig,
    retry_process_id: null,
    force_when_dirty: null,
    perform_git_reset: null,
});
```

This calls: `POST /api/sessions/{sessionId}/follow-up`

**Step 2: Backend creates a new execution process**

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/sessions/mod.rs` (lines 102-212)

The `follow_up` handler:
1. Validates the workspace and session exist
2. Constructs a `CodingAgentFollowUpRequest` with prompt and session_id
3. Calls `deployment.container().start_execution(...)` to spawn the process

**Step 3: Claude Code is spawned with --resume**

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude.rs` (lines 331-353)

```rust
async fn spawn_follow_up(&self, ..., session_id: &str, ...) -> ... {
    let mut args = vec!["--resume".to_string(), session_id.to_string()];
    if let Some(uuid) = reset_to_message_id {
        args.push("--resume-session-at".to_string());
        args.push(uuid.to_string());
    }
    let command_parts = command_builder.build_follow_up(&args)?;
    self.spawn_internal(current_dir, prompt, command_parts, env).await
}
```

**Step 4: Protocol peer sends user message**

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude.rs` (lines 631-663)

```rust
tokio::spawn(async move {
    let protocol_peer = ProtocolPeer::spawn(child_stdin, child_stdout, client.clone(), cancel);
    protocol_peer.initialize(hooks).await?;
    protocol_peer.set_permission_mode(permission_mode).await?;
    protocol_peer.send_user_message(prompt_clone).await?;
});
```

### 1.6 How Tool Approvals Flow from Browser to Claude

**Step 1: Claude sends CanUseTool control request via stdout**

The read loop in `ProtocolPeer` receives a `CanUseTool` message.

**Step 2: Backend creates an approval request and streams it to browser**

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/client.rs` (lines 60-143)

```rust
async fn handle_approval(&self, tool_use_id: String, tool_name: String, ...) -> ... {
    let approval_id = approval_service.create_tool_approval(&tool_name).await?;
    // Log approval request for streaming to frontend
    self.log_writer.log_raw(&serde_json::to_string(&ClaudeJson::ApprovalRequested { ... })?).await;
    // Block waiting for user response
    let status = approval_service.wait_tool_approval(&approval_id, self.cancel.clone()).await?;
    // Return result to protocol peer
    match status {
        ApprovalStatus::Approved => Ok(PermissionResult::Allow { ... }),
        ApprovalStatus::Denied { reason } => Ok(PermissionResult::Deny { ... }),
    }
}
```

**Step 3: Frontend polls approvals via WebSocket**

File: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/shared/hooks/useApprovals.ts`

```typescript
const { data, isConnected } = useJsonPatchWsStream<ApprovalState>(
    '/api/approvals/stream/ws', true, () => ({ pending: {} })
);
```

**Step 4: User approves/denies in browser, sends HTTP POST**

File: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/shared/lib/api.ts` (lines 1043-1057)

```typescript
export const approvalsApi = {
    respond: async (approvalId: string, payload: ApprovalResponse, signal?: AbortSignal) => {
        const res = await makeRequest(`/api/approvals/${approvalId}/respond`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return handleApiResponse<ApprovalStatus>(res);
    },
};
```

**Step 5: Backend sends approval result to Claude via stdin**

The `wait_tool_approval()` resolves, and the protocol peer sends the response via `send_hook_response()`.

### 1.7 How AskUserQuestion Prompts Are Answered

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/client.rs` (lines 145-231)

When Claude uses the `AskUserQuestion` tool, the same hook mechanism catches it:

```rust
async fn handle_question(&self, tool_use_id: String, ...) -> ... {
    let approval_id = approval_service.create_question_approval(&tool_name, question_count).await?;
    let status = approval_service.wait_question_answer(&approval_id, ...).await?;
    match status {
        QuestionStatus::Answered { answers } => {
            // Inject answers into tool_input and return Allow
            let answers_map = answers.iter().map(|qa| (qa.question.clone(), qa.answer.join(", "))).collect();
            updated.as_object_mut().insert("answers", answers_map);
            Ok(PermissionResult::Allow { updated_input: updated, ... })
        }
    }
}
```

### 1.8 Message Queuing for Non-Blocking Interaction

When a user sends a follow-up while Claude is still processing, the message is queued:

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/sessions/queue.rs`

```rust
pub async fn queue_message(...) -> ... {
    let queued = deployment.queued_message_service().queue_message(session.id, data);
    Ok(ResponseJson(ApiResponse::success(QueueStatus::Queued { message: queued })))
}
```

When the current execution finishes, the queue is consumed:

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/local-deployment/src/container.rs` (lines 549-580)

```rust
if let Some(queued_msg) = container.queued_message_service.take_queued(ctx.session.id) {
    if should_execute_queued {
        container.start_queued_follow_up(&ctx, &queued_msg.data).await?;
    }
}
```

### 1.9 Terminal WebSocket: A Real PTY

Vibe-kanban also provides a real PTY-based terminal for each workspace, entirely separate from the Claude session.

File: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/terminal.rs`

```rust
// The terminal WebSocket accepts input and resize commands
enum TerminalCommand {
    Input { data: String },     // Base64-encoded input
    Resize { cols: u16, rows: u16 },
}
```

The browser connects via `ws://.../api/terminal/ws?workspace_id=...` and uses xterm.js to render a full terminal. This is for general shell access, NOT for interacting with the Claude session directly. Users can use it to run git commands, inspect files, etc.

### 1.10 PR Workflow Actions

Push, rebase, create PR, etc. are server-side operations (not Claude interactions). They are executed directly by the server:

- `POST /api/task-attempts/{id}/push` -- server runs `git push`
- `POST /api/task-attempts/{id}/rebase` -- server runs `git rebase`
- `POST /api/task-attempts/{id}/pr` -- server runs `gh pr create`

These bypass Claude entirely and execute directly on the workspace filesystem.

---

## 2. Claude-Code-Monitor: Read-Only Architecture

### 2.1 Data Flow

```
Claude Code Session
    |
    | Hook scripts fire on events (PreToolUse, PostToolUse, Stop, etc.)
    |
    v
session-monitor.sh (shell script)
    |
    | curl POST to secondary server (fire-and-forget)
    |
    v
Secondary Server (Express, local per-machine)
    |
    | Stores in SQLite, pushes metadata via WebSocket
    |
    v
Primary Server (Express, central)
    |
    | Broadcasts to dashboard clients via WebSocket
    |
    v
Dashboard (React, read-only)
```

### 2.2 The Hook Script: One-Way Fire-and-Forget

File: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/cli/templates/session-monitor.sh`

```bash
#!/bin/bash
event=$(cat)
transformed=$(echo "$event" | jq -c '{
  type: .hook_event_name,
  sessionId: .session_id,
  timestamp: ...,
  uuid: .uuid,
  data: .
}')
curl -X POST "{{SECONDARY_URL}}/api/events" \
  -H "Content-Type: application/json" \
  -d "$transformed" \
  --max-time 2 --silent --show-error >/dev/null 2>&1 &
exit 0
```

The `exit 0` at the end is critical -- the script always succeeds immediately. It is fire-and-forget. There is no mechanism to send data back to Claude Code through this hook.

### 2.3 Dashboard WebSocket: Server-to-Client Only

File: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/dashboard-hub.ts`

The dashboard WebSocket only sends data from server to client:
- `init` - Initial session list
- `session_update` - Session metadata changed
- `session_removed` - Session ended

```typescript
// dashboard-hub.ts line 37-39
ws.on('close', () => { ... });  // Only handles disconnect
ws.on('error', (error) => { ... });  // Only handles errors
// NO ws.on('message') handler -- no inbound messages processed
```

### 2.4 No Bidirectional Support

There is no code or planned support for sending input back to sessions. The monitor observes but cannot interact. The WebSocket protocol has no inbound message types from dashboard to session.

---

## 3. Claude-Devtools: Read-Only Architecture

### 3.1 Session Data Source

Claude-devtools reads session data from `~/.claude/projects/` JSONL transcript files. It uses a file watcher (fsProvider) to detect changes, either locally or via SSH.

### 3.2 SSH: File Access Only, Not Command Execution

File: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/SshConnectionManager.ts`

The SSH connection is used exclusively for SFTP file access:

```typescript
// line 157-158
const sftpChannel = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, channel) => { ... });
});
this.provider = new SshFileSystemProvider(sftpChannel);
```

While `SshConnectionManager` has an `execRemoteCommand()` method (line 482-515), it is only used for resolving the remote home directory path:

```typescript
private async resolveRemoteHomeDirectory(): Promise<string | null> {
    const home = await this.execRemoteCommand('printf %s "$HOME"');
    return home.trim().startsWith('/') ? home.trim() : null;
}
```

There is no `shell:execute` IPC channel, no mechanism to write to session input, and no command execution beyond the one home directory resolution.

### 3.3 IPC Channels: All Read/Config Operations

File: `/home/jakekausler/dev/localenv/claude-devtools/src/preload/constants/ipcChannels.ts`

All IPC channels are for:
- Configuration management (config:get, config:update, etc.)
- SSH connection lifecycle (ssh:connect, ssh:disconnect, ssh:test)
- Window management (window:minimize, window:close)
- Context switching (context:list, context:switch)

There are no channels for sending input to Claude sessions.

---

## 4. Claude Code's Own Input/Interaction Mechanisms

### 4.1 The stream-JSON Protocol (Primary Mechanism)

Claude Code exposes a bidirectional protocol when run with:
```
claude -p --input-format=stream-json --output-format=stream-json
```

This is the mechanism vibe-kanban uses. The protocol operates over stdin/stdout with JSON-line messages.

**Sending user messages (stdin):**
```json
{"type": "user", "message": {"role": "user", "content": "Your message here"}}
```

**Receiving control requests (stdout):**
```json
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {...}, "tool_use_id": "uuid"}}
```

**Sending control responses (stdin):**
```json
{"type": "control_response", "response": {"subtype": "success", "request_id": "uuid", "response": {"behavior": "allow", "updatedInput": {...}}}}
```

**Sending SDK control requests (stdin):**
```json
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "initialize", "hooks": {...}}}
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "interrupt"}}
{"type": "control_request", "request_id": "uuid", "request": {"subtype": "set_permission_mode", "mode": "bypassPermissions"}}
```

### 4.2 The --resume Flag

Claude Code supports resuming sessions with `--resume <session-id>`, which picks up where a previous session left off. Combined with `--resume-session-at <message-id>`, you can even truncate the conversation history and restart from a specific point.

### 4.3 The --permission-prompt-tool=stdio Flag

This flag tells Claude Code to route permission decisions through the stdin/stdout protocol rather than using its built-in TUI prompt. This is what enables programmatic tool approval/denial.

### 4.4 Hooks: Output Only, Input Limited

File: `/home/jakekausler/.claude/settings.json` (lines 27-58)

Claude Code hooks receive event data on stdin and can return JSON on stdout, but they have very limited ability to influence the session:

- **UserPromptSubmit hooks** can add context but cannot modify the prompt text itself
- **Notification hooks** are fire-and-forget (no return value used)
- **PreToolUse hooks** can approve/deny tool calls but this requires `--permission-prompt-tool=stdio` mode

The hook system is NOT bidirectional in the general sense -- hooks are invoked by Claude Code and respond synchronously. They cannot initiate communication to Claude Code.

### 4.5 No Official API or SDK for Session Management

There is no HTTP API, REST endpoint, or official SDK for managing running Claude Code sessions. The references in vibe-kanban's code to `claude-code-api-rs` (types.rs line 4: `Similar to: https://github.com/ZhangHanDong/claude-code-api-rs`) are community projects that implement the same stdin/stdout protocol.

### 4.6 Session Environment Files

Claude stores session environment data in `~/.claude/session-env/{session-id}/` directories, but these are read-only artifacts and cannot be used to inject input.

---

## 5. Answers to Specific Questions

### Q1: Can you send a message to a running Claude Code session programmatically?

**Yes, but only through the stdin/stdout protocol.** You must:
1. Spawn Claude Code with `--input-format=stream-json --output-format=stream-json -p`
2. Hold a reference to its stdin pipe
3. Write JSON-line messages to stdin

You CANNOT send messages to an already-running Claude Code session you didn't spawn. There is no socket, pipe, or API to connect to an existing session.

For follow-up messages to an existing session's conversation, you spawn a NEW Claude Code process with `--resume <session-id>` and send the message to that new process's stdin.

### Q2: Can you approve/deny tool calls programmatically?

**Yes**, using the `--permission-prompt-tool=stdio` flag. Claude sends `CanUseTool` control requests on stdout, and you respond with Allow/Deny on stdin.

Vibe-kanban implements this in `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/client.rs` (lines 60-143).

### Q3: Can you answer AskUserQuestion prompts programmatically?

**Yes.** `AskUserQuestion` tool calls are routed through the same hook/permission system. When Claude tries to use `AskUserQuestion`, it triggers a `CanUseTool` or `HookCallback` control request, and you respond with answers injected into the tool input.

Vibe-kanban implements this in `client.rs` (lines 145-231).

### Q4: What does vibe-kanban do -- stdin/stdout wrapping or different mechanism?

**stdin/stdout wrapping.** Vibe-kanban spawns Claude Code as a child process with:
- `stdin(Stdio::piped())` -- backend writes to Claude's stdin
- `stdout(Stdio::piped())` -- backend reads from Claude's stdout
- `stderr(Stdio::piped())` -- backend reads error output

The `ProtocolPeer` struct manages the bidirectional JSON-line protocol over these pipes. Every message flows through `send_json()` which writes to the locked stdin mutex, and the `read_loop()` which reads lines from stdout.

### Q5: Is there a Claude Code API or SDK for session management?

**No official one.** The stream-JSON protocol over stdin/stdout is the only supported programmatic interface. Vibe-kanban reverse-engineers this protocol through their Rust types in `types.rs`. The protocol is documented implicitly through Claude Code's `--help` flags and behavior.

The community project [claude-code-api-rs](https://github.com/ZhangHanDong/claude-code-api-rs) provides a Rust SDK wrapper, but it's unofficial.

### Q6: What would a bidirectional interaction architecture look like?

Based on vibe-kanban's proven architecture, a bidirectional web-based interaction system needs:

```
                    Browser (React)
                        |
                        | HTTP/WebSocket
                        |
                    Web Server (Backend)
                        |
            +-----------+-----------+
            |                       |
    Session Manager          Process Manager
    (track sessions)         (spawn/manage processes)
            |                       |
            +-------+-------+      |
                    |              |
            Approval Service       |
            (queue approvals)      |
                    |              |
                    v              v
            Protocol Peer <--> Claude Code CLI
                              (stdin/stdout pipes)
```

Required components:
1. **Process Manager**: Spawns Claude Code with `--input-format=stream-json --output-format=stream-json -p --permission-prompt-tool=stdio`
2. **Protocol Peer**: Manages bidirectional JSON-line communication over stdin/stdout
3. **Approval Service**: Queues tool approvals and question answers from web clients
4. **Message Queue**: Buffers follow-up messages when Claude is busy
5. **Session State Tracker**: Maps session IDs to running processes
6. **WebSocket Hub**: Streams log output and approval requests to browser clients

Key limitations:
- You cannot attach to an existing Claude Code session -- you must control it from spawn
- Each interaction requires a new Claude Code process (using `--resume` to maintain conversation context)
- The protocol is undocumented and may change between Claude Code versions

---

## 6. Summary Table

| Feature | vibe-kanban | claude-code-monitor | claude-devtools |
|---------|-------------|---------------------|-----------------|
| Send messages to Claude | Yes (stdin protocol) | No | No |
| Approve/deny tool calls | Yes (approval service) | No | No |
| Answer AskUserQuestion | Yes (question handler) | No | No |
| View session output | Yes (log streaming) | Yes (hooks + WebSocket) | Yes (transcript files) |
| Real terminal access | Yes (PTY WebSocket) | No | No |
| Resume sessions | Yes (--resume flag) | N/A | N/A |
| Git operations | Yes (server-side) | No | No |
| Remote/SSH support | N/A | N/A | Yes (SFTP read-only) |
| Architecture | Process wrapper | Hook observer | File watcher |
| Communication | stdin/stdout JSON | HTTP POST (one-way) | Filesystem reads |

---

## 7. Key File References

### Vibe-Kanban (Bidirectional)
- **API Client**: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/shared/lib/api.ts` -- `sessionsApi.followUp()` (line 270), `approvalsApi.respond()` (line 1043), `queueApi.queue()` (line 1334)
- **Protocol Peer**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/protocol.rs` -- Full bidirectional protocol implementation
- **Claude Client**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/client.rs` -- Tool approval + question handling
- **Protocol Types**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude/types.rs` -- All message type definitions
- **Claude Executor**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/executors/claude.rs` -- Process spawning with flags (line 171), spawn_internal (line 579)
- **Session Routes**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/sessions/mod.rs` -- HTTP follow-up handler (line 102)
- **Approval Routes**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/approvals.rs` -- HTTP approval response handler (line 18)
- **Terminal Routes**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/routes/terminal.rs` -- PTY WebSocket handler
- **Queue Service**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/services/src/services/queued_message.rs` -- Follow-up message queuing
- **Follow-Up Action**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/executors/src/actions/coding_agent_follow_up.rs` -- Follow-up execution logic
- **Frontend Send Hook**: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/features/workspace-chat/model/hooks/useSessionSend.ts` -- Browser-side message sending
- **Frontend Approvals Hook**: `/home/jakekausler/dev/localenv/vibe-kanban/packages/web-core/src/shared/hooks/useApprovals.ts` -- Browser-side approval streaming

### Claude-Code-Monitor (Read-Only)
- **Hook Receiver**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/hook-receiver.ts` -- Receives events from hook scripts
- **Hook Template**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/cli/templates/session-monitor.sh` -- Fire-and-forget curl POST
- **Dashboard Hub**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/dashboard-hub.ts` -- Server-to-client only WebSocket
- **Dashboard WebSocket Hook**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/dashboard/src/hooks/useWebSocket.ts` -- Client receives init/update/removed messages only

### Claude-Devtools (Read-Only)
- **SSH Manager**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/SshConnectionManager.ts` -- SFTP file access only
- **IPC Channels**: `/home/jakekausler/dev/localenv/claude-devtools/src/preload/constants/ipcChannels.ts` -- All read/config channels, no session input
- **SSH IPC**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/ipc/ssh.ts` -- Connection lifecycle only

### Claude Code Configuration
- **Settings**: `/home/jakekausler/.claude/settings.json` -- Hook configuration, permissions
- **Hooks**: UserPromptSubmit, Notification hooks (output-only except for UserPromptSubmit's additionalContext)
