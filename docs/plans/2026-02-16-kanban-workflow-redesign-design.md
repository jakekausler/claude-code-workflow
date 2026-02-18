# Kanban Workflow Redesign — Design Document

**Date**: 2026-02-16
**Status**: Approved
**Approach**: Incremental Migration (Approach A)

## Table of Contents

1. [Hierarchy, File Structure & Frontmatter](#1-hierarchy-file-structure--frontmatter)
2. [CLI Script & Dependency Graph](#2-cli-script--dependency-graph)
3. [Workflow Skill Changes](#3-workflow-skill-changes)
4. [Delivery Staging](#4-delivery-staging)
5. [Open Questions & Deferred Decisions](#5-open-questions--deferred-decisions)
6. [Modularity & Pipeline Configuration](#6-modularity--pipeline-configuration)

---

## 1. Hierarchy, File Structure & Frontmatter

### 1.1 Hierarchy

```
Epic (collection of related tickets — a theme or initiative)
  └── Ticket (a feature/capability — formerly "epic")
        └── Stage (a component/step of the ticket)
              └── Phase (Design → Build → Refinement → Finalize)
```

Epics and tickets are containers. Stages are where work happens. Phases are the workflow within a stage.

### 1.2 Valid States

- **Epic with tickets**: Normal case. Epic status computed from children.
- **Ticket with stages**: Normal case. Ticket status computed from children.
- **Ticket without stages**: Valid. Sits in kanban as "To Convert" (Jira import) or "Ready for Work" (user-created). Must have stages created before work begins — triggers brainstorming skill for stage breakdown.
- **Jira-imported ticket**: Pulled via Jira skill/MCP (environment-dependent — if no Jira connection exists on the system, Jira integration is not available). Lands in "To Convert" column. Carries `jira_key` in frontmatter for later MR/PR linking.

### 1.3 Directory Layout

```
epics/
  EPIC-001-user-authentication/
    EPIC-001.md
    TICKET-001-001-login-flow/
      TICKET-001-001.md
      STAGE-001-001-001-login-form.md
      STAGE-001-001-002-auth-api.md
      STAGE-001-001-003-session-mgmt.md
      regression.md
      changelog/
    TICKET-001-002-registration/
      TICKET-001-002.md
      STAGE-001-002-001-signup-form.md
      ...
  EPIC-002-payment-system/
    EPIC-002.md
    TICKET-002-001-checkout/
      TICKET-002-001.md          # no stages yet — needs conversion
      ...
```

### 1.4 Naming Convention

| Level | Pattern | Example |
|-------|---------|---------|
| Epic | `EPIC-XXX` | `EPIC-001` |
| Ticket | `TICKET-XXX-YYY` | `TICKET-001-002` |
| Stage | `STAGE-XXX-YYY-ZZZ` | `STAGE-001-002-003` |

IDs embed the hierarchy — a stage ID is globally unique and self-describing. The epic and ticket IDs are derivable from any stage ID.

### 1.5 YAML Frontmatter Templates

#### Epic File (`EPIC-001.md`)

```yaml
---
id: EPIC-001
title: User Authentication
status: In Progress        # Not Started | In Progress | Complete
jira_key: null             # e.g., "PROJ-EPIC-42" if linked to Jira epic (read-only link, no auto transitions)
tickets:
  - TICKET-001-001
  - TICKET-001-002
depends_on: []             # epic-level dependencies (other epics or tickets)
---
## Overview
[Description of the initiative/theme]

## Notes
```

#### Ticket File (`TICKET-001-001.md`)

```yaml
---
id: TICKET-001-001
epic: EPIC-001
title: Login Flow
status: In Progress        # Not Started | In Progress | Complete | Skipped
jira_key: null             # e.g., "PROJ-1234" if imported from Jira
source: local              # local | jira
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
  - STAGE-001-001-003
depends_on: []             # ticket-level dependencies (other tickets, epics, or stages)
---
## Overview
[Description of the feature/capability]

## Notes
```

#### Ticket Without Stages (`TICKET-002-001.md`)

```yaml
---
id: TICKET-002-001
epic: EPIC-002
title: Checkout Flow
status: Not Started
jira_key: PROJ-5678
source: jira
stages: []                 # empty — needs conversion via brainstorming
depends_on:
  - TICKET-001-001         # depends on login flow ticket
---
## Overview
[Jira ticket description pulled during import]

## Notes
```

#### Stage File (`STAGE-001-001-001.md`)

```yaml
---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form
status: Not Started        # Not Started | Design | User Design Feedback |
                           # Build | Automatic Testing | Manual Testing |
                           # Finalize | PR Created | Addressing Comments |
                           # Complete | Skipped
session_active: false      # false = ready to be picked up, true = session in progress
refinement_type:
  - frontend               # frontend | backend | cli | database | infrastructure | custom
                            # accepts a list — combined checklists when multiple types
                            # setup/brainstorming skill recommends splitting when feasible
depends_on:
  - STAGE-001-001-002                        # same ticket
  - STAGE-001-002-001                        # cross-ticket, same epic
  - STAGE-002-001-001                        # cross-epic
  # cross-repo (stage 8):
  # - repo:other-project/STAGE-002-001-001
worktree_branch: epic-001/ticket-001-001/stage-001-001-001
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
[Checklist determined by refinement_type — see Section 1.6]
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

### 1.6 Refinement Checklists by Type

The `refinement_type` frontmatter field determines which approval checklist the `phase-refinement` skill enforces. When multiple types are listed, all checklists are combined (all approvals required).

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

The viewport/approval reset rule generalizes: ANY code change during refinement resets ALL approvals for ALL refinement types on that stage. No exceptions.

### 1.7 Dependency Rules

| Dependency Type | Example | Supported |
|----------------|---------|-----------|
| Stage → Stage (same ticket) | `STAGE-001-001-002` depends on `STAGE-001-001-001` | Yes (stage 1) |
| Stage → Stage (cross-ticket) | `STAGE-001-002-001` depends on `STAGE-001-001-003` | Yes (stage 1) |
| Stage → Stage (cross-epic) | `STAGE-002-001-001` depends on `STAGE-001-001-003` | Yes (stage 1) |
| Stage → Ticket | `STAGE-002-001-001` depends on `TICKET-001-001` | Yes (stage 1) — resolved when all stages in ticket complete |
| Stage → Epic | `STAGE-002-001-001` depends on `EPIC-001` | Yes (stage 1) — resolved when all tickets in epic complete |
| Ticket → Ticket | `TICKET-002-001` depends on `TICKET-001-001` | Yes (stage 1) |
| Ticket → Epic | `TICKET-002-001` depends on `EPIC-001` | Yes (stage 1) |
| Epic → Epic | `EPIC-002` depends on `EPIC-001` | Yes (stage 1) |
| Any → cross-repo | `repo:other-project/STAGE-XXX-YYY-ZZZ` | Stage 8 (global CLI) |

**Resolution logic**: A dependency on a ticket or epic is satisfied when that container's status is `Complete`. A dependency on a stage is satisfied when that stage's status is `Complete`.

### 1.8 Kanban Column Mapping

Kanban columns are divided into **system columns** (structural, always present) and **pipeline columns** (defined in the workflow config). System columns are engine-driven; pipeline columns map to skills or resolvers.

**System Columns** (non-configurable):

| Kanban Column | Source | Condition |
|--------------|--------|-----------|
| **To Convert** | System | Ticket with `stages: []` (needs brainstorming) |
| **Backlog** | System | Stage with unresolved `depends_on` |
| **Ready for Work** | System | Stage with `status: Not Started` and all dependencies resolved |
| **Done** | System | Stage with `status: Complete` |

**Pipeline Columns** (configurable via workflow config):

| Kanban Column | Type | Skill/Resolver |
|--------------|------|----------------|
| **Design** | Skill | `phase-design` |
| **User Design Feedback** | Skill | `user-design-feedback` |
| **Build** | Skill | `phase-build` |
| **Automatic Testing** | Skill | `automatic-testing` |
| **Manual Testing** | Skill | `manual-testing` |
| **Finalize** | Skill | `phase-finalize` |
| **PR Created** | Resolver | `pr-status` |
| **Addressing Comments** | Skill | `review-cycle` |

**Column renames from original design:**

| Old Name | New Name |
|----------|----------|
| Awaiting Design Decision | User Design Feedback |
| Refinement | Automatic Testing |
| Awaiting Refinement | Manual Testing |
| Awaiting Merge | PR Created |

Each pipeline column has two internal states: **Ready** (`session_active: false`) and **In Progress** (`session_active: true`). The orchestration loop only picks up stages in Ready state. See [Section 6: Modularity & Pipeline Configuration](#6-modularity--pipeline-configuration) for full details.

"To Convert" is a ticket-level column (not stage-level). All other columns are stage-level. The CLI outputs both in the JSON. Pipeline columns are read from the workflow config file — see Section 6.

---

## 2. CLI Script & Dependency Graph

### 2.1 Overview

A TypeScript CLI tool (`kanban-cli`) that parses YAML frontmatter from all epic/ticket/stage files, maintains a global SQLite cache, builds a dependency graph, computes kanban column assignments, and outputs structured JSON.

### 2.2 Commands

```
kanban-cli board [options]       # Output kanban board as JSON
kanban-cli graph [options]       # Output dependency graph as JSON
kanban-cli next [options]        # Output next workable stages (priority-sorted)
kanban-cli summary <id> [options] # Summarize what happened for a stage/ticket/epic
kanban-cli validate              # Validate all frontmatter and dependency integrity
kanban-cli validate-pipeline     # Validate workflow pipeline config (4-layer audit)
kanban-cli migrate               # Migrate old epic-stage layout to new format
kanban-cli sync [options]        # Force re-parse of files into SQLite
```

### 2.3 `kanban-cli board`

Scans the `epics/` directory (or reads from SQLite cache), resolves dependencies, and outputs:

```json
{
  "generated_at": "2026-02-16T14:30:00Z",
  "repo": "/storage/programs/my-project",
  "columns": {
    "to_convert": [
      {
        "type": "ticket",
        "id": "TICKET-002-001",
        "epic": "EPIC-002",
        "title": "Checkout Flow",
        "jira_key": "PROJ-5678",
        "source": "jira"
      }
    ],
    "backlog": [
      {
        "type": "stage",
        "id": "STAGE-002-001-001",
        "ticket": "TICKET-002-001",
        "epic": "EPIC-002",
        "title": "Payment Form",
        "blocked_by": ["TICKET-001-001"],
        "blocked_by_resolved": false
      }
    ],
    "ready_for_work": [],
    "design": [],
    "awaiting_design_decision": [],
    "build": [],
    "refinement": [],
    "awaiting_refinement": [],
    "finalize": [],
    "awaiting_merge": [],
    "done": []
  },
  "stats": {
    "total_stages": 12,
    "total_tickets": 4,
    "by_column": {
      "backlog": 3,
      "ready_for_work": 2,
      "design": 1,
      "build": 1,
      "done": 5
    }
  }
}
```

**Filters** (combinable):
```
--epic EPIC-001              # Filter to one epic
--ticket TICKET-001-001      # Filter to one ticket
--column ready_for_work      # Filter to one column
--exclude-done               # Omit completed stages
--repo /path/to/repo         # Filter to specific repo (global mode)
```

### 2.4 `kanban-cli graph`

Outputs the full dependency graph:

```json
{
  "nodes": [
    {
      "id": "STAGE-001-001-001",
      "type": "stage",
      "status": "Complete",
      "title": "Login Form"
    },
    {
      "id": "TICKET-001-001",
      "type": "ticket",
      "status": "In Progress",
      "title": "Login Flow"
    },
    {
      "id": "EPIC-001",
      "type": "epic",
      "status": "In Progress",
      "title": "User Authentication"
    }
  ],
  "edges": [
    {
      "from": "STAGE-001-001-002",
      "to": "STAGE-001-001-001",
      "type": "depends_on",
      "resolved": true
    },
    {
      "from": "STAGE-002-001-001",
      "to": "TICKET-001-001",
      "type": "depends_on",
      "resolved": false
    }
  ],
  "cycles": [],
  "critical_path": [
    "STAGE-001-001-001",
    "STAGE-001-001-002",
    "STAGE-001-001-003"
  ]
}
```

**Key features**:
- **Cycle detection**: Reports circular dependencies as errors in the `cycles` array.
- **Critical path**: The longest chain of unresolved dependencies — shows what's blocking the most work.
- **Resolution status**: Each edge reports whether the dependency is satisfied.

### 2.5 `kanban-cli next`

Returns stages ready to be worked on, sorted by priority:

```
kanban-cli next --max 3
```

```json
{
  "ready_stages": [
    {
      "id": "STAGE-001-002-001",
      "ticket": "TICKET-001-002",
      "epic": "EPIC-001",
      "title": "Signup Form",
      "worktree_branch": "epic-001/ticket-001-002/stage-001-002-001",
      "refinement_type": ["frontend"],
      "priority_score": 85,
      "priority_reason": "review_comments_pending",
      "needs_human": false
    }
  ],
  "blocked_count": 4,
  "in_progress_count": 2,
  "to_convert_count": 1
}
```

**Priority order** (highest first):
1. **Review comments to address** — stages in `Awaiting Merge` with unresolved MR/PR comments
2. **Awaiting Refinement** — stages needing user approval (block quickly, address first)
3. **Refinement ready** — stages that just finished Build
4. **Build ready** — stages with approved designs, ready for implementation
5. **Design ready** — stages in Ready for Work, no design yet
6. **Explicit priority** — `priority` field in stage frontmatter (0 = normal, higher = more urgent)
7. **Due date** — stages with `due_date` approaching

Stages requiring human input are returned with `needs_human: true` so the orchestration loop can park them and move to the next item.

This is what the external orchestration loop (delivery stage 6) will call to pick up work.

### 2.6 `kanban-cli summary`

Extracts a human-readable summary from tracking files:

```
kanban-cli summary STAGE-001-001-001    # Single stage
kanban-cli summary TICKET-001-001       # All stages in ticket
kanban-cli summary EPIC-001             # All tickets and stages in epic
kanban-cli summary STAGE-001-001-001 TICKET-001-002  # Specific set
```

```json
{
  "items": [
    {
      "id": "STAGE-001-001-001",
      "title": "Login Form",
      "status": "Complete",
      "design_decision": "React Hook Form with Zod validation, modal-based login",
      "what_was_built": "Login modal component with email/password fields, validation, error handling",
      "issues_encountered": "Session token refresh race condition in concurrent requests",
      "commit_hash": "abc1234",
      "mr_pr_url": null
    }
  ]
}
```

The summary parses session notes, user choices, and feedback rounds from each phase section of the stage files. Claude can also be asked to generate richer summaries by reading the files directly — the CLI provides the structured extraction.

### 2.7 `kanban-cli validate`

Checks integrity of all tracking files:

- All `depends_on` references point to existing IDs
- No circular dependencies
- Ticket `stages` arrays match actual stage files on disk
- Epic `tickets` arrays match actual ticket directories on disk
- All required frontmatter fields present
- Status values are valid
- `worktree_branch` values are unique across all stages
- Cross-entity dependency types are valid (stage can depend on epic/ticket/stage; epic can depend on epic; ticket can depend on ticket/epic)

Output:

```json
{
  "valid": false,
  "errors": [
    {
      "file": "epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md",
      "field": "depends_on",
      "error": "Reference STAGE-001-001-099 does not exist"
    }
  ],
  "warnings": [
    {
      "file": "epics/EPIC-002/TICKET-002-001/TICKET-002-001.md",
      "field": "stages",
      "warning": "Ticket has no stages — needs conversion"
    }
  ]
}
```

### 2.8 `kanban-cli sync`

Forces a full re-parse of all tracking files into the global SQLite database:

```
kanban-cli sync                              # Sync current repo
kanban-cli sync --stage STAGE-001-001-001    # Sync single stage (fast)
kanban-cli sync --all                        # Sync all registered repos (stage 8)
```

### 2.9 SQLite Cache Layer

A global SQLite database at `~/.config/kanban-workflow/kanban.db` serves as a cache/index for fast queries. Files remain the source of truth.

**Schema**:

```sql
-- Repos registered in the system
repos (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL
)

-- Epics (denormalized from files)
epics (
  id TEXT PRIMARY KEY,          -- EPIC-001
  repo_id INTEGER REFERENCES repos,
  title TEXT,
  status TEXT,
  jira_key TEXT,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)

-- Tickets
tickets (
  id TEXT PRIMARY KEY,          -- TICKET-001-001
  epic_id TEXT REFERENCES epics,
  repo_id INTEGER REFERENCES repos,
  title TEXT,
  status TEXT,
  jira_key TEXT,
  source TEXT,                  -- local | jira
  has_stages BOOLEAN,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)

-- Stages
stages (
  id TEXT PRIMARY KEY,          -- STAGE-001-001-001
  ticket_id TEXT REFERENCES tickets,
  epic_id TEXT REFERENCES epics,
  repo_id INTEGER REFERENCES repos,
  title TEXT,
  status TEXT,
  kanban_column TEXT,           -- computed: backlog, ready_for_work, etc.
  refinement_type TEXT,         -- JSON array
  worktree_branch TEXT,
  priority INTEGER DEFAULT 0,
  due_date TEXT,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)

-- Dependencies (all levels)
dependencies (
  id INTEGER PRIMARY KEY,
  from_id TEXT NOT NULL,        -- the item that depends
  to_id TEXT NOT NULL,          -- the item depended upon
  from_type TEXT NOT NULL,      -- epic | ticket | stage
  to_type TEXT NOT NULL,
  resolved BOOLEAN DEFAULT 0,
  repo_id INTEGER REFERENCES repos
)
```

**Sync behavior**:
- `kanban-cli board` reads from SQLite first, falls back to file parse if stale.
- `kanban-cli sync` forces a full re-parse of files → SQLite.
- Any write operation (status change, dependency update) writes to file first, then updates SQLite.
- `last_synced` timestamp compared to file mtime to detect staleness.
- Phase skills call `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` after updating a stage file.

### 2.10 Technical Implementation

- **Frontmatter parsing**: `gray-matter` npm package.
- **Dependency graph**: Adjacency list built from `depends_on` fields. Topological sort for cycle detection and critical path. Standard graph algorithms — no external graph library needed for the data sizes involved.
- **File discovery**: Glob `epics/**/EPIC-*.md`, `epics/**/TICKET-*.md`, `epics/**/STAGE-*.md`.
- **Database**: `better-sqlite3` for synchronous SQLite access (simpler than async for a CLI tool).
- **Output**: JSON to stdout. All commands support `--pretty` for formatted output.
- **Location**: Lives in the `claude-code-workflow` repo as a `tools/kanban-cli/` directory with its own `package.json`. Installed globally via `npm link` or added to PATH.

---

## 3. Workflow Skill Changes

### 3.1 Terminology Rename (All Skills)

Global find-and-replace across all skill files, commands, agents, and examples:

| Old Term | New Term | Context |
|----------|----------|---------|
| `epic` (as the work unit) | `ticket` | File references, instructions, frontmatter field names |
| `EPIC-XXX` (as the work unit ID) | `TICKET-XXX-YYY` | ID patterns in templates and examples |
| `epic-stage-workflow` | `ticket-stage-workflow` | Skill name, file references |
| `epic-stage-setup` | `ticket-stage-setup` | Skill name, file references |

The word "epic" is then reintroduced as the container above tickets. Every skill that references the hierarchy needs to be aware of three levels now, not two.

**Affected files**: All 9 skills, 3 commands, 16 agents, examples directory, both CLAUDE.md files, README.md.

### 3.2 `ticket-stage-setup` (formerly `epic-stage-setup`)

**Changes**:
- Creates the new nested directory structure (epic dir > ticket dir > stage files).
- YAML frontmatter in all templates instead of plain markdown headers.
- `refinement_type` field on stages (prompts user or infers from context).
- `worktree_branch` auto-generated from the ID hierarchy.
- `jira_key` and `source` fields on tickets.
- `depends_on` fields at all levels (empty by default, user populates).
- When creating a ticket without stages, sets `stages: []` and notes it needs conversion.

**New capability**: Creating epics. The old skill only created epics (now tickets) and stages. Now it also creates the epic container:
```
/setup epic "User Authentication"           # Creates EPIC-XXX dir and file
/setup ticket EPIC-001 "Login Flow"         # Creates ticket under epic
/setup stage TICKET-001-001 "Login Form"    # Creates stage under ticket
```

### 3.3 `ticket-stage-workflow` (formerly `epic-stage-workflow`)

**Changes**:
- All terminology updates (epic → ticket, new epic layer references).
- Phase routing unchanged — phases still operate on stages.
- New awareness of `refinement_type` — passes it to phase-refinement.
- New awareness of remote mode (`WORKFLOW_REMOTE_MODE` env var).
- New awareness of auto-design (`WORKFLOW_AUTO_DESIGN` env var).

**New environment variables the workflow reads**:

| Env Var | Values | Default | Effect |
|---------|--------|---------|--------|
| `WORKFLOW_REMOTE_MODE` | `true`/`false` | `false` | Finalize pushes to remote branch + creates MR/PR instead of merging to main |
| `WORKFLOW_AUTO_DESIGN` | `true`/`false` | `false` | Design phase accepts recommended approach without prompting user |
| `WORKFLOW_MAX_PARALLEL` | integer | `1` | Max parallel stages for the orchestration loop |
| `WORKFLOW_GIT_PLATFORM` | `github`/`gitlab` | auto-detected | Which platform for MR/PR creation |
| `WORKFLOW_SLACK_WEBHOOK` | URL | unset | Webhook for MR/PR notifications (stretch goal) |
| `WORKFLOW_LEARNINGS_THRESHOLD` | integer | `10` | Auto-analyze learnings when unanalyzed count exceeds this |
| `WORKFLOW_JIRA_CONFIRM` | `true`/`false` | `false` | Prompt before Jira transitions instead of auto-transitioning |

### 3.4 `phase-design`

**Changes**:
- Reads `WORKFLOW_AUTO_DESIGN` env var. When `true`, the brainstormer still runs and presents approaches, but instead of waiting for user selection, it proceeds with its recommended option. The recommendation and reasoning are logged in the stage file's Design Phase section.
- When a ticket has `stages: []` (needs conversion), Design phase begins with the brainstorming skill to break the ticket into stages. This creates the stage files, then proceeds with the first stage's Design phase.
- Terminology updates throughout.

### 3.5 `phase-build`

**Changes**:
- Terminology updates.
- Worktree awareness: before implementation begins, ensures the stage's worktree exists and is checked out to the correct branch. Uses `git worktree add` with the `worktree_branch` from frontmatter.
- Spec files continue to use `/tmp/spec-*` pattern — no change needed.

### 3.6 `phase-refinement`

**Changes**:
- Reads `refinement_type` from stage frontmatter instead of assuming frontend.
- Loads the appropriate checklist based on type(s):
  - `frontend`: Desktop + Mobile approval (existing behavior)
  - `backend`: E2E test approval
  - `cli`: CLI behavior approval
  - `database`: Migration + data integrity approval
  - `infrastructure`: Deployment verification
  - `custom`: User-defined approvals from Design phase
- Combined checklists for multi-type stages (all approvals required).
- The viewport reset rule generalizes: ANY code change resets ALL approvals for ALL refinement types on that stage. No exceptions.
- Terminology updates.

### 3.7 `phase-finalize`

**Significant changes** — this phase has the most new behavior:

**Local mode** (default, `WORKFLOW_REMOTE_MODE=false`):
- Unchanged from current behavior. Merges to main, commits directly.

**Remote mode** (`WORKFLOW_REMOTE_MODE=true`):
1. Code review (pre-tests) — same as current.
2. Implement review suggestions — same.
3. Tests — same.
4. Code review (post-tests) — same.
5. Documentation — same.
6. Changelog — same.
7. **NEW**: Create implementation commit on the worktree branch (not main).
8. **NEW**: Push branch to remote (`git push -u origin <worktree_branch>`).
9. **NEW**: Create MR/PR via `gh pr create` or `glab mr create`:
   - Title: Stage title.
   - Description: Summary of what was built, design decisions, test results. Must be detailed and descriptive.
   - If `jira_key` is set on the ticket: include Jira link in description (e.g., `Closes PROJ-1234` or link format per Jira integration).
   - If `jira_key` is set on the epic: reference the Jira epic in description.
   - Labels/tags as appropriate.
10. **NEW**: Set stage status to `Awaiting Merge`.
11. **NEW**: If `WORKFLOW_SLACK_WEBHOOK` is set, POST notification with MR/PR URL.
12. **NEW**: Jira transition — if ticket has `jira_key`, move to "In Review" / "In Testing" on Jira (auto unless `WORKFLOW_JIRA_CONFIRM=true`).

**Stage status after finalize**:
- Local mode: `Complete`
- Remote mode: `Awaiting Merge`

### 3.8 New Skill: `review-cycle`

Handles the push → review → address → push cycle for MR/PR code review:

**Trigger**: Stage is in `Awaiting Merge` and has review comments to address.

**Workflow**:
1. Fetch comments from MR/PR via `gh pr view --comments` or `glab mr notes list`.
2. Parse comments into actionable items vs. discussions.
3. For each actionable comment:
   - Ensure worktree is active for this stage.
   - Delegate to fixer/scribe to address the comment.
   - Run verification (tests, lint).
4. Push updated branch.
5. Post reply comments on the MR/PR noting what was addressed.
6. If all comments addressed: notify user that MR is ready for re-review.
7. Repeat if new round of comments comes in.

**Entry**: Invoked manually (`/review-cycle STAGE-001-001-001`) or detected by the orchestration loop when it sees an `Awaiting Merge` stage with unresolved comments.

### 3.9 New Skill: `convert-ticket`

Handles the "ticket without stages" → "ticket with stages" conversion:

**Trigger**: Ticket has `stages: []`.

**Workflow**:
1. Read the ticket file (description, Jira details if any).
2. Invoke brainstorming skill to explore what stages are needed.
3. User approves the stage breakdown.
4. Create stage files via `ticket-stage-setup`.
5. Update ticket frontmatter with the new stage list.
6. Set dependencies between stages as identified during brainstorming.
7. Run `kanban-cli validate` to confirm integrity.

### 3.10 New Skill: `migrate-repo`

Converts repos using the old epic-stage layout to the new format:

**Workflow**:
1. Scan for old-format files (`epics/EPIC-XXX/STAGE-XXX-YYY.md` without YAML frontmatter, without ticket layer).
2. Present inventory to user: N epics found, M stages found.
3. For each old epic:
   - Analyze its stages for thematic grouping (which stages are related?).
   - Propose ticket groupings: "These 3 stages look like they're about login, these 2 about registration."
   - User approves or adjusts groupings.
4. For each approved grouping:
   - Create ticket directory and file with YAML frontmatter.
   - Move stage files into ticket directory.
   - Add YAML frontmatter to stage files (parse existing markdown headers into frontmatter fields).
   - Infer `refinement_type` from stage content (if it mentions UI/components → frontend, if API/endpoints → backend, etc.).
5. Infer dependencies:
   - Analyze stage ordering (sequential stages in old format likely have dependencies).
   - Look at git history for which stages were worked on in what order.
   - Look at code imports/references between stage outputs.
   - Present inferred dependencies to user for approval.
6. Create epic-level file wrapping the tickets.
7. Run `kanban-cli validate`.
8. Commit the migration.

### 3.11 `next_task` Command

**Changes**:
- Now calls `kanban-cli next --max 1` internally to find the next workable stage.
- If a ticket needs conversion (`stages: []`), returns that ticket with instructions to run `convert-ticket`.
- Task card updated with new terminology:

```
═══════════════════════════════════════════════════════════
NEXT TASK
═══════════════════════════════════════════════════════════
Epic:     EPIC-001 [User Authentication]
Ticket:   TICKET-001-001 [Login Flow]
Stage:    STAGE-001-001-001 [Login Form]
Phase:    Design
Type:     frontend

Instructions:
[Phase-specific instructions]

Dependencies: All resolved
Worktree:     epic-001/ticket-001-001/stage-001-001-001
═══════════════════════════════════════════════════════════
```

### 3.12 `lessons-learned` and `journal`

**Changes**:
- Terminology updates only (epic → ticket in metadata fields, add epic field).
- Metadata now includes: `repository`, `epic`, `ticket`, `stage`, `phase`.

### 3.13 `meta-insights`

**Changes**:
- Terminology updates.
- New trigger: auto-invoked when unanalyzed learnings count exceeds `WORKFLOW_LEARNINGS_THRESHOLD`. Checked at the end of each phase (after lessons-learned runs). If threshold exceeded, meta-insights runs automatically instead of waiting for manual `/analyze_learnings`.

### 3.14 Jira Bidirectional Sync

When Jira integration is available (Jira skill/MCP present on the system), the workflow automatically syncs status changes to Jira. Controlled by `WORKFLOW_JIRA_CONFIRM` env var (default: auto, set to `true` for manual confirmation).

**Ticket-level Jira transitions** (automatic):

| Workflow Event | Jira Action |
|---------------|-------------|
| First stage of ticket enters Design | Assign ticket to system user, move to In Progress |
| Any stage creates MR/PR | Move ticket to In Review / In Testing |
| All stages complete + merged | Move ticket to Done |
| Ticket blocked by dependency | Move ticket to Blocked (if Jira status exists) |

**Epic-level Jira linking** (read-only):

| Workflow Event | Jira Action |
|---------------|-------------|
| Epic linked via `jira_key` | No auto transitions. MR/PR descriptions reference the Jira epic. Summary command includes epic Jira key. |

### 3.15 Worktree Isolation Strategy

Each repo participating in the workflow must define a worktree isolation strategy in its CLAUDE.md. This is enforceable and verifiable — the workflow validates that this section exists before creating worktrees.

```markdown
## Worktree Isolation Strategy

### Service Ports
- Dev server: PORT=3000 + $WORKTREE_INDEX
- API server: PORT=4000 + $WORKTREE_INDEX
- Database: PORT=5432 + $WORKTREE_INDEX

### Database
- Each worktree uses database: myapp_dev_$WORKTREE_INDEX

### Environment
- .env.worktree template with $WORKTREE_INDEX substitutions

### Verification Command
- `npm run verify` (must pass in isolated worktree)
```

`$WORKTREE_INDEX` is assigned by the orchestration system (0 for main, 1-N for parallel worktrees). The workflow validates that this section exists before creating worktrees.

---

## 4. Delivery Staging

### Stage 0: Pipeline Configuration (Modularity System)

**Goal**: Config-driven workflow pipeline system established. The kanban workflow is defined by YAML config files, not hardcoded. Users can define their own phases, skills, and resolvers. Pipeline validation ensures correctness.

**What ships**:
1. Global config file schema (`~/.config/kanban-workflow/config.yaml`).
2. Per-repo config file schema (`<repo>/.kanban-workflow.yaml`).
3. Config loading with global + repo override merging (phases replace, defaults merge).
4. State machine model: states with `skill` (Claude session) or `resolver` (TypeScript function), `transitions_to` declarations.
5. `session_active` locking mechanism in stage frontmatter + SQLite.
6. `kanban-cli validate-pipeline` command with four validation layers:
   - Config validation (static YAML parsing).
   - Graph validation (reachability, terminability, dead ends).
   - Skill content validation (LLM verifies skill text matches transitions).
   - Resolver validation (TypeScript function exists, signature correct, return values match transitions).
7. Default pipeline config: Design → User Design Feedback → Build → Automatic Testing → Manual Testing → Finalize → PR Created → Addressing Comments → Done.
8. Resolver function registration and loading.
9. `entry_phase` routing including resolver-based branching for custom DAG pipelines.

**What does NOT ship**: The skills themselves, CLI board/graph/next commands, the orchestration loop, SQLite cache, integrations. Those remain in Stage 1+.

**Why first**: Everything in Stage 1+ depends on the pipeline being config-driven. Building Stage 1 with hardcoded phases and then retrofitting modularity would require rewriting the CLI, orchestration loop, and all skills. Starting config-driven avoids that rework.

See [Section 6: Modularity & Pipeline Configuration](#6-modularity--pipeline-configuration) for the full design.

### Stage 1: Foundation (File Format + CLI + Rename + SQLite)

**Goal**: New file format established, CLI tool works, all skills use new terminology, SQLite cache operational. Single-stage sequential workflow still works exactly as before, just with new names and frontmatter.

**What ships**:
1. Terminology rename across all skills, commands, agents, examples (epic → ticket, new epic layer).
2. YAML frontmatter templates for epic/ticket/stage files.
3. `ticket-stage-setup` skill (creates new nested structure with frontmatter).
4. `kanban-cli` tool with `board`, `graph`, `validate`, `sync` commands.
5. Global SQLite database at `~/.config/kanban-workflow/kanban.db`.
6. Updated `next_task` command (calls `kanban-cli next` internally).
7. Updated phase skills with terminology changes.
8. `refinement_type` support in `phase-refinement`.
9. Updated `lessons-learned`, `journal`, `meta-insights` with new metadata fields.
10. `priority` and `due_date` optional frontmatter fields on stages.

**What does NOT ship**: Remote mode, Jira, review cycle, parallel orchestration, migration tool, convert-ticket, summary command, Slack, auto-design, auto-analysis threshold.

**Why first**: Everything else depends on the file format and CLI being stable. The workflow is functional end-to-end at this point — just single-stage, local-only, manual design decisions.

**Modularity integration**: Stage 1 depends on Stage 0 (Pipeline Configuration). All CLI commands consume the pipeline config system via `loadConfig()` and `StateMachine.fromConfig()`. The CLI `board` command reads columns from the pipeline config, not hardcoded. `kanban-cli next` filters by `session_active = false`. All status changes are validated through `TransitionValidator`. SQLite schema includes `session_active`, `locked_at`, `locked_by` on the stages table. `kanban-cli validate` also runs `validate-pipeline`. See `tools/kanban-cli/docs/integration-spec-stage-1.md` for detailed integration contracts.

### Stage 2: Migration + Conversion

**Goal**: Existing repos can be migrated. Tickets without stages can be converted.

**What ships**:
1. `migrate-repo` skill (old layout → new layout with ticket grouping and dependency inference).
2. `convert-ticket` skill (ticket with no stages → brainstorm into stages).
3. `kanban-cli migrate` command (non-interactive migration for simple cases).
4. `kanban-cli summary` command.

**Depends on**: Stage 1 (file format must be stable).

**Modularity integration**: Migration tool must generate config-compatible status values. When migrating stages, set `session_active: false` in frontmatter. `convert-ticket` skill must set stages to `Not Started` status (the system column entry point).

### Stage 3: Remote Mode + MR/PR

**Goal**: Work can be pushed to remote branches with MR/PR creation instead of merging to main locally.

**What ships**:
1. `WORKFLOW_REMOTE_MODE` env var support in `phase-finalize`.
2. `WORKFLOW_GIT_PLATFORM` auto-detection and env var.
3. MR/PR creation via `gh`/`glab` CLI with descriptive bodies.
4. Jira key linking in MR/PR descriptions (when `jira_key` present).
5. `Awaiting Merge` status and kanban column.
6. `review-cycle` skill (fetch comments → address → push → reply).

**Depends on**: Stage 1. Independent of Stage 2.

**Modularity integration**: Remote mode behavior is configured via `WORKFLOW_REMOTE_MODE` in pipeline config defaults. The `pr-status` built-in resolver (created in Stage 0) gets its production code host API integration in this stage. The `review-cycle` skill must transition to `PR Created` using the status from config, not a hardcoded value.

### Stage 4: Jira Integration

**Goal**: Tickets can be pulled from Jira into the workflow and status syncs bidirectionally.

**What ships**:
1. Jira import flow (via available Jira skill/MCP).
2. "To Convert" kanban column populated from Jira imports.
3. `jira_key` and `source: jira` frontmatter fields populated during import.
4. Integration with `convert-ticket` (Stage 2) for breaking Jira tickets into stages.
5. Bidirectional Jira status sync (workflow events → Jira transitions).
6. `WORKFLOW_JIRA_CONFIRM` env var for manual confirmation mode.
7. Jira epic read-only linking.

**Depends on**: Stage 1 + Stage 2 (convert-ticket). Stage 3 recommended (Jira workflows typically use remote branches/MRs).

**Modularity integration**: Jira integration logic lives in the skills that handle each pipeline state, not in a separate integration layer. Custom pipeline skills handle their own Jira interaction. `WORKFLOW_JIRA_CONFIRM` is set in the pipeline config defaults.

### Stage 5: Auto-Design + Auto-Analysis

**Goal**: Reduce manual intervention for routine decisions.

**What ships**:
1. `WORKFLOW_AUTO_DESIGN` env var — brainstormer runs, recommends, proceeds without prompting.
2. `WORKFLOW_LEARNINGS_THRESHOLD` env var — auto-triggers meta-insights when threshold exceeded.
3. Updated phase exit gates to check threshold after lessons-learned.

**Depends on**: Stage 1. Independent of Stages 2-4.

**Modularity integration**: `WORKFLOW_AUTO_DESIGN` and `WORKFLOW_LEARNINGS_THRESHOLD` are set in the pipeline config defaults section. Skills read these from config passed via orchestration context.

### Stage 6: Parallel Orchestration (Worktrees + External Loop)

**Goal**: Multiple stages worked on simultaneously via isolated worktrees and an external scheduling loop.

**What ships**:
1. Worktree creation/cleanup tied to stage lifecycle.
2. `WORKFLOW_MAX_PARALLEL` env var.
3. Worktree isolation strategy validation (checks repo CLAUDE.md).
4. `$WORKTREE_INDEX` assignment and port/database isolation.
5. Priority queue in `kanban-cli next` (review comments → awaiting refinement → refinement ready → build ready → design ready → explicit priority → due date).
6. `needs_human` flag on returned stages.
7. External scheduling script (TypeScript):
   - Calls `kanban-cli next --max N`.
   - Spawns Claude sessions in worktrees (Ralph-loop style, one per stage).
   - Monitors completion (watches stage status in files).
   - Picks up next ready stages when workers finish.
   - Parks stages needing human input in appropriate "Awaiting" columns.
8. Human-in-the-loop handling: stages requiring decisions are flagged, loop continues with other stages.

**Note**: This stage requires its own deep design session. The external loop architecture (hybrid: external TS scheduler + Claude worker sessions) needs detailed specification for: failure handling, session lifecycle, state synchronization, and cost control.

**Background — Ralph Loops**: The worker sessions follow the Ralph Loop pattern created by Geoffrey Huntley. Each Claude session is spawned fresh with a clean context window, reads the current state from files (stage file, spec, codebase), does one unit of work, commits, and exits. The external loop respawns as needed. This avoids context rot (degraded performance as context fills up) by giving each iteration the full specification. The official Ralph Loop plugin for Claude Code is already installed and could be leveraged for the worker sessions.

**Depends on**: Stage 1 + Stage 3 (worktrees need branch management).

**Modularity integration**: The orchestration loop is config-driven. It reads the pipeline config to determine which states are skill vs resolver. For skill states: check `session_active`, lock, spawn session. For resolver states: call the resolver function, apply transition. Priority queue ordering uses pipeline phase index. `WORKFLOW_MAX_PARALLEL` is read from config defaults.

### Stage 7: Slack Notifications (Stretch)

**Goal**: Team gets notified when MRs are created.

**What ships**:
1. `WORKFLOW_SLACK_WEBHOOK` env var.
2. POST to webhook on MR/PR creation with link, title, description summary.
3. Channel/team routing (could be per-epic or per-ticket config in frontmatter).

**Implementation**: Webhook-based initially. More advanced Slack bot integration to be explored when this stage begins.

**Depends on**: Stage 3 (MR/PR creation).

**Modularity integration**: `WORKFLOW_SLACK_WEBHOOK` is set in the pipeline config defaults. Slack notification logic lives in the finalize skill (or custom equivalent). Users with custom pipelines add Slack to their own skills.

### Stage 8: Global CLI + Multi-Repo

**Goal**: CLI works across repos, cross-repo dependencies resolve.

**What ships**:
1. Repo registration system (config file listing participating repos).
2. `kanban-cli` scans across registered repos.
3. Cross-repo dependency resolution (`repo:other-project/STAGE-XXX-YYY-ZZZ`).
4. Global kanban board aggregating all repos.
5. Global `next` command considering cross-repo dependencies.

**Depends on**: Stage 1. Benefits from all other stages being stable.

**Modularity integration**: Each repo can have its own `.kanban-workflow.yaml` with a different pipeline. The global kanban board shows stages from different repos with different pipelines. Board output includes the pipeline config source for each stage.

### Stage 9: Web UI

**Goal**: Replace/rebuild Vibe Kanban as a proper web UI for this workflow.

**What ships**: Full web application consuming the file-based source of truth (or SQLite database synced from it). Separate deep design session needed.

**Depends on**: All previous stages stable.

**Modularity integration**: The web UI reads pipeline config to render columns dynamically. Different repos may have different column sets. Column ordering comes from the pipeline config phase list.

### Stage 10: Session Monitor Integration

**Goal**: Integrate claude-session-monitor-efficient for real-time session visibility and prompt answering from the web UI.

**What ships**:
1. Map Claude sessions to stages via worktree path (session's working directory → worktree → stage ID).
2. Real-time session status on kanban cards (active, waiting for input, waiting for permission).
3. Prompt answering from web UI — when Claude is waiting for user input on a stage, the kanban web UI can send the response.
4. Token/cost tracking per stage.

**Leverages**: The session monitor's existing WebSocket infrastructure, secondary server architecture, event query API, and hook-based event capture.

**Depends on**: Stage 9 (Web UI) + claude-session-monitor-efficient.

**Modularity integration**: Session-to-stage mapping uses `session_active` and `locked_by` fields from SQLite. The monitor displays the skill name from config for each active session.

### Delivery Stage Dependency Graph

```
Stage 0 (Pipeline Configuration)
  └── Stage 1 (Foundation + SQLite + CLI)
        ├── Stage 2 (Migration + Conversion)
        │     └── Stage 4 (Jira + Bidirectional Sync) ── also depends on Stage 3
        ├── Stage 3 (Remote Mode + MR/PR)
        │     ├── Stage 6 (Parallel Orchestration + Priority Queue)
        │     ├── Stage 7 (Slack)
        │     └── Stage 4 (Jira)
        ├── Stage 5 (Auto-Design + Auto-Analysis) ── independent
        └── Stage 8 (Global CLI + Multi-Repo) ── independent
              └── Stage 9 (Web UI)
                    └── Stage 10 (Session Monitor Integration)
```

**Parallelizable after Stage 1**: Stages 2, 3, 5, and 8 can all be worked on concurrently since they're independent of each other.

---

## 5. Open Questions & Deferred Decisions

### 5.1 Resolved During This Design

| Question | Resolution |
|----------|-----------|
| Where does the kanban board live? | File-based + CLI (stage 1), global CLI (stage 8), web UI (stage 9) |
| Dependency format | YAML frontmatter `depends_on` at all levels |
| Cross-boundary dependencies | Full: cross-ticket, cross-epic, cross-repo (cross-repo in stage 8) |
| Worktree granularity | Per-stage |
| Service isolation | Repo-specific strategy in CLAUDE.md, enforced by workflow |
| CLI output format | JSON to stdout |
| CLI language | TypeScript |
| Directory layout | Nested: epic dir > ticket dir > stage files |
| Mixed refinement types | Allow list, recommend splitting |
| SQLite scope | Global from the start |
| Jira ticket transitions | Auto with override (`WORKFLOW_JIRA_CONFIRM`) |
| Jira epic transitions | Read-only link, no auto transitions |
| Parallel loop architecture | Hybrid: external TS script + Claude workers |
| Refinement checklists | Type-driven (frontend/backend/cli/database/infrastructure/custom) |
| Learnings auto-analysis | Threshold trigger (checked at end of each phase) |
| Slack notifications | Webhook-based initially, deeper integration explored later |
| Priority system | Review comments > awaiting refinement > refinement ready > build ready > design ready > explicit priority > due date |
| Where does modularity configuration live? | Global `~/.config/kanban-workflow/config.yaml` + per-repo `.kanban-workflow.yaml`. Phases replace, defaults merge. |
| How are phases customized? | Flat state machine in YAML. Each state has a skill or resolver, plus transitions_to. |
| How are integrations handled? | Integration logic lives in skills. Each skill handles its own integrations. |
| How is the pipeline validated? | `kanban-cli validate-pipeline` — 4 layers: config, graph, skill content (LLM), resolver code. |
| What are the two kinds of pipeline states? | Skill states (Claude session) and resolver states (TypeScript function). |
| How is concurrent pickup prevented? | `session_active` field in frontmatter + SQLite. Orchestration loop locks before spawning. |

### 5.2 Open — Resolve at Stage Start

**Stage 0 (Pipeline Configuration)**:
- How should the LLM validation layer handle skills that use conditional logic (e.g., "if WORKFLOW_AUTO_DESIGN is true, skip to Build; otherwise transition to User Design Feedback")? The LLM needs to understand environment-conditional transitions.
- Should resolver functions be shipped as part of the `kanban-cli` package, or loaded from a separate plugin directory? If plugins, what's the discovery mechanism?
- How to handle config migration when the default pipeline changes between versions? Repos with no `.kanban-workflow.yaml` would get the new defaults automatically. Repos with explicit configs would not.
- Should the validator warn about unreachable states that are only reachable via resolver branching (since static analysis can't always trace resolver return values)?

**Stage 1 (Foundation)**:
- What happens when a stage file is manually edited and SQLite is stale? File mtime check may not catch all cases (e.g., git checkout changes files without updating mtime predictably). May need a content hash.
- Should `kanban-cli validate` also check SQLite consistency, or only file integrity?
- How should the CLI be packaged? `npm link` works for development but is fragile for global install. Consider a compiled binary via `pkg` or `tsx` shebang.

**Stage 2 (Migration)**:
- How aggressive should dependency inference be? Analyzing git history and code imports could be powerful but also noisy. May want a `--conservative` flag that only infers sequential dependencies within a ticket.
- Should migration preserve old file paths as git history (rename tracking), or is a clean restructure acceptable?

**Stage 3 (Remote Mode)**:
- Branch naming: `worktree_branch` uses `epic-001/ticket-001-001/stage-001-001-001`. Some git servers have branch name length limits or character restrictions. May need a shorter format option.
- MR/PR templates: should these be configurable per-repo (a template file), or is the generated description sufficient?
- What happens if the remote branch already exists (e.g., from a previous failed push)? Force push? Error? Prompt?

**Stage 4 (Jira)**:
- Jira workflow names vary across projects ("In Progress" vs "Active" vs "Development"). Need a mapping config somewhere — probably in the repo's CLAUDE.md or a `.kanban-workflow.yaml` config file.
- Which Jira fields to populate beyond status? Assignee, sprint, story points, labels?
- Should the "To Convert" column support non-Jira sources (e.g., GitHub Issues, Linear tickets)?

**Stage 6 (Parallel Orchestration)**:
- How does the external loop handle Claude session failures (crash, timeout, token limit)? Retry? Mark stage as blocked? Alert user?
- How does it detect that a stage needs human input vs. is actively being worked on? File polling for status changes? Or a more active signal?
- Should the loop run indefinitely (daemon) or as a bounded batch (`--rounds N`)?
- Worktree cleanup: when should worktrees be removed? After merge? After a TTL? Manual cleanup command?
- How does `$WORKTREE_INDEX` get assigned and communicated to the Claude session? Env var? Written to a file in the worktree?
- Detailed cost control: per-stage token budgets, automatic pause thresholds, reporting.

**Stage 8 (Global CLI)**:
- Repo registration format: a config file at `~/.config/kanban-workflow/repos.yaml`? Auto-discovery by scanning common paths?
- Cross-repo dependency resolution latency: scanning multiple repos' files could be slow. SQLite cache helps, but sync frequency matters.

**Stage 9 (Web UI)**:
- Rewrite Vibe Kanban from scratch or fork and adapt? The tech stack (Rust + React) is solid but the data model is fundamentally different.
- Should the web UI read files directly (via a file-watching backend) or only query the SQLite database?
- Real-time updates: file system watcher (chokidar) vs polling vs triggered by CLI commands?

**Stage 10 (Session Monitor)**:
- How to map a Claude session to a stage? The session's cwd will be the worktree path, which contains the stage ID. But the session monitor doesn't currently store structured metadata about "what task" a session is working on.
- Prompt answering from web UI requires a bidirectional channel back to Claude. The session monitor currently has WebSocket push (server → dashboard) but no input path (dashboard → Claude). This needs the Claude Code permission/input hook system or a custom MCP server.

### 5.3 Architectural Risks

| Risk | Mitigation | Stage |
|------|-----------|-------|
| File ↔ SQLite desync | Content hash comparison, sync on every CLI call, file watchers in web UI | 1, 9 |
| Circular dependencies across repos | `kanban-cli validate` with cycle detection spanning all registered repos | 8 |
| Worktree port collisions | CLAUDE.md isolation strategy is enforceable but depends on project cooperation. Validation script can check port usage before spawning. | 6 |
| Ralph loop cost accumulation | `WORKFLOW_MAX_PARALLEL` cap, per-stage token budget, automatic pause if spend exceeds threshold | 6 |
| Jira API rate limits | Batch transitions, cache Jira state, rate-limit outbound calls | 4 |
| Git merge conflicts between parallel stages | Stages should touch different files. If conflict detected, park the later stage and alert user. | 6 |
| Branch name collisions | `worktree_branch` is deterministic from ID — unique by construction. Validate uniqueness in `kanban-cli validate`. | 3 |
| Terminology rename blast radius | Incremental migration (Approach A) — rename first, test, then add layers. Temporary inconsistency is manageable. | 1 |
| Session monitor bidirectional communication | Requires new input path (dashboard → Claude). May need custom MCP server or hook-based approach. Research needed. | 10 |
| Skill text ↔ config transition mismatch | LLM validation layer in `validate-pipeline` checks skill content against declared transitions. Runtime enforcement rejects illegal transitions. | 0 |
| Custom pipeline dead ends | Graph validation ensures all states can reach Done. Users must run `validate-pipeline` before using custom configs. | 0 |
| Resolver function errors in production | Resolver validation dry-runs with mock data. Runtime catches exceptions and logs errors without transitioning. | 0 |

---

## 6. Modularity & Pipeline Configuration

### 6.1 Architecture Overview

The unit of modularity is the **skill**. The workflow pipeline is a flat state machine defined in a YAML config file. Each state maps to either a **skill** (spawns a Claude session) or a **resolver** (lightweight TypeScript function). The orchestration loop reads the config to know how to route stages through the pipeline.

**Three layers:**

| Layer | Responsibility |
|-------|---------------|
| **Config Layer** | YAML files define the pipeline (states, transitions, skills/resolvers) |
| **Engine Layer** | Orchestration loop + kanban-cli execute the pipeline |
| **Skill/Resolver Layer** | Skills (Claude sessions) and resolvers (TypeScript functions) do the actual work |

**Config hierarchy:**

```
~/.config/kanban-workflow/config.yaml     (global defaults)
    ↓ overridden by
<repo>/.kanban-workflow.yaml              (per-repo overrides)
```

Global config sets the user's preferred defaults. Per-repo config overrides any part of it. A repo with no `.kanban-workflow.yaml` uses the global config as-is.

**Two kinds of pipeline states:**

| Kind | Config field | What happens | Example |
|------|-------------|-------------|---------|
| **Skill state** | `skill: phase-design` | Orchestration loop spawns a Claude session with this skill. Session runs, does work, sets a new status from `transitions_to`, exits. | Design, Build, Manual Testing |
| **Resolver state** | `resolver: pr-status` | Orchestration loop calls a lightweight TypeScript function on each tick. Function returns a transition target or null (no change). No Claude session. | PR Created, Router |

**Four system columns** exist outside the pipeline config. They're structural — part of the engine, always present, not configurable:

- **To Convert** — ticket with `stages: []`
- **Backlog** — stage with unresolved `depends_on`
- **Ready for Work** — stage with all deps resolved, `status: Not Started`
- **Done** — terminal state

### 6.2 Config Schema

**Global config** (`~/.config/kanban-workflow/config.yaml`):

```yaml
workflow:
  entry_phase: Design

  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build, User Design Feedback]

    - name: User Design Feedback
      skill: user-design-feedback
      status: User Design Feedback
      transitions_to: [Build]

    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Automatic Testing]

    - name: Automatic Testing
      skill: automatic-testing
      status: Automatic Testing
      transitions_to: [Manual Testing]

    - name: Manual Testing
      skill: manual-testing
      status: Manual Testing
      transitions_to: [Finalize]

    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done, PR Created]

    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to: [Done, Addressing Comments]

    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to: [PR Created]

  defaults:
    WORKFLOW_REMOTE_MODE: false
    WORKFLOW_AUTO_DESIGN: false
    WORKFLOW_MAX_PARALLEL: 1
    WORKFLOW_GIT_PLATFORM: auto
    WORKFLOW_LEARNINGS_THRESHOLD: 10
```

**Per-repo override** (`<repo>/.kanban-workflow.yaml`):

```yaml
# Example: a team that replaces the default pipeline
workflow:
  phases:
    - name: Spike
      skill: my-spike-phase
      status: Spike
      transitions_to: [Implement]

    - name: Implement
      skill: my-implement-phase
      status: Implement
      transitions_to: [QA]

    - name: QA
      skill: my-qa-phase
      status: QA
      transitions_to: [Done, QA Failed]

    - name: QA Failed
      skill: my-qa-fix
      status: QA Failed
      transitions_to: [QA]

  entry_phase: Spike

  defaults:
    WORKFLOW_REMOTE_MODE: false
```

**Override semantics**: If a repo config defines `phases`, it **replaces** the entire pipeline (not merge). Other fields (`defaults`) merge with global. This prevents confusing partial pipeline merges.

### 6.3 State Machine Model

The pipeline is a **flat directed graph** of states. No nesting, no parent/child relationships. Every state is a peer.

**State shape:**

```
State {
  name: string              # display name
  status: string            # unique status value written to frontmatter
  skill?: string            # Claude skill reference (mutually exclusive with resolver)
  resolver?: string         # TypeScript resolver function name (mutually exclusive with skill)
  transitions_to: string[]  # valid next states (by name) — "Done" is always valid as a target
}
```

**Session locking** — every stage in a pipeline state has two internal conditions:

```yaml
# In stage frontmatter
status: Design              # which pipeline state
session_active: false       # false = ready to be picked up, true = session is working
```

Both are also cached in SQLite for fast queries. File is source of truth.

**Orchestration loop behavior per state kind:**

```
For skill states:
  1. Find stages where status matches AND session_active = false
  2. Set session_active = true (file + SQLite)
  3. Spawn Claude session with the skill
  4. Session runs → sets new status → sets session_active = false
  5. If session crashes → scheduler resets session_active = false after timeout

For resolver states:
  1. Find stages where status matches AND session_active = false
  2. Call the resolver function (no session spawned, no lock needed)
  3. If resolver returns a transition target → set new status
  4. If resolver returns null → skip, check again next tick
```

**Resolver function contract:**

```typescript
type Resolver = (stage: Stage, context: ResolverContext) => string | null;
```

Returns a valid transition target from `transitions_to`, or `null` for no change.

**Transition rules:**

- A skill sets the new status before exiting. The status must be in its `transitions_to` list.
- A resolver returns a target from its `transitions_to` list, or null.
- The engine validates at runtime that any status change is a legal transition. Illegal transitions are logged as errors and rejected.
- `Done` is a reserved target — any state can list it in `transitions_to`.
- `Not Started` is a reserved status — means the stage hasn't entered the pipeline yet (it's in Ready for Work).

### 6.4 Branching & Converging Pipelines

The pipeline is a DAG (directed acyclic graph), not necessarily linear. Users can create branching pipelines where stages take different paths based on their metadata (e.g., `refinement_type`).

**Branching** = a state (skill or resolver) with multiple `transitions_to` targets. The skill/resolver picks which one based on stage metadata.

**Converging** = multiple states list the same target in their `transitions_to`.

**Routing** = a resolver state whose sole job is to read metadata and return a transition. No Claude session needed.

**Example: branching pipeline with type-specific testing:**

```yaml
workflow:
  entry_phase: Router

  phases:
    - name: Router
      resolver: stage-router
      status: Routing
      transitions_to: [Frontend Design, Backend Design, DB Design, Design]

    - name: Frontend Design
      skill: frontend-design
      status: Frontend Design
      transitions_to: [Build]

    - name: Backend Design
      skill: backend-design
      status: Backend Design
      transitions_to: [Build]

    - name: DB Design
      skill: db-design
      status: DB Design
      transitions_to: [Build]

    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build]

    # Converges
    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Testing Router]

    # Branches again
    - name: Testing Router
      resolver: testing-router
      status: Testing Routing
      transitions_to: [Frontend Testing, Backend Testing, General Testing]

    - name: Frontend Testing
      skill: frontend-testing
      status: Frontend Testing
      transitions_to: [Finalize]

    - name: Backend Testing
      skill: backend-testing
      status: Backend Testing
      transitions_to: [Finalize]

    - name: General Testing
      skill: general-testing
      status: General Testing
      transitions_to: [Finalize]

    # Converges
    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done]
```

**Router resolver example:**

```typescript
function stageRouter(stage: Stage, ctx: ResolverContext): string | null {
  const type = stage.refinement_type;
  if (type?.includes('frontend')) return 'Frontend Design';
  if (type?.includes('backend')) return 'Backend Design';
  if (type?.includes('database')) return 'DB Design';
  return 'Design';
}
```

The default pipeline does not use routing — `entry_phase: Design` enters directly. Branching is opt-in for custom pipelines.

### 6.5 Orchestration Loop Changes

The tick cycle handles skill states, resolver states, and system columns:

```
On each tick:

  1. RESOLVER states (session_active = false):
     - Call each resolver function
     - If returns target → transition stage
     - If returns null → no change

  2. SKILL states (session_active = false):
     - Pick up based on priority queue
     - Respect WORKFLOW_MAX_PARALLEL limit
     - Set session_active = true
     - Spawn Claude session with the skill

  3. SYSTEM columns (Backlog):
     - Check dependency resolution
     - If all deps resolved → move to Ready for Work

  4. COMPLETION cascade:
     - Stage reaches Done → check ticket → check epic
```

**Priority queue** applies only to skill states. Resolvers are instant. Ordering:

1. Stages in Addressing Comments (unblock team reviewers)
2. Stages in Manual Testing (unblock human approval)
3. Stages ready for Automatic Testing
4. Stages ready for Build
5. Stages ready for Design
6. Explicit `priority` field in frontmatter
7. `due_date` proximity

**Session crash handling**: If a session exits without setting a new status, the scheduler resets `session_active = false`. Stage stays in its current status, eligible to be picked up again on the next tick.

### 6.6 Pipeline Validator

`kanban-cli validate-pipeline` audits the full pipeline config. Four validation layers:

**Layer 1: Config validation (static parsing)**

- YAML is well-formed
- Every state has `name`, `status`, and `transitions_to`
- Every state has exactly one of `skill` or `resolver` (not both, not neither)
- `status` values are unique across all states
- `transitions_to` targets all reference existing state names or `Done`
- `entry_phase` references an existing state
- No reserved status values used (`Not Started`, `Complete`)

**Layer 2: Graph validation (traversal)**

- All states reachable from `entry_phase` via `transitions_to` chains
- All states can reach `Done` via some path
- No orphaned states
- No dead ends
- Cycles allowed only if at least one state in the cycle can reach `Done`

**Layer 3: Skill content validation (LLM)**

- For each skill state, read the skill file content
- Verify skill text instructs Claude to set a status matching one of the state's `transitions_to` targets
- Flag mismatches and missing transitions

**Layer 4: Resolver validation (code analysis)**

- Verify TypeScript function exists and is importable
- Verify function signature matches `(stage, context) => string | null`
- Static analysis of return values against `transitions_to` where possible
- Dry-run with mock data to confirm execution without errors

**Output:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "layer": "skill_content",
      "state": "User Design Feedback",
      "message": "Skill text references 'Design' as a transition but config only allows ['Build']"
    }
  ]
}
```

**When validation runs:**

- `kanban-cli validate-pipeline` — manual invocation
- Automatically on first `kanban-cli` command after config file changes (detected via file mtime)
- Automatically when a new skill or resolver is registered

### 6.7 Default Pipeline Reference

The built-in pipeline config that ships with the tool:

| # | Column | Type | Skill/Resolver | Transitions To |
|---|--------|------|----------------|----------------|
| 1 | Design | Skill | `phase-design` | Build, User Design Feedback |
| 2 | User Design Feedback | Skill | `user-design-feedback` | Build |
| 3 | Build | Skill | `phase-build` | Automatic Testing |
| 4 | Automatic Testing | Skill | `automatic-testing` | Manual Testing |
| 5 | Manual Testing | Skill | `manual-testing` | Finalize |
| 6 | Finalize | Skill | `phase-finalize` | Done, PR Created |
| 7 | PR Created | Resolver | `pr-status` | Done, Addressing Comments |
| 8 | Addressing Comments | Skill | `review-cycle` | PR Created |

**Complete column list (system + pipeline):**

| Column | Source | Type |
|--------|--------|------|
| To Convert | System | Condition: `stages: []` |
| Backlog | System | Condition: unresolved deps |
| Ready for Work | System | Condition: deps resolved, `Not Started` |
| Design | Pipeline | Skill |
| User Design Feedback | Pipeline | Skill |
| Build | Pipeline | Skill |
| Automatic Testing | Pipeline | Skill |
| Manual Testing | Pipeline | Skill |
| Finalize | Pipeline | Skill |
| PR Created | Pipeline | Resolver |
| Addressing Comments | Pipeline | Skill |
| Done | System | Terminal |

**Example trace through default pipeline:**

```
Ready for Work (Not Started)
  → Design (skill: phase-design runs)
    → User Design Feedback (skill: user-design-feedback loops with user)
      → Build (skill: phase-build runs)
        → Automatic Testing (skill: automatic-testing runs)
          → Manual Testing (skill: manual-testing loops with user)
            → Finalize (skill: phase-finalize runs, creates PR)
              → PR Created (resolver: pr-status polls)
                → Addressing Comments (skill: review-cycle runs)
                  → PR Created (resolver polls again)
                    → Done (resolver detects merge)
```
