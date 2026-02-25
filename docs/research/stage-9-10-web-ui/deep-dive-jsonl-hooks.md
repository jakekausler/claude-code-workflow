# Claude Code JSONL Session Format & Hook System: Definitive Reference

## Table of Contents

1. [File System Layout](#1-file-system-layout)
2. [JSONL Session Format](#2-jsonl-session-format)
3. [Entry Types](#3-entry-types)
4. [Content Block Types](#4-content-block-types)
5. [Tool Use / Tool Result Linking](#5-tool-use--tool-result-linking)
6. [Subagent File Storage](#6-subagent-file-storage)
7. [Compaction / Summary](#7-compaction--summary)
8. [Claude Code Hook System](#8-claude-code-hook-system)
9. [claude-code-monitor Architecture](#9-claude-code-monitor-architecture)
10. [claude-devtools JSONL Parsing](#10-claude-devtools-jsonl-parsing)
11. [Complete Type Definitions](#11-complete-type-definitions)

---

## 1. File System Layout

### Base Directory

```
~/.claude/
├── settings.json              # Global settings including hook configuration
├── projects/                  # All session data, organized by project
│   ├── {encoded-project-path}/
│   │   ├── {session-uuid}.jsonl           # Main agent session file
│   │   ├── {session-uuid}/                # Session subdirectory (new structure)
│   │   │   ├── subagents/
│   │   │   │   ├── agent-{agent-id}.jsonl # Subagent session files
│   │   │   │   └── ...
│   │   │   └── tool-results/              # Large tool result storage
│   │   │       ├── {hash}.txt
│   │   │       └── toolu_{id}.txt
│   │   └── agent-{agent-id}.jsonl         # Subagent files (legacy structure)
├── todos/
│   └── {session-uuid}.json                # Task list data per session
└── session-monitor/                       # claude-code-monitor data directory
    └── sessions.db                        # SQLite database
```

### Project Path Encoding

Project directories are encoded from absolute paths by replacing all path separators (`/` and `\`) with dashes:

- Path: `/home/jakekausler/dev/localenv/claude-code-workflow`
- Encoded: `-home-jakekausler-dev-localenv-claude-code-workflow`

**Important**: This encoding is LOSSY for paths containing dashes. The actual `cwd` field in session entries provides the accurate path.

Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/utils/pathDecoder.ts`

---

## 2. JSONL Session Format

Each `.jsonl` file contains one JSON object per line. Lines are appended chronologically as the session progresses. The file is append-only, making it suitable for incremental/streaming reads.

### Common Envelope Fields

Every entry in the JSONL file has at minimum:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Entry type discriminator |
| `timestamp` | string (ISO 8601) | When the entry was created |
| `uuid` | string | Unique identifier for this entry |

### Conversational Entry Fields

Entries of type `user`, `assistant`, and `system` share additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `parentUuid` | string \| null | UUID of the parent message (for threading) |
| `isSidechain` | boolean | `false` = main agent, `true` = subagent |
| `userType` | string | Always `"external"` |
| `cwd` | string | Working directory when message was created |
| `sessionId` | string | Session UUID (for subagents, points to PARENT session) |
| `version` | string | Claude Code version (e.g., `"2.1.56"`) |
| `gitBranch` | string | Git branch name |
| `slug` | string? | Human-readable session slug (e.g., `"serene-bubbling-muffin"`) |
| `agentId` | string? | Agent ID (present on subagent entries) |

---

## 3. Entry Types

### 3.1 `type: "user"` — User Input / Tool Results

User entries serve **two distinct purposes**:

#### A. Real User Input (starts new conversation chunks)

```json
{
  "parentUuid": "0af44589-...",
  "isSidechain": false,
  "userType": "external",
  "cwd": "/home/jakekausler/dev/localenv/claude-code-workflow",
  "sessionId": "783f2ec5-...",
  "version": "2.1.56",
  "gitBranch": "feat/stage-9-web-view",
  "type": "user",
  "message": {
    "role": "user",
    "content": "Read @docs/plans/... We are about to start stage 9..."
  },
  "uuid": "7e0f8210-...",
  "timestamp": "2026-02-25T13:44:09.120Z",
  "todos": [],
  "permissionMode": "bypassPermissions"
}
```

Key characteristics:
- `isMeta`: absent or `false`
- `message.content`: **string** (the actual user text)
- May include `todos` array and `permissionMode`

#### B. Internal Tool Result Messages (part of response flow)

```json
{
  "parentUuid": "a2b1da72-...",
  "isSidechain": false,
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_bdrk_019GTkLVnA1nQroFfgbCVG18",
        "type": "tool_result",
        "content": "",
        "is_error": false
      }
    ]
  },
  "isMeta": true,
  "sourceToolAssistantUUID": "a2b1da72-543d-448f-92f7-8c6090...",
  "toolUseResult": {
    "stdout": "",
    "stderr": "",
    "interrupted": false,
    "isImage": false,
    "noOutputExpected": true
  },
  "uuid": "...",
  "timestamp": "..."
}
```

Key characteristics:
- `isMeta`: **not always set**; may be absent even for tool results
- `message.content`: **array** containing `tool_result` blocks
- `sourceToolAssistantUUID`: links back to the assistant message that made the tool call
- `sourceToolUseID`: sometimes present, links to the specific tool_use ID
- `toolUseResult`: enriched structured result data (varies by tool type)

#### C. Special User Message Subtypes

**Command output** (system response to slash commands):
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "<local-command-stdout>Set model to sonnet...</local-command-stdout>"
  }
}
```

**Slash command invocation**:
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"
  }
}
```

**System caveats** (injected metadata):
```json
{
  "type": "user",
  "isMeta": true,
  "message": {
    "role": "user",
    "content": "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands...</local-command-caveat>"
  }
}
```

**System reminders** (context injected by plugins/hooks):
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "<system-reminder>... context ...</system-reminder>"
  }
}
```

**User interruptions**:
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "[Request interrupted by user]"
      }
    ]
  }
}
```

### 3.2 `type: "assistant"` — AI Responses

```json
{
  "parentUuid": "7e0f8210-...",
  "isSidechain": false,
  "cwd": "/home/jakekausler/dev/localenv/claude-code-workflow",
  "sessionId": "783f2ec5-...",
  "version": "2.1.56",
  "gitBranch": "feat/stage-9-web-view",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_bdrk_01B9jdsXErm3CD5ExDsBbuqs",
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "I'll launch three parallel research agents..." },
      {
        "type": "tool_use",
        "id": "toolu_bdrk_0132x5bdfMXYCfLJXye2gLkY",
        "name": "Task",
        "input": {
          "description": "Deep research: vibe-kanban repo",
          "subagent_type": "Explore",
          "prompt": "...",
          "run_in_background": true
        }
      }
    ],
    "stop_reason": "tool_use",
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 66366,
      "cache_read_input_tokens": 0,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 66366,
        "ephemeral_1h_input_tokens": 0
      },
      "output_tokens": 551,
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
      "service_tier": "standard"
    }
  },
  "type": "assistant",
  "uuid": "4d568a82-...",
  "timestamp": "2026-02-25T13:44:26.858Z"
}
```

Key fields:
- `message.model`: Model identifier (e.g., `"claude-opus-4-6"`, `"claude-haiku-4-5-20251001"`, `"<synthetic>"` for system-generated)
- `message.id`: API message ID (prefixed with `msg_bdrk_` for Bedrock)
- `message.content`: Array of content blocks (text, thinking, tool_use)
- `message.stop_reason`: `"end_turn"` | `"tool_use"` | `"max_tokens"` | `"stop_sequence"` | `null`
- `message.usage`: Token usage metadata

**IMPORTANT**: Assistant messages may be **streamed as multiple entries** with the same `message.id`. Each entry represents a partial update with new content blocks appended. The `stop_reason` is `null` for intermediate entries and set on the final entry.

### 3.3 `type: "system"` — System Metadata

```json
{
  "parentUuid": "388304a5-...",
  "isSidechain": false,
  "cwd": "/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli",
  "sessionId": "7a8eaa0a-...",
  "version": "2.1.50",
  "gitBranch": "kanban",
  "slug": "serene-bubbling-muffin",
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 7631574,
  "timestamp": "2026-02-23T18:50:16.722Z",
  "uuid": "4d50975c-...",
  "isMeta": false
}
```

Known subtypes:
- `"turn_duration"`: Records the duration of a conversation turn in milliseconds
- `"init"`: Session initialization metadata

### 3.4 `type: "summary"` — Compaction Summaries

```json
{
  "type": "summary",
  "summary": "The conversation covered implementing Stage 6A...",
  "leafUuid": "abc123-...",
  "timestamp": "...",
  "uuid": "..."
}
```

Appears when Claude Code compacts the conversation to free context window space. The `leafUuid` references the last message UUID before compaction.

### 3.5 `type: "file-history-snapshot"` — File Tracking

```json
{
  "type": "file-history-snapshot",
  "messageId": "7e0f8210-...",
  "snapshot": {
    "messageId": "7e0f8210-...",
    "trackedFileBackups": {},
    "timestamp": "2026-02-25T13:44:09.250Z"
  },
  "isSnapshotUpdate": false
}
```

Tracks file modifications for undo/restore capabilities. `trackedFileBackups` maps file paths to backup content. `isSnapshotUpdate` indicates whether this is an incremental update or full snapshot.

### 3.6 `type: "queue-operation"` — Task Queue Events

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-02-23T15:55:49.450Z",
  "sessionId": "7a8eaa0a-...",
  "content": "{\"task_id\":\"a56f58df34eb2846e\",\"tool_use_id\":\"toolu_bdrk_01HeqVZiempqBbYuWQbds446\",\"description\":\"Explore orchestrator flow diagram\",\"task_type\":\"local_agent\"}"
}
```

Records task queue operations for subagent scheduling.

### 3.7 `type: "progress"` — Real-Time Progress Updates

Progress entries are the **most frequent** type (can be 70%+ of all entries). They provide real-time status of ongoing operations.

#### Progress Subtypes

| Subtype | Frequency | Description |
|---------|-----------|-------------|
| `agent_progress` | ~77% | Subagent execution progress |
| `bash_progress` | ~15% | Bash command output streaming |
| `hook_progress` | ~0.5% | Hook execution status |
| `waiting_for_task` | rare | Waiting for subagent task completion |

**`agent_progress` example**:
```json
{
  "type": "progress",
  "data": {
    "type": "agent_progress",
    "prompt": "Read and analyze the orchestrator flow diagram...",
    "agentId": "a56f58df34eb2846e",
    "message": {
      "type": "user",
      "message": { "role": "user", "content": [...] },
      "uuid": "9b3e5110-...",
      "timestamp": "2026-02-23T15:55:49.444Z"
    },
    "normalizedMessages": []
  },
  "toolUseID": "agent_msg_bdrk_01FqZVybCCgs8A8TTeY8MWzR",
  "parentToolUseID": "toolu_bdrk_01HeqVZiempqBbYuWQbds446"
}
```

**`bash_progress` example**:
```json
{
  "type": "progress",
  "data": {
    "type": "bash_progress",
    "output": "",
    "fullOutput": "",
    "elapsedTimeSeconds": 3,
    "totalLines": 0,
    "totalBytes": 0,
    "taskId": "bf1af02",
    "timeoutMs": 120000
  },
  "toolUseID": "bash-progress-0",
  "parentToolUseID": "toolu_bdrk_011VamQ7x3AJEWxDo1ijwEMB"
}
```

**`hook_progress` example**:
```json
{
  "type": "progress",
  "data": {
    "type": "hook_progress",
    "hookEvent": "SessionStart",
    "hookName": "SessionStart:startup",
    "command": "'${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd' session-start"
  },
  "parentToolUseID": "a880d66b-...",
  "toolUseID": "a880d66b-..."
}
```

**Note**: Progress entries are typically **skipped** during parsing by both claude-devtools and claude-code-monitor because they lack a `uuid` field that passes the `parseChatHistoryEntry` check.

---

## 4. Content Block Types

Content blocks appear in `message.content` arrays on assistant (and some user) entries.

### 4.1 `type: "text"`

```json
{
  "type": "text",
  "text": "I'll launch three parallel research agents..."
}
```

### 4.2 `type: "thinking"`

Extended thinking content (reasoning traces):

```json
{
  "type": "thinking",
  "thinking": "The user has provided the Stage 6A handoff document and wants me to...",
  "signature": "EtAECkgICxABGAIqQDU/ZzMe5WVDE2oDCJjJrmnK4fHY1eeIjb..."
}
```

The `signature` field is a cryptographic signature verifying the thinking content's authenticity.

### 4.3 `type: "tool_use"`

```json
{
  "type": "tool_use",
  "id": "toolu_bdrk_019GTkLVnA1nQroFfgbCVG18",
  "name": "Bash",
  "input": {
    "command": "mkdir -p /home/jakekausler/dev/localenv/claude-code-workflow/docs/plans",
    "description": "Create directory for implementation plan"
  }
}
```

The `id` field is the correlation key for matching with `tool_result` blocks. Tool names include: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` (subagent), `Skill`, `WebFetch`, `NotebookEdit`, `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList`, etc.

### 4.4 `type: "tool_result"`

```json
{
  "tool_use_id": "toolu_bdrk_019GTkLVnA1nQroFfgbCVG18",
  "type": "tool_result",
  "content": "",
  "is_error": false
}
```

- `tool_use_id`: Links back to the `tool_use.id` field
- `content`: String or array of content blocks (for rich tool output)
- `is_error`: Boolean indicating tool execution failure

### 4.5 `type: "image"`

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "iVBORw0KGgo..."
  }
}
```

Supported media types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.

---

## 5. Tool Use / Tool Result Linking

### Linking Mechanism

Tool calls and their results are linked via **ID matching across entries**:

1. **Assistant message** contains a `tool_use` content block with `id: "toolu_bdrk_019..."`.
2. **Next user message** (isMeta: true or with tool_result content) contains a `tool_result` content block with `tool_use_id: "toolu_bdrk_019..."` matching the `tool_use.id`.

### Additional Linking Fields on User Entries

| Field | Description |
|-------|-------------|
| `sourceToolUseID` | Direct reference to the tool_use ID (sometimes absent) |
| `sourceToolAssistantUUID` | UUID of the assistant message that made the tool call |
| `toolUseResult` | Enriched structured result data (tool-specific) |

### toolUseResult Structures by Tool Type

**Bash tool**:
```json
{
  "stdout": "file1.txt\nfile2.txt",
  "stderr": "",
  "interrupted": false,
  "isImage": false,
  "noOutputExpected": true
}
```

**Task (subagent) tool**:
```json
{
  "status": "completed",
  "prompt": "Research the vibe-kanban repo...",
  "agentId": "ac571739e8534baf3",
  "content": "The research is complete...",
  "totalDurationMs": 45230,
  "totalTokens": 128456,
  "usage": { "input_tokens": ..., "output_tokens": ... }
}
```

**File tools (Read/Edit/Write)**:
```json
{
  "type": "read",
  "success": true,
  "filePath": "/path/to/file.ts",
  "content": "file contents..."
}
```

### Tool Result Storage

For large tool results, content may be stored in separate files:
```
{session-uuid}/tool-results/{hash}.txt
{session-uuid}/tool-results/toolu_{id}.txt
```

---

## 6. Subagent File Storage

### Two Directory Structures

#### New Structure (Current)

```
~/.claude/projects/{project-name}/
  {session-uuid}.jsonl              ← Main agent
  {session-uuid}/
    subagents/
      agent-{agent-id}.jsonl        ← Subagent files
```

#### Old/Legacy Structure

```
~/.claude/projects/{project-name}/
  {session-uuid}.jsonl              ← Main agent
  agent-{agent-id}.jsonl            ← Subagent files (at project root)
```

### Subagent File Format

Subagent JSONL files have the **exact same format** as main session files, with these distinguishing characteristics:

1. **`isSidechain: true`** — All entries have this set to true
2. **`sessionId`** — Points to the **parent** session UUID (not the subagent's own ID)
3. **`agentId`** — Present on all entries, matches the filename hash

**First entry of a subagent file** (always a user message with the task prompt):
```json
{
  "parentUuid": null,
  "isSidechain": true,
  "userType": "external",
  "cwd": "/home/jakekausler/dev/localenv/claude-code-workflow",
  "sessionId": "783f2ec5-...",
  "version": "2.1.56",
  "gitBranch": "feat/stage-9-web-view",
  "agentId": "ac571739e8534baf3",
  "slug": "staged-gathering-boole",
  "type": "user",
  "message": {
    "role": "user",
    "content": "You are a subagent researching the claude-devtools repository..."
  },
  "uuid": "6a14f024-...",
  "timestamp": "2026-02-25T13:44:46.515Z"
}
```

### Subagent Nesting

Subagents **can** spawn their own subagents. The chain depth is tracked via `parentUuid` linking across files:

- A continuation file's first message `parentUuid` matches the last message `uuid` of the previous file
- Team members may generate multiple JSONL files (one per activation/turn)
- Maximum chain depth for metadata propagation: 10 levels

### Subagent Identification

| Method | Description |
|--------|-------------|
| Filename | `agent-{agent-id}.jsonl` → agent ID = `{agent-id}` |
| `sessionId` field | Points to parent session UUID |
| `isSidechain` field | Always `true` for subagents |
| `agentId` field | Matches the filename agent ID |

### Filtered Subagent Types

- **Warmup subagents**: First user message content is exactly `"Warmup"` — pre-warming agents, filtered out
- **Compact files**: Agent ID starts with `acompact` — context compaction artifacts, filtered out
- **Empty files**: Files with 0 bytes or only whitespace — filtered out

Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/discovery/SubagentLocator.ts`
Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/discovery/SubagentResolver.ts`

---

## 7. Compaction / Summary

When Claude Code runs out of context window space, it **compacts** the conversation:

1. A `type: "summary"` entry is written with a condensed version of the conversation
2. User entries may have `isCompactSummary: true` flag to mark compact boundaries
3. The `summary.leafUuid` references the last message before compaction

### Context Consumption Tracking

Claude-devtools tracks context consumption across compaction phases:

- **Phase 1**: Tokens from session start to first compaction
- **Phase N**: Tokens from post-compaction to next compaction (contribution = `pre[N] - post[N-1]`)
- **Final phase**: Tokens from last post-compaction to current state

The total context consumption is the sum of all phase contributions, giving a "total context consumed" metric that exceeds the context window size.

Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/utils/jsonl.ts` (lines 520-597)

---

## 8. Claude Code Hook System

### Hook Configuration

Hooks are configured in `~/.claude/settings.json` under the `hooks` key:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/hook.sh"
          }
        ]
      }
    ]
  }
}
```

### Available Hook Types

From claude-code-monitor's install code (definitive list):

| Hook Type | Description | Matcher |
|-----------|-------------|---------|
| `SessionStart` | Session begins | `*` |
| `SessionEnd` | Session ends | `*` |
| `UserPromptSubmit` | User sends a prompt | `*` |
| `SubagentStart` | Subagent spawns | `*` |
| `SubagentStop` | Subagent completes | `*` |
| `PreToolUse` | Before a tool executes | `*` |
| `PostToolUse` | After a tool succeeds | `*` |
| `PostToolUseFailure` | After a tool fails | `*` |
| `Stop` | Claude finishes responding | `*` |
| `PermissionRequest` | Claude needs permission | `*` |
| `Notification` | Idle/permission notification | `idle_prompt` or `permission_prompt` |

### Hook Invocation Protocol

1. Claude Code invokes the hook command as a **child process**
2. **JSON data is piped to stdin** — the hook reads it via `cat` or similar
3. The hook can return JSON on **stdout** to modify behavior
4. Hooks can be **fire-and-forget** (exit immediately) or **blocking** (return a decision)

### Hook Input Format (stdin JSON)

The JSON piped to hooks contains:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "783f2ec5-...",
  "cwd": "/home/jakekausler/dev/localenv/claude-code-workflow",
  "uuid": "...",
  "prompt": "...",
  "tool_name": "Bash",
  "tool_use_id": "toolu_bdrk_...",
  "agent_id": "...",
  "git": {
    "branch": "feat/stage-9-web-view",
    "context": { ... }
  }
}
```

Fields vary by hook type. Known fields include:
- `hook_event_name`: The hook type
- `session_id`: Session UUID
- `cwd`: Current working directory
- `prompt`: User prompt (for UserPromptSubmit)
- `tool_name`: Tool name (for PreToolUse/PostToolUse)
- `tool_use_id`: Tool use ID (for tool hooks)
- `agent_id` / `agentId`: Subagent ID (for SubagentStart/SubagentStop)
- `git`: Git context information

### Hook Output Format (stdout JSON)

Hooks that modify behavior return:

```json
{
  "decision": "approve",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Extra context to inject into the prompt..."
  }
}
```

For `UserPromptSubmit`, the `additionalContext` is injected as a `<system-reminder>` message.

**Decision values**:
- `"approve"` — Allow the action to proceed
- `"reject"` — Block the action
- (absence) — Fire-and-forget, no decision needed

### Real-World Hook Example: Notification

From `/home/jakekausler/.claude/notify.sh`:
```bash
#!/bin/bash
input=$(cat)
REPO_PATH=$(echo "$input" | jq -r '.cwd // empty')
REPO_NAME=$(basename "$REPO_PATH")
# Send notification to Home Assistant
curl -X POST -H "Authorization: Bearer ..." \
  -d "{\"message\": \"Claude needs input in $REPO_NAME\"}" \
  http://192.168.2.148:8123/api/services/notify/mobile_app_jake_s_android
```

### Real-World Hook Example: Prompt Enhancement

From `/home/jakekausler/.claude/claude_prompt_enhancer.sh`:
```bash
#!/bin/bash
input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // empty')
jq -n --arg decision "approve" --arg context "$additional_context" '{
  decision: $decision,
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $context
  }
}'
```

---

## 9. claude-code-monitor Architecture

### Overview

claude-code-monitor uses a **Primary/Secondary architecture** for distributed monitoring:

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Claude Code  │────→│ Secondary Server │────→│   Primary   │
│   (hooks)    │     │  (per machine)   │     │   Server    │
└─────────────┘     └─────────────────┘     └──────┬──────┘
                                                    │
                           ┌────────────────────────┤
                           │ WebSocket               │ WebSocket
                           ▼                         ▼
                    ┌─────────────┐          ┌─────────────┐
                    │  Dashboard  │          │  Dashboard  │
                    │  (browser)  │          │  (browser)  │
                    └─────────────┘          └─────────────┘
```

### Data Flow Pipeline

#### 1. Hook → Secondary Server

The hook shell script (`session-monitor.sh`) transforms and POSTs:

```bash
#!/bin/bash
event=$(cat)
# Transform from Claude Code's hook format to internal format
transformed=$(echo "$event" | jq -c '{
  type: .hook_event_name,
  sessionId: .session_id,
  timestamp: (now | ...ISO format...),
  uuid: .uuid,
  data: .
}')
# POST to secondary server (fire-and-forget, background)
curl -X POST "http://localhost:4100/api/events" \
  -H "Content-Type: application/json" \
  -d "$transformed" \
  --max-time 2 --silent >/dev/null 2>&1 &
exit 0
```

#### 2. Secondary Server Processing

The secondary server (`hook-receiver.ts`):
- Receives POST at `/api/events`
- Validates required fields (`type`, `sessionId`, `timestamp`)
- Normalizes event type (PascalCase → snake_case)
- Enhances timestamp precision (adds milliseconds)
- Generates deterministic UUID for deduplication
- Extracts metadata (tool_name, subagent_id, etc.)
- Routes: `session_start` → create session, `session_end` → end session, else → generic
- Tracks subagent lifecycle (push/pop stack for tool correlation)
- Calculates duration for end events (PostToolUse, SubagentStop)
- Inserts into SQLite database
- Pushes session metadata to Primary via WebSocket

#### 3. Transcript Watcher (Secondary)

Independently watches JSONL files (`transcript-watcher.ts`):
- Uses `chokidar` to watch `~/.claude/projects/` (depth: 4)
- Tracks file offsets for incremental reading (append-only optimization)
- Parses new lines into events
- Maps JSONL types to event types: `assistant` → `assistant_text`, `tool_use` → `pre_tool_use`, `tool_result` → `post_tool_use`
- Skips: `summary`, `file-history-snapshot`, `progress`, `queue-operation`
- Batch inserts events into SQLite
- Detects out-of-order insertions (subagent files)
- Pushes session metadata updates to Primary

#### 4. Secondary → Primary

Via WebSocket at `/api/secondary`:
- `session_metadata`: Session status, tokens, event count
- `events_added`: New events appended to timeline
- `events_inserted`: Out-of-order events detected

#### 5. Primary → Dashboard

Via WebSocket at `/api/dashboard`:
- `init`: Full session list on connect
- `session_update` / `session_updated`: Session metadata changed
- `event_added`: New event available
- `session_ended`: Session ended
- `session_removed`: Session removed
- `timeline_invalidation`: Timeline data is stale, refetch needed

### Database Schema

SQLite with WAL mode. Two tables:

**sessions**:
- `id` (TEXT PK), `machine_id`, `cwd`, `transcript_path`
- `status` (active/waiting/ended), `waiting_state` (JSON: type + since)
- `start_time`, `last_activity` (INTEGER ms since epoch)
- `git_branch`, `git_context` (JSON), `tokens` (JSON), `model`
- `hidden`, `pinned` (INTEGER boolean)

**events**:
- `id` (INTEGER PK AUTOINCREMENT), `session_id` (FK), `timestamp` (INTEGER ms)
- `event_type`, `event_data` (full JSON blob), `source` (hook/transcript)
- `subagent_id`, `event_uuid` (deduplication)
- `tokens_input`, `tokens_output`, `tokens_cache_creation`, `tokens_cache_read` (cumulative)
- `tool_name`, `duration_ms`

### REST API Endpoints

**Primary Server**:
- `GET /api/sessions/:sessionId/events` — Paginated event timeline
- `GET /api/sessions/:sessionId/events/main` — Main-level events only
- `GET /api/sessions/:sessionId/events/subagent/:subagentId` — Subagent events
- `GET /api/sessions/:sessionId/events/:eventId/full` — Full event data

All proxied through to the appropriate secondary server based on session → machine mapping.

Source: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/`

---

## 10. claude-devtools JSONL Parsing

### Parsing Pipeline

```
JSONL File → parseJsonlFile() → ParsedMessage[] → processMessages() → ParsedSession
```

#### Step 1: Line-by-Line Streaming

```typescript
// From /home/jakekausler/dev/localenv/claude-devtools/src/main/utils/jsonl.ts
const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
for await (const line of rl) {
  const parsed = parseJsonlLine(line);
  if (parsed) messages.push(parsed);
}
```

#### Step 2: Entry Classification

Each JSON line is parsed as `ChatHistoryEntry`, then entries **without `uuid`** are skipped (this filters out `progress` entries and malformed data).

#### Step 3: ParsedMessage Construction

For each valid entry, the parser extracts:
- Core fields: `uuid`, `parentUuid`, `type`, `timestamp`
- Content and role from `message` field
- Token usage from `message.usage`
- Tool calls via `extractToolCalls()` — scans content blocks for `tool_use` type
- Tool results via `extractToolResults()` — scans content blocks for `tool_result` type
- Metadata: `cwd`, `gitBranch`, `agentId`, `isSidechain`, `isMeta`
- Special fields: `sourceToolUseID`, `sourceToolAssistantUUID`, `toolUseResult`

### Message Classification (4-Category System)

After parsing, messages are classified for visualization:

| Category | Detection | Display |
|----------|-----------|---------|
| **User** | `type='user'`, `isMeta!=true`, has text/image, no system tags | Right side, starts new chunk |
| **System** | `type='user'`, contains `<local-command-stdout>` | Left side, gray styling |
| **Hard Noise** | `type='system'\|'summary'\|'file-history-snapshot'\|'queue-operation'`, caveats, reminders, interruptions, synthetic assistant | **FILTERED OUT** entirely |
| **AI** | Everything else (assistant messages, tool results, internal user messages) | Left side, grouped into AIChunks |

### Chunk Building

Messages are grouped into independent chunks:
- **UserChunk**: Single user input message
- **AIChunk**: Consecutive AI messages (assistant + tool results + internal) until next user message
- **SystemChunk**: Command output
- **CompactChunk**: Compaction boundary marker

### Enhanced Chunks with Semantic Steps

AIChunks are further broken down into `SemanticStep` sequences:
- `thinking`: Extended thinking content
- `tool_call`: Tool invocation
- `tool_result`: Tool result received
- `subagent`: Subagent execution
- `output`: Main text output
- `interruption`: User interruption

### Subagent Resolution (Task → Subagent Linking)

Three-phase linking in `SubagentResolver`:

1. **Result-based matching**: Read `toolUseResult.agentId` from parent session's tool result messages → match to subagent file by ID
2. **Description-based matching**: For team members, compare Task `description` to `<teammate-message summary="...">` in subagent file
3. **Positional fallback**: Match remaining unmatched subagents/tasks by chronological order

### Parallel Detection

Subagents with start times within **100ms** of each other are marked as `isParallel: true`.

### Ongoing Detection

A session is detected as "ongoing" by analyzing the last entries:
- Presence of `thinking` or `tool_use` blocks without corresponding completions
- Absence of ending events (`end_turn` text, `ExitPlanMode`, shutdown responses)
- User interruptions are treated as ending events

Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/parsing/SessionParser.ts`
Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/discovery/SubagentResolver.ts`
Source: `/home/jakekausler/dev/localenv/claude-devtools/src/main/utils/jsonl.ts`

---

## 11. Complete Type Definitions

### Entry Types (from jsonl.ts)

```typescript
type EntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

// Note: 'progress' is also present in files but NOT in the EntryType union
// because it lacks uuid and is filtered during parsing.
```

### Content Block Types

```typescript
type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

interface TextContent {
  type: 'text';
  text: string;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

interface ToolUseContent {
  type: 'tool_use';
  id: string;        // Correlation ID for linking to tool_result
  name: string;      // Tool name (Bash, Read, Edit, Task, etc.)
  input: Record<string, unknown>;
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;           // Links to tool_use.id
  content: string | ContentBlock[];
  is_error?: boolean;
}

interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}
```

### Stop Reasons

```typescript
type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
```

### Usage Metadata

```typescript
interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  // Extended fields (not always present):
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  server_tool_use?: { web_search_requests: number; web_fetch_requests: number };
  service_tier?: string;
}
```

### JSONL Entry Interfaces

```typescript
interface ConversationalEntry {
  type: 'user' | 'assistant' | 'system';
  parentUuid: string | null;
  isSidechain: boolean;
  userType: 'external';
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  slug?: string;
  timestamp?: string;
  uuid?: string;
}

interface UserEntry extends ConversationalEntry {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  isMeta?: boolean;
  agentId?: string;
  toolUseResult?: Record<string, unknown>;
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  todos?: unknown[];
  permissionMode?: string;
}

interface AssistantEntry extends ConversationalEntry {
  type: 'assistant';
  message: {
    model: string;
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    stop_reason: StopReason;
    stop_sequence: string | null;
    usage: UsageMetadata;
  };
  requestId: string;
  agentId?: string;
}

interface SystemEntry extends ConversationalEntry {
  type: 'system';
  subtype: 'turn_duration' | 'init';
  durationMs: number;
  isMeta: boolean;
}

interface SummaryEntry {
  type: 'summary';
  summary: string;
  leafUuid: string;
  timestamp?: string;
  uuid?: string;
}

interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, string>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

interface QueueOperationEntry {
  type: 'queue-operation';
  operation: string;
  timestamp?: string;
  sessionId?: string;
  content?: string;  // JSON string with task details
}
```

### ParsedMessage (Application Internal)

```typescript
interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  type: 'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation';
  timestamp: Date;
  role?: string;
  content: ContentBlock[] | string;
  usage?: TokenUsage;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain: boolean;
  isMeta: boolean;
  userType?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: Record<string, unknown>;
  isCompactSummary?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  isTask: boolean;
  taskDescription?: string;
  taskSubagentType?: string;
}

interface ToolResult {
  toolUseId: string;
  content: string | unknown[];
  isError: boolean;
}
```

### Process (Subagent Execution)

```typescript
interface Process {
  id: string;                // Agent ID from filename
  filePath: string;          // Path to subagent JSONL file
  messages: ParsedMessage[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: SessionMetrics;
  description?: string;      // From parent Task call
  subagentType?: string;     // e.g., "Explore", "Plan"
  isParallel: boolean;       // True if ran concurrently
  parentTaskId?: string;     // tool_use ID of spawning Task
  isOngoing?: boolean;
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}
```

### XML Tags in User Messages

| Tag | Purpose | Category |
|-----|---------|----------|
| `<local-command-stdout>` | Command output from slash commands | System chunk |
| `<local-command-stderr>` | Command error output | System chunk |
| `<local-command-caveat>` | System metadata injection | Hard noise (filtered) |
| `<system-reminder>` | Context injection from plugins/hooks | Hard noise (filtered) |
| `<command-name>` | Slash command invocation | User chunk (allowed) |
| `<command-message>` | Slash command text | Part of command |
| `<command-args>` | Slash command arguments | Part of command |
| `<teammate-message>` | Team member message | Special handling |

---

## Summary of Key Design Insights

1. **JSONL is append-only**: Both claude-devtools (TranscriptWatcher) and the session monitor use offset tracking for incremental reads. This makes the format ideal for real-time monitoring.

2. **User entries serve double duty**: Real user input AND tool results are both `type: "user"`. The `isMeta` field and content format (string vs array) distinguish them.

3. **Assistant messages stream incrementally**: Multiple JSONL lines may share the same `message.id`, each adding content blocks. Only the final line has `stop_reason` set.

4. **Progress entries dominate but are noise**: ~70% of entries are `progress` type without UUIDs. They're useful for real-time display but skipped during historical parsing.

5. **Subagent linking is complex**: Three-phase resolution (result-based → description-based → positional) handles regular subagents, team members, and edge cases.

6. **Hooks are stdin/stdout JSON pipes**: Claude Code sends JSON to stdin, hooks can return JSON on stdout to modify behavior. The `decision` field controls approve/reject.

7. **Two independent data paths exist**: Hooks provide real-time events but limited data. Transcript watching provides full JSONL data but with a delay. The claude-code-monitor combines both for comprehensive coverage.

8. **The tool-results directory**: Large tool outputs may be stored in separate files alongside the session JSONL, referenced by tool use ID or hash.
