# Claude Code Monitor - Comprehensive Research Report

## Date
2026-02-25

## Executive Summary

Claude Code Monitor is a sophisticated real-time session monitoring system designed to observe and display Claude Code sessions with exceptional performance characteristics. It uses a primary/secondary architecture for distributed monitoring across machines, with an efficient React dashboard that can handle 30K+ events with <500ms load times and 60fps scrolling through virtual DOM techniques.

---

## 1. Technology Stack

### Backend
- **Language:** TypeScript (Node.js 20+)
- **HTTP Framework:** Express 5.2.0
- **WebSocket Library:** ws 8.18.0
- **Database:** SQLite 3 with WAL mode (better-sqlite3 11.0.0)
- **File Watching:** chokidar 5.0.0
- **Testing:** Vitest 2.1.0

### Frontend
- **Language:** TypeScript + React 19.0.0
- **Build Tool:** Vite 5.4.0
- **UI State Management:** Zustand 5.0.0
- **Virtualization:** Virtua 0.39.0 (efficient rendering of large lists)
- **Markdown Rendering:** react-markdown 10.1.0 with remark-gfm
- **Syntax Highlighting:** Shiki 3.22.0
- **Styling:** Tailwind CSS 3.4.0
- **Utilities:** lucide-react (icons), use-debounce

### CLI
- **Language:** TypeScript
- **Hook Technology:** Bash + jq (for data transformation)
- **Dependencies:** Same as server packages

---

## 2. Architecture Overview

### High-Level Design

The system follows a **Primary/Secondary distributed architecture**:

```
┌─────────────────────────────────────────┐
│        PRIMARY SERVER (port 3200)       │
│  - In-memory session coordinator        │
│  - WebSocket hub for dashboards         │
│  - LRU event cache (50MB)               │
│  - Routes queries to secondaries        │
│  - Serves built dashboard (production)  │
└──────┬──────────────────────────┬───────┘
       │ WS /api/secondary        │ WS /api/dashboard
       │                          │
       ▼                          ▼
┌────────────────────┐   ┌──────────────────┐
│ SECONDARY SERVER 1 │   │ DASHBOARDS (N)   │
│  (port 3202)       │   │ - Real-time sync │
│ - Hook receiver    │   │ - Event viewing  │
│ - Transcript watch │   │ - Session mgmt   │
│ - SQLite DB        │   │ - Settings       │
└────────────────────┘   └──────────────────┘
```

**Key Principle:** Events stay on the machine where they were created. Secondaries push lightweight metadata updates; Primary coordinates and caches.

### Port Assignments

| Service | Port | Purpose |
|---------|------|---------|
| Primary Server | 3200 | Dashboard UI + WebSocket API |
| Dashboard Dev | 3201 | Vite dev server (dev only) |
| Secondary Server | 3202 | Hook receiver + query API |

---

## 3. Session Monitoring

### How Sessions Are Detected

**Session lifecycle tracking:**

1. **Session Start** - Claude Code fires a `SessionStart` hook event
   - Location: `/packages/cli/templates/session-monitor.sh` (lines 1-26)
   - Hook detection: Defined in install process (see `/packages/cli/src/install.ts`, lines 24-36)

2. **Hook Receiver Processing** - Secondary server receives hook event
   - Endpoint: `POST /api/events` (line 138 in `/packages/server/src/secondary/hook-receiver.ts`)
   - Validates event data, generates UUID for deduplication
   - Creates new session in database if not exists (lines 191-227)

3. **Session Status Tracking** - Multiple status states:
   - `waiting` - Idle, waiting for user input
   - `active` - Processing Claude response
   - `ended` - Session finished

4. **Status Transitions** - Tracked via events (lines 275-330 in hook-receiver.ts):
   - `user_prompt_submit` → `active`
   - `stop` → `waiting` (with subtype: user_input)
   - `permission_request` → `waiting` (with subtype: permission)
   - `notification` → `waiting` (with subtype: idle)
   - `session_end` → `ended`

### Captured Session Metadata

**Session Database Schema** (`/packages/server/src/shared/database-schema.ts`, lines 10-27):

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  machine_id TEXT,              -- Which machine this session runs on
  cwd TEXT,                      -- Working directory
  transcript_path TEXT,          -- Path to transcript file
  status TEXT,                   -- active|waiting|ended
  waiting_state TEXT,            -- JSON: {type, since}
  start_time INTEGER,            -- Milliseconds since epoch
  last_activity INTEGER,         -- Last event timestamp
  git_branch TEXT,               -- Current git branch
  git_context TEXT,              -- JSON git metadata
  tokens TEXT,                   -- JSON: {input, output, cacheCreation, cacheRead}
  model TEXT,                    -- LLM model identifier
  hidden INTEGER,                -- User-hidden flag
  pinned INTEGER,                -- User-pinned flag
  hidden_at INTEGER,             -- When hidden
  pinned_at INTEGER              -- When pinned
)
```

**Tracked via Type Interfaces** (`/packages/server/src/shared/types.ts`, lines 13-30):
- `SessionRow` - Database representation
- `SessionUpdate` - Partial update object
- `SessionMetadata` - In-memory coordinator format

---

## 4. Message and Event Capture

### Event Data Flow

```
Claude Code → Hook Script → Secondary Server → Database + Primary
              (bash)       (Node.js)        (SQLite)
```

### Hook Event Format

**Incoming format** (lines 131-138 in types.ts):
```typescript
interface HookEvent {
  type: string;                  // Event type (e.g., "SessionStart", "PreToolUse")
  sessionId: string;             // Unique session identifier
  timestamp: string;             // ISO 8601 timestamp
  data: Record<string, any>;     // Full event payload
  uuid?: string;                 // Deduplication ID
  subagentId?: string;           // For subagent tracking
}
```

### Event Processing Pipeline

**Location:** `/packages/server/src/secondary/hook-receiver.ts`

1. **Validation** (lines 138-157)
   - Check required fields: type, sessionId, timestamp
   - Validate ISO 8601 timestamp format

2. **Timestamp Enhancement** (lines 57-70, 159-162)
   - Claude Code provides second-level precision (ends in .000Z)
   - Function adds millisecond component for sub-second ordering
   - Ensures stable ordering of same-second events

3. **Event UUID Generation** (line 163)
   - Function `generateEventUuid()` creates deterministic dedup key
   - Prevents duplicate processing

4. **Metadata Extraction** (line 164)
   - Function `extractMetadata()` pre-extracts:
     - `tool_name` - For tool events
     - `subagent_id` - For subagent tracking
     - `duration_ms` - Computed from start/end events (lines 407-453)

5. **Event Routing** (lines 169-176)
   - `session_start` → `handleSessionStart()` (lines 191-227)
   - `session_end` → `handleSessionEnd()` (lines 233-269)
   - Other → `handleGenericEvent()` (lines 336-401)

### Event Types Captured

**From Hook Template** (`/packages/cli/templates/session-monitor.sh` and install.ts):

| Hook Type | Captures |
|-----------|----------|
| `SessionStart` | Session initialization, cwd, git context |
| `SessionEnd` | Session completion |
| `UserPromptSubmit` | User input with prompt text |
| `SubagentStart` | Subagent spawn with agent_id and type |
| `SubagentStop` | Subagent completion with status |
| `PreToolUse` | Tool invocation start with tool_name and inputs |
| `PostToolUse` | Tool result with outputs, execution time |
| `PostToolUseFailure` | Tool error with error message |
| `Stop` | Claude stop signal (user interrupt) |
| `PermissionRequest` | Permission prompt for user |
| `Notification` | Background notifications |

### Transcript Parsing

**Location:** `/packages/server/src/secondary/transcript-parser.ts`

Watches Claude Code `.jsonl` transcript files and extracts events:

- **Record Types Skipped** (lines 12-17):
  - `summary` - Internal summaries
  - `file-history-snapshot` - File tracking
  - `progress` - Progress events
  - `queue-operation` - Queue management

- **Mapped Record Types** (lines 19-23):
  - `assistant` → `assistant_text`
  - `tool_use` → `pre_tool_use`
  - `tool_result` → `post_tool_use`

- **Metadata Extracted** (lines 25-68):
  - Token usage (input, output, cache creation, cache read)
  - Tool names
  - Model identifier
  - Subagent ID from file path

---

## 5. Real-Time Display Architecture

### WebSocket Protocol

**Two WebSocket endpoints on Primary:**

1. **`/api/secondary`** - Secondary servers connect here
   - Location: Handled by `SecondaryHub` (`/packages/server/src/primary/secondary-hub.ts`)
   - Purpose: Receive event metadata and session updates from secondaries
   - Message types: `register`, `session_metadata`, `events_added`, `events_inserted`

2. **`/api/dashboard`** - Dashboards connect here
   - Location: Handled by `DashboardHub` (`/packages/server/src/primary/dashboard-hub.ts`)
   - Purpose: Broadcast session updates to all connected dashboards
   - Message types: `init`, `session_update`, `session_updated`, `event_added`, `session_ended`, `session_removed`, `timeline_invalidation`

### Unified WebSocket Coordinator

**Location:** `/packages/server/src/primary/unified-websocket-coordinator.ts`

Routes all WebSocket connections through single HTTP upgrade handler:
- Handles `/api/secondary` → delegates to `SecondaryHub`
- Handles `/api/dashboard` → delegates to `DashboardHub`
- Unknown paths → connection rejected

### Real-Time Update Flow

```
Secondary writes events → Posts to Primary via WS
                        ↓
                 Primary Session Coordinator
                        ↓
                   Broadcasts to Dashboards
                        ↓
                   Dashboard receives via WS
                        ↓
                   Zustand store updates
                        ↓
                   React re-render (Virtua virtualization)
```

**Key Messages:**

1. **`events_added`** (EventsAddedMessage, types.ts line 151-156)
   - Sent when events appended to end of timeline
   - Triggers dashboard refetch of latest events

2. **`events_inserted`** (EventsInsertedMessage, types.ts line 162-171)
   - Sent when events inserted out-of-order (timestamp before max)
   - Includes affected timestamp range
   - Triggers dashboard invalidation of affected cache

3. **`timeline_invalidation`** (TimelineInvalidationMessage, types.ts line 177-188)
   - Broadcast from Primary to Dashboards
   - Indicates cache should be invalidated

### Message Timing

- **Hook events** - Fire-and-forget via curl in hook script (lines 17-23 of session-monitor.sh)
  - Max 2-second timeout
  - Async background execution (&)

- **Transcript watching** - File system events processed immediately via chokidar
  - 500ms debounce to stabilize writes

---

## 6. Tool Use Visibility

### Tool Event Correlation

**Location:** `/packages/server/src/secondary/hook-receiver.ts`, lines 373-386

Tools are correlated to subagents via active subagent stack:

```typescript
// Track active subagents per session (stack for nested subagents)
const activeSubagents = new Map<string, Array<{ agentId: string; startTime: number }>>();

// When PreToolUse event arrives:
// 1. Check if there's an active subagent
// 2. If yes, tag tool with that subagent_id
// 3. If no, tool is main-level
```

### Tool Data Captured

**From PreToolUse event:**
- `tool_name` - Type of tool (Read, Write, Bash, etc.)
- `tool_use_id` - Unique invocation ID
- Inputs - Tool-specific inputs (file paths, commands, etc.)

**From PostToolUse event:**
- `tool_use_id` - Correlates to PreToolUse
- Result data - Output, files modified, command output
- Duration - Calculated from timestamp difference (line 407-453)
- Status - Success

**From PostToolUseFailure event:**
- `tool_use_id` - Correlates to PreToolUse
- Error message - Failure reason
- Duration - Time before failure

### Dashboard Tool Rendering

**Tool Renderers** (`/packages/dashboard/src/toolRenderers/renderers/`):

Specialized renderers for each tool type:

| Tool | Renderer | File | Features |
|------|----------|------|----------|
| Read | ReadRenderer | ReadRenderer.tsx | File content preview |
| Write | WriteRenderer | WriteRenderer.tsx | Diff visualization |
| Bash | BashRenderer | BashRenderer.tsx | Command & output |
| Glob | GlobRenderer | GlobRenderer.tsx | File matches |
| Skill | SkillRenderer | SkillRenderer.tsx | MCP tool calls |
| Playwright | PlaywrightRenderer | PlaywrightRenderer.tsx | Browser automation |
| WebFetch | WebFetchRenderer | WebFetchRenderer.tsx | HTTP requests |
| Memory | MemoryRenderer | MemoryRenderer.tsx | Memory operations |
| Task | TaskRenderer | TaskRenderer.tsx | Subagent tasks |
| WebSearch | WebSearchRenderer | WebSearchRenderer.tsx | Search results |
| AskUserQuestion | AskUserQuestionRenderer | AskUserQuestionRenderer.tsx | User prompts |
| ModeControl | ModeControlRenderer | ModeControlRenderer.tsx | Mode changes |
| SubagentTask | SubagentTaskRenderer | SubagentTaskRenderer.tsx | Subagent execution |

---

## 7. Subagent Tracking

### Subagent Lifecycle

**Subagent Detection:**

1. `SubagentStart` event
   - Event type: `subagent_start`
   - Data contains: `agent_id`, agent type, task description
   - Tracked in `activeSubagents` stack (hook-receiver.ts, line 17)

2. `SubagentStop` event
   - Event type: `subagent_stop`
   - Correlates to `SubagentStart` via `agent_id`
   - Duration calculated (line 427-431)
   - Popped from `activeSubagents` stack

**Hierarchy:**

```
Main Session
  ├── Tool 1
  ├── Subagent 1
  │   ├── Tool 1.1
  │   ├── Tool 1.2
  │   └── Tool 1.3
  ├── Tool 2
  └── Subagent 2
      ├── Tool 2.1
      └── Tool 2.2
```

### Subagent Data in Database

**Stored as events with subagent_id field:**

```sql
CREATE TABLE events (
  ...
  subagent_id TEXT,        -- Identifies which subagent
  ...
)
```

**Tracking in hook-receiver.ts:**
- Line 75-80: `trackSubagentStart()` - Push to stack
- Line 86-98: `trackSubagentStop()` - Pop from stack
- Line 104-110: `getCurrentSubagent()` - Top of stack
- Line 379-386: Tool correlation - Assign to active subagent if present

### Transcript Subagent Detection

**Location:** `/packages/server/src/secondary/transcript-watcher.ts`, lines 123-128

Extracts subagent ID from file path:
- Main transcript: `~/.claude/projects/{session_id}/transcript.jsonl`
- Subagent transcript: `~/.claude/projects/{session_id}/subagents/{agent_id}/transcript.jsonl`
- Function `parseSubagentIdFromPath()` extracts agent_id from path

All events from subagent transcript file automatically tagged with that subagent_id.

### Dashboard Subagent Display

**UI Components** (`/packages/dashboard/src/components/`):
- `SubagentItem.tsx` - List item for subagent in timeline
- `SubagentEvent.tsx` - Individual subagent event rendering
- `SubagentDetails.tsx` - Expanded subagent view showing child events

**Store Integration** (`/packages/dashboard/src/stores/sessionStore.ts`):
- T3 timeline: Subagent events (lines 31-33)
- T4 timeline: Subagent tool details (lines 35-37)
- Expand/collapse tracking (lines 62-63)

---

## 8. User Interaction Capabilities

### Current Features

The monitor is **read-only** for session viewing. No direct user interaction with Claude sessions.

### Dashboard Interactions

**User can:**

1. **Select Sessions** - Click session in sidebar to view timeline
2. **Expand/Collapse** - Collapsible subagents and tools in timeline
3. **View Details** - Click tools to see full event data
4. **Search/Filter** - Settings modal (SettingsModal.tsx)
5. **Pin/Hide Sessions** - Session management in list
6. **Change Theme** - Light/dark mode toggle
7. **Responsive UI** - Mobile drawer for session list on small screens

**Location:** `/packages/dashboard/src/components/`
- SessionList.tsx - List of sessions
- SettingsModal.tsx - User preferences
- SessionDrawer.tsx - Mobile session picker

### Architecture for Future Interactivity

If approval/intervention were to be added:

1. **Approval Message Type** - Would be sent from dashboard → primary → secondary
2. **Queue System** - Secondary would pause execution, wait for approval
3. **Broadcast Response** - Dashboard broadcasts approval/denial back through WebSocket

Current system doesn't implement this, but architecture supports it.

---

## 9. Multi-Session Support

### Session Coordination

**In-Memory Coordinator** (`/packages/server/src/primary/session-coordinator.ts`):

```typescript
class SessionCoordinator {
  private sessions: Map<string, SessionMetadata> = new Map();
  
  updateSession(metadata: SessionMetadata) { }
  getSession(sessionId: string): SessionMetadata | null { }
  getAllSessions(): SessionMetadata[] { }
  removeSession(sessionId: string) { }
}
```

- Maintains session metadata for all concurrent sessions
- Routed from `SessionCoordinator.getAllSessions()` to dashboard on connect

### Per-Session Event Lookup

**Routing** (`/packages/server/src/primary/event-router.ts`, lines 33-100):

When dashboard requests events for a session:
1. Look up session in coordinator
2. Get associated secondary server machine ID
3. Query secondary HTTP API for events
4. Cache result in LRU cache
5. Return to dashboard

### Concurrent Session Handling

**Database** - Multiple sessions per database:

```sql
SELECT * FROM events 
WHERE session_id = ?
ORDER BY timestamp ASC
LIMIT 100
```

**Queries use indexed lookups:**
```sql
CREATE INDEX idx_events_session_timestamp 
  ON events(session_id, timestamp ASC);
```

**Dashboard State Management** (sessionStore.ts):

```typescript
sessions: Map<string, SessionMetadata>;     // All sessions
timelines: Map<string, TimelineState>;      // Per-session timelines
selectedSessionId: string | null;           // Currently viewing
```

---

## 10. Data Persistence

### Database Storage

**Location:** `~/.claude/session-monitor/sessions.db`

**Format:** SQLite 3 with WAL (Write-Ahead Logging) mode

**Configuration** (`/packages/server/src/secondary/database-manager.ts`, lines 26-32):
- WAL mode enabled (line 29): `PRAGMA journal_mode = WAL`
- Foreign keys enabled (line 32): `PRAGMA foreign_keys = ON`

### Schema

**Two main tables:**

1. **sessions** - Session metadata (indexed on status, machine, last_activity)
2. **events** - Individual events (indexed on session_id + timestamp, subagent_id, event_type)

**Key indexes:**
- `idx_sessions_status` - Query by status (active/waiting/ended)
- `idx_sessions_machine` - Route to correct secondary
- `idx_events_session_timestamp` - Primary lookup for event pagination
- `idx_events_subagent` - Subagent event filtering
- `idx_events_type` - Event type filtering

### Persistence Points

1. **Hook Events** - Written immediately to events table (lines 459-508)
2. **Session Updates** - Written on status changes (lines 275-330)
3. **Transcript Events** - Batch inserted when transcript file changes (line 166)
4. **Deduplication** - UNIQUE(session_id, event_uuid) prevents duplicates (line 50)

### Retention

- No automatic deletion
- Sessions marked `ended` remain in database indefinitely
- User can hide sessions via dashboard (hides from view, doesn't delete)

---

## 11. Hook System

### Hook Installation

**Location:** `/packages/cli/src/install.ts`, lines 53-86

Installation process:

1. **Check Dependencies** (lines 55, 88-98)
   - Verify `jq` and `curl` are available
   - Fail on Windows (must use WSL)

2. **Initialize Database** (lines 64-66)
   - Create `~/.claude/session-monitor/` directory
   - Initialize SQLite database with schema

3. **Write Config** (lines 69-72)
   - Create `~/.claude/session-monitor/config.json`
   - Stores primary/secondary host:port, machine ID

4. **Deploy Hook Script** (lines 75-77)
   - Copy `session-monitor.sh` to `~/.claude/hooks/`
   - Replace `{{SECONDARY_URL}}` placeholder with actual secondary API URL

5. **Register Hooks with Claude Code** (lines 80-81)
   - Merge hook entries into `~/.claude/settings.json`
   - Register 11 hook types (lines 24-36)

### Hook Script

**Location:** `/packages/cli/templates/session-monitor.sh`

```bash
#!/bin/bash
# 1. Read hook event from stdin
event=$(cat)

# 2. Transform hook format to internal format using jq
# - Extract hook_event_name → type
# - Extract session_id
# - Generate ISO 8601 timestamp with millisecond precision
# - Preserve uuid and full data payload

# 3. POST to secondary server
# - Fire-and-forget (background &)
# - 2-second max timeout
# - Silent mode (no output)
```

### Hook Event Transformation

The hook script uses `jq` to transform Claude Code's hook event format:

**Input (Claude Code hook):**
```json
{
  "hook_event_name": "SessionStart",
  "session_id": "abc-123",
  "uuid": "...",
  "cwd": "/path/to/project",
  // ... other fields
}
```

**Output (Internal format):**
```json
{
  "type": "SessionStart",
  "sessionId": "abc-123",
  "timestamp": "2026-02-25T12:34:56.789Z",
  "uuid": "...",
  "data": { /* full original event */ }
}
```

### Hook Types Registered

From `/packages/cli/src/install.ts` lines 24-36:

```typescript
const HOOK_TYPES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PermissionRequest',
  'Notification',
]
```

Each hook type is registered in settings.json under `hooks[matcher]` array.

---

## 12. WebSocket/Event Protocol

### WebSocket Message Protocol

#### Dashboard → Primary Connection (`/api/dashboard`)

**No client→server messages in current implementation.**

Dashboards receive broadcast messages only.

#### Primary → Dashboard (Broadcast Messages)

**On Connect:**
```json
{
  "type": "init",
  "sessions": [
    {
      "id": "session-123",
      "machineId": "laptop",
      "status": "active",
      "eventCount": 450,
      "lastActivity": "2026-02-25T12:34:56.789Z",
      "cwd": "/home/user/project",
      "gitBranch": "main",
      "tokens": { "input": 5000, "output": 3000, ... },
      "model": "claude-opus-4-20250514"
    }
  ]
}
```

**Session Update:**
```json
{
  "type": "session_update",
  "session": { /* SessionMetadata */ }
}
```

**Timeline Invalidation:**
```json
{
  "type": "timeline_invalidation",
  "sessionId": "session-123",
  "invalidationType": "appended|inserted",
  "affectedRange": { "start": "...", "end": "..." },
  "latestTimestamp": "2026-02-25T12:34:56.789Z"
}
```

**Session Ended:**
```json
{
  "type": "session_ended",
  "sessionId": "session-123"
}
```

#### Secondary → Primary Connection (`/api/secondary`)

**Register (on connect):**
```json
{
  "type": "register",
  "machineId": "laptop",
  "hostname": "laptop.local",
  "apiUrl": "http://laptop.local:3202"
}
```

**Session Metadata Update:**
```json
{
  "type": "session_metadata",
  "sessionId": "session-123",
  "machineId": "laptop",
  "status": "active",
  "eventCount": 450,
  "lastActivity": "2026-02-25T12:34:56.789Z",
  "waitingState": { "type": "user_input", "since": "..." },
  "cwd": "/home/user/project",
  "gitBranch": "main",
  "tokens": { "input": 5000, "output": 3000, ... },
  "model": "claude-opus-4-20250514"
}
```

**Events Added:**
```json
{
  "type": "events_added",
  "sessionId": "session-123",
  "newEventCount": 5,
  "latestTimestamp": "2026-02-25T12:34:56.789Z"
}
```

**Events Inserted (out-of-order):**
```json
{
  "type": "events_inserted",
  "sessionId": "session-123",
  "insertedAt": "2026-02-25T12:34:56.789Z",
  "count": 3,
  "affectedRange": {
    "start": "2026-02-25T12:30:00.000Z",
    "end": "2026-02-25T12:32:00.000Z"
  }
}
```

### HTTP API Endpoints

#### Secondary Server

**Query Events:**
```
GET /api/sessions/:sessionId/events
  ?direction=latest|before|after
  &limit=100
  &startTimestamp=2026-02-25T12:34:56.789Z
```

Response:
```json
{
  "events": [ /* EventMetadata[] */ ],
  "hasMore": true,
  "windowStart": "2026-02-25T12:00:00.000Z",
  "windowEnd": "2026-02-25T12:34:56.789Z"
}
```

**Get Sessions:**
```
GET /api/sessions
```

Response:
```json
{
  "sessions": [ /* SessionMetadata[] */ ]
}
```

#### Primary Server

**Get Events (routes to secondary):**
```
GET /api/sessions/:sessionId/events?...
```

Proxies to secondary HTTP API, caches result in LRU.

**Health Checks:**
```
GET /health
```

---

## 13. UI Components and Views

### Dashboard Layout

**Components** (`/packages/dashboard/src/components/`):

1. **App.tsx** (lines 82-151)
   - Main app layout
   - Desktop sidebar (300px) + mobile drawer
   - Timeline content area
   - Settings modal

2. **SidebarContent.tsx**
   - Session list with search/filter
   - Shows active/waiting/ended status
   - Token usage indicators
   - Git branch display

3. **SessionList.tsx**
   - Memoized session cards
   - Click to select
   - Display cwd, status, last activity
   - Token context percentage

4. **ActivityTimeline.tsx** (lines 1-150+)
   - Main timeline view
   - Virtua virtualization
   - Collapse/expand subagents and tools
   - Windowed pagination
   - Loading states

5. **ToolDetails.tsx**
   - Tool-specific rendering
   - Expandable content
   - Syntax highlighting (Shiki)

6. **SubagentDetails.tsx**
   - Child events list
   - Subagent status and duration

### Timeline Item Types

**Union type** (`/packages/dashboard/src/types/session.ts`):

```typescript
type TimelineItem = EventMetadata | SubagentEntity | ToolEntity;

interface SubagentEntity {
  type: 'subagent';
  id: string;
  agentType: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ended';
  duration: number | null;
  tokens: { input, output, cacheCreation?, cacheRead? } | null;
  startEvent: EventMetadata;
  endEvent: EventMetadata | null;
  model: string | null;
}

interface ToolEntity {
  type: 'tool';
  id: string;
  toolName: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ended';
  duration: number | null;
  absorbedContent: string;
}
```

### Theme System

**Location:** `/packages/dashboard/src/themes/`

- Light/dark mode toggle
- CSS custom properties for colors:
  - `--text-primary`, `--text-muted`
  - `--bg-primary`, `--bg-secondary`
  - `--border`, `--accent`
- Stored in localStorage

---

## 14. Multi-User and Deployment Considerations

### Current Limitations

**No built-in authentication or multi-user support:**
- Dashboards connect directly to Primary server
- No user identity tracking
- All dashboards see all sessions
- Any user can manipulate settings

### Distributed Deployment

**Supports multi-machine setup:**

1. Machine A runs Primary server (port 3200)
   - Accessible from network
   - Hosts dashboard
   - Coordinates all secondaries

2. Machine A also runs Secondary (port 3202)
   - Watches local Claude sessions
   - Stores events locally

3. Machine B runs Secondary (port 3202)
   - Watches local Claude sessions
   - Registers with Primary on Machine A
   - Stores events locally

**Configuration** (`/packages/cli/src/config.ts`):
- `PRIMARY_HOST` / `PRIMARY_PORT` - Where primary runs
- `SECONDARY_HOST` / `SECONDARY_PORT` - Where secondary listens
- `CMON_MACHINE_ID` - Identifies this machine
- Can be overridden via env vars for remote deployment

### Environment Variables for Configuration

```bash
# Primary server config
PRIMARY_HOST=0.0.0.0
PRIMARY_PORT=3200

# Secondary server config
SECONDARY_HOST=0.0.0.0
SECONDARY_PORT=3202

# Machine identification
CMON_MACHINE_ID=hostname

# Database location
DB_PATH=~/.claude/session-monitor/sessions.db

# Secondary API URL (externally reachable)
SECONDARY_API_URL=http://hostname:3202

# Transcripts watch location
CLAUDE_PROJECTS_PATH=~/.claude/projects
```

---

## 15. Performance Characteristics

### Benchmarks (from README)

| Metric | Old System | New System |
|--------|------------|-----------|
| Initial load (30K events) | 5-10 seconds | <500ms |
| DOM elements (30K events) | 80,000+ | <500 |
| Memory usage | 200-500 MB | <50 MB |
| Scroll FPS | 5-15 (laggy) | 60 fps |
| Network payload | 35 MB | <100 KB |

### Optimization Techniques

1. **Virtualization** (Virtua library)
   - Only renders visible items
   - Constant DOM size regardless of event count
   - Variable height measurement

2. **Windowed Pagination**
   - Load events on-demand (100 at a time)
   - Timestamp-based anchoring
   - Before/after/latest directions

3. **LRU Cache** (`/packages/server/src/primary/lru-cache.ts`)
   - 50MB timeline cache
   - 20MB subagent cache
   - 10MB tool cache
   - Size-based eviction

4. **Event Filtering**
   - Skip internal event types (progress, file-history, queue-ops)
   - 86.5% of events never rendered

5. **Timestamp Enhancement**
   - Millisecond precision added at ingestion
   - Ensures stable ordering without re-sorting

### Scalability Limits

- **Single session:** 30K+ events (tested and verified)
- **Concurrent sessions:** Limited by Primary server memory
- **Multiple machines:** Scales horizontally via secondaries
- **Event throughput:** Limited by secondary HTTP POST rate

---

## 16. Hook Detection Summary

### Hook Event Sources

**11 hook types are monitored:**

1. `SessionStart` - Session initialization
2. `SessionEnd` - Session completion
3. `UserPromptSubmit` - User input
4. `SubagentStart` - Subagent spawned
5. `SubagentStop` - Subagent completed
6. `PreToolUse` - Tool invoked
7. `PostToolUse` - Tool completed successfully
8. `PostToolUseFailure` - Tool failed
9. `Stop` - User stop signal
10. `PermissionRequest` - Permission prompt
11. `Notification` - Background notification

### Hook Delivery Mechanism

```
Claude Code fires event
    ↓
Calls ~/.claude/hooks/session-monitor.sh
    ↓
Script reads event from stdin
    ↓
Transforms to internal format with jq
    ↓
curl POST to http://localhost:3202/api/events
    ↓
Background fire-and-forget (&)
    ↓
Secondary receives and processes
    ↓
Database insert with deduplication
    ↓
Primary notifies dashboards via WebSocket
```

**Reliability:** Best-effort delivery. Failures don't block Claude Code execution.

---

## 17. Key Files Reference

### Server Package

| File | Purpose | Key Functions/Classes |
|------|---------|-----|
| `/packages/server/src/primary/index.ts` | Primary server entry | Express app setup, WebSocket init |
| `/packages/server/src/primary/session-coordinator.ts` | In-memory session index | SessionCoordinator class |
| `/packages/server/src/primary/secondary-hub.ts` | WebSocket hub for secondaries | SecondaryHub class, message routing |
| `/packages/server/src/primary/dashboard-hub.ts` | WebSocket hub for dashboards | DashboardHub class, broadcast |
| `/packages/server/src/primary/unified-websocket-coordinator.ts` | Single upgrade handler | Route /api/secondary vs /api/dashboard |
| `/packages/server/src/primary/lru-cache.ts` | Event caching | LRUCache class |
| `/packages/server/src/primary/event-router.ts` | HTTP API routes | /api/sessions/:sessionId/events |
| `/packages/server/src/secondary/index.ts` | Secondary server entry | Express app, database init |
| `/packages/server/src/secondary/hook-receiver.ts` | POST /api/events endpoint | Event validation, routing, subagent tracking |
| `/packages/server/src/secondary/transcript-watcher.ts` | File system watcher | TranscriptWatcher class |
| `/packages/server/src/secondary/database-manager.ts` | SQLite access | DatabaseManager class |
| `/packages/server/src/secondary/primary-client.ts` | WebSocket to primary | PrimaryClient class, auto-reconnect |
| `/packages/server/src/secondary/query-api.ts` | HTTP query endpoints | /api/sessions, /api/sessions/:id/events |
| `/packages/server/src/shared/types.ts` | TypeScript interfaces | SessionRow, EventRow, HookEvent, etc. |
| `/packages/server/src/shared/database-schema.ts` | SQLite schema | SCHEMA_SQL constant |
| `/packages/server/src/shared/metadata-extractor.ts` | Event metadata extraction | normalizeEventType(), extractMetadata() |

### CLI Package

| File | Purpose |
|------|---------|
| `/packages/cli/src/install.ts` | Hook installation logic |
| `/packages/cli/src/run.ts` | Server startup (cmon run) |
| `/packages/cli/src/config.ts` | Configuration management |
| `/packages/cli/src/hooks.ts` | Hook script generation |
| `/packages/cli/templates/session-monitor.sh` | Hook script template |

### Dashboard Package

| File | Purpose |
|------|---------|
| `/packages/dashboard/src/App.tsx` | Main app component |
| `/packages/dashboard/src/main.tsx` | React entry point |
| `/packages/dashboard/src/stores/sessionStore.ts` | Zustand store (sessions + timelines) |
| `/packages/dashboard/src/stores/settingsStore.ts` | Zustand store (user settings) |
| `/packages/dashboard/src/hooks/useWebSocket.ts` | WebSocket connection hook |
| `/packages/dashboard/src/types/session.ts` | TypeScript types (SessionMetadata, EventMetadata, etc.) |
| `/packages/dashboard/src/components/ActivityTimeline.tsx` | Main timeline view with virtualization |
| `/packages/dashboard/src/components/SessionList.tsx` | Session list sidebar |
| `/packages/dashboard/src/toolRenderers/` | Tool-specific renderers (Read, Write, Bash, etc.) |

---

## 18. Project Development Setup

### Installation

```bash
# Root level
npm install

# Build everything
npm run build

# Run development (3 processes: primary, secondary, dashboard)
npm run dev

# Or run individual servers
npm run primary:dev    # Terminal 1
npm run secondary:dev  # Terminal 2
npm run dashboard:dev  # Terminal 3
```

### Install Hooks (One-time)

```bash
cd packages/cli
npm link
cmon install
```

This:
- Checks dependencies (jq, curl)
- Creates database
- Writes config
- Deploys hook script
- Merges into settings.json

### Running in Production

```bash
npm run build:publish
cd packages/cli
npm link
cmon run              # Starts primary + secondary
```

Access dashboard at http://localhost:3200

---

## 19. Key Design Decisions

### 1. Primary/Secondary Over Monolithic

**Decision:** Separate Primary (coordination) from Secondary (data storage)

**Rationale:**
- Scales horizontally (add secondaries)
- Events stay local (security, performance)
- Stateless primary (easy failover)

### 2. SQLite Over Document Database

**Decision:** SQLite with WAL mode

**Rationale:**
- ACID guarantees
- Built-in indexing
- Small footprint (no service)
- Concurrent read access via WAL

### 3. WebSocket Over HTTP Polling

**Decision:** Push metadata via WebSocket, pull data via HTTP

**Rationale:**
- Real-time updates with low latency
- Bidirectional channel available for future features
- HTTP for large event transfers (separate concerns)

### 4. Virtua Over Custom Virtualization

**Decision:** Use Virtua library for timeline virtualization

**Rationale:**
- Production-tested library
- Handles variable heights
- Handles resize efficiently
- Tested with 30K+ items

### 5. Timestamp Enhancement Over Re-sorting

**Decision:** Add millisecond precision at ingestion

**Rationale:**
- Events from same second stay ordered by arrival
- No database re-sorting needed
- Deterministic per event
- Minimal overhead

### 6. LRU Cache Over Always-Fresh

**Decision:** Cache event queries with size-based eviction

**Rationale:**
- 50MB cache handles large events at <500ms
- LRU eviction fits usage patterns
- Reduces secondary load

### 7. Hook Installation Over Built-in

**Decision:** Hook script managed by CLI

**Rationale:**
- Works with existing Claude Code hook system
- Easy to uninstall (just remove settings.json entries)
- Portable (works on any machine with bash/jq/curl)

---

## 20. Limitations and Constraints

### Current Constraints

1. **No Authentication** - Anyone with dashboard URL sees all sessions
2. **Single Primary** - No redundancy for primary server
3. **No TTL on Data** - Events stay forever (can grow large)
4. **Bash Hook Script** - Windows requires WSL
5. **Manual Installation** - Must run `cmon install` for each machine
6. **No Event Filtering API** - Dashboard must fetch and filter locally
7. **No Export** - No session export/download feature

### Platform Constraints

- Requires Node.js 20+
- Linux/macOS (Windows via WSL)
- Bash, jq, curl for hook script
- SQLite 3 (included via better-sqlite3)

---

## 21. Future Enhancement Possibilities

1. **User Authentication** - Add OAuth/JWT for multi-user
2. **Event Retention Policies** - Auto-archive old sessions
3. **Session Export** - Download session transcript
4. **Event Search** - Full-text search on event data
5. **Approval Workflow** - For sensitive tool calls (Read sensitive files, etc.)
6. **Performance Metrics** - Dashboard showing latency, token usage trends
7. **Alert Rules** - Notify on specific event patterns
8. **Event Replay** - Debug sessions by replaying events
9. **Performance Profiling** - Track tool execution times over time

---

## 22. Summary

Claude Code Monitor is a sophisticated, production-ready system for monitoring Claude Code sessions with exceptional performance. Its primary/secondary architecture enables distributed monitoring across multiple machines while maintaining data locality. The efficient virtualization approach and intelligent caching allow it to handle 30K+ event sessions smoothly on consumer hardware.

The system captures comprehensive telemetry: session lifecycle, user interactions, tool usage (including detailed inputs/outputs), subagent hierarchies, token consumption, and model information. Real-time updates via WebSocket keep all connected dashboards synchronized within milliseconds.

The implementation is well-structured with clear separation of concerns: hook receipt → event normalization → database storage → coordination → visualization. The codebase demonstrates excellent engineering practices including robust error handling, comprehensive testing, and thoughtful optimization.

For web UI development purposes, the key architectural patterns to study are:
- **Primary/Secondary with HTTP routing** for distributed data access
- **WebSocket for real-time coordination** rather than polling
- **Virtua virtualization** for handling massive lists
- **Timestamp-based pagination** for efficient historical traversal
- **LRU cache at coordination layer** for performance

---

## Appendix: File Location Quick Reference

### Core Architecture
- Primary Server: `/packages/server/src/primary/index.ts`
- Secondary Server: `/packages/server/src/secondary/index.ts`
- Session Coordination: `/packages/server/src/primary/session-coordinator.ts`
- Event Processing: `/packages/server/src/secondary/hook-receiver.ts`
- WebSocket Coordination: `/packages/server/src/primary/unified-websocket-coordinator.ts`

### Data Layer
- Database Schema: `/packages/server/src/shared/database-schema.ts`
- Database Manager: `/packages/server/src/secondary/database-manager.ts`
- Types: `/packages/server/src/shared/types.ts`

### Hook System
- Hook Script: `/packages/cli/templates/session-monitor.sh`
- Installation: `/packages/cli/src/install.ts`

### Dashboard UI
- Main App: `/packages/dashboard/src/App.tsx`
- Timeline: `/packages/dashboard/src/components/ActivityTimeline.tsx`
- WebSocket Hook: `/packages/dashboard/src/hooks/useWebSocket.ts`
- Session Store: `/packages/dashboard/src/stores/sessionStore.ts`

### Documentation
- Architecture Design: `/docs/plans/2026-02-02-efficient-architecture-design.md`
- Project README: `/README.md`

---

**End of Report**

Generated: 2026-02-25
Research Depth: Comprehensive (Full codebase exploration)
