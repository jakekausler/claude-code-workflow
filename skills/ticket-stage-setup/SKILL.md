---
name: ticket-stage-setup
description: Use when creating new projects requiring structured phased development, bootstrapping epic/ticket/stage hierarchy, creating new epics, tickets, or stages.
---

# Ticket-Stage Setup - Bootstrapping Guide

This skill handles the CREATION of epic/ticket/stage workflow structure. For WORKING ON existing tickets and stages, see the `ticket-stage-workflow` skill.

## When to Use

- Starting a new project that will benefit from phased development with quality gates
- Converting an existing project to use epic/ticket/stage tracking
- User explicitly requests "epic workflow", "ticket workflow", "stage tracking", or "phased development"
- Creating a NEW epic, ticket, or stage within an existing project
- User asks to "create an epic", "add a ticket", or "add a stage"

## When NOT to Use

- Single-file scripts or throwaway prototypes
- Projects with fewer than 3 distinct features
- Projects where user explicitly wants ad-hoc development without tracking
- Projects already using a different structured workflow (e.g., GitHub Projects, Jira)
- **WORKING ON existing stages** - use `ticket-stage-workflow` skill instead

---

## Workflow Structure Overview

```
Epic (Initiative/Theme)
  └── Ticket (Feature/Capability)
        └── Stage (Component/Step)
              └── Phase: Design → Build → Automatic Testing → Finalize
```

### Hierarchy

- **Epic** = Initiative or theme grouping related tickets (User Authentication, Payment System, etc.)
- **Ticket** = Feature or capability to be delivered (Login Flow, Registration, Checkout, etc.)
- **Stage** = Single component or interaction within that ticket
- **Phase** = Design | Build | Automatic Testing | Finalize

Epics and tickets are containers. Stages are where work happens. Phases are the workflow within a stage.

---

## Command Syntax

```
/setup epic "Name"                          # Creates EPIC-XXX dir + file
/setup ticket EPIC-XXX "Name"              # Creates TICKET-XXX-YYY dir + file under epic
/setup stage TICKET-XXX-YYY "Name"         # Creates STAGE-XXX-YYY-ZZZ file under ticket
```

### Auto-ID Generation

When creating any entity, scan the existing `epics/` directory to determine the next available ID:

- **Epic**: Find the highest `EPIC-XXX` number, increment by 1. First epic is `EPIC-001`.
- **Ticket**: Within the specified epic, find the highest `TICKET-XXX-YYY` number, increment the YYY portion. First ticket under EPIC-001 is `TICKET-001-001`.
- **Stage**: Within the specified ticket, find the highest `STAGE-XXX-YYY-ZZZ` number, increment the ZZZ portion. First stage under TICKET-001-001 is `STAGE-001-001-001`.

Use 3-digit zero-padded numbers for all ID segments.

---

## What This Skill Sets Up

When invoked for a new project:

1. Creates `epics/` directory for the epic/ticket/stage hierarchy
2. Creates per-ticket `regression.md` files for testing checklists
3. Adds workflow documentation to project CLAUDE.md (from templates below)
4. Creates `changelog/` directory within each ticket for changelog entries

### Directory Layout

```
epics/
├── EPIC-001-user-authentication/
│   ├── EPIC-001.md
│   ├── TICKET-001-001-login-flow/
│   │   ├── TICKET-001-001.md
│   │   ├── STAGE-001-001-001-login-form.md
│   │   ├── STAGE-001-001-002-auth-api.md
│   │   ├── STAGE-001-001-003-session-mgmt.md
│   │   ├── regression.md
│   │   └── changelog/
│   ├── TICKET-001-002-registration/
│   │   ├── TICKET-001-002.md
│   │   ├── STAGE-001-002-001-signup-form.md
│   │   ├── regression.md
│   │   └── changelog/
│   └── ...
├── EPIC-002-payment-system/
│   ├── EPIC-002.md
│   ├── TICKET-002-001-checkout/
│   │   ├── TICKET-002-001.md          # no stages yet - needs conversion
│   │   └── ...
│   └── ...
└── ...
```

### Naming Conventions

| Level  | Pattern             | Example              | Directory Name Format                    |
| ------ | ------------------- | -------------------- | ---------------------------------------- |
| Epic   | `EPIC-XXX`          | `EPIC-001`           | `EPIC-XXX-kebab-case-name/`             |
| Ticket | `TICKET-XXX-YYY`    | `TICKET-001-002`     | `TICKET-XXX-YYY-kebab-case-name/`       |
| Stage  | `STAGE-XXX-YYY-ZZZ` | `STAGE-001-002-003`  | `STAGE-XXX-YYY-ZZZ-kebab-case-name.md`  |

IDs embed the hierarchy -- a stage ID is globally unique and self-describing. The epic and ticket IDs are derivable from any stage ID.

---

## After Setup

Tell user:

- Use `/next_task` to check current work
- Use `/epic-stats` to see overall progress
- Create first epic: `/setup epic "Feature Name"`

---

## Creating Epics, Tickets, and Stages

All templates are embedded below in this skill file.

### Key Rules

- Use 3-digit padding: EPIC-001, TICKET-001-001, STAGE-001-001-001
- All files use YAML frontmatter for metadata
- Status values for stages: "Not Started", "Design", "User Design Feedback", "Build", "Automatic Testing", "Manual Testing", "Finalize", "PR Created", "Addressing Comments", "Complete", "Skipped"
- Status values for epics/tickets: "Not Started", "In Progress", "Complete", "Skipped"
- `refinement_type` must be set on every stage (prompt user if not obvious)
- `worktree_branch` is auto-generated from the ID hierarchy
- Run `kanban-cli sync` after creating any files

---

## Epic File Template (EPIC-XXX.md)

```yaml
---
id: EPIC-XXX
title: [Name]
status: Not Started        # Not Started | In Progress | Complete
jira_key: null             # e.g., "PROJ-EPIC-42" if linked to Jira epic
tickets:
  - TICKET-XXX-001
  - TICKET-XXX-002
depends_on: []             # epic-level dependencies (other epics or tickets)
---
## Overview
[Description of the initiative/theme]

## Notes
- [Any relevant notes]
```

---

## Ticket File Template (TICKET-XXX-YYY.md)

```yaml
---
id: TICKET-XXX-YYY
epic: EPIC-XXX
title: [Name]
status: Not Started        # Not Started | In Progress | Complete | Skipped
jira_key: null             # e.g., "PROJ-1234" if imported from Jira
source: local              # local | jira
stages:
  - STAGE-XXX-YYY-001
  - STAGE-XXX-YYY-002
depends_on: []             # ticket-level dependencies (other tickets, epics, or stages)
---
## Overview
[Description of the feature/capability]

## Notes
- [Any relevant notes]
```

### Ticket Without Stages

When creating a ticket where stages are not yet defined, set `stages: []`. This ticket will appear in the "To Convert" kanban column and needs conversion via the brainstorming skill before work can begin.

```yaml
---
id: TICKET-XXX-YYY
epic: EPIC-XXX
title: [Name]
status: Not Started
jira_key: null
source: local
stages: []                 # empty - needs conversion via brainstorming
depends_on: []
---
## Overview
[Description]

## Notes
```

---

## Stage File Template (STAGE-XXX-YYY-ZZZ.md)

```yaml
---
id: STAGE-XXX-YYY-ZZZ
ticket: TICKET-XXX-YYY
epic: EPIC-XXX
title: [Name]
status: Not Started        # Not Started | Design | User Design Feedback |
                           # Build | Automatic Testing | Manual Testing |
                           # Finalize | PR Created | Addressing Comments |
                           # Complete | Skipped
session_active: false      # false = ready to be picked up, true = session in progress
refinement_type:
  - frontend               # frontend | backend | cli | database | infrastructure | custom
                           # accepts a list - combined checklists when multiple types
                           # setup/brainstorming skill recommends splitting when feasible
depends_on: []             # stage-level dependencies (other stages, tickets, or epics)
worktree_branch: epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz
priority: 0                # 0 = normal, 1+ = elevated (optional)
due_date: null             # ISO date if deadline exists (optional)
---
## Overview
[What this stage implements]

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
[Checklist determined by refinement_type - see Refinement Checklists section]
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

### Setting refinement_type

When creating a stage, prompt the user for the refinement type or infer from context:

| Type             | When to Use                                           |
| ---------------- | ----------------------------------------------------- |
| `frontend`       | UI components, visual elements, user-facing pages     |
| `backend`        | API endpoints, server logic, services                 |
| `cli`            | Command-line tools, scripts, CLI interfaces           |
| `database`       | Migrations, schema changes, data transformations      |
| `infrastructure` | Deployment configs, CI/CD, environment setup          |
| `custom`         | Anything else - user defines approvals during Design  |

Multiple types can be listed (e.g., `[frontend, backend]`). When multiple types are specified, all checklists are combined. Recommend splitting into separate stages when feasible.

### Auto-generating worktree_branch

The `worktree_branch` field is auto-generated from the ID hierarchy using lowercase:

```
epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz
```

Example: For STAGE-001-002-003, the branch would be:

```
epic-001/ticket-001-002/stage-001-002-003
```

---

## Refinement Checklists by Type

The `refinement_type` frontmatter field determines which approval checklist the testing phase enforces.

**Frontend (`refinement_type: [frontend]`)**:
```markdown
## Refinement Phase
- [ ] Desktop Approved
- [ ] Mobile Approved
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

**Backend (`refinement_type: [backend]`)**:
```markdown
## Refinement Phase
- [ ] E2E Tests Approved
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

**CLI (`refinement_type: [cli]`)**:
```markdown
## Refinement Phase
- [ ] CLI Behavior Approved
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

**Database (`refinement_type: [database]`)**:
```markdown
## Refinement Phase
- [ ] Migration Verified
- [ ] Data Integrity Approved
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

**Infrastructure (`refinement_type: [infrastructure]`)**:
```markdown
## Refinement Phase
- [ ] Deployment Verified
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

**Custom (`refinement_type: [custom]`)**:
```markdown
## Refinement Phase
- [ ] [User defines approvals during Design phase]
- [ ] Regression Items Added
- **Feedback Round 1**:
- **Feedback Round 2**:
**Status**: [ ] Complete
```

When multiple types are listed, all checklists are combined (all approvals required). ANY code change during the testing phase resets ALL approvals for ALL refinement types on that stage. No exceptions.

---

## Dependency Rules

Dependencies can be set at any level:

| Dependency Type                   | Example                                                 | Supported |
| --------------------------------- | ------------------------------------------------------- | --------- |
| Stage -> Stage (same ticket)      | `STAGE-001-001-002` depends on `STAGE-001-001-001`     | Yes       |
| Stage -> Stage (cross-ticket)     | `STAGE-001-002-001` depends on `STAGE-001-001-003`     | Yes       |
| Stage -> Stage (cross-epic)       | `STAGE-002-001-001` depends on `STAGE-001-001-003`     | Yes       |
| Stage -> Ticket                   | `STAGE-002-001-001` depends on `TICKET-001-001`        | Yes       |
| Stage -> Epic                     | `STAGE-002-001-001` depends on `EPIC-001`              | Yes       |
| Ticket -> Ticket                  | `TICKET-002-001` depends on `TICKET-001-001`           | Yes       |
| Ticket -> Epic                    | `TICKET-002-001` depends on `EPIC-001`                 | Yes       |
| Epic -> Epic                      | `EPIC-002` depends on `EPIC-001`                       | Yes       |

Dependencies default to empty (`depends_on: []`). Users populate them as needed. A dependency on a ticket or epic is satisfied when that container's status is `Complete`.

---

## kanban-cli Integration

After creating any epic, ticket, or stage files, run:

```bash
kanban-cli sync
```

This re-parses all tracking files into the SQLite cache so the kanban board reflects the new entities.

For creating a single stage, you can use the targeted sync:

```bash
kanban-cli sync --stage STAGE-XXX-YYY-ZZZ
```

---

## CLAUDE.md Sections Template

Add these sections to a project's CLAUDE.md when bootstrapping:

### Development Workflow Section

```markdown
## Development Workflow

### Hierarchy

- **Epic** = Initiative or theme (User Authentication, Payment System, etc.)
- **Ticket** = Feature or capability within an epic (Login Flow, Registration, etc.)
- **Stage** = Single component or interaction within a ticket
- **Phase** = Design | Build | Automatic Testing | Finalize

### Phase Cycle Per Stage

Each stage goes through phases, typically each in a separate session:

1. DESIGN PHASE - Present options, user picks, confirm seed data
2. BUILD PHASE - Implement, add seed data, add placeholders
3. AUTOMATIC TESTING PHASE - Type-specific approval (frontend: Desktop+Mobile, backend: E2E, etc.)
4. FINALIZE PHASE - Tests, review, docs, commit (all via subagents)
```

### Commands Section

```markdown
## Commands

| Command              | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `/next_task`         | Find next work by scanning epic/ticket/stage hierarchy |
| `/epic-stats`        | Calculate progress across epics                        |
| `/setup epic`        | Create a new epic                                      |
| `/setup ticket`      | Create a new ticket under an epic                      |
| `/setup stage`       | Create a new stage under a ticket                      |
```

### Stage Tracking Section

```markdown
## Stage Tracking Documents

### Location

epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ-name.md

### Status Values

- `Not Started` - Work not yet begun
- `Design` - In design phase
- `User Design Feedback` - Awaiting user design decision
- `Build` - In build phase
- `Automatic Testing` - In automatic testing phase
- `Manual Testing` - In manual testing phase
- `Finalize` - In finalize phase
- `PR Created` - MR/PR created, awaiting review
- `Addressing Comments` - Addressing review comments
- `Complete` - All phases done
- `Skipped` - Intentionally skipped
```

---

## Regression Checklist Template

Create per-ticket regression files at `epics/EPIC-XXX-name/TICKET-XXX-YYY-name/regression.md`:

```markdown
# Regression Checklist - TICKET-XXX-YYY: [Name]

Items to verify after each deployment. Format varies by refinement_type.

## STAGE-XXX-YYY-001: [Stage Name]

- [ ] Description of item to check

## STAGE-XXX-YYY-002: [Stage Name]

- [ ] Description of item to check
```

---

## Changelog Pattern

Agents write entries to date-based files in ticket-level `changelog/` directories:

**CRITICAL: Getting the date - NEVER estimate or hardcode dates:**
```bash
# Get today's date for the changelog filename
TODAY=$(date +%Y-%m-%d)
# Example output: 2026-01-14
```

**File pattern**: `epics/EPIC-XXX-name/TICKET-XXX-YYY-name/changelog/$TODAY.changelog.md`

**Entry format**:

```
## [STAGE-XXX-YYY-ZZZ] Stage Name

- Description of what was done
- Commit: `<hash>`
```

**Rules**:

- Multiple entries on same day - PREPEND to same file (newest at top)
- Always include commit hash after committing
- User runs consolidation script to create CHANGELOG.md

---
