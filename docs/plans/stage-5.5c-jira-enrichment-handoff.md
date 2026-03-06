# Stage 5.5C: Jira Conversion Enrichment — Session Prompt

## Context

Stages 5.5A and 5.5B are complete on the `kanban` branch. This session implements **Stage 5.5C: Jira Conversion Enrichment** — enhancing `jira-import` to capture link manifests and `convert-ticket` to fetch linked content for richer brainstorming context.

Stage 5.5C is **independent of Stage 5.5B** (skill updates). It depends only on Stage 5.5A (which provided the `jira_links` schema).

### What Stage 5.5A Built (Relevant to 5.5C)

**Ticket frontmatter schema**:
- `jira_links: JiraLink[]` field added to Ticket interface and Zod schema
- `JiraLink` interface: `{ type, url, title, key?, relationship?, filename?, mime_type? }`
- `type` enum: `'confluence' | 'jira_issue' | 'attachment' | 'external'`
- Defaults to `[]` if not present — backward compatible
- Zod schema in `src/parser/frontmatter-schemas.ts`
- TypeScript type in `src/types/work-items.ts` (lines 77-85)

**Validation**:
- `kanban-cli validate` checks `jira_links` format (type required, url required, title required)
- Error if type has invalid value, error if missing required fields
- Tests in `tests/cli/logic/validate.test.ts` (5 test cases)

### What Stage 5.5B Built

- Code host adapter methods (`editPRBase`, `markPRReady`, `getBranchHead`)
- `phase-build` parent branch merge step
- `phase-finalize` draft MR and target branch logic
- `resolve-merge-conflicts` skill
- **None of this is relevant to 5.5C** — listed for completeness only

### Key Design References

- **MR dependency chains design (Section 5)**: `docs/plans/2026-02-21-mr-dependency-chains-design.md` ← PRIMARY REFERENCE
- Stage 5.5A design: `docs/plans/stage-5.5a-schema-sync-design.md`
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`

---

## What Stage 5.5C Delivers

### Goal

`jira-import` captures link manifests from Jira tickets during import. `convert-ticket` fetches and reads all linked content for enriched brainstorming context when breaking tickets into stages.

### What Ships

1. **`jira-import` command update — link manifest extraction**:
   - When importing a Jira ticket, extract all linked items from the Jira API response
   - Populate `jira_links` array in ticket frontmatter with:
     - **Confluence pages** → `type: 'confluence'`, url, title
     - **Related Jira issues** → `type: 'jira_issue'`, url, title, key, relationship
     - **Attachments** → `type: 'attachment'`, url, title, filename, mime_type
     - **External links** → `type: 'external'`, url, title
   - This is **metadata only** — no content is fetched during import
   - The Jira reading script must return link data (may require script update)

2. **`convert-ticket` skill update — enriched content fetching**:
   - Before brainstorming stage breakdown, check for `jira_links` in ticket frontmatter
   - If present, fetch linked content:
     - **Re-pull Jira ticket** — fresh data from Jira (not relying on import-time snapshot)
     - **Confluence pages** → Use Confluence reader skill (stub if unavailable)
     - **Jira issues** → Use Jira reader skill/script to fetch linked issue details
     - **Attachments** → Download and read (PDF reader, image description, document parsing)
     - **External URLs** → Use WebFetch tool
   - Compile all fetched content into enriched context for brainstorming
   - **Graceful degradation**: log which links couldn't be fetched, continue with available content

3. **Jira reading script contract update**:
   - The existing `reading_script` (configured in `.kanban-workflow.yaml`) returns ticket data via `getTicket(key)`
   - The script response must be extended to include link data (issue links, remote links, attachments)
   - The Zod schema in `src/jira/schemas.ts` must be updated to parse link data

4. **Tests for all new behavior**

### What Stage 5.5C Does NOT Include

- ❌ Confluence reader skill implementation (consumed if available, stubbed if not)
- ❌ Any changes to the sync engine or schema (Stage 5.5A already handled these)
- ❌ Any changes to phase skills (Stage 5.5B already handled these)
- ❌ MR cron or orchestrator (Stage 6A/6D)
- ❌ Attachment storage or caching (content is fetched on-demand during conversion, not persisted)

---

## Open Questions (Resolve During Design Phase)

1. **Should the Jira reading script return links as part of `getTicket()`, or should there be a separate `getTicketLinks(key)` call?**

   Recommendation: Extend `getTicket()` response to include a `links` array. Simpler contract, single round-trip. The script already has authentication context.

2. **Should the converter store fetched content as separate files alongside the ticket, or inline it all into the brainstorming context?**

   Options: (a) Inline into brainstorming prompt context only — simpler, no file artifacts. (b) Save as `-enrichment.md` sibling file — persistent, reusable across sessions. (c) Save individual files per link type.

3. **Rate limiting for fetching many linked items from a single Jira ticket.**

   A ticket could have 10+ links. Fetching them all sequentially may be slow. Consider parallel fetching with a concurrency limit (e.g., 3 at a time).

4. **Exact Confluence reader skill API contract.**

   Can be stubbed until the skill is available. Design should define the expected interface (URL in → markdown content out) so the stub is replaceable.

5. **What if the Jira reading script doesn't support returning links yet?**

   The import should gracefully handle a script that returns no link data — `jira_links` stays `[]`. The enrichment feature is additive, not breaking.

---

## Current State of Key Files

### Jira Import

**Command**: `tools/kanban-cli/src/cli/commands/jira-import.ts`
**Logic**: `tools/kanban-cli/src/cli/logic/jira-import.ts`

Current behavior:
- Fetches ticket via `executor.getTicket(key)` (calls reading script)
- For ticket imports, writes frontmatter with: `id`, `epic`, `title`, `status`, `jira_key`, `source: jira`, `stages: []`, `depends_on: []`
- **Does NOT populate `jira_links`** — this is the gap 5.5C fills

**Jira Executor**: `tools/kanban-cli/src/jira/executor.ts`
- Wraps reading/writing scripts via `npx tsx <script>`
- `getTicket(key)` returns: `{ key, summary, description, type, parent, status, assignee, labels, comments }`
- **Does NOT return link data** — script contract must be extended

**Jira Schemas**: `tools/kanban-cli/src/jira/schemas.ts`
- Zod schemas for Jira API responses
- Must be extended with link data schema

**Jira Types**: `tools/kanban-cli/src/jira/types.ts`
- `JiraExecutor` interface, `JiraTicket` type
- Must be extended with link fields

### Convert-Ticket Skill

**File**: `skills/convert-ticket/SKILL.md`

Current workflow:
1. Read ticket context (YAML frontmatter + markdown body)
2. Read parent epic for context
3. Brainstorm stage breakdown (invoke brainstormer)
4. Create stage files
5. Update ticket frontmatter with stages list
6. Set dependencies, validate, sync

**Missing**: No step between 1 and 2 to check `jira_links` and fetch linked content. This is where the enrichment step inserts.

### Validation (Already Done)

**File**: `tools/kanban-cli/src/cli/logic/validate.ts`
- `jira_links` validation already implemented in Stage 5.5A
- Tests in `tests/cli/logic/validate.test.ts` (5 test cases covering format validation)

### Frontmatter Types (Already Done)

**File**: `tools/kanban-cli/src/types/work-items.ts`
- `JiraLink` interface at lines 77-85
- `Ticket` interface includes `jira_links: JiraLink[]` at line 60

**File**: `tools/kanban-cli/src/parser/frontmatter-schemas.ts`
- `jiraLinkSchema` Zod schema at lines 12-20
- Integrated into `ticketFrontmatterSchema`

---

## Existing Test Coverage

**jira-import tests**: `tests/cli/logic/jira-import.test.ts` (582 lines)
- Epic import: correct frontmatter, ID incrementing, null description handling
- Ticket import: parent resolution (--epic flag, auto-resolve via jira_key), ID incrementing
- Error cases: missing config, missing reading_script, duplicate import, missing parent
- **Does NOT test `jira_links` population** — 5.5C adds these tests

**jira-sync tests**: `tests/cli/logic/jira-sync.test.ts`
- Workflow event computation and state syncing
- Not directly relevant to 5.5C

**validate tests**: `tests/cli/logic/validate.test.ts`
- `jira_links` format validation (5 test cases) — already passing

**Test suite**: 703 tests across 49 files, all passing

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the MR dependency chains design doc Section 5 (`docs/plans/2026-02-21-mr-dependency-chains-design.md`)
2. Study the jira-import logic (`tools/kanban-cli/src/cli/logic/jira-import.ts`) — understand current import flow
3. Study the Jira executor and types (`tools/kanban-cli/src/jira/executor.ts`, `types.ts`, `schemas.ts`) — understand script contract
4. Study the convert-ticket skill (`skills/convert-ticket/SKILL.md`) — understand current conversion flow
5. Resolve the Open Questions listed above
6. Identify what changes are needed in the reading script contract
7. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-5.5c-jira-enrichment-design.md`
2. Write the implementation plan (task-level breakdown with dependencies)

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill to execute:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor**
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Write handoff for next stage

### Key Constraints

- The existing 703 tests must continue passing throughout
- `npm run verify` must pass after every task
- New Jira script contract must be backward compatible (scripts that don't return links should still work)
- `jira_links: []` default means existing tickets are unaffected
- Graceful degradation: missing skills/tools should not break the converter
- The convert-ticket skill is a Markdown file (no unit tests) — correctness validated by review

---

## Next Steps After Stage 5.5C

- **Stage 6A**: Orchestrator infrastructure — session spawning, worktree management with `pending_merge_parents` awareness
- **Stage 6D**: MR cron — parent branch tracking, child MR rebasing, draft-to-ready promotion
