---
name: convert-ticket
description: Use when a ticket has stages:[] (empty stages) and needs to be broken down into stages via brainstorming before work can begin. Appears in the "To Convert" kanban column.
---

# Convert Ticket - Stage Breakdown

This skill handles converting tickets that have no stages (`stages: []`) into tickets with a defined stage breakdown. These tickets appear in the "To Convert" kanban column and cannot be worked on until they have stages.

## When to Use

- Ticket has `stages: []` in its YAML frontmatter
- Ticket appears in the "To Convert" kanban column
- After Jira import creates tickets without stage breakdown
- User runs `/convert-ticket TICKET-XXX-YYY`
- `next_task` returns a ticket needing conversion

## When NOT to Use

- Ticket already has stages defined
- Creating a brand new ticket (use `ticket-stage-setup` instead)
- Migrating an entire repository (use `migrate-repo` instead)

---

## Workflow

### Step 1: Read Ticket Context

1. Read the ticket file to understand what needs to be built:

   ```bash
   # Locate the ticket file
   find epics/ -name "TICKET-XXX-YYY.md" -type f
   ```

2. Extract from the ticket's YAML frontmatter:
   - `id`: Ticket identifier
   - `epic`: Parent epic ID
   - `title`: Ticket title
   - `jira_key`: Jira ticket key (if imported from Jira)
   - `source`: `local` or `jira`
   - `depends_on`: Any existing dependencies

3. Read the ticket's markdown body for:
   - Overview/description of the feature
   - Any notes or requirements
   - Jira description (if `source: jira`)
   - Acceptance criteria (if present)

   **Jira Context Note:** If ticket has `source: jira` and a `jira_key`, the ticket body may contain a detailed description imported from Jira. Use this context during stage breakdown brainstorming -- it often contains acceptance criteria, technical details, and scope information from the original Jira ticket.

4. Read the parent epic file for broader context:
   - What other tickets exist in this epic
   - Epic-level description and goals
   - How this ticket fits into the larger initiative

5. Present ticket context to user:

   ```
   ============================================================
   TICKET CONVERSION
   ============================================================
   Epic:     EPIC-XXX [Epic Title]
   Ticket:   TICKET-XXX-YYY [Ticket Title]
   Source:   local | jira
   Jira Key: PROJ-1234 (or null)

   Description:
   [Ticket description/overview]

   Dependencies:
   [Any existing ticket-level dependencies]

   Proceeding to brainstorm stage breakdown...
   ============================================================
   ```

### Step 2: Enrich Ticket Context

If the ticket was imported from Jira, enrich it with the latest Jira data, linked Confluence pages, and related issues before brainstorming.

1. **Check if enrichment applies**: Look at the frontmatter extracted in Step 1.
   - If `source: jira` AND `jira_key` is present, proceed with enrichment.
   - If `source: local` or `jira_key` is missing/null, **skip this step entirely** and proceed to Step 3.

2. **Run the enrich command**:

   **Preferred:** Use the `mcp__kanban__enrich_ticket` tool:
   - ticketPath: `<ticket-path>`

   Where `<ticket-path>` is the full path to the ticket markdown file found in Step 1. The tool fetches:
   - Fresh Jira ticket data (latest title, description, status, comments)
   - Linked Confluence pages
   - Linked Jira issues
   - Linked attachments (metadata)
   - External URLs

   The tool returns a JSON summary; the enrichment content itself is written to the `-enrichment.md` file (see next sub-step).

   **Fallback (if MCP unavailable):**
   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts enrich <ticket-path>
   ```

   **Note:** The command outputs a JSON summary to stdout; the enrichment content itself is written to the `-enrichment.md` file (see next sub-step). Do not try to parse stdout as the enrichment content.

3. **Read the enrichment file**: After the enrich command completes, read the generated enrichment file located alongside the ticket file. The enrichment file is named after the ticket file: `<ticket-filename-without-.md>-enrichment.md`, in the same directory as the ticket. For example, if the ticket file is `TICKET-001-001.md`, the enrichment file is `TICKET-001-001-enrichment.md`:

   ```
   epics/EPIC-001/TICKET-001-001-enrichment.md
   ```

   This file contains structured context from Jira and linked sources that will improve the quality of the stage breakdown.

4. **Handle enrichment failures gracefully**:
   - If the enrich command fails entirely, log the error and continue to Step 3 with whatever context is already available from Step 1.
   - If enrichment produces partial results (some links could not be fetched), note which links failed but use whatever content was retrieved.
   - Enrichment is **additive, never blocking** — the conversion must proceed even if enrichment completely fails.

### Step 3: Brainstorm Stage Breakdown

Invoke the brainstorming process to explore what stages are needed for this ticket.

**Use the brainstormer agent (Opus)** to analyze the ticket and propose 2-3 stage breakdown options:

1. **Provide brainstormer with context**:
   - Ticket description and requirements
   - Parent epic context
   - Enrichment file content (if Step 2 produced one — includes Jira comments, linked Confluence pages, related issues, and attachments)
   - Existing codebase patterns (if relevant)
   - Any Jira acceptance criteria

2. **Brainstormer produces options** such as:

   ```
   ============================================================
   STAGE BREAKDOWN OPTIONS
   ============================================================

   Option A: Fine-grained (4 stages)
     STAGE-XXX-YYY-001: Data Model & Schema
       Type: database
     STAGE-XXX-YYY-002: API Endpoints
       Type: backend
     STAGE-XXX-YYY-003: UI Components
       Type: frontend
     STAGE-XXX-YYY-004: Integration & E2E
       Type: backend

     Pros: Clear separation of concerns, easier to parallelize
     Cons: More overhead per stage

   Option B: Feature-slice (2 stages)
     STAGE-XXX-YYY-001: Backend (model + API)
       Type: [database, backend]
     STAGE-XXX-YYY-002: Frontend (UI + integration)
       Type: frontend

     Pros: Fewer stages, each delivers visible progress
     Cons: Larger stages, harder to review

   Option C: Vertical slice (3 stages)
     STAGE-XXX-YYY-001: Core Feature
       Type: [frontend, backend]
     STAGE-XXX-YYY-002: Edge Cases & Validation
       Type: [frontend, backend]
     STAGE-XXX-YYY-003: Polish & Documentation
       Type: custom

     Pros: Each stage delivers working functionality
     Cons: Cross-cutting stages harder to isolate

   Recommended: Option A (best for code review and testing)
   ============================================================
   ```

3. **User selects an option** or requests modifications.

4. **If user wants modifications**: Adjust the breakdown as requested and re-present until approved.

### Step 4: Create Stage Files

Once the user approves a stage breakdown, create the stage files using the `ticket-stage-setup` patterns.

For each approved stage:

1. **Determine the stage ID** by scanning existing stages under the ticket:

   ```bash
   # Find highest existing stage number (if any)
   ls epics/EPIC-XXX-*/TICKET-XXX-YYY-*/STAGE-XXX-YYY-*.md 2>/dev/null
   ```

   Use the next available ZZZ number (001 if no stages exist).

2. **Create the stage file** at `epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ-name.md`:

   ```yaml
   ---
   id: STAGE-XXX-YYY-ZZZ
   ticket: TICKET-XXX-YYY
   epic: EPIC-XXX
   title: [Stage Title from approved breakdown]
   status: Not Started
   session_active: false
   refinement_type:
     - [type from approved breakdown]
   depends_on: [dependencies identified in brainstorming]
   worktree_branch: epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz
   priority: 0
   due_date: null
   ---
   ## Overview
   [Description from approved breakdown]

   ## Design Phase
   - **Approaches Presented**:
   - **User Choice**:
   - **Seed Data Agreed**:
   - **Session Notes**:
   **Status**: [ ] Complete

   ## Build Phase
   - **Components Created**:
   - **API Endpoints Added**:
   - **Placeholders Added**:
   - **Session Notes**:
   **Status**: [ ] Complete

   ## Refinement Phase
   [Checklist determined by refinement_type]
   **Status**: [ ] Complete

   ## Finalize Phase
   - [ ] Code Review (pre-tests)
   - [ ] Tests Written (unit, integration, e2e)
   - [ ] Code Review (post-tests)
   - [ ] Documentation Updated
   - [ ] Committed
   - [ ] MR/PR Created (if remote mode)
   - [ ] Review Comments Addressed (if remote mode)
   **Commit Hash**:
   **MR/PR URL**:
   **CHANGELOG Entry**: [ ] Added
   **Status**: [ ] Complete
   ```

3. **Create regression.md** if it does not already exist:

   ```markdown
   # Regression Checklist - TICKET-XXX-YYY: [Ticket Title]

   Items to verify after each deployment.

   ## STAGE-XXX-YYY-001: [Stage Name]

   - [ ] [To be populated during testing phases]
   ```

4. **Create changelog directory** if it does not already exist:

   ```bash
   mkdir -p "epics/EPIC-XXX-name/TICKET-XXX-YYY-name/changelog"
   ```

### Step 5: Update Ticket Frontmatter

Update the ticket file's YAML frontmatter to list the new stages:

```yaml
---
id: TICKET-XXX-YYY
epic: EPIC-XXX
title: [Ticket Title]
status: Not Started
jira_key: [preserved]
source: [preserved]
stages:
  - STAGE-XXX-YYY-001
  - STAGE-XXX-YYY-002
  - STAGE-XXX-YYY-003
depends_on: [preserved]
---
```

The `stages` field changes from `[]` to the list of newly created stage IDs.

### Step 6: Set Dependencies

Set dependencies between stages as identified during brainstorming:

1. **Within-ticket dependencies**: Stages that must be completed before others within this ticket.

   Example: If the API stage depends on the database schema stage:
   ```yaml
   # In STAGE-XXX-YYY-002.md
   depends_on:
     - STAGE-XXX-YYY-001
   ```

2. **Cross-ticket dependencies**: If any stage depends on stages from other tickets.

   Example: If a frontend stage depends on a login API from another ticket:
   ```yaml
   # In STAGE-XXX-YYY-003.md
   depends_on:
     - STAGE-XXX-YYY-002
     - STAGE-001-001-002      # Auth API from login ticket
   ```

3. **Present final dependency map** to user for confirmation:

   ```
   Stage Dependencies:
     STAGE-XXX-YYY-001 (Data Model)     → no dependencies
     STAGE-XXX-YYY-002 (API Endpoints)  → depends on STAGE-XXX-YYY-001
     STAGE-XXX-YYY-003 (UI Components)  → depends on STAGE-XXX-YYY-002

   Confirm? (Y/N)
   ```

### Step 7: Validate and Sync

1. **Run validation** to confirm integrity:

   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts validate
   ```

   If validation fails:
   - Report specific errors to user
   - Fix the issues (missing references, invalid IDs, etc.)
   - Re-validate until clean

2. **Sync to SQLite**:

   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts sync
   ```

3. **Present conversion summary**:

   ```
   ============================================================
   TICKET CONVERTED
   ============================================================
   Ticket:   TICKET-XXX-YYY [Ticket Title]
   Stages:   N stages created

   Stage List:
     STAGE-XXX-YYY-001: [Title] (type) - Not Started
     STAGE-XXX-YYY-002: [Title] (type) - Not Started, depends on 001
     STAGE-XXX-YYY-003: [Title] (type) - Not Started, depends on 002

   Validation: PASSED

   The ticket has been moved from "To Convert" to having
   workable stages. Run /next_task to begin working on
   the first available stage.
   ============================================================
   ```

---

## User Approval Gates Summary

This skill has TWO mandatory approval gates:

1. **Stage breakdown approval** (Step 3): User selects from brainstormer options or requests modifications
2. **Dependency approval** (Step 6): User confirms stage dependencies

Do NOT create stage files until the breakdown is approved.
Do NOT finalize until dependencies are confirmed.

---

## Error Handling

- **Ticket already has stages**: Report that the ticket already has stages and does not need conversion. Exit gracefully.
- **Ticket file not found**: Report the missing file path and suggest checking the ticket ID.
- **Epic file not found**: Report the missing epic file. The ticket can still be converted, but epic context will be limited.
- **Brainstormer fails**: Fall back to asking the user directly what stages they want. Present a simple prompt: "What stages should this ticket have? List the stage names and types."
- **Validation fails after creation**: Report errors, offer to fix or remove the created stages and retry.

## Edge Cases

- **Ticket with Jira description**: Use the Jira description as primary input for brainstorming. Include acceptance criteria if present.
- **Ticket with existing dependencies**: Preserve ticket-level `depends_on`. New stages may inherit relevant dependencies.
- **Single-stage ticket**: Valid. Some tickets only need one stage. Do not force multiple stages.
- **Ticket in an epic with other converted tickets**: Reference sibling tickets' stages when considering cross-ticket dependencies.
