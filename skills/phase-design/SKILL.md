---
name: phase-design
description: Use when entering Design phase of ticket-stage-workflow - guides task discovery, context gathering, and approach selection within the epic/ticket/stage hierarchy
---

# Design Phase

## Purpose

The Design phase discovers what to build and selects the approach. It ensures the right solution is chosen before implementation begins.

## Entry Conditions

- `/next_task` has been run and returned a Design phase assignment
- `ticket-stage-workflow` skill has been invoked (shared rules loaded)
- Stage YAML frontmatter has been read (status, refinement_type, ticket, epic, etc.)

## Phase Workflow

```
1. Delegate to task-navigator (Haiku) to get task card
2. Delegate to Explore (built-in) to gather codebase context

3. [CONDITIONAL: Brainstorming]
   IF task has multiple valid approaches OR is architecturally complex:
     → Delegate to brainstormer (Opus) to present 2-3 options to user
   ELSE (obvious single solution OR trivial task):
     → Skip brainstormer, proceed with obvious approach

   **SELF-CHECK: Are you about to skip brainstormer?**

   Read these thoughts. If you're thinking ANY of them, you're rationalizing:

   | Thought | Why You're Wrong | Correct Action |
   |---------|------------------|----------------|
   | "I already have context from Explore" | Context gathering ≠ architecture brainstorming | Use brainstormer anyway |
   | "I can present options myself" | Main agent = coordinator only, not architect | Use brainstormer (Opus) |
   | "Faster to skip delegation" | Speed ≠ excuse to violate coordination boundaries | Use brainstormer anyway |
   | "This seems straightforward" | Your gut feeling is unreliable under time pressure | Use brainstormer when unsure |
   | "User wants it fast" | User wants it RIGHT, not fast-but-wrong | Use brainstormer anyway |

   **When in doubt, use brainstormer.** Opus is specialized for architecture options. You (Sonnet) coordinate, don't architect.

4. [CONDITIONAL: Auto-Design Mode]
   Check `WORKFLOW_AUTO_DESIGN` environment variable:

   IF `WORKFLOW_AUTO_DESIGN=true`:
     → Brainstormer still runs and presents 2-3 approaches
     → Instead of waiting for user selection, proceed with the brainstormer's recommended option
     → Log the recommendation and reasoning in the stage file's Design Phase section:
       - **Auto-Selected Approach**: [name]
       - **Reasoning**: [why brainstormer recommended this]
       - **Alternatives Considered**: [brief list of other options]
     → Note: The user can still override by reviewing the stage file later

   IF `WORKFLOW_AUTO_DESIGN=false` (default):
     → Existing behavior: present options, wait for user to select

5. User selects approach (or confirms obvious one, or auto-selected in auto-design mode)
6. Delegate to doc-updater (Haiku) to update tracking documents:
   - Record selected approach in STAGE-XXX-YYY-ZZZ.md (Design Phase section)
   - Mark Design phase complete in STAGE-XXX-YYY-ZZZ.md
   - Update stage status in ticket's TICKET-XXX-YYY.md (MANDATORY)
   - Update ticket status in epic's EPIC-XXX.md if needed
```

## Skip Brainstormer Criteria

**Skip brainstormer ONLY when ALL of these are true:**

- [ ] Task is trivial (typo fix, config tweak, obvious bug fix with known solution)
- [ ] Single obvious implementation exists
- [ ] No architectural decisions needed
- [ ] No UI/UX choices to make
- [ ] User explicitly specified the complete approach

**Use brainstormer when ANY of these apply:**

- [ ] Multiple UI patterns could work
- [ ] Integration between systems (GraphQL, WebSocket, state management)
- [ ] User-facing feature with UX implications
- [ ] Architectural decision needed
- [ ] You're unsure whether to use brainstormer (meta-uncertainty = use it)

## Auto-Design Mode (`WORKFLOW_AUTO_DESIGN`)

When `WORKFLOW_AUTO_DESIGN=true`, the Design phase operates in autonomous mode:

- **Brainstormer still runs** — it is NOT skipped. The brainstormer analyzes the problem, explores approaches, and makes a recommendation.
- **No user prompt** — instead of presenting options and waiting, the brainstormer's recommended option is accepted automatically.
- **Logging is mandatory** — the recommendation, reasoning, and alternatives must be recorded in the stage file's Design Phase section so the user has full visibility into what was decided and why.
- **Default is `false`** — when unset or `false`, the existing interactive behavior applies (user selects from presented options).

This mode is useful for automated/batch processing where a human is not available to make design decisions in real time. The brainstormer's judgment is trusted, but the decision trail is preserved for later review.

## Reading Stage Data

All stage metadata is read from YAML frontmatter in the stage file (`STAGE-XXX-YYY-ZZZ.md`), not from markdown headers. Key fields:

- `id`: Stage identifier (e.g., `STAGE-001-001-001`)
- `ticket`: Parent ticket (e.g., `TICKET-001-001`)
- `epic`: Parent epic (e.g., `EPIC-001`)
- `title`: Stage title
- `status`: Current status
- `refinement_type`: List of types (frontend, backend, cli, database, infrastructure, custom)
- `depends_on`: Dependencies
- `worktree_branch`: Git worktree branch name

File paths follow the three-level hierarchy:
```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md
```

## Phase Gates Checklist

Before completing Design phase, verify:

- [ ] Task card received from task-navigator
- [ ] Context gathered via Explore
- [ ] IF multiple approaches: brainstormer presented 2-3 options, user selected one (or auto-selected if `WORKFLOW_AUTO_DESIGN=true`)
- [ ] IF obvious solution: Confirmed approach with user
- [ ] Seed data requirements confirmed (if applicable)
- [ ] Tracking documents updated via doc-updater:
  - Selected approach recorded in stage file (`STAGE-XXX-YYY-ZZZ.md`)
  - Design phase marked complete
  - Ticket stage status updated (MANDATORY)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before proceeding to Build phase, you MUST complete these steps IN ORDER:

1. Update stage tracking file (mark Design phase complete in `STAGE-XXX-YYY-ZZZ.md`)
2. Update ticket tracking file (update stage status in `TICKET-XXX-YYY.md`)
3. Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` to sync changes to the kanban board
4. Use Skill tool to invoke `lessons-learned`
5. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Establish facts (phase done, status updated)
- Step 3: Sync state to kanban board so downstream tools see current status
- Steps 4-5: Capture learnings and feelings based on the now-complete phase

Lessons and journal need the full phase context, including final status updates. Running them before status updates means they lack complete information.

After completing all exit gate steps, use Skill tool to invoke `phase-build` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Build phase until exit gate is complete.** This includes:

- Announcing "proceeding to Build"
- Reading code files for Build planning
- Thinking about implementation approach
- Invoking phase-build skill

**Complete ALL exit gate steps FIRST. Then invoke phase-build.**
