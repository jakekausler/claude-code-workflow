---
name: phase-manual-testing
description: Use when entering Manual Testing phase — walks user through manual verification based on refinement_type, collects pass/fail approvals, and gates progression until all test areas pass
---

# Manual Testing Phase

## Purpose

The Manual Testing phase is an interactive session where the user manually verifies the implementation beyond what automated tests cover. The agent guides the user through a testing checklist based on `refinement_type`, collects pass/fail results for each test area, and does NOT end the session until all areas are approved.

## Trigger

This skill is invoked when the stage status is **Manual Testing** (set after automatic testing completes).

## Entry Conditions

- Stage status is "Manual Testing"
- Automatic testing phase is complete
- `ticket-stage-workflow` skill has been invoked (shared rules loaded)
- Stage YAML frontmatter has been read (status, refinement_type, ticket, epic, etc.)
- Note: if no `refinement_type` is set, use general functionality verification (treat as `custom`)

## CRITICAL: Main Agent Coordination Only

**The main agent is a COORDINATOR, not an executor.**

- Main agent DELEGATES all file writes to doc-updater subagents
- Main agent NEVER reads, writes, or modifies files directly
- Main agent walks the user through testing and facilitates approvals
- Use the Task tool to spawn subagents for ALL file operations

**If you're about to read a file, write content, or run a command (other than simple git) -- STOP -- Delegate to a subagent instead.**

## Phase Workflow

```
1. Read all sibling files for context
   Delegate to Explore (built-in) to read ALL `STAGE-XXX-YYY-ZZZ-*.md` sibling
   files in the same ticket directory. This will include:
   - `STAGE-XXX-YYY-ZZZ-design.md` (design research)
   - `STAGE-XXX-YYY-ZZZ-build.md` (build notes)
   - `STAGE-XXX-YYY-ZZZ-automatic-testing.md` (automatic testing results)
   - Any other sibling notes files from prior phases

2. Read `refinement_type` from stage file YAML frontmatter
   Delegate to Explore to read the stage file's frontmatter.
   `refinement_type` is an array — when multiple types are listed,
   combine all checklists (all test areas required).
   If `refinement_type` is missing or empty, treat as `custom`.

3. Generate testing checklist
   Build the combined checklist from all refinement types present
   (see "Testing Checklists by Type" below).

4. Present testing overview to user
   Show the user:
   - What was built (brief summary from sibling files)
   - What automatic testing already covered
   - The manual testing checklist they will walk through
   - How the process works (one area at a time, pass/fail for each)

5. Walk user through each test area ONE AT A TIME
   For each test area in the checklist:
   a. Present the test area and what to verify
   b. User performs the test
   c. User reports pass or fail
   d. If FAIL: discuss what went wrong, iterate until the user is satisfied
   e. Mark area as passed only after explicit user approval
   f. Move to next area only after current one passes

6. Session does NOT end until ALL areas are approved
   This is a hard gate. Do NOT:
   - Skip unapproved areas
   - Accept vague approval ("it's fine" without testing)
   - Proceed to exit gate with any area still failing
   - End session with incomplete testing

7. Prepare testing results (DO NOT write files yet -- exit gate handles all writes)

   a. Testing walkthrough content for `STAGE-XXX-YYY-ZZZ-manual-testing.md`:
      - Each test area with pass/fail result
      - Issues found and how they were resolved (if any)
      - User observations and feedback
      - Final approval status for each area

   b. Stage file update content:
      - Manual Testing section with filled-in approval checklist
      - Status change: "Manual Testing" → "Finalize"
```

## Testing Checklists by Type

Read `refinement_type` from the stage's YAML frontmatter. This field is an array -- when multiple types are listed, combine all checklists (all test areas required).

### Frontend (`refinement_type` includes `frontend`)
- [ ] **Visual Checks** -- UI matches design intent, no visual regressions, correct colors/fonts/spacing
- [ ] **Responsive Layout** -- Works at desktop, tablet, and mobile breakpoints; no overflow or clipping
- [ ] **Accessibility** -- Keyboard navigation works, focus indicators visible, screen reader basics, color contrast
- [ ] **User Interactions** -- Clicks, hovers, form inputs, transitions, loading states all behave correctly
- [ ] **Cross-Browser Basics** -- Core functionality works in Chrome, Firefox, Safari (if applicable)

### Backend (`refinement_type` includes `backend`)
- [ ] **API Endpoint Testing** -- Endpoints return correct data, status codes, and response format
- [ ] **Data Integrity** -- Data is created/updated/deleted correctly, no orphaned records
- [ ] **Error Responses** -- Invalid inputs return proper error messages and status codes
- [ ] **Auth Flows** -- Authentication and authorization work correctly, unauthorized access is blocked

### CLI (`refinement_type` includes `cli`)
- [ ] **Command-Line Arguments** -- All flags and arguments work as documented, invalid args show errors
- [ ] **Output Format** -- Output is correct, properly formatted, and readable
- [ ] **Error Messages** -- Clear, actionable error messages for all failure modes
- [ ] **Help Text** -- `--help` output is accurate and complete

### Database (`refinement_type` includes `database`)
- [ ] **Query Correctness** -- Queries return expected results for known inputs
- [ ] **Migration Testing** -- Migrations apply and roll back cleanly
- [ ] **Data Consistency** -- Foreign keys, constraints, and indexes behave correctly

### Infrastructure (`refinement_type` includes `infrastructure`)
- [ ] **Deployment Verification** -- Service deploys and starts correctly
- [ ] **Config Validation** -- Configuration values are applied correctly, env vars are respected
- [ ] **Monitoring** -- Health checks, logs, and metrics are working

### Custom (`refinement_type` includes `custom` or `refinement_type` is missing)
- [ ] **General Functionality Verification** -- Feature works as described in the design phase
- [ ] **Edge Cases** -- Boundary conditions and unusual inputs are handled
- [ ] **User Experience** -- Flow feels correct and intuitive based on what was built

### Combined Example

A stage with `refinement_type: [frontend, backend]` requires ALL test areas from both:
- [ ] Visual Checks
- [ ] Responsive Layout
- [ ] Accessibility
- [ ] User Interactions
- [ ] Cross-Browser Basics
- [ ] API Endpoint Testing
- [ ] Data Integrity
- [ ] Error Responses
- [ ] Auth Flows

## Approval Rules

### What Counts as "Pass"

For each test area, the user must explicitly confirm it passes:
- User says "pass", "approved", "looks good", "LGTM", or equivalent
- Approval must follow the agent's explicit presentation of the test area
- Vague acknowledgments ("ok", "sure") should be clarified: "Confirming [test area] passes?"

### What Counts as "Fail"

- User reports any issue, bug, or concern
- User says "fail", "broken", "not working", "needs fix", or equivalent
- User identifies something that doesn't match expected behavior

### Handling Failures

When a test area fails:

1. Discuss with the user what went wrong
2. Determine what needs to change (if anything -- some issues may be cosmetic or deferred)
3. If a code fix is needed: note it for post-session follow-up or iterate in-session
4. User decides when the area passes (they may accept with caveats or require a fix)
5. If user accepts with caveats: document the caveat in testing results
6. Only move to next test area after current one is resolved

### Session Does NOT End Until All Areas Pass

This is a **hard gate**. The session continues until every test area in the checklist has an explicit pass from the user. There is no shortcut, skip, or override.

If the user wants to defer a test area:
1. User must explicitly state: "I defer [test area] because [reason]"
2. Agent documents the deferral and reason in testing results
3. Deferral is NOT a pass -- it's documented risk acceptance
4. All non-deferred areas must still pass

## Testing Notes File (`STAGE-XXX-YYY-ZZZ-manual-testing.md`)

The testing notes sibling file captures the manual testing walkthrough so later phases (Finalize) and future sessions can understand what was verified. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md                        # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md                 # design research
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-build.md                  # build notes
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-automatic-testing.md      # automatic testing results
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-manual-testing.md         # manual testing results (this phase)
```

**Contents of the testing notes file:**

- Refinement types tested
- Each test area with pass/fail/deferred result
- Issues found during testing and their resolution
- User observations and feedback
- Caveats or deferrals with reasons
- Final approval status summary

**The main stage file stays lean.** Only the filled-in approval checklist goes in the stage file's Manual Testing section. Full testing walkthrough lives in `-manual-testing.md`.

## Reading Stage Data

All stage metadata is read from YAML frontmatter in the stage file (`STAGE-XXX-YYY-ZZZ.md`), not from markdown headers. Key fields:

- `id`: Stage identifier (e.g., `STAGE-001-001-001`)
- `ticket`: Parent ticket (e.g., `TICKET-001-001`)
- `epic`: Parent epic (e.g., `EPIC-001`)
- `title`: Stage title
- `status`: Current status (should be "Manual Testing")
- `refinement_type`: List of types (frontend, backend, cli, database, infrastructure, custom)
- `depends_on`: Dependencies
- `worktree_branch`: Git worktree branch name

File paths follow the three-level hierarchy:
```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md
```

## Phase Gates Checklist

Before completing the Manual Testing phase, verify:

- [ ] All sibling files read for context (design, build, automatic-testing notes)
- [ ] `refinement_type` read from stage file YAML frontmatter
- [ ] Testing checklist generated from all refinement types
- [ ] Testing overview presented to user
- [ ] Each test area walked through one at a time
- [ ] Each test area has explicit pass, or documented deferral with reason
- [ ] ALL test areas resolved (no unapproved areas remaining)
- [ ] Testing walkthrough and results prepared for `-manual-testing.md`
- [ ] Stage file update content prepared (approval checklist + status change)
- [ ] Exit gate completed (all file writes and tracking updates happen there)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write testing results to `-manual-testing.md` sibling file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the Manual Testing phase, you MUST complete these steps IN ORDER.
This is the SINGLE authoritative checklist -- all file writes happen here, not in the workflow steps above.

1. Delegate to doc-updater (Haiku) to write testing artifacts:
   a. Write testing walkthrough and results to `STAGE-XXX-YYY-ZZZ-manual-testing.md` sibling file (test areas, pass/fail results, issues found, resolutions, user feedback, deferrals)
2. Delegate to doc-updater (Haiku) to update tracking documents:
   a. Update stage file's Manual Testing section with filled-in approval checklist
   b. Set stage status → Finalize in `STAGE-XXX-YYY-ZZZ.md`
   c. Update stage status in `TICKET-XXX-YYY.md` (MANDATORY)
   d. Update ticket status in `EPIC-XXX.md` if needed
3. Use Skill tool to invoke `lessons-learned` -- **mandatory, no exceptions**
4. Use Skill tool to invoke `journal` -- **mandatory, no exceptions**

**Why this order?**

- Step 1: Persist testing results before anything else (if session crashes, results are saved)
- Step 2: Establish facts (approval checklist recorded, status updated to Finalize in all tracking files)
- Steps 3-4: Capture learnings and feelings based on the now-complete testing process

**After exit gate completes:**

Session ends. Finalize phase will be handled in a new session with the `phase-finalize` skill. Do NOT invoke `phase-finalize` from this session.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT claim the phase is complete until exit gate is done.** This includes:

- Telling user "testing complete" or "moving to Finalize"
- Starting any Finalize phase planning
- Reading code files for code review
- Invoking phase-finalize skill

**Complete ALL exit gate steps FIRST. Then the session ends.**
