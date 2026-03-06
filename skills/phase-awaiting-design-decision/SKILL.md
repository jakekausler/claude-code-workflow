---
name: phase-awaiting-design-decision
description: Use when entering User Design Feedback phase - facilitates user review of design options, discussion of trade-offs, and selection of implementation approach
---

# User Design Feedback Phase

## Purpose

The User Design Feedback phase is an interactive session where the user reviews design options produced by the prior Design phase, discusses trade-offs with the agent, and selects an approach. Once a decision is made, the rationale is recorded and the stage transitions to Build.

## Trigger

This skill is invoked when the stage status is **User Design Feedback** (set by `phase-design` when `WORKFLOW_AUTO_DESIGN=false`).

## Entry Conditions

- `phase-design` has completed and set status to "User Design Feedback"
- `ticket-stage-workflow` skill has been invoked (shared data conventions loaded)
- Stage YAML frontmatter has been read (status, refinement_type, ticket, epic, etc.)
- `STAGE-XXX-YYY-ZZZ-design.md` sibling file exists (written by Design phase)

**When `WORKFLOW_AUTO_DESIGN=true`:** This skill is never entered. `phase-design` transitions directly to Build and this session does not occur.

## CRITICAL: Main Agent Coordination Only

**The main agent is a COORDINATOR, not an executor.**

- Main agent DELEGATES all file writes to doc-updater subagents
- Main agent NEVER reads, writes, or modifies files directly
- Main agent discusses options with the user and facilitates the decision
- Use the Task tool to spawn subagents for ALL file operations

**If you're about to read a file, write content, or run a command (other than simple git) → STOP → Delegate to a subagent instead.**

## Phase Workflow

```
1. Read all sibling files for context
   Delegate to Explore (built-in) to read ALL `STAGE-XXX-YYY-ZZZ-*.md` sibling
   files in the same ticket directory. This will include:
   - `STAGE-XXX-YYY-ZZZ-design.md` (full research from Design phase)
   - Any other sibling notes files from prior phases

2. Read stage file for design options summary
   Delegate to Explore to read the stage file's Design Phase section,
   which contains the brief options summary (approach names + one-liners).

3. Present design options to the user
   Combine the brief summary from the stage file with the full research
   from `-design.md` to give the user a complete picture:
   - List each approach with its name and description
   - Highlight key trade-offs, risks, and benefits from the research
   - Note the brainstormer's recommendation (if one was given)
   - Include relevant codebase context that informs the decision

4. Discuss with the user
   Go back-and-forth as needed:
   - Answer questions about specific approaches
   - Clarify trade-offs and implications
   - Discuss risks and mitigations
   - Explore variations or hybrid approaches if the user wants
   - Provide technical context from the design research
   - This is a conversation -- let the user drive the pace

5. User selects an approach
   Wait for the user to make a clear selection. Do NOT rush the decision.
   The user may:
   - Pick one of the presented options
   - Request a hybrid of multiple options
   - Ask for a variation not originally presented
   - Request additional research (delegate to Explore if needed)

6. Prepare exit gate content (DO NOT write files yet -- exit gate handles all writes)

   a. Discussion log and decision rationale for `STAGE-XXX-YYY-ZZZ-user-design-feedback.md`:
      - Summary of options discussed
      - Key questions the user asked and answers given
      - Trade-offs that influenced the decision
      - Selected approach and WHY it was chosen
      - Rejected alternatives and WHY they were rejected
      - Any modifications or constraints the user added

   b. Stage file update content:
      - Selected approach name + brief rationale for the Design Phase section (`User Choice` field)
      - Status change: "User Design Feedback" → "Build"
```

## Discussion Log File (`STAGE-XXX-YYY-ZZZ-user-design-feedback.md`)

The discussion log sibling file captures the decision-making process so later phases (Build, Finalize) and future sessions can understand WHY an approach was chosen. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md                        # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md                 # design research (from Design phase)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-user-design-feedback.md   # decision rationale (from this phase)
```

**Contents of the discussion log file:**

- Options that were discussed (brief recap)
- Key questions and answers from the conversation
- Trade-offs the user weighed
- Selected approach with full rationale
- Rejected alternatives with reasons
- Any user-specified modifications, constraints, or requirements
- If the user chose a hybrid or variation: what was combined and why

**The main stage file stays lean.** Only the selected approach name + brief rationale go in the stage file's Design Phase section. Full discussion lives in `-user-design-feedback.md`.

## Reading Stage Data

All stage metadata is read from YAML frontmatter in the stage file (`STAGE-XXX-YYY-ZZZ.md`), not from markdown headers. Key fields:

- `id`: Stage identifier (e.g., `STAGE-001-001-001`)
- `ticket`: Parent ticket (e.g., `TICKET-001-001`)
- `epic`: Parent epic (e.g., `EPIC-001`)
- `title`: Stage title
- `status`: Current status (should be "User Design Feedback")
- `refinement_type`: List of types (frontend, backend, cli, database, infrastructure, custom)
- `depends_on`: Dependencies
- `worktree_branch`: Git worktree branch name

File paths follow the three-level hierarchy:
```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md
```

## Phase Gates Checklist

Before completing the User Design Feedback phase, verify:

- [ ] All sibling files read for context (especially `-design.md`)
- [ ] Design options presented to user with trade-offs from research
- [ ] Discussion occurred -- user had opportunity to ask questions
- [ ] User made a clear approach selection
- [ ] Discussion log and decision rationale prepared for `-user-design-feedback.md`
- [ ] Stage file update content prepared (selected approach + status change)
- [ ] Exit gate completed (all file writes and tracking updates happen there)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write discussion log to `-user-design-feedback.md` sibling file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the User Design Feedback phase, you MUST complete these steps IN ORDER.
This is the SINGLE authoritative checklist -- all file writes happen here, not in the workflow steps above.

1. Delegate to doc-updater (Haiku) to write discussion artifacts:
   a. Write discussion log and decision rationale to `STAGE-XXX-YYY-ZZZ-user-design-feedback.md` sibling file (options discussed, questions asked, trade-offs weighed, selected approach + rationale, rejected alternatives + reasons)
2. Delegate to doc-updater (Haiku) to update tracking documents:
   a. Update stage file's Design Phase section (specifically the `User Choice` field) with selected approach + brief rationale
   b. Set stage status → Build in `STAGE-XXX-YYY-ZZZ.md`
   c. Update stage status in `TICKET-XXX-YYY.md` (MANDATORY)
   d. Update ticket status in `EPIC-XXX.md` if needed
3. Use Skill tool to invoke `lessons-learned` -- **mandatory, no exceptions**
4. Use Skill tool to invoke `journal` -- **mandatory, no exceptions**

**Why this order?**

- Step 1: Persist decision rationale before anything else (if session crashes, the decision is saved)
- Step 2: Establish facts (selected approach recorded, status updated to Build in all tracking files)
- Steps 3-4: Capture learnings and feelings based on the now-complete decision process

**After exit gate completes:**

Session ends. Build phase will be handled in a new session with the `phase-build` skill. Do NOT invoke `phase-build` from this session.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT claim the phase is complete until exit gate is done.** This includes:

- Telling user "decision recorded" or "moving to Build"
- Starting any Build phase planning
- Reading code files for implementation
- Invoking phase-build skill

**Complete ALL exit gate steps FIRST. Then the session ends.**
