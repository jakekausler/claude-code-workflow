# Stage 2C: Migration Skills

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `migrate-repo` and `convert-ticket` workflow skills for interactive migration and ticket conversion.

**Status:** Complete

**Prerequisites:** Stage 2B complete (migrate command available), Stage 1 complete (file format, CLI, all skills use new terminology)

**Architecture:** Two markdown skill files following existing skill patterns. Each lives in `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`). No TypeScript code -- these are Claude Code instruction documents.

---

### Task 1: Create `migrate-repo` skill

**Files:**
- Create directory: `skills/migrate-repo/`
- Create: `skills/migrate-repo/SKILL.md`

**Step 1: Create directory**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow
mkdir -p skills/migrate-repo
```

**Step 2: Write SKILL.md**

Create `skills/migrate-repo/SKILL.md` with the following COMPLETE content:

````markdown
---
name: migrate-repo
description: Use when migrating a repository from the old epic-stage layout (no YAML frontmatter, no ticket layer) to the new epic/ticket/stage hierarchy with YAML frontmatter.
---

# Migrate Repo - Interactive Migration

This skill handles INTERACTIVE migration of repositories using the old epic-stage layout to the new three-level epic/ticket/stage hierarchy with YAML frontmatter.

## When to Use

- Repository has old-format files: `epics/EPIC-XXX/STAGE-XXX-YYY.md` (stages directly inside epics, no ticket layer)
- Stage files lack YAML frontmatter (use markdown headers instead)
- User wants to adopt the new workflow hierarchy

## When NOT to Use

- Repository already uses the new format (three-level hierarchy with YAML frontmatter)
- Simple non-interactive migration is sufficient (use `kanban-cli migrate` CLI command instead)
- Creating a brand new project from scratch (use `ticket-stage-setup` instead)

## Key Difference from `kanban-cli migrate`

| Feature | `kanban-cli migrate` (CLI) | `migrate-repo` (This Skill) |
|---------|---------------------------|----------------------------|
| Interactivity | Non-interactive | Interactive with user approval gates |
| Ticket Grouping | One ticket per epic (simple) | Claude analyzes content to propose smart groupings |
| Dependency Inference | None | Analyzes ordering, git history, code references |
| User Input | None required | Approval at each step |

**Use `kanban-cli migrate` for**: Quick, simple migrations where one ticket per epic is acceptable.

**Use this skill for**: Thoughtful migrations where stages should be grouped into meaningful tickets with inferred dependencies.

---

## Workflow

### Phase 1: Scan and Inventory

1. Run a dry-run scan to identify old-format files:

   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts migrate --dry-run
   ```

   If the CLI is not available, manually scan:

   ```bash
   # Find old-format stage files (stages directly under epic dirs, no ticket layer)
   find epics/ -maxdepth 2 -name "STAGE-*.md" -type f 2>/dev/null
   # Find epic directories
   find epics/ -maxdepth 1 -type d -name "EPIC-*" 2>/dev/null
   ```

2. Read each discovered file to confirm it uses the old format (no YAML frontmatter, markdown headers instead).

3. Present inventory to user:

   ```
   ============================================================
   MIGRATION INVENTORY
   ============================================================
   Repository: /path/to/repo

   Epics found: N
     EPIC-001 (M stages)
     EPIC-002 (K stages)
     ...

   Total stages: X
   Format: Old (no YAML frontmatter, no ticket layer)

   Proceed with interactive migration? (Y/N)
   ============================================================
   ```

4. Wait for user confirmation before proceeding.

### Phase 2: Analyze and Propose Ticket Groupings

For EACH old epic, perform the following:

1. **Read all stage files** in the epic directory. For each stage, note:
   - Title (from filename or first heading)
   - Content summary (what the stage implements)
   - Status (from markdown headers if present, otherwise "Not Started")
   - Any references to other stages or features

2. **Analyze stages for thematic grouping**. Look for:
   - Stages that work on the same feature area (e.g., login form + login API + session management = "Login Flow")
   - Stages that share code dependencies or data models
   - Stages mentioned together in markdown links or references
   - Stages with sequential naming that suggest a natural group

3. **Propose ticket groupings** to the user:

   ```
   ============================================================
   EPIC-001: User Authentication
   ============================================================

   Proposed Ticket Groupings:

   TICKET-001-001: Login Flow
     - STAGE-001-001 (Login Form)
     - STAGE-001-002 (Auth API)
     - STAGE-001-003 (Session Management)
     Reasoning: All three stages handle the login feature end-to-end.

   TICKET-001-002: Registration
     - STAGE-001-004 (Signup Form)
     - STAGE-001-005 (Email Verification)
     Reasoning: Both stages are about new user registration.

   TICKET-001-003: Password Reset
     - STAGE-001-006 (Reset Flow)
     Reasoning: Single stage, standalone feature.

   Approve these groupings? (Y = approve, N = adjust)
   ============================================================
   ```

4. **If user wants adjustments**: Ask which stages to move between tickets, which tickets to merge or split, and re-present until approved.

5. **Repeat for each epic**.

### Phase 3: Infer Refinement Types

For each stage, analyze its content to infer `refinement_type`:

| Content Signals | Inferred Type |
|----------------|---------------|
| References to UI, components, forms, pages, CSS, HTML, React, Vue, etc. | `frontend` |
| References to API, endpoints, services, controllers, routes, REST, GraphQL | `backend` |
| References to CLI, commands, flags, arguments, terminal, scripts | `cli` |
| References to migrations, schema, SQL, tables, columns, database | `database` |
| References to deployment, CI/CD, Docker, Kubernetes, infrastructure | `infrastructure` |
| Cannot determine, or mixed signals | `custom` (prompt user) |

Present inferred types to user for confirmation:

```
Refinement Type Inference:
  STAGE-001-001-001 (Login Form)         → frontend
  STAGE-001-001-002 (Auth API)           → backend
  STAGE-001-001-003 (Session Management) → backend
  STAGE-001-002-001 (Signup Form)        → frontend

Approve these types? (Y = approve, N = adjust per stage)
```

### Phase 4: Infer Dependencies

Analyze multiple signals to infer dependencies between stages:

1. **Stage ordering**: Sequential stages within the old epic likely have dependencies (STAGE-001-001 before STAGE-001-002).

2. **Git history**: Check git log for the old stage files to see which were worked on first:

   ```bash
   git log --diff-filter=A --name-only --pretty=format:"%H %ai" -- "epics/EPIC-XXX/STAGE-*.md"
   ```

   Earlier-created stages are likely dependencies of later ones.

3. **Content references**: Look for:
   - Explicit mentions of other stage names in markdown content
   - Import statements or code references between stage outputs
   - Shared data models or APIs mentioned across stages

4. **Present inferred dependencies** to user:

   ```
   ============================================================
   INFERRED DEPENDENCIES
   ============================================================

   STAGE-001-001-002 (Auth API)
     depends_on: [STAGE-001-001-001]
     Reason: Login Form was created first; Auth API references login endpoints

   STAGE-001-001-003 (Session Management)
     depends_on: [STAGE-001-001-002]
     Reason: Sequential ordering; session management needs auth API

   STAGE-001-002-001 (Signup Form)
     depends_on: [STAGE-001-001-001]
     Reason: Registration reuses login form components

   Cross-ticket dependencies:
     TICKET-001-002 (Registration)
       depends_on: [TICKET-001-001]
       Reason: Registration builds on login infrastructure

   Approve these dependencies? (Y = approve, N = adjust)
   ============================================================
   ```

5. If user wants adjustments: Allow adding, removing, or changing individual dependencies.

### Phase 5: Execute Migration

For each approved epic and its ticket groupings:

1. **Create ticket directories and files** following the new layout:

   ```
   epics/EPIC-XXX-name/
     EPIC-XXX.md                              (create with YAML frontmatter)
     TICKET-XXX-YYY-name/
       TICKET-XXX-YYY.md                      (create with YAML frontmatter)
       STAGE-XXX-YYY-ZZZ-name.md              (move + add YAML frontmatter)
       regression.md                           (create)
       changelog/                              (create)
   ```

2. **Create epic file** with YAML frontmatter:

   ```yaml
   ---
   id: EPIC-XXX
   title: [Epic Title]
   status: [computed from stage statuses]
   jira_key: null
   tickets:
     - TICKET-XXX-001
     - TICKET-XXX-002
   depends_on: []
   ---
   ## Overview
   [Description from old epic file if exists, or generated summary]

   ## Notes
   - Migrated from old format on [date]
   ```

3. **Create ticket files** with YAML frontmatter:

   ```yaml
   ---
   id: TICKET-XXX-YYY
   epic: EPIC-XXX
   title: [Ticket Title from approved grouping]
   status: [computed from stage statuses]
   jira_key: null
   source: local
   stages:
     - STAGE-XXX-YYY-001
     - STAGE-XXX-YYY-002
   depends_on: [approved ticket-level dependencies]
   ---
   ## Overview
   [Generated description based on stage contents]

   ## Notes
   - Migrated from old format on [date]
   ```

4. **Move and update stage files**:
   - Use `git mv` to preserve history:
     ```bash
     git mv "epics/EPIC-XXX-name/STAGE-XXX-YYY.md" "epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ-name.md"
     ```
   - Add YAML frontmatter to each stage file:
     ```yaml
     ---
     id: STAGE-XXX-YYY-ZZZ
     ticket: TICKET-XXX-YYY
     epic: EPIC-XXX
     title: [Stage Title]
     status: [preserved from old file, or Not Started]
     session_active: false
     refinement_type:
       - [inferred type]
     depends_on: [approved dependencies]
     worktree_branch: epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz
     priority: 0
     due_date: null
     ---
     ```
   - Preserve existing markdown content below the frontmatter.
   - If the old file had Design/Build/Refinement/Finalize sections, keep them.
   - If not, add empty phase section templates.

5. **Create regression.md** for each ticket:

   ```markdown
   # Regression Checklist - TICKET-XXX-YYY: [Ticket Title]

   Items to verify after each deployment.

   ## STAGE-XXX-YYY-001: [Stage Name]

   - [ ] [To be populated during testing phases]
   ```

6. **Create changelog directory** for each ticket:

   ```bash
   mkdir -p "epics/EPIC-XXX-name/TICKET-XXX-YYY-name/changelog"
   ```

### Phase 6: Validate and Commit

1. **Run validation**:

   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts validate
   ```

   If validation fails, report errors to user and fix before proceeding.

2. **Sync to SQLite**:

   ```bash
   npx tsx tools/kanban-cli/src/cli/index.ts sync
   ```

3. **Present migration summary**:

   ```
   ============================================================
   MIGRATION COMPLETE
   ============================================================
   Epics migrated: N
   Tickets created: M
   Stages migrated: X
   Dependencies set: Y

   Validation: PASSED

   Ready to commit? (Y/N)
   ============================================================
   ```

4. **Commit the migration** (with specific file paths, NEVER `git add -A`):

   ```bash
   # Add all migrated files explicitly
   git add epics/EPIC-XXX-name/EPIC-XXX.md
   git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md
   git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ-name.md
   git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/regression.md
   # ... (list all files explicitly)

   git commit -m "feat: migrate to epic/ticket/stage hierarchy with YAML frontmatter"
   ```

---

## User Approval Gates Summary

This skill has FOUR mandatory approval gates:

1. **Inventory approval** (Phase 1): User confirms migration should proceed
2. **Ticket grouping approval** (Phase 2): User approves or adjusts per-epic groupings
3. **Refinement type approval** (Phase 3): User confirms inferred types
4. **Dependency approval** (Phase 4): User confirms inferred dependencies

Do NOT proceed past any gate without explicit user approval.

---

## Error Handling

- **Old file not parseable**: Report the specific file and error, ask user how to handle (skip, manual fix, abort)
- **Git mv fails**: Report error, suggest manual move, continue with remaining files
- **Validation fails after migration**: Report specific validation errors, offer to fix or rollback
- **Ambiguous stage content**: When refinement_type or grouping cannot be inferred confidently, always ask the user rather than guessing

## Edge Cases

- **Epic with single stage**: Creates a single ticket with one stage (still valid)
- **Epic with no stages**: Creates empty epic file, warns user
- **Stage already has YAML frontmatter**: Skip frontmatter addition, preserve existing
- **Mixed old/new format in same repo**: Only migrate old-format files, leave new-format files untouched
- **Stage files with non-standard names**: Report and skip, let user handle manually
````

**Step 3: Verify**

```bash
# Verify file exists
ls skills/migrate-repo/SKILL.md
# Expected: file exists

# Verify frontmatter
head -4 skills/migrate-repo/SKILL.md
# Expected: --- / name: migrate-repo / description: ... / ---

# Verify key sections exist
grep -c "When to Use" skills/migrate-repo/SKILL.md
# Expected: 1

grep -c "kanban-cli migrate" skills/migrate-repo/SKILL.md
# Expected: > 0 (references CLI command)

grep -c "kanban-cli validate" skills/migrate-repo/SKILL.md
# Expected: > 0

grep -c "ticket-stage-setup" skills/migrate-repo/SKILL.md
# Expected: > 0 (references setup skill)

grep -c "approval" skills/migrate-repo/SKILL.md
# Expected: > 0 (multiple approval gates)

grep -c "git mv" skills/migrate-repo/SKILL.md
# Expected: > 0 (preserves history)

grep -c "refinement_type" skills/migrate-repo/SKILL.md
# Expected: > 0
```

**Step 4: Commit**

```bash
git add skills/migrate-repo/SKILL.md
git commit -m "feat: add migrate-repo skill for interactive repository migration"
```

---

### Task 2: Create `convert-ticket` skill

**Files:**
- Create directory: `skills/convert-ticket/`
- Create: `skills/convert-ticket/SKILL.md`

**Step 1: Create directory**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow
mkdir -p skills/convert-ticket
```

**Step 2: Write SKILL.md**

Create `skills/convert-ticket/SKILL.md` with the following COMPLETE content:

````markdown
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

### Step 2: Brainstorm Stage Breakdown

Invoke the brainstorming process to explore what stages are needed for this ticket.

**Use the brainstormer agent (Opus)** to analyze the ticket and propose 2-3 stage breakdown options:

1. **Provide brainstormer with context**:
   - Ticket description and requirements
   - Parent epic context
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

### Step 3: Create Stage Files

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

### Step 4: Update Ticket Frontmatter

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

### Step 5: Set Dependencies

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

### Step 6: Validate and Sync

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

1. **Stage breakdown approval** (Step 2): User selects from brainstormer options or requests modifications
2. **Dependency approval** (Step 5): User confirms stage dependencies

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
````

**Step 3: Verify**

```bash
# Verify file exists
ls skills/convert-ticket/SKILL.md
# Expected: file exists

# Verify frontmatter
head -4 skills/convert-ticket/SKILL.md
# Expected: --- / name: convert-ticket / description: ... / ---

# Verify key sections
grep -c "When to Use" skills/convert-ticket/SKILL.md
# Expected: 1

grep -c "stages: \[\]" skills/convert-ticket/SKILL.md
# Expected: > 0 (references empty stages trigger)

grep -c "brainstorm" skills/convert-ticket/SKILL.md
# Expected: > 0 (brainstorming integration)

grep -c "ticket-stage-setup" skills/convert-ticket/SKILL.md
# Expected: > 0 (references setup patterns)

grep -c "kanban-cli validate" skills/convert-ticket/SKILL.md
# Expected: > 0

grep -c "kanban-cli sync" skills/convert-ticket/SKILL.md
# Expected: > 0

grep -c "refinement_type" skills/convert-ticket/SKILL.md
# Expected: > 0

grep -c "depends_on" skills/convert-ticket/SKILL.md
# Expected: > 0

grep -c "To Convert" skills/convert-ticket/SKILL.md
# Expected: > 0 (references kanban column)
```

**Step 4: Commit**

```bash
git add skills/convert-ticket/SKILL.md
git commit -m "feat: add convert-ticket skill for breaking stageless tickets into stages"
```

---

### Task 3: Update `next_task` command to remove "Stage 2" note

**Files:**
- Modify: `commands/next_task.md`

**Changes:**

In the "To Convert Handling" section of `commands/next_task.md`, the current text says:

```
Note: convert-ticket ships in Stage 2. For now, manually
      create stages using /setup stage TICKET-XXX-YYY "Stage Name".
```

Update this to:

```
Action: Run /convert-ticket TICKET-XXX-YYY to brainstorm
        and create stages for this ticket.
```

Remove the "ships in Stage 2" note since the skill now exists.

**Verify:**

```bash
grep -c "ships in Stage 2" commands/next_task.md
# Expected: 0 (note removed)

grep -c "convert-ticket" commands/next_task.md
# Expected: > 0
```

**Commit:**

```bash
git add commands/next_task.md
git commit -m "feat: update next_task to reference convert-ticket skill (no longer deferred)"
```

---

### Task 4: Cross-reference verification

**Step 1: Verify skill naming consistency**

```bash
# Both skills should reference correct CLI commands
grep "kanban-cli" skills/migrate-repo/SKILL.md skills/convert-ticket/SKILL.md
# Expected: references to validate, sync, migrate

# Both skills should reference correct other skills
grep "ticket-stage-setup\|ticket-stage-workflow" skills/migrate-repo/SKILL.md skills/convert-ticket/SKILL.md
# Expected: ticket-stage-setup referenced in both

# Verify no references to old skill names
grep -r "epic-stage-setup\|epic-stage-workflow\|phase-refinement" skills/migrate-repo/ skills/convert-ticket/
# Expected: no matches
```

**Step 2: Verify terminology consistency**

```bash
# Check that YAML frontmatter field names match the canonical templates
grep "refinement_type\|depends_on\|session_active\|worktree_branch\|jira_key" skills/migrate-repo/SKILL.md
# Expected: all present

grep "refinement_type\|depends_on\|session_active\|worktree_branch\|jira_key" skills/convert-ticket/SKILL.md
# Expected: all present (except jira_key may only be in ticket context)
```

**Step 3: Verify all skill directories exist**

```bash
ls -d skills/migrate-repo skills/convert-ticket
# Expected: both listed

ls skills/migrate-repo/SKILL.md skills/convert-ticket/SKILL.md
# Expected: both exist
```

**Step 4: Verify design doc references are satisfied**

The design document (Section 3.9 and 3.10) specifies these skills. Verify alignment:

```bash
# migrate-repo should mention: scan, inventory, grouping, dependencies, validate, commit
grep -c "Scan\|inventory\|grouping\|dependencies\|validate\|commit" skills/migrate-repo/SKILL.md
# Expected: > 0 for each concept

# convert-ticket should mention: stages:[], brainstorm, stage files, dependencies, validate
grep -c "stages: \[\]\|brainstorm\|stage files\|dependencies\|validate" skills/convert-ticket/SKILL.md
# Expected: > 0 for each concept
```

---

### Completion Checklist

| Task | Description | Status |
|------|-------------|--------|
| Task 1 | Create `skills/migrate-repo/SKILL.md` with interactive migration workflow | [x] |
| Task 2 | Create `skills/convert-ticket/SKILL.md` with stage breakdown workflow | [x] |
| Task 3 | Update `commands/next_task.md` to remove "Stage 2" deferral note | [x] |
| Task 4 | Cross-reference verification (terminology, CLI commands, skill references) | [x] |
| - | All verification grep commands pass | [x] |
| - | Each task committed incrementally | [x] |
