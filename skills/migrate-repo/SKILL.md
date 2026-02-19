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
