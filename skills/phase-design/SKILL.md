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

**Re-entry note:** If re-entering Design (e.g., kicked back from Build), read existing sibling files and overwrite `-design.md` with updated research.

## Phase Workflow

```
1. Delegate to task-navigator (Haiku) to get task card
2. Delegate to Explore (built-in) to gather codebase context

3. [CONDITIONAL: Brainstorming]
   IF task has multiple valid approaches OR is architecturally complex:
     → Delegate to brainstormer (Opus) to generate 2-3 approaches
   ELSE (obvious single solution OR trivial task):
     → Skip brainstormer, proceed with obvious approach

   **SELF-CHECK: Are you about to skip brainstormer?**

   Read these thoughts. If you're thinking ANY of them, you're rationalizing:

   | Thought | Why You're Wrong | Correct Action |
   |---------|------------------|----------------|
   | "I already have context from Explore" | Context gathering != architecture brainstorming | Use brainstormer anyway |
   | "I can present options myself" | Main agent = coordinator only, not architect | Use brainstormer (Opus) |
   | "Faster to skip delegation" | Speed != excuse to violate coordination boundaries | Use brainstormer anyway |
   | "This seems straightforward" | Your gut feeling is unreliable under time pressure | Use brainstormer when unsure |
   | "User wants it fast" | User wants it RIGHT, not fast-but-wrong | Use brainstormer anyway |

   **When in doubt, use brainstormer.** Opus is specialized for architecture options. You (Sonnet) coordinate, don't architect.

4. Gather and prepare design artifacts (DO NOT write files yet -- exit gate handles all writes):

   a. FULL research for `STAGE-XXX-YYY-ZZZ-design.md` sister file:
      - Codebase exploration findings (what Explore discovered)
      - All approaches with detailed trade-offs (brainstormer output)
      - Architectural considerations and risks
      - Relevant code references and patterns found
      - Seed data requirements (if applicable)

   b. BRIEF options summary for stage file's Design Phase section:
      - Just approach names + one-liner descriptions (NOT full research)
      - Example:
        - **Option A: Direct Integration** -- Embed logic in existing service
        - **Option B: Adapter Pattern** -- New adapter layer between systems
        - **Option C: Event-Driven** -- Pub/sub with async handlers
      - The full analysis lives in the `-design.md` sister file

5. [CONDITIONAL: Auto-Design Mode]
   Check `WORKFLOW_AUTO_DESIGN` environment variable:

   IF `WORKFLOW_AUTO_DESIGN=true`:
     → Auto-select the brainstormer's recommended approach
     → Log in BOTH the stage file AND `STAGE-XXX-YYY-ZZZ-design.md`:
        "Auto-selected: [Approach Name] -- [reasoning]"
     → Set stage status → Build (skip User Design Feedback)
     → Proceed to exit gate

   IF `WORKFLOW_AUTO_DESIGN=false` or unset (default):
     → Proceed to exit gate
     → **Session ends after exit gate** -- design feedback happens in a
        SEPARATE session with the `phase-awaiting-design-decision` skill
     → Do NOT present options to the user or wait for selection
     → Do NOT invoke `phase-build`
```

## Design Notes File (`STAGE-XXX-YYY-ZZZ-design.md`)

The design notes sister file captures the full research context so later phases (Build, Testing, Finalize) can reference it. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md          # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md   # design research (detailed)
```

**Contents of the design notes file:**

- Codebase exploration findings
- All approaches with detailed trade-offs
- Brainstormer output (full analysis, not just summaries)
- Architectural considerations and risks
- Relevant code references and patterns found
- If auto-design: "Auto-selected: [Approach Name] -- [reasoning]"
- If manual: note that decision is pending user feedback

**The main stage file stays lean.** Only brief option summaries go in the stage file's Design Phase section. Full research lives in `-design.md`.

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

- **Brainstormer still runs** -- it is NOT skipped. The brainstormer analyzes the problem, explores approaches, and makes a recommendation.
- **No user prompt** -- instead of presenting options and waiting, the brainstormer's recommended option is accepted automatically.
- **Logging is mandatory** -- the recommendation, reasoning, and alternatives must be recorded in BOTH:
  - The stage file's Design Phase section (brief: "Auto-selected: [Name] -- [one-liner reasoning]")
  - The `STAGE-XXX-YYY-ZZZ-design.md` sister file (detailed: full reasoning and alternatives)
- **Status transitions to Build** -- skips "User Design Feedback" entirely.
- **Default is `false`** -- when unset or `false`, the session writes design artifacts, sets status to "User Design Feedback", and ends. User design feedback happens in a separate session with `phase-awaiting-design-decision`.

This mode is useful for automated/batch processing where a human is not available to make design decisions in real time. The brainstormer's judgment is trusted, but the decision trail is preserved for later review.

## Default Flow (`WORKFLOW_AUTO_DESIGN=false`)

When auto-design is off (the default):

1. Brainstormer runs and generates approaches
2. Full research is written to `STAGE-XXX-YYY-ZZZ-design.md`
3. Brief options summary is written to stage file's Design Phase section
4. Stage status is set to **User Design Feedback**
5. Exit gate runs (lessons-learned, journal, etc.)
6. **Session ends**

The user will review the design options in a **separate session** using the `phase-awaiting-design-decision` skill. That skill reads the `-design.md` sister file for full context and facilitates the user's approach selection.

**Do NOT:**
- Present options to the user and wait for a response
- Invoke `phase-build`
- Handle user design feedback in this session

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
- [ ] IF multiple approaches: brainstormer generated 2-3 approaches
- [ ] IF obvious solution (brainstormer skipped): approach documented in both stage file and `-design.md`
- [ ] Design artifacts prepared (full research + brief summary)
- [ ] IF `WORKFLOW_AUTO_DESIGN=true`: approach auto-selected, logged in both files
- [ ] IF `WORKFLOW_AUTO_DESIGN=false`: session will end after exit gate
- [ ] Seed data requirements confirmed (if applicable)
- [ ] Exit gate completed (all file writes and tracking updates happen there)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write design notes to `-design.md` sister file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the Design phase, you MUST complete these steps IN ORDER.
This is the SINGLE authoritative checklist -- all file writes happen here, not in the workflow steps above.

1. Delegate to doc-updater (Haiku) to write design artifacts:
   a. Write full research to `STAGE-XXX-YYY-ZZZ-design.md` sister file (approaches, trade-offs, codebase exploration findings, brainstormer output)
   b. Write brief options summary to stage file's Design Phase section
2. Delegate to doc-updater (Haiku) to update tracking documents:
   a. Mark Design phase complete in `STAGE-XXX-YYY-ZZZ.md`
   b. Set stage status (Build if auto-design, User Design Feedback otherwise)
   c. Update stage status in `TICKET-XXX-YYY.md` (MANDATORY)
   d. Update ticket status in `EPIC-XXX.md` if needed
3. Use Skill tool to invoke `lessons-learned`
4. Use Skill tool to invoke `journal`

**Why this order?**

- Step 1: Persist detailed research before anything else (if session crashes, research is saved)
- Step 2: Establish facts (phase done, status updated in all tracking files)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

**After exit gate completes:**

- **IF `WORKFLOW_AUTO_DESIGN=true`:** Use Skill tool to invoke `phase-build` to begin the next phase.
- **IF `WORKFLOW_AUTO_DESIGN=false`:** Session ends. Do NOT invoke `phase-build`. The user will provide design feedback in a separate session using the `phase-awaiting-design-decision` skill.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Build phase (when auto-design) until exit gate is complete.** This includes:

- Announcing "proceeding to Build"
- Reading code files for Build planning
- Thinking about implementation approach
- Invoking phase-build skill

**Complete ALL exit gate steps FIRST. Then either invoke phase-build (auto-design) or end session (default).**
