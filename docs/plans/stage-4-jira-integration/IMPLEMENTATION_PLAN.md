# Stage 4: Jira Integration — Implementation Plan

**Design doc**: `docs/plans/2026-02-20-jira-integration-design.md`
**Branch**: `kanban`

## Sub-Stage Dependency Graph

```
4a (Config Schema)
 └──▶ 4b (JiraScriptExecutor)
       ├──▶ 4c (jira-import command)
       ├──▶ 4d (jira-sync command)
       └──▶ 4e (Default wrapper scripts)
             4c + 4d ──▶ 4f (Skill updates)
```

4c, 4d, 4e can run in parallel after 4b completes.
4f depends on 4c and 4d.

---

## Sub-Stage 4a: Config Schema Extension

**Goal**: Add `jira` section to pipeline config schema, types, loader, and validation.

**Status**: Not Started

**Files to modify:**
- `src/config/schema.ts` — add `jiraConfigSchema` Zod schema, integrate into `pipelineConfigSchema`
- `src/types/pipeline.ts` — add `JiraConfig` interface to `PipelineConfig`
- `src/config/loader.ts` — merge `jira` section (repo overrides global entirely, like phases)
- `config/default-pipeline.yaml` — no change (ships without jira section)

**Schema definition:**
```typescript
const jiraStatusMapSchema = z.object({
  first_stage_design: z.string().optional(),
  stage_pr_created: z.string().optional(),
  all_stages_done: z.string().optional(),
}).optional();

const jiraConfigSchema = z.object({
  reading_script: z.string().nullable().optional(),
  writing_script: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  status_map: jiraStatusMapSchema,
}).nullable().optional();
```

**Type definition:**
```typescript
export interface JiraStatusMap {
  first_stage_design?: string;
  stage_pr_created?: string;
  all_stages_done?: string;
}

export interface JiraConfig {
  reading_script?: string | null;
  writing_script?: string | null;
  project?: string | null;
  assignee?: string | null;
  status_map?: JiraStatusMap;
}
```

**Merge behavior:** If repo config has `jira` section, it completely replaces global `jira` section (same as phases).

**Tests:**
- Valid config with all jira fields
- Valid config with jira: null (disabled)
- Valid config with no jira section (disabled)
- Valid config with only reading_script (read-only)
- Valid config with only writing_script (write-only)
- Status map with partial keys
- Status map with all keys
- Invalid status_map key rejected
- Merge: repo jira overrides global jira entirely
- Backward compat: existing configs without jira section still parse

**Success criteria:** `npm run verify` passes, new config tests pass, existing 453 tests unaffected.

---

## Sub-Stage 4b: JiraScriptExecutor

**Goal**: Core module that spawns configured scripts with JSON stdin/stdout and validates contracts.

**Status**: Not Started

**Files to create:**
- `src/jira/executor.ts` — JiraScriptExecutor implementation
- `src/jira/schemas.ts` — Zod schemas for all operation stdin/stdout contracts
- `src/jira/types.ts` — TypeScript interfaces for operation inputs/outputs
- `src/jira/index.ts` — barrel export

**JiraScriptExecutor internals:**
1. `constructor(config: JiraConfig, repoRoot: string)` — stores config, resolves script paths
2. Private `executeScript(scriptPath: string, input: unknown, outputSchema: ZodSchema): Promise<T>`:
   - Resolve script path (absolute or relative to repoRoot)
   - Spawn child process: `npx tsx <scriptPath>`
   - Write JSON.stringify(input) to child stdin, close stdin
   - Collect stdout and stderr
   - Handle timeout (30s): kill child process, throw timeout error
   - Handle non-zero exit: parse stderr as JSON error or use raw text
   - Parse stdout as JSON, validate against outputSchema
   - Return typed result
3. Public methods delegate to `executeScript` with operation-specific input and schemas

**Zod schemas (src/jira/schemas.ts):**
```typescript
// Stdin schemas
const getTicketInputSchema = z.object({
  operation: z.literal('get-ticket'),
  key: z.string(),
});

const searchTicketsInputSchema = z.object({
  operation: z.literal('search-tickets'),
  jql: z.string(),
  max_results: z.number().optional().default(50),
});

const transitionTicketInputSchema = z.object({
  operation: z.literal('transition-ticket'),
  key: z.string(),
  target_status: z.string(),
});

const assignTicketInputSchema = z.object({
  operation: z.literal('assign-ticket'),
  key: z.string(),
  assignee: z.string().nullable(),
});

const addCommentInputSchema = z.object({
  operation: z.literal('add-comment'),
  key: z.string(),
  body: z.string(),
});

// Stdout schemas
const jiraTicketDataSchema = z.object({
  key: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  parent: z.string().nullable(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  comments: z.array(z.object({
    author: z.string(),
    body: z.string(),
    created: z.string(),
  })),
});

const jiraSearchResultSchema = z.object({
  tickets: z.array(z.object({
    key: z.string(),
    summary: z.string(),
    status: z.string(),
    type: z.string(),
  })),
});

const jiraTransitionResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
  previous_status: z.string(),
  new_status: z.string(),
});

const jiraAssignResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
});

const jiraCommentResultSchema = z.object({
  key: z.string(),
  success: z.boolean(),
  comment_id: z.string(),
});
```

**Tests:**
- `executeScript` with mock script that echoes valid JSON → success
- `executeScript` with mock script that echoes invalid JSON → schema validation error
- `executeScript` with mock script that exits non-zero → error with message
- `executeScript` with mock script that times out → timeout error
- `executeScript` with mock script that writes JSON to stderr → structured error
- `canRead()` returns true when reading_script set, false when null
- `canWrite()` returns true when writing_script set, false when null
- Calling read method when reading_script null → throws descriptive error
- Calling write method when writing_script null → throws descriptive error
- Script path resolution: absolute path used as-is, relative resolved from repoRoot

**Mock scripts for testing:** Create small TypeScript scripts in `tests/fixtures/jira/` that read stdin JSON and echo expected responses based on the operation.

**Success criteria:** `npm run verify` passes, executor tests pass with mock scripts.

---

## Sub-Stage 4c: jira-import Command

**Goal**: CLI command that imports a Jira issue as a local epic or ticket file.

**Status**: Not Started

**Files to create:**
- `src/cli/commands/jira-import.ts` — command registration (yargs)
- `src/cli/logic/jira-import.ts` — business logic

**Files to modify:**
- `src/cli/index.ts` — register jira-import command

**Command definition:**
```
kanban-cli jira-import <key>
  --repo <path>       Repository path (required)
  --epic <id>         Parent epic ID override (optional)
  --pretty            Human-readable output
  --output/-o <file>  Write output to file
```

**Logic (src/cli/logic/jira-import.ts):**

```typescript
export interface JiraImportOptions {
  key: string;
  repoPath: string;
  epicOverride?: string;
}

export interface JiraImportResult {
  created_type: 'epic' | 'ticket';
  id: string;
  file_path: string;
  jira_key: string;
  parent_epic?: string;
  title: string;
  column: string; // "To Convert" for tickets, N/A for epics
}

export async function jiraImport(options: JiraImportOptions): Promise<JiraImportResult>
```

**Implementation steps:**
1. Load pipeline config via existing `loadConfig()`
2. Create JiraExecutor, verify `canRead()`
3. Call `getTicket(key)`
4. Branch on `type`:

**Epic path:**
- Scan existing epic files in repo to determine next ID (EPIC-NNN)
- Create epic markdown file at `epics/EPIC-NNN/EPIC-NNN.md`
- Write frontmatter + Jira description as body
- Run `syncRepo()` to update SQLite

**Ticket path:**
- Resolve parent epic:
  - If `--epic` provided, validate it exists in DB
  - Else if Jira `parent` is set, query `SELECT id FROM epics WHERE jira_key = ? AND repo_id = ?`
  - Else error
- Scan existing ticket files in epic dir to determine next ID (TICKET-NNN-MMM)
- Create ticket markdown file at `epics/EPIC-NNN/TICKET-NNN-MMM.md`
- Write frontmatter (source: jira, stages: []) + Jira description as body
- Run `syncRepo()` to update SQLite

5. Return result

**ID generation:** Follow existing patterns — look at how seed scripts and migration generate IDs. Scan directory for existing files matching the pattern and increment.

**Tests:**
- Import epic type → creates epic file with correct frontmatter
- Import story type with --epic → creates ticket file under specified epic
- Import story type with Jira parent → auto-resolves local epic via jira_key lookup
- Import story with Jira parent not locally present → error message
- Import story with no parent and no --epic → error message
- Import when reading_script not configured → error
- Duplicate import (same jira_key) → error or skip (prevent duplicates)
- ID generation increments correctly
- Created file has Jira description as markdown body
- Sync runs after file creation
- Pretty and JSON output formats

**Success criteria:** `npm run verify` passes, import tests pass.

---

## Sub-Stage 4d: jira-sync Command

**Goal**: CLI command that computes expected Jira state from workflow state and syncs.

**Status**: Not Started

**Files to create:**
- `src/cli/commands/jira-sync.ts` — command registration
- `src/cli/logic/jira-sync.ts` — business logic

**Files to modify:**
- `src/cli/index.ts` — register jira-sync command

**Command definition:**
```
kanban-cli jira-sync <ticket-id>
  --repo <path>       Repository path (required)
  --dry-run           Show what would change without executing
  --pretty            Human-readable output
  --output/-o <file>  Write output to file
```

**Logic:**

```typescript
export interface JiraSyncOptions {
  ticketId: string;
  repoPath: string;
  dryRun?: boolean;
}

export interface JiraSyncResult {
  ticket_id: string;
  jira_key: string;
  actions: JiraSyncAction[];
  dry_run: boolean;
  confirmation_needed: boolean; // true when WORKFLOW_JIRA_CONFIRM=true and not dry-run
}

export interface JiraSyncAction {
  type: 'transition' | 'assign';
  description: string;
  executed: boolean;
  result?: unknown;
  error?: string;
}
```

**Workflow state computation:**
1. Load ticket from DB, verify `jira_key` exists
2. Load all stages for ticket from DB
3. Determine the most advanced workflow event:
   - All stages have status "Complete" → `all_stages_done`
   - Any stage has `pr_url` set (non-null) → `stage_pr_created`
   - Any stage has status other than "Not Started" → `first_stage_design`
   - All stages "Not Started" → no transition needed
4. Look up target Jira status from `status_map[event]`
5. If no mapping for that event → skip transition (log warning)

**WORKFLOW_JIRA_CONFIRM handling:**
- Read from env var first, then from config defaults (same pattern as WORKFLOW_GIT_PLATFORM)
- When true and not --dry-run: output planned actions, exit with code 2
- Calling code (skill) interprets exit code 2 as "confirmation needed", shows user, re-runs if approved

**Assignment logic:**
- On `first_stage_design` event (work starting), also assign ticket
- Use `config.jira.assignee` (null = authenticated API user)
- Only assign if work has started (not on `all_stages_done`)

**Tests:**
- All stages complete → transitions to all_stages_done status
- Stage has PR → transitions to stage_pr_created status
- Stage in progress → transitions to first_stage_design status
- All stages Not Started → no actions
- Ticket without jira_key → error
- Writing script not configured → error
- --dry-run → actions listed but not executed
- WORKFLOW_JIRA_CONFIRM=true → exit code 2 with planned actions
- Status map missing key → skip transition with warning
- Assignment triggered on first_stage_design
- Assignment not triggered on all_stages_done
- Pretty and JSON output formats

**Success criteria:** `npm run verify` passes, sync tests pass.

---

## Sub-Stage 4e: Default Wrapper Scripts

**Goal**: Thin TypeScript wrapper scripts that translate JSON stdin to atlassian-tools CLI calls.

**Status**: Not Started

**Files to create:**
- `scripts/jira/default-jira-reader.ts`
- `scripts/jira/default-jira-writer.ts`
- `scripts/jira/package.json` (dependencies: tsx)

**Hardcoded atlassian-tools path:** `/home/jakekausler/.claude/plugins/cache/claude-code-marketplace/atlassian-tools/1.4.0`
(Versioned path — will need updating when plugin updates. Acceptable for now per design decision.)

### default-jira-reader.ts

```typescript
// 1. Read all of stdin as JSON
// 2. Validate operation field
// 3. Switch on operation:
//    get-ticket:
//      - Spawn: npx tsx <at-path>/skills/jira-reader/scripts/jira-get.ts KEY --json
//      - Parse JSON output
//      - Reshape: extract key, summary, description (ADF→text already done by --json),
//        status, type (issuetype.name), parent (parent?.key), assignee,
//        labels, comments
//      - Write reshaped JSON to stdout
//    search-tickets:
//      - Spawn: npx tsx <at-path>/skills/jira-reader/scripts/jira-search.ts "JQL" --json --max-results N
//      - Parse JSON output
//      - Reshape to { tickets: [...] }
//      - Write to stdout
// 4. On error: exit non-zero, write JSON error to stderr
```

### default-jira-writer.ts

```typescript
// 1. Read all of stdin as JSON
// 2. Validate operation field
// 3. Switch on operation:
//    assign-ticket:
//      - Spawn: npx tsx <at-path>/skills/jira-writer/scripts/jira-write.ts --key KEY --assignee ASSIGNEE
//      - Parse JSON output, reshape to { key, success: true }
//    add-comment:
//      - Spawn: npx tsx <at-path>/skills/jira-writer/scripts/jira-write.ts --key KEY --comment "body"
//      - Parse JSON output, reshape
//    transition-ticket:
//      - Import auth-helper from atlassian-tools lib
//      - GET /rest/api/3/issue/{key}/transitions → list transitions
//      - Find transition where name matches target_status (case-insensitive)
//      - If not found: error "No transition to '{target_status}' available"
//      - GET /rest/api/3/issue/{key}?fields=status → get current status
//      - POST /rest/api/3/issue/{key}/transitions with { transition: { id } }
//      - Output { key, success: true, previous_status, new_status }
// 4. On error: exit non-zero, write JSON error to stderr
```

**Tests:**
- These scripts are tested at the integration level (sub-stage 4b executor tests cover the contract)
- Manual testing with real Jira (not automated) for the atlassian-tools delegation
- Mock-level testing: create test scripts that simulate the atlassian-tools output format

**Success criteria:** Scripts execute via `npx tsx`, accept JSON stdin, produce JSON stdout matching contract.

---

## Sub-Stage 4f: Skill Updates

**Goal**: Update phase-finalize and convert-ticket skills with Jira awareness.

**Status**: Not Started

**Files to modify:**
- `skills/phase-finalize.md` — add jira-sync step after MR/PR creation, add Jira links to MR/PR description
- `skills/convert-ticket.md` — add note about Jira-sourced ticket context

### phase-finalize changes

Add after MR/PR creation step (remote mode) or after merge (local mode):

```markdown
### Jira Status Sync (if applicable)

After MR/PR creation or stage completion:
1. Check if ticket has `jira_key` in frontmatter
2. If yes and `writing_script` is configured in pipeline config:
   - Run: `npx tsx src/cli/index.ts jira-sync TICKET-XXX-YYY --repo <path>`
   - If exit code 0: report sync result
   - If exit code 2 (WORKFLOW_JIRA_CONFIRM=true): show user the planned changes, ask for confirmation, re-run if approved
   - If exit code 1: report error, continue (don't block finalization on Jira failure)
3. If no jira_key or no writing_script: skip silently
```

Add to MR/PR description generation:

```markdown
### Jira Links in MR/PR Description

When generating MR/PR description:
- If ticket has `jira_key`: add line "Jira: https://<base>/browse/PROJ-1234"
- If epic has `jira_key`: add line "Epic: https://<base>/browse/PROJ-100"
- Jira base URL: extract from jira_key project + configured Jira instance, or omit link if unknown
```

### convert-ticket changes

Add note in the "Read Ticket Context" section:

```markdown
If ticket has `source: jira` and a `jira_key`, the ticket body may contain
a detailed description imported from Jira. Use this context during stage
breakdown brainstorming — it often contains acceptance criteria, technical
details, and scope information from the original Jira ticket.
```

**Tests:** Skills are markdown files — verify changes with grep for key terminology and structure.

**Success criteria:** Skills contain correct Jira integration instructions, verified by grep.

---

## Execution Order

1. **4a** (config schema) — sequential, foundation for everything
2. **4b** (executor) — sequential, depends on 4a
3. **4c + 4d + 4e** (import + sync + wrapper scripts) — parallel after 4b
4. **4f** (skill updates) — after 4c and 4d complete

## Verification

After each sub-stage: `npm run verify` must pass.
After all sub-stages: full integration test with seed repo + mock Jira scripts.
