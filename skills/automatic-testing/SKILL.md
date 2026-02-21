---
name: automatic-testing
description: Use when entering Automatic Testing phase of ticket-stage-workflow — guides type-specific testing and user approval cycles
---

# Automatic Testing Phase

## Purpose

The Automatic Testing phase validates the implementation through type-specific testing. It ensures the feature works correctly based on the stage's `refinement_type` — whether that's frontend viewports, backend integration, CLI behavior, database migrations, infrastructure deployments, or custom criteria defined during Design.

## Entry Conditions

- Build phase is complete (code written, verification passed)
- `ticket-stage-workflow` skill has been invoked (shared data conventions loaded)
- Stage YAML frontmatter contains `refinement_type` (array of one or more types)

**Re-entry note:** If re-entering Automatic Testing (e.g., kicked back from Manual Testing), read existing `-automatic-testing.md` sibling and overwrite with updated test results.

## Phase Workflow (Start of Session)

```
1. Read all sibling files for prior context
   Delegate to Explore (built-in) to read ALL `STAGE-XXX-YYY-ZZZ-*.md` sibling
   files in the same ticket directory. This will include:
   - `STAGE-XXX-YYY-ZZZ-design.md` (design research from Design phase)
   - `STAGE-XXX-YYY-ZZZ-user-design-feedback.md` (decision rationale, if present)
   - `STAGE-XXX-YYY-ZZZ-build.md` (build notes from Build phase)
   - Any other sibling notes files from prior phases

2. Read refinement_type from stage YAML frontmatter
   → Determine the checklist (see below)

3. Execute type-specific testing workflows (see Workflow by Refinement Type)

4. After all types approved, prepare automatic-testing session notes
   (DO NOT write files yet — exit gate handles all writes)

   Content for `STAGE-XXX-YYY-ZZZ-automatic-testing.md`:
   - Test results (pass/fail counts, specific failures)
   - Failures found and fixes applied
   - Test coverage observations
   - Issues deferred to manual testing
```

## Determining the Checklist

Read `refinement_type` from the stage's YAML frontmatter. This field is an array — when multiple types are listed, combine all checklists (all approvals required).

### Checklists by Type

**Frontend (`refinement_type` includes `frontend`)**:
- [ ] Desktop Approved
- [ ] Mobile Approved
- [ ] Regression Items Added

**Backend (`refinement_type` includes `backend`)**:
- [ ] E2E Tests Approved
- [ ] Regression Items Added

**CLI (`refinement_type` includes `cli`)**:
- [ ] CLI Behavior Approved
- [ ] Regression Items Added

**Database (`refinement_type` includes `database`)**:
- [ ] Migration Verified
- [ ] Data Integrity Approved
- [ ] Regression Items Added

**Infrastructure (`refinement_type` includes `infrastructure`)**:
- [ ] Deployment Verified
- [ ] Regression Items Added

**Custom (`refinement_type` includes `custom`)**:
- [ ] User-defined approvals (established during Design phase)
- [ ] Regression Items Added

### Combined Example

A stage with `refinement_type: [frontend, backend]` requires:
- [ ] Desktop Approved
- [ ] Mobile Approved
- [ ] E2E Tests Approved
- [ ] Regression Items Added

"Regression Items Added" appears once regardless of how many types are combined.

## RED FLAGS - Read BEFORE Making ANY Approval Decisions

**IF YOU ARE THINKING ANY OF THESE THOUGHTS, YOU ARE VIOLATING THE RULE:**

| Thought | Why You're Wrong |
| --- | --- |
| "This change only affects one refinement type" | STOP - analyzing scope means you're rationalizing |
| "The other approvals won't be affected technically" | STOP - technical analysis is irrelevant to this rule |
| "That type was approved before the change" | STOP - timing doesn't matter |
| "The change only targets one subsystem" | STOP - subsystem scope doesn't matter |
| "It's just a minor tweak, not a real change" | STOP - change severity doesn't matter |
| "Only the changed type needs re-testing" | STOP - you misunderstand the rule |

**Self-Check Question**: Did you just analyze whether a code change will "affect" one of the refinement types? **If yes, you are rationalizing.** The rule does not care about your analysis.

## The Absolute Workflow Rule

```
if (ANY_code_changed_during_testing) {
    reset_ALL_approvals_for_ALL_refinement_types();
    require_re_test_for_ALL_types();
}
```

**There are ZERO exceptions based on:**

- Technical impact analysis
- Change severity (minor tweak vs major refactor)
- Subsystem targeting or scope
- Timing (before/after approval)
- Developer judgment of scope
- "Common sense" about what "should" affect what

**Why no exceptions:**

- Subsystems interact in unexpected ways
- "Safe" changes cause bugs all the time
- User approved a specific code state; that state changed
- **The cost of re-testing is low. The cost of shipping a regression is high.**

**This is a WORKFLOW rule, not a technical rule.** It exists to ensure comprehensive testing coverage regardless of what you think the technical impact is.

## Session Boundary Rules

When resuming Automatic Testing in a new session:

### Determining Starting Point

1. **Check stage YAML frontmatter** to read `refinement_type` and current approval state

2. **Check for code changes** since last session:

   ```bash
   git log --oneline <last-session-commit>..HEAD
   git status --porcelain
   ```

3. **Read stage file** to check approval state from previous session

4. **If code has CHANGED** (new commits OR uncommitted changes):
   - Invalidate all previous approvals automatically for ALL refinement types
   - Report: "Code changed since last session (X new commits / uncommitted changes). Previous approvals invalidated. Re-testing required for all refinement types."
   - Proceed with fresh testing for all types in `refinement_type`
   - User CANNOT choose to trust stale approvals when code has changed

5. **If code is CLEAN** (no commits since last session, no uncommitted changes):
   - Report: "Code unchanged since last session (verified via git). Previous approvals: [list each type and its status]"
   - Ask user for direction:
     - "(A) Re-test all types from scratch (safest)"
     - "(B) Trust previous approvals (code verified unchanged)"
     - "(C) Re-test only the unapproved types"

**Why mandatory git check:** Between sessions, teammates may push changes, dependencies may update, or local edits may occur. Trusting stale approvals without verification risks shipping untested code.

### Code Changes Invalidate ALL Previous Approvals

If you make ANY code change in this session (even to fix one type's issue):

- ALL approvals for ALL refinement types from previous sessions are invalidated
- All types must be re-tested
- This rule applies regardless of what the code change is

### No Code Changes This Session

If you have NOT made any code changes yet:

- User may choose to trust previous approvals
- OR user may choose to re-test for confidence
- Agent presents options, user decides

**The reset rule applies across session boundaries.** Previous-session approvals are convenience, not guarantees.

## Real-Time Testing Does NOT Bypass Reset Rule

Even if user is watching you test live:

- Code change resets ALL approvals for ALL refinement types
- User must explicitly re-approve each type AFTER the change
- Visual confirmation during testing does not equal formal approval
- Re-test all types even if user says "I saw it working"

**The rule is about workflow consistency, not trust.**

| Thought | Why You're Wrong |
| --- | --- |
| "User saw it working before the change" | Approval is for code STATE, not visual memory |
| "We never left the session" | Session continuity doesn't override reset rule |
| "User confirmed visually" | Visual does not equal explicit approval via workflow |

### What Counts as "Explicit Approval"

**Formal approval workflow:**

1. Agent tests the type (takes screenshot, runs tests, or describes state)
2. Agent presents result to user: "[Type] shows [X]. Approve?"
3. User provides unambiguous approval: "Approved" / "LGTM" / "Yes, looks good"

**Timing matters:**

- Approval MUST follow the agent's explicit "Approve?" question (step 2)
- Statements during presentation (steps 1-2) are observations, NOT approvals
- Example: User says "looks good" during demo — observation, not approval
- Agent must still ask "Approve?" and wait for response

**NOT formal approval:**

- "It's fine" during live testing — Too casual, may be acknowledgment not approval
- "I saw it working" — Visual observation, not approval decision
- "Skip re-testing" — Waiver request, not approval of functionality
- Nodding along during demo — Passive observation, not active approval
- Preemptive approval ("just approve it") before testing — Invalid timing
- Conditional approval ("approve if X") — Agent must verify X, then ask "[Type] — X confirmed. Approve?"
- Emoji-only responses — Require text confirmation: "Confirming approval?"

**Multi-type approval:**

- Agent must explicitly list types: "Approving Desktop, Mobile, AND E2E Tests?"
- User must acknowledge all: "Yes, all approved" or "Approve desktop, mobile, and e2e"
- Partial approval allowed: "Approve desktop, need to re-test mobile"
- Generic "approve all" without agent listing types is NOT formal approval

**Approval lifecycle:**

- Approval is valid until user retracts or code changes
- Retraction keywords: "wait", "hold on", "let me check again", "actually..."
- If user retracts — Return to testing (approval invalidated)
- If code changes post-approval — Re-approval required (per reset rule)

**Re-approval after retraction:**

- User can re-approve after additional testing
- Each approval/retraction cycle is independent — no limit on cycles
- Previous retractions do not affect validity of subsequent approval

**Batch approval after retractions:**

- If user approves multiple types at once (e.g., "Approve desktop, mobile, and e2e"), treat as valid for all explicitly listed types
- Agent must have presented each type to user before batch approval is valid
- Vague batch approvals ("approve everything") require clarification: "Confirming approval for [list all types]?"

**State after cascading retractions:**

Example: approve — retract — approve — retract — "approve all"

- Final "approve all" is valid approval for all listed types
- Previous retraction history is irrelevant once user explicitly re-approves
- Agent proceeds to next phase

**If user wants to skip re-testing:**

1. User must explicitly state: "I waive re-testing for [type] because [reason]"
2. Agent documents in stage file: "[Type] re-test waived by user: [reason]"
3. Waiver is NOT approval — it's documented risk acceptance

**Why this matters:**

- Casual "it's fine" can mean "stop explaining" not "I approve"
- Formal approval creates clear audit trail
- Ambiguous approval leads to "I thought you approved" disputes

---

**CRITICAL: Any code change during Automatic Testing resets ALL approvals for ALL refinement types on this stage!**

- If one type is approved and you change code for another type — ALL approvals reset
- All types must be re-tested after any code change
- No exceptions. Ever.

### Edge Case: Code Changes Before All Types Tested

**Scenario:**

1. Frontend Desktop approved
2. Before testing Mobile, code change is made (for any reason)
3. Desktop approval is reset
4. Mobile was never approved

**Rule:** Treat this identically to all types being reset. Re-test all types from the beginning.

**Why:** The code state that was approved no longer exists. All types must be validated against the new code state.

## Workflow by Refinement Type

### Frontend Workflow

```
1. User tests Desktop
2. User reports any issues
3. [IF issues] → Fix → Verify
4. [LOOP until Desktop approved]

5. User tests Mobile
6. User reports any issues
7. [IF issues] → Fix → Verify
8. [LOOP until Mobile approved]
```

### Backend Workflow

```
1. Design and run API/integration/E2E tests
2. [IF issues found] → Fix → Verify
3. [LOOP until E2E Tests approved]
```

### CLI Workflow

```
1. Test CLI commands and behavior
2. User verifies output, flags, edge cases
3. [IF issues found] → Fix → Verify
4. [LOOP until CLI Behavior approved]
```

### Database Workflow

```
1. Run migration on test data
2. Verify migration integrity (up and down)
3. [IF issues found] → Fix → Verify
4. [LOOP until Migration Verified]

5. Validate data integrity post-migration
6. [IF issues found] → Fix → Verify
7. [LOOP until Data Integrity Approved]
```

### Infrastructure Workflow

```
1. Deploy to test/staging environment
2. Verify deployment health and behavior
3. [IF issues found] → Fix → Verify
4. [LOOP until Deployment Verified]
```

### Custom Workflow

```
1. Load user-defined approval criteria from Design phase notes
2. Test each criterion
3. [IF issues found] → Fix → Verify
4. [LOOP until all custom approvals granted]
```

### After All Types Approved

```
1. Ensure Regression Items Added to ticket's regression.md
2. Prepare automatic-testing session notes for `-automatic-testing.md`
   (DO NOT write files yet — exit gate handles all writes)
```

## Automatic Testing Notes File (`STAGE-XXX-YYY-ZZZ-automatic-testing.md`)

The automatic testing notes sibling file captures testing context so later phases (Manual Testing, Finalize) can reference it. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md                             # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md                      # design research
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-user-design-feedback.md        # decision rationale
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-build.md                       # build notes
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-automatic-testing.md           # automatic testing notes (this phase)
```

**Contents of the automatic testing notes file:**

- Test results (pass/fail counts, specific failures)
- Failures found and fixes applied
- Test coverage observations
- Issues deferred to manual testing

**The main stage file stays lean.** Only automatic testing phase completion status goes in the stage file. Full testing context lives in `-automatic-testing.md`.

## Status Values

During this phase, the stage status in YAML frontmatter will be one of:

- **Automatic Testing** — Agent-driven testing is in progress (current phase)
- **Manual Testing** — Stage requires user-driven manual testing/approval

The transition between these is managed by the `ticket-stage-workflow` skill based on what the stage needs.

## Phase Gates Checklist

The checklist is dynamically constructed from `refinement_type`. All items from all listed types must be checked:

### Frontend Items
- [ ] Desktop tested and approved by user
- [ ] Mobile tested and approved by user

### Backend Items
- [ ] E2E tests designed, run, and approved

### CLI Items
- [ ] CLI behavior tested and approved by user

### Database Items
- [ ] Migration verified (up and down)
- [ ] Data integrity approved

### Infrastructure Items
- [ ] Deployment verified and approved

### Custom Items
- [ ] All user-defined approvals granted

### Always Required
- [ ] All sibling files read for context (design, build, user-design-feedback notes)
- [ ] Regression items added to ticket's `regression.md`
- [ ] **Remember**: ANY code change resets ALL approvals for ALL types
- [ ] Automatic testing session notes prepared for `-automatic-testing.md`
- [ ] Exit gate completed (all file writes and tracking updates happen there)

---

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write automatic testing notes to `-automatic-testing.md` sibling file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the Automatic Testing phase, you MUST complete these steps IN ORDER.
This is the SINGLE authoritative checklist -- all file writes happen here, not in the workflow steps above.

1. Delegate to doc-updater (Haiku) to write automatic testing artifacts:
   a. Write automatic testing session notes to `STAGE-XXX-YYY-ZZZ-automatic-testing.md` sibling file (test results, failures found and fixes applied, coverage observations, issues deferred to manual testing)
2. Delegate to doc-updater (Haiku) to update tracking documents:
   a. Mark Automatic Testing phase complete in `STAGE-XXX-YYY-ZZZ.md`
   b. Set stage status → Manual Testing in `STAGE-XXX-YYY-ZZZ.md`
   c. Update stage status in `TICKET-XXX-YYY.md` (MANDATORY)
   d. Update ticket status in `EPIC-XXX.md` if needed
   e. Verify regression items were added to ticket's `regression.md`
3. Use Skill tool to invoke `lessons-learned` -- **mandatory, no exceptions**
4. Use Skill tool to invoke `journal` -- **mandatory, no exceptions**

**Why this order?**

- Step 1: Persist testing context before anything else (if session crashes, testing notes are saved)
- Step 2: Establish facts (phase done, status updated to Manual Testing in all tracking files)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

**After exit gate completes:**

Use Skill tool to invoke `phase-manual-testing` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Manual Testing phase until exit gate is complete.** This includes:

- Announcing "proceeding to Manual Testing"
- Reading code files for Manual Testing planning
- Starting testing mentally
- Invoking phase-manual-testing skill

**Complete ALL exit gate steps FIRST. Then invoke phase-manual-testing.**
