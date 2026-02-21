---
name: phase-build
description: Use when entering Build phase of ticket-stage-workflow — guides implementation planning, code writing, and verification within the epic/ticket/stage hierarchy
---

# Build Phase

## Purpose

The Build phase implements the selected approach from Design. It creates working code that can be tested in Automatic Testing.

## Entry Conditions

- Design phase is complete (approach selected, tracking docs updated)
- `ticket-stage-workflow` skill has been invoked (shared data conventions loaded)
- Stage YAML frontmatter has been read (status, refinement_type, ticket, epic, worktree_branch, etc.)

## Worktree Awareness

Before implementation begins, check if `worktree_branch` is set in the stage's YAML frontmatter.

**If `worktree_branch` is set:**

1. Check if the git worktree already exists for this branch:
   ```bash
   git worktree list | grep <worktree_branch>
   ```
2. If the worktree does NOT exist, create it:
   ```bash
   git worktree add ../worktrees/<worktree_branch> -b <worktree_branch>
   ```
   The worktree path uses the branch name under a `worktrees/` sibling directory.
3. Ensure the worktree is checked out to the correct branch before any code changes begin.

**If `worktree_branch` is not set:**

- Proceed with implementation in the current working directory (default behavior).

> **Note**: Full worktree lifecycle management (cleanup, port isolation, `$WORKTREE_INDEX` assignment) ships in Stage 6. For now, create the worktree if it doesn't exist and work within it.

## Spec Handoff Protocol (CRITICAL)

**Problem:** Planner output doesn't automatically transfer to implementer subagents. Main agent context is NOT inherited by subagents.

**Required workflow:**

1. **Planner/planner-lite agents MUST:**
   - Get timestamp using bash: `TIMESTAMP=$(date +%Y-%m-%d-%H-%M-%S)` - NEVER estimate
   - Save spec to `/tmp/spec-$TIMESTAMP.md`
   - Include "Spec saved to: [filepath]" at END of response
   - Example: "Spec saved to: /tmp/spec-2026-01-12-15-30-45.md"

2. **Main agent MUST:**
   - Extract spec file path from planner response
   - Pass file path explicitly to implementer agents
   - NEVER say "use the spec above" or "from planner-lite above"
   - Template: "Read and implement the spec from: /tmp/spec-2026-01-12-15-30-45.md"

3. **Implementer agents (scribe/fixer) MUST:**
   - Read spec file FIRST before any implementation
   - Confirm spec contents in response
   - Example: "Read spec from [filepath]. Spec defines [summary]. Implementing now..."

### "Obvious Steps" Still Require Written Spec

**CRITICAL: "I can describe the steps clearly" ≠ "Skip planner"**

IF you can articulate the implementation steps:
→ Those steps ARE the spec
→ Write them to `/tmp/spec-*.md` via planner-lite
→ Takes 60 seconds, ensures scribe has written reference

ONLY skip spec file for:

- Single-line config changes
- Typo fixes
- Changes requiring zero verification testing

**Test**: If scribe will use Read/Edit tools → Write a spec file first

### Spec-First Sequencing (NO Retroactive Specs)

**CRITICAL: Spec BEFORE implementation. NO exceptions.**

```
CORRECT: planner-lite → spec file → scribe implements spec
WRONG:   scribe implements → write spec after "for documentation"
```

**Why this matters:**

- Specs force you to THINK before acting
- Retroactive specs describe what you did, not what you should do
- Writing spec after defeats the planning purpose entirely

**If you already implemented before reading this:**

- See "Out-of-Sequence Recovery" section above
- DO NOT write a retroactive spec to "comply" - that's not compliance
- The time is already spent; use the recovery workflow

**Rationalizations that don't work:**

- "I'll write the spec after, it's faster" → Spec-after is not a spec
- "The implementation is the spec" → Code is not documentation
- "I know what I'm doing" → Everyone thinks this; spec anyway

### Mid-Implementation Complexity Discovery

**Scenario:** You started with what seemed trivial (no spec needed), but halfway through you realize it's complex.

**This is NOT retroactive spec-writing.** You're writing a PROSPECTIVE spec for remaining work.

**Resolution workflow:**

1. STOP implementation immediately
2. Document what you've learned so far (this is reconnaissance, not retroactive spec)
3. Call planner-lite to write spec for REMAINING work
4. Mark already-completed work as "exploratory spike" in stage file
5. Continue with spec-driven development for remaining work

**Key distinction:**

- Retroactive = Writing spec for COMPLETED work ("I did X, here's the spec for X")
- Prospective = Writing spec for REMAINING work after learning ("I learned X, here's spec for remaining Y")

**Escalation triggers (any of these → STOP and write spec):**

- Started as <3 files → Now touching 3+ files
- Started as single component → Now requires state/API changes
- Started as "copy existing pattern" → Now deviating from pattern
- Estimated 10 minutes → Already spent 30+ minutes

**"Almost done" is NOT an exception:**

There is NO completion percentage where you're "too far along" to need a spec.

- "I'm 90% done" / "99% done" / "almost finished" → STOP. Write spec for remaining work
- "Just one more function" / "just one more line" → STOP. If you're rationalizing, you need a spec
- "Writing spec takes longer than finishing" → STOP. Spec documents complexity for future developers

**Explicit examples that do NOT exempt you:**

- "Remaining 1% is trivial"
- "It's just a closing brace"
- "The overhead isn't worth it for this little"

**Why late-stage specs matter:** A spec written at 99% documents the complexity you discovered. It's a "complexity warning label" preventing future developers from assuming the task was trivial.

## Out-of-Sequence Recovery

**IF YOU ALREADY IMPLEMENTED BEFORE READING THIS SKILL:**

This is a sunk cost situation. The time spent is gone whether you keep or redo the code.

**Correct recovery path:**

1. Acknowledge: "Implementation happened out-of-sequence"
2. Delegate to code-reviewer (Opus) to review existing implementation
3. If major issues found: Redo with proper workflow (brainstormer → planner → scribe)
4. If minor issues only: Apply fixes via fixer and continue Build workflow from verification step
5. Document in stage file: "Implementation preceded workflow on [date], recovered via [action]"

**DO NOT:**

- Rationalize skipping remaining workflow steps
- Assume the premature implementation is correct
- Skip code review because "it's already written"
- Treat sunk cost as justification for shortcuts

---

## Phase Workflow

```
1. Read all sibling files for prior context
   Delegate to Explore (built-in) to read ALL `STAGE-XXX-YYY-ZZZ-*.md` sibling
   files in the same ticket directory. This will include:
   - `STAGE-XXX-YYY-ZZZ-design.md` (design research from Design phase)
   - `STAGE-XXX-YYY-ZZZ-user-design-feedback.md` (decision rationale, if present)
   - Any other sibling notes files from prior phases

2. [CONDITIONAL: Worktree Setup]
   IF worktree_branch is set in stage YAML frontmatter:
     → Ensure git worktree exists (create if needed)
     → Switch to worktree directory for all subsequent work

3. [CONDITIONAL: Planning]
   IF complex multi-file feature OR architectural change:
     → Delegate to planner (Opus) for detailed implementation spec
     → Planner MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE IF simple single-file OR straightforward change:
     → Delegate to planner-lite (Sonnet) for simple spec
     → Planner-lite MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE (trivial change):
     → Skip planner, main agent instructs scribe directly (no spec file needed)

4. Delegate to scribe (Haiku) to write code from spec file
   → Pass spec file path explicitly: "Read and implement: /tmp/spec-YYYY-MM-DD-HH-MM-SS.md"

5. Add seed data if agreed in Design phase

6. Add placeholder stubs for related future features

7. Verify dev server works — feature must be testable

8. [PARALLEL] Delegate to verifier (Haiku) + tester (Haiku)
   Run build/lint/type-check AND tests in parallel

9. [IF verification fails] → Analyze errors, delegate to fixer (Haiku) to resolve

10. [LOOP steps 4-9 until green]

11. Prepare build session notes (DO NOT write files yet — exit gate handles all writes)

    Content for `STAGE-XXX-YYY-ZZZ-build.md`:
    - Implementation decisions made during the session
    - Problems encountered and how they were solved
    - Deviations from the design (if any)
    - Key code changes and their rationale
```

## Build Notes File (`STAGE-XXX-YYY-ZZZ-build.md`)

The build notes sibling file captures implementation context so later phases (Automatic Testing, Manual Testing, Finalize) can reference it. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md                        # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md                 # design research
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-user-design-feedback.md   # decision rationale
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-build.md                  # build notes (this phase)
```

**Contents of the build notes file:**

- Implementation decisions made during the session
- Problems encountered and how they were solved
- Deviations from the design (if any)
- Key code changes and their rationale

**The main stage file stays lean.** Only build phase completion status goes in the stage file. Full implementation context lives in `-build.md`.

## Planner Selection Criteria

**Use planner (Opus) when ANY of these apply:**

- Changes span 3+ files across packages (backend + frontend)
- Integration between systems (WebSocket, GraphQL, external APIs)
- Real-time features (WebSocket, SSE, polling)
- State management changes (Zustand stores, cache patterns)
- Database schema changes + service layer + resolvers
- New architectural patterns for the codebase

**CRITICAL: "Requirements are clear" does NOT mean "use planner-lite"**

- Requirements clarity is about WHAT to build
- Planner tier is about HOW MANY moving parts coordinate

**Example of Opus-level complexity:**

- "Add WebSocket notifications" touches 7+ files across backend/frontend with real-time state sync
- Even if requirements are crystal clear, the integration coordination requires Opus

**Example of Sonnet-level simplicity:**

- "Add loading spinner to existing button" is 1-2 files with no integration

**Skip planner when:**

- Single-file change with clear requirements
- Bug fix with known solution
- Simple config or documentation change

## "Trivial" Means Literally Trivial

Trivial ONLY includes:

- [ ] Single-line changes (typo, constant value)
- [ ] Documentation-only edits
- [ ] Config file tweaks with no code impact

**NOT trivial (requires planner-lite at minimum):**

- Adding UI elements (even "just" a spinner)
- CSS changes affecting layout or spacing
- Any change requiring verification testing
- "Quick" features (if it needs testing, it needs planning)

**Test**: Would verifier/tester need to run? → Not trivial → Write spec

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

Before completing Build phase, verify:

- [ ] All sibling files read for context (design, user-design-feedback notes)
- [ ] Worktree checked out (if `worktree_branch` is set)
- [ ] Implementation spec created (planner OR planner-lite OR direct for trivial)
- [ ] Code written via scribe
- [ ] Seed data added (if agreed in Design)
- [ ] Placeholder stubs added for related future features
- [ ] Dev server verified working
- [ ] Verification passed (verifier + tester in parallel)
- [ ] Build session notes prepared for `-build.md`
- [ ] Exit gate completed (all file writes and tracking updates happen there)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write build notes to `-build.md` sibling file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the Build phase, you MUST complete these steps IN ORDER.
This is the SINGLE authoritative checklist -- all file writes happen here, not in the workflow steps above.

1. Delegate to doc-updater (Haiku) to write build artifacts:
   a. Write build session notes to `STAGE-XXX-YYY-ZZZ-build.md` sibling file (implementation decisions, problems encountered, deviations from design, key code changes and rationale)
2. Delegate to doc-updater (Haiku) to update tracking documents:
   a. Mark Build phase complete in `STAGE-XXX-YYY-ZZZ.md`
   b. Set stage status → Automatic Testing in `STAGE-XXX-YYY-ZZZ.md`
   c. Update stage status in `TICKET-XXX-YYY.md` (MANDATORY)
   d. Update ticket status in `EPIC-XXX.md` if needed
3. Use Skill tool to invoke `lessons-learned` -- **mandatory, no exceptions**
4. Use Skill tool to invoke `journal` -- **mandatory, no exceptions**

**Why this order?**

- Step 1: Persist build context before anything else (if session crashes, implementation notes are saved)
- Step 2: Establish facts (phase done, status updated to Automatic Testing in all tracking files)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

**After exit gate completes:**

Use Skill tool to invoke `automatic-testing` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Automatic Testing phase until exit gate is complete.** This includes:

- Announcing "proceeding to Automatic Testing"
- Starting user testing discussions
- Thinking about what to test
- Invoking automatic-testing skill

**Complete ALL exit gate steps FIRST. Then invoke automatic-testing.**
