---
name: phase-design
description: Use when entering Design phase of epic-stage-workflow - guides task discovery, context gathering, and approach selection
---

# Design Phase

## Purpose

The Design phase discovers what to build and selects the approach. It ensures the right solution is chosen before implementation begins.

## Entry Conditions

- `/next_task` has been run and returned a Design phase assignment
- `epic-stage-workflow` skill has been invoked (shared rules loaded)

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

4. User selects approach (or confirms obvious one)
5. Delegate to doc-updater (Haiku) to update tracking documents:
   - Record selected approach in STAGE-XXX-YYY.md
   - Mark Design phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
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

## Phase Gates Checklist

Before completing Design phase, verify:

- [ ] Task card received from task-navigator
- [ ] Context gathered via Explore
- [ ] IF multiple approaches: brainstormer presented 2-3 options, user selected one
- [ ] IF obvious solution: Confirmed approach with user
- [ ] Seed data requirements confirmed (if applicable)
- [ ] Tracking documents updated via doc-updater:
  - Selected approach recorded in stage file
  - Design phase marked complete
  - Epic stage status updated (MANDATORY)

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

1. Update stage tracking file (mark Design phase complete)
2. Update epic tracking file (update stage status in table)
3. Use Skill tool to invoke `lessons-learned`
4. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Establish facts (phase done, status updated)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

Lessons and journal need the full phase context, including final status updates. Running them before status updates means they lack complete information.

After completing all exit gate steps, use Skill tool to invoke `phase-build` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Build phase until exit gate is complete.** This includes:

- Announcing "proceeding to Build"
- Reading code files for Build planning
- Thinking about implementation approach
- Invoking phase-build skill

**Complete ALL exit gate steps FIRST. Then invoke phase-build.**
