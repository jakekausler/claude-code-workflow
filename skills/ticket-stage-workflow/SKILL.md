---
name: ticket-stage-workflow
description: Shared conventions, file formats, and data structures for the kanban workflow. Included by the orchestrator in every phase session prompt.
---

# Ticket-Stage Workflow - Session Context

Shared data conventions for the kanban workflow. Phase-specific guidance is in separate phase skills (phase-design, phase-build, automatic-testing, phase-manual-testing, phase-finalize, phase-awaiting-design-decision, review-cycle).

## Workflow Hierarchy

```
Epic (Initiative/Theme)
  +-- Ticket (Feature/Capability)
        +-- Stage (Component/Step)
              +-- Phase: Design -> Build -> Automatic Testing -> Finalize
```

- **Epic** = Initiative or theme grouping related tickets
- **Ticket** = Feature or capability to be delivered
- **Stage** = Single component or interaction within a ticket
- **Phase** = Design | Build | Automatic Testing | Finalize

Epics and tickets are containers. Stages are where work happens. Phases are the workflow within a stage.

---

## File Path Conventions

All tracking files follow the three-level nested directory structure:

```
epics/EPIC-XXX-name/EPIC-XXX.md                                          # Epic file
epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md              # Ticket file
epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ-name.md     # Stage file
epics/EPIC-XXX-name/TICKET-XXX-YYY-name/regression.md                   # Regression checklist
epics/EPIC-XXX-name/TICKET-XXX-YYY-name/changelog/                      # Changelog entries
```

ID patterns: `EPIC-XXX`, `TICKET-XXX-YYY`, `STAGE-XXX-YYY-ZZZ` (all 3-digit zero-padded).

---

## Status Values

### Stage Status Values

| Status               | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| Not Started          | Stage has not entered the pipeline yet          |
| Design               | In design phase                                 |
| User Design Feedback | Awaiting user decision on design options        |
| Build                | In build phase                                  |
| Automatic Testing    | In automatic testing phase                      |
| Manual Testing       | In manual testing phase (user approval)         |
| Finalize             | In finalize phase                               |
| PR Created           | MR/PR created, awaiting review (remote mode)    |
| Addressing Comments  | Addressing MR/PR review comments (remote mode)  |
| Complete             | All phases done                                 |
| Skipped              | Intentionally skipped                           |

### Epic and Ticket Status Values

| Status      | Meaning                       |
| ----------- | ----------------------------- |
| Not Started | No work has begun             |
| In Progress | At least one child is active  |
| Complete    | All children are complete     |
| Skipped     | Intentionally skipped         |

---

## YAML Frontmatter

All entity metadata lives in YAML frontmatter (between `---` delimiters at the top of each file). Read status, refinement_type, dependencies, and other fields from the frontmatter, not from markdown headers or body text.

### Epic Frontmatter Fields

| Field        | Type     | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| `id`         | string   | Epic identifier (e.g., `EPIC-001`)                       |
| `title`      | string   | Epic name                                                |
| `status`     | string   | One of the epic status values above                      |
| `jira_key`   | string?  | Jira epic key if linked (e.g., `PROJ-EPIC-42`), else null |
| `tickets`    | string[] | List of child ticket IDs                                 |
| `depends_on` | string[] | Epic-level dependencies (other epics or tickets)         |

### Ticket Frontmatter Fields

| Field        | Type     | Description                                                 |
| ------------ | -------- | ----------------------------------------------------------- |
| `id`         | string   | Ticket identifier (e.g., `TICKET-001-001`)                  |
| `epic`       | string   | Parent epic ID                                              |
| `title`      | string   | Ticket name                                                 |
| `status`     | string   | One of the epic/ticket status values above                  |
| `jira_key`   | string?  | Jira ticket key if linked (e.g., `PROJ-1234`), else null    |
| `source`     | string   | Origin: `local` or `jira`                                   |
| `stages`     | string[] | List of child stage IDs (empty `[]` = needs conversion)     |
| `depends_on` | string[] | Ticket-level dependencies (other tickets, epics, or stages) |

### Stage Frontmatter Fields

| Field              | Type     | Description                                                        |
| ------------------ | -------- | ------------------------------------------------------------------ |
| `id`               | string   | Stage identifier (e.g., `STAGE-001-001-001`)                       |
| `ticket`           | string   | Parent ticket ID                                                   |
| `epic`             | string   | Parent epic ID                                                     |
| `title`            | string   | Stage name                                                         |
| `status`           | string   | One of the stage status values above                               |
| `session_active`   | boolean  | `false` = ready to be picked up, `true` = session in progress      |
| `refinement_type`  | string[] | Testing types: frontend, backend, cli, database, infrastructure, custom. Combined checklists when multiple. |
| `depends_on`       | string[] | Stage-level dependencies (other stages, tickets, or epics)         |
| `worktree_branch`  | string   | Git worktree branch: `epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz`   |
| `priority`         | integer  | 0 = normal, 1+ = elevated (optional)                               |
| `due_date`         | string?  | ISO date if deadline exists, else null (optional)                   |

### Reading and Writing Frontmatter

- **Read** fields by parsing the YAML block between the opening and closing `---` delimiters.
- **Write** updates by modifying only the specific frontmatter fields that changed, preserving all other fields and the markdown body below.
- When updating `status`, always update the parent ticket and epic files as well (ticket tracks stage statuses; epic tracks ticket statuses).
