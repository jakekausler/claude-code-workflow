---
name: next_task
description: Find the next workable task via kanban-cli and begin working on it.
---

# Next Task — Kanban-CLI Integration

Find the next workable stage using `kanban-cli next` and display a formatted task card with epic, ticket, and stage context.

## How to Use

1. Run `kanban-cli next --max 1` to find the next workable stage
2. Parse the output and display a formatted task card
3. Route to the appropriate phase skill
4. Invoke `ticket-stage-workflow` to begin work

## Step 1: Find the Next Task via kanban-cli

Run the following command from the project root:

```bash
npx tsx tools/kanban-cli/src/cli/index.ts next --max 1
```

If the CLI is built and installed, you may also use:

```bash
node tools/kanban-cli/dist/cli/index.js next --max 1
```

### Error Handling / Fallback

If `kanban-cli` is not available, errors, or returns no results, fall back to scanning the `epics/` directory directly:

1. Scan `epics/` for all `STAGE-*.md` files
2. Read each stage's YAML frontmatter
3. Find the first stage with status that is NOT `Complete` and NOT `Skipped`
4. Check `depends_on` — skip stages with unresolved dependencies
5. Use the first eligible stage as the next task

### To Convert Handling

If `kanban-cli next` returns a ticket that has no stages (status: `To Convert` or `stages: []`), display:

```
═══════════════════════════════════════════════════════════
NEXT TASK — CONVERSION NEEDED
═══════════════════════════════════════════════════════════
Epic:     EPIC-XXX [Epic Title]
Ticket:   TICKET-XXX-YYY [Ticket Title]
Status:   To Convert (no stages defined)

This ticket needs to be broken down into stages before
work can begin.

Action: Run /convert-ticket TICKET-XXX-YYY to brainstorm
        and create stages for this ticket.
═══════════════════════════════════════════════════════════
```

Then STOP — do not invoke `ticket-stage-workflow` for tickets needing conversion.

## Step 2: Display the Task Card

Format the task card with all three hierarchy levels:

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
[Phase-specific instructions from the stage file]

Dependencies: All resolved
Worktree:     epic-001/ticket-001-001/stage-001-001-001
═══════════════════════════════════════════════════════════
```

### Field Descriptions

- **Epic**: The parent epic ID and title (from the epic's YAML frontmatter)
- **Ticket**: The parent ticket ID and title (from the ticket's YAML frontmatter)
- **Stage**: The stage ID and title (from the stage's YAML frontmatter)
- **Phase**: Current phase based on stage status — see Phase Routing below
- **Type**: The `refinement_type` from stage frontmatter (e.g., frontend, backend, cli, database, infrastructure, custom)
- **Instructions**: Phase-specific instructions extracted from the stage file
- **Dependencies**: Whether all `depends_on` entries are resolved
- **Worktree**: The `worktree_branch` from stage frontmatter

## Step 3: Phase Routing

Based on the stage's current status, determine the active phase and route to the appropriate skill:

| Stage Status                    | Phase          | Skill to Invoke     |
| ------------------------------- | -------------- | -------------------- |
| Not Started                     | Design         | phase-design         |
| Design                          | Design         | phase-design         |
| User Design Feedback            | Design         | phase-design         |
| Build                           | Build          | phase-build          |
| Automatic Testing               | Testing        | automatic-testing    |
| Manual Testing                  | Testing        | automatic-testing    |
| Finalize                        | Finalize       | phase-finalize       |
| PR Created                      | Finalize       | phase-finalize       |
| Addressing Comments             | Finalize       | phase-finalize       |

Display the phase in the task card and prepare to invoke the corresponding skill after `ticket-stage-workflow` loads.

## Step 4: Invoke ticket-stage-workflow

**IMMEDIATELY invoke the `ticket-stage-workflow` skill** using the Skill tool:

- Skill name: `ticket-stage-workflow`

This loads shared session context including:

- Workflow hierarchy (Epic > Ticket > Stage > Phase)
- File path conventions and ID patterns
- Stage, ticket, and epic status values
- YAML frontmatter field definitions

The phase-specific skill (already determined by Step 3's routing) provides all behavioral guidance -- phase workflows, exit gates, quality gates, subagent delegation rules, etc.

Do NOT proceed with any work until both `/next_task` has run AND `ticket-stage-workflow` skill is invoked.
