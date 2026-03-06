# Stage 4: Jira Integration — Design

**Date**: 2026-02-20
**Status**: Approved
**Depends on**: Stage 1 (Foundation), Stage 2 (Migration/convert-ticket), Stage 3 (Remote Mode)

## 1. Goal

Tickets can be pulled from Jira into the workflow and status syncs bidirectionally. All Jira API calls happen via external scripts with a JSON stdin/stdout contract — no HTTP client code in kanban-cli itself.

## 2. Architecture: Script-Executor

kanban-cli defines a `JiraScriptExecutor` that spawns configured external scripts as child processes. Scripts receive JSON on stdin and produce JSON on stdout. Zod validates both sides of the contract.

```
kanban-cli ──JSON stdin──▶ configured script ──JSON stdout──▶ kanban-cli
                              │                                    │
                              ▼                                    ▼
                         Jira REST API                      Zod validation
```

Default wrapper scripts are provided that delegate to the atlassian-tools plugin scripts (hardcoded paths for now).

### Why scripts, not built-in HTTP

- Users can swap scripts for any Jira-compatible system
- Default scripts leverage existing atlassian-tools authentication and API wrappers
- kanban-cli stays focused on workflow logic, not API plumbing
- Scripts are independently testable outside kanban-cli

## 3. Configuration

New `jira` section in `.kanban-workflow.yaml`:

```yaml
jira:
  # Script paths (nullable — null disables that operation category)
  reading_script: null          # Path to script for read operations
  writing_script: null          # Path to script for write operations

  # Jira project key (optional — if null, full keys like PROJ-1234 required everywhere)
  project: null                 # e.g., "PROJ"

  # Assignee for auto-assignment (null = authenticated API user)
  assignee: null                # e.g., "5f7a8b..." accountId

  # Workflow event → Jira transition name mapping
  status_map:
    first_stage_design: "In Progress"
    stage_pr_created: "In Review"
    all_stages_done: "Done"
```

### Validation rules

- `reading_script` and `writing_script` are independent — read-only or write-only integration is valid
- `status_map` keys are a fixed enum: `first_stage_design`, `stage_pr_created`, `all_stages_done`
- `status_map` values are freeform strings (Jira workflow names vary across projects)
- Entire `jira` section is optional — absent means Jira fully disabled
- Script paths: absolute, or relative to repo root

### Integration with existing config

- `WORKFLOW_JIRA_CONFIRM` (boolean, already in `workflow.defaults`) controls whether `jira-sync` auto-executes or requires confirmation
- Config merge follows existing priority: repo > global > embedded default
- The embedded default pipeline ships with `jira: null` (disabled)

## 4. Script Contract

### 4.1 Read Operations (reading_script)

#### get-ticket

**Stdin:**
```json
{
  "operation": "get-ticket",
  "key": "PROJ-1234"
}
```

**Stdout:**
```json
{
  "key": "PROJ-1234",
  "summary": "Add user authentication",
  "description": "Markdown description text...",
  "status": "Open",
  "type": "Story",
  "parent": "PROJ-100",
  "assignee": "john.doe@example.com",
  "labels": ["backend", "auth"],
  "comments": [
    {
      "author": "jane@example.com",
      "body": "Comment text...",
      "created": "2026-02-15T10:30:00Z"
    }
  ]
}
```

- `parent` is nullable — epics and parentless issues return `null`
- `description` is Markdown (converted from ADF by the script)
- `comments` is an array, may be empty

#### search-tickets

**Stdin:**
```json
{
  "operation": "search-tickets",
  "jql": "status='In Progress' AND project=PROJ",
  "max_results": 50
}
```

**Stdout:**
```json
{
  "tickets": [
    {
      "key": "PROJ-1234",
      "summary": "Add user authentication",
      "status": "In Progress",
      "type": "Story"
    }
  ]
}
```

### 4.2 Write Operations (writing_script)

#### transition-ticket

**Stdin:**
```json
{
  "operation": "transition-ticket",
  "key": "PROJ-1234",
  "target_status": "In Progress"
}
```

**Stdout:**
```json
{
  "key": "PROJ-1234",
  "success": true,
  "previous_status": "Open",
  "new_status": "In Progress"
}
```

Note: Jira status transitions use the transitions API (`POST /rest/api/3/issue/{key}/transitions`), not field updates. The script must list available transitions, find the one matching `target_status`, and execute it.

#### assign-ticket

**Stdin:**
```json
{
  "operation": "assign-ticket",
  "key": "PROJ-1234",
  "assignee": null
}
```

- `assignee: null` means assign to the authenticated API user

**Stdout:**
```json
{
  "key": "PROJ-1234",
  "success": true
}
```

#### add-comment

**Stdin:**
```json
{
  "operation": "add-comment",
  "key": "PROJ-1234",
  "body": "Markdown comment text"
}
```

**Stdout:**
```json
{
  "key": "PROJ-1234",
  "success": true,
  "comment_id": "12345"
}
```

### 4.3 Error Contract

- Non-zero exit code on failure
- JSON on stderr when possible: `{"error": "message", "code": "NOT_FOUND"}`
- If stderr is not valid JSON, the raw text is used as the error message
- Timeout: 30 seconds default, executor kills child process on timeout

## 5. JiraScriptExecutor Module

`src/jira/executor.ts`

### Public API

```typescript
interface JiraExecutor {
  // Read operations (requires reading_script configured)
  getTicket(key: string): Promise<JiraTicketData>
  searchTickets(jql: string, maxResults?: number): Promise<JiraSearchResult>

  // Write operations (requires writing_script configured)
  transitionTicket(key: string, targetStatus: string): Promise<JiraTransitionResult>
  assignTicket(key: string, assignee: string | null): Promise<JiraAssignResult>
  addComment(key: string, body: string): Promise<JiraCommentResult>

  // Capability checks
  canRead(): boolean   // reading_script is configured
  canWrite(): boolean  // writing_script is configured
}

function createJiraExecutor(config: JiraConfig, repoRoot: string): JiraExecutor
```

### Behavior

- `canRead()` / `canWrite()` return false when scripts aren't configured
- Calling a method when the corresponding script isn't configured throws a descriptive error
- No retry logic — callers decide whether to retry
- Script paths resolved: absolute used as-is, relative resolved from repo root

## 6. CLI Commands

### 6.1 jira-import

```bash
kanban-cli jira-import PROJ-1234 --repo <path> [--epic EPIC-001] [--pretty]
```

**Flow:**
1. Load pipeline config, create JiraExecutor, check `canRead()`
2. Call `getTicket(key)` to fetch Jira data
3. Auto-detect item type from Jira `type` field:

**If type = "Epic":**
- Create epic file with next available epic ID
- Frontmatter: `id`, `title` (from summary), `status: Not Started`, `jira_key`, `tickets: []`, `depends_on: []`
- Jira description becomes markdown body
- `--epic` flag ignored

**If type = Story/Bug/Task/etc:**
- Create ticket file
- Determine parent epic (priority order):
  1. `--epic` flag (explicit override)
  2. Jira `parent` field → query SQLite: `SELECT id FROM epics WHERE jira_key = ? AND repo_id = ?`
  3. Parent in Jira but not local → error: "Parent epic PROJ-100 not found locally. Import it first or specify --epic"
  4. No parent anywhere → error: "No parent epic detected. Specify --epic"
- Generate next ticket ID within the epic
- Frontmatter: `id`, `epic`, `title`, `status: Not Started`, `jira_key`, `source: jira`, `stages: []`, `depends_on: []`
- Jira description becomes markdown body (lands in "To Convert" column)

4. Run sync to update SQLite
5. Output result (JSON default, `--pretty` for human-readable)

**Output formats:** JSON (default), `--pretty`.
Supports `--output/-o <file>` like all other commands.

### 6.2 jira-sync

```bash
kanban-cli jira-sync TICKET-001-001 --repo <path> [--dry-run] [--pretty]
```

**Flow:**
1. Load pipeline config, create JiraExecutor, check `canWrite()`
2. Load ticket from SQLite, verify it has a `jira_key`
3. Load all stages for the ticket, compute current workflow state
4. Determine expected Jira status using `status_map`:
   - All stages complete (status = Complete) → `all_stages_done`
   - Any stage has `pr_url` set → `stage_pr_created`
   - Any stage has entered a pipeline state (status is not "Not Started") → `first_stage_design`
   - No stages started → no transition needed
5. If `--dry-run`, output what would change and exit
6. If `WORKFLOW_JIRA_CONFIRM` is true, output what would change and exit with code 2 (confirmation needed)
7. Call `transitionTicket(jiraKey, targetStatus)` if status needs changing
8. Call `assignTicket(jiraKey, config.assignee)` if ticket has entered work and is not yet assigned
9. Output result

## 7. Default Wrapper Scripts

Two TypeScript scripts in `tools/kanban-cli/scripts/jira/`:

### default-jira-reader.ts

- Reads JSON from stdin, validates `operation` field
- `get-ticket`: spawns `npx tsx <atlassian-tools-path>/skills/jira-reader/scripts/jira-get.ts KEY --json`, parses output, reshapes to contract (extracts parent, type, comments, converts to expected fields)
- `search-tickets`: spawns `npx tsx <atlassian-tools-path>/skills/jira-reader/scripts/jira-search.ts "JQL" --json --max-results N`, reshapes output
- Hardcoded atlassian-tools path (will be made configurable later)

### default-jira-writer.ts

- Reads JSON from stdin, validates `operation` field
- `assign-ticket`: spawns `npx tsx <atlassian-tools-path>/skills/jira-writer/scripts/jira-write.ts --key KEY --assignee ASSIGNEE`
- `add-comment`: spawns `npx tsx <atlassian-tools-path>/skills/jira-writer/scripts/jira-write.ts --key KEY --comment "body"`
- `transition-ticket`: **implements directly** using atlassian-tools' `lib/auth-helper.ts` for credentials + raw fetch to Jira transitions API (since atlassian-tools doesn't support transitions):
  1. `GET /rest/api/3/issue/{key}/transitions` to list available transitions
  2. Find transition matching `target_status` name
  3. `POST /rest/api/3/issue/{key}/transitions` with `{"transition": {"id": "..."}}`
- Hardcoded atlassian-tools path

## 8. Skill Updates

### convert-ticket

Minimal change. The Jira description is already written into the ticket markdown body during `jira-import`. The skill already reads the ticket file content for brainstorming context. Only addition: a note in the skill that Jira-sourced tickets may have richer descriptions from the import.

### phase-finalize

After MR/PR creation (remote mode) or merge (local mode):
1. Check if ticket has `jira_key`
2. If yes, run `kanban-cli jira-sync TICKET-XXX-YYY --repo <path>`
3. If `WORKFLOW_JIRA_CONFIRM` is true, jira-sync exits with code 2 and dry-run output — skill shows user what would change and asks for confirmation, then re-runs
4. Report sync result or skip if no jira_key

MR/PR description generation:
1. If ticket has `jira_key`, include Jira ticket link
2. If epic has `jira_key`, reference Jira epic link

## 9. Graceful Degradation

When Jira is not configured (`jira` section absent or scripts null):
- `jira-import` errors immediately with "Jira reading not configured"
- `jira-sync` errors immediately with "Jira writing not configured"
- `phase-finalize` skips Jira sync silently (no jira_key or no writing_script)
- All other commands work identically — no behavioral change
- No Jira-related errors in validate, board, graph, next, sync, summary

## 10. Testing Strategy

**Unit tests:**
- Config schema: `jira` section parsing, nullable fields, status_map enum validation
- JiraScriptExecutor: mock child process, validate stdin/stdout schema enforcement, timeout, error cases
- `jira-import` logic: epic vs ticket detection, parent epic lookup via jira_key, ID generation, file creation
- `jira-sync` logic: workflow state computation, status map resolution, dry-run mode, confirm mode (exit code 2)

**Integration tests:**
- Mock scripts (small scripts that echo expected JSON) to test executor→script→parse pipeline
- `jira-import` with mock reader: verify created files have correct frontmatter
- `jira-sync` with mock writer: verify correct operations sent

**No real Jira API calls in tests.** All mocked at the script boundary.

**Existing 453 tests must continue passing.** Config additions are backward-compatible (all jira fields optional).
