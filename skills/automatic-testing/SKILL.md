---
name: phase-refinement
description: Use when entering Refinement phase of epic-stage-workflow - guides user testing, feedback incorporation, and iteration
---

# Refinement Phase

## Purpose

The Refinement phase validates the implementation through user testing. It ensures the feature works correctly across viewports (frontend) or integration scenarios (backend).

## Entry Conditions

- Build phase is complete (code written, verification passed)
- `epic-stage-workflow` skill has been invoked (shared rules loaded)

## RED FLAGS - Read BEFORE Making ANY Viewport Decisions

**IF YOU ARE THINKING ANY OF THESE THOUGHTS, YOU ARE VIOLATING THE RULE:**

| Thought                                   | Why You're Wrong                                     |
| ----------------------------------------- | ---------------------------------------------------- |
| "This change is mobile-specific CSS"      | STOP - analyzing scope means you're rationalizing    |
| "Desktop won't be affected technically"   | STOP - technical analysis is irrelevant to this rule |
| "Desktop was approved before the change"  | STOP - timing doesn't matter                         |
| "The CSS only targets mobile breakpoints" | STOP - CSS scope doesn't matter                      |
| "It's just padding, not a layout change"  | STOP - change severity doesn't matter                |
| "Only the changed viewport needs re-test" | STOP - you misunderstand the rule                    |

**Self-Check Question**: Did you just analyze whether a code change will "affect" a viewport? **If yes, you are rationalizing.** The rule doesn't care about your analysis.

## The Absolute Workflow Rule

```
if (ANY_code_changed_during_refinement) {
    reset_BOTH_viewport_approvals();
    require_re_test_for_BOTH_viewports();
}
```

**There are ZERO exceptions based on:**

- CSS specificity or targeting
- Technical impact analysis
- Change severity (padding vs layout)
- Timing (before/after approval)
- Developer judgment of scope
- "Common sense" about what "should" affect what

**Why no exceptions:**

- CSS has complex cascade and specificity rules
- Media queries can interact in unexpected ways
- "Safe" changes cause bugs all the time
- User approved a specific code state; that state changed
- **The cost of re-testing is low. The cost of shipping a regression is high.**

**This is a WORKFLOW rule, not a technical rule.** It exists to ensure comprehensive testing coverage regardless of what you think the technical impact is.

## Session Boundary Rules

When resuming Refinement in a new session:

### Determining Starting Point

1. **Check for code changes** since last session:

   ```bash
   git log --oneline <last-session-commit>..HEAD
   git status --porcelain
   ```

2. **Read stage file** to check viewport state from previous session

3. **If code has CHANGED** (new commits OR uncommitted changes):
   - Invalidate all previous approvals automatically
   - Report: "Code changed since last session (X new commits / uncommitted changes). Previous approvals invalidated. Re-testing required."
   - Proceed with fresh testing: Desktop → Mobile
   - User CANNOT choose to trust stale approvals when code has changed

4. **If code is CLEAN** (no commits since last session, no uncommitted changes):
   - Report: "Code unchanged since last session (verified via git). Previous approvals: Desktop [status], Mobile [status]"
   - Ask user for direction:
     - "(A) Re-test both viewports from scratch (safest)"
     - "(B) Trust previous approvals (code verified unchanged)"
     - "(C) Re-test only the unapproved viewport"

**Why mandatory git check:** Between sessions, teammates may push changes, dependencies may update, or local edits may occur. Trusting stale approvals without verification risks shipping untested code.

### Code Changes Invalidate ALL Previous Approvals

If you make ANY code change in this session (even to fix an approved viewport):

- ALL viewport approvals from previous sessions are invalidated
- Both viewports must be re-tested
- This rule applies regardless of what the code change is

### No Code Changes This Session

If you have NOT made any code changes yet:

- User may choose to trust previous approvals
- OR user may choose to re-test for confidence
- Agent presents options, user decides

**The viewport reset rule applies across session boundaries.** Previous-session approvals are convenience, not guarantees.

## Real-Time Testing Does NOT Bypass Reset Rule

Even if user is watching you test both viewports live:

- Code change resets ALL viewport approvals
- User must explicitly re-approve each viewport AFTER the change
- Visual confirmation during testing ≠ formal approval
- Re-test both viewports even if user says "I saw it working"

**The rule is about workflow consistency, not trust.**

| Thought                                 | Why You're Wrong                               |
| --------------------------------------- | ---------------------------------------------- |
| "User saw it working before the change" | Approval is for code STATE, not visual memory  |
| "We never left the session"             | Session continuity doesn't override reset rule |
| "User confirmed visually"               | Visual ≠ explicit approval via workflow        |

### What Counts as "Explicit Approval"

**Formal approval workflow:**

1. Agent tests viewport (takes screenshot or describes state)
2. Agent presents result to user: "Desktop shows [X]. Approve?"
3. User provides unambiguous approval: "Approved" / "LGTM" / "Yes, looks good"

**Timing matters:**

- Approval MUST follow the agent's explicit "Approve?" question (step 2)
- Statements during presentation (steps 1-2) are observations, NOT approvals
- Example: User says "looks good" during demo → observation, not approval
- Agent must still ask "Approve?" and wait for response

**NOT formal approval:**

- "It's fine" during live testing → Too casual, may be acknowledgment not approval
- "I saw it working" → Visual observation, not approval decision
- "Skip re-testing" → Waiver request, not approval of functionality
- Nodding along during demo → Passive observation, not active approval
- Preemptive approval ("just approve it") before testing → Invalid timing
- Conditional approval ("approve if X") → Agent must verify X, then ask "X confirmed. Approve?"
- Emoji-only responses (👍, ✅) → Require text confirmation: "Confirming approval?"

**Multi-viewport approval:**

- Agent must explicitly list viewports: "Approving desktop AND mobile?"
- User must acknowledge all: "Yes, both approved" or "Approve desktop and mobile"
- Partial approval allowed: "Approve desktop, need to re-test mobile"
- Generic "approve all" without agent listing viewports is NOT formal approval

**Approval lifecycle:**

- Approval is valid until user retracts or code changes
- Retraction keywords: "wait", "hold on", "let me check again", "actually..."
- If user retracts → Return to Refinement (approval invalidated)
- If code changes post-approval → Re-approval required (per viewport reset rule)

**Re-approval after retraction:**

- User can re-approve after additional testing
- Each approval/retraction cycle is independent - no limit on cycles
- Previous retractions do not affect validity of subsequent approval

**Batch approval after retractions:**

- If user approves multiple viewports at once (e.g., "Approve both desktop and mobile"), treat as valid for all explicitly listed viewports
- Agent must have presented each viewport to user before batch approval is valid
- Vague batch approvals ("approve everything") require clarification: "Confirming approval for desktop AND mobile?"

**State after cascading retractions:**

Example: approve → retract → approve → retract → "approve both"

- Final "approve both" is valid approval for both viewports
- Previous retraction history is irrelevant once user explicitly re-approves
- Agent proceeds to next phase

**If user wants to skip re-testing:**

1. User must explicitly state: "I waive re-testing for [viewport] because [reason]"
2. Agent documents in stage file: "Desktop re-test waived by user: [reason]"
3. Waiver is NOT approval - it's documented risk acceptance

**Why this matters:**

- Casual "it's fine" can mean "stop explaining" not "I approve"
- Formal approval creates clear audit trail
- Ambiguous approval leads to "I thought you approved" disputes

---

**CRITICAL: Any code change during Refinement resets the OTHER viewport's approval!**

- If Desktop is approved and you change code for Mobile → Desktop approval is reset
- If Mobile is approved and you change code for Desktop → Mobile approval is reset
- Both viewports must be re-tested after any code change

**No exceptions. Ever.**

### Edge Case: Code Changes Before Both Viewports Tested

**Scenario:**

1. Desktop approved
2. Before testing Mobile, code change is made (for any reason)
3. Desktop approval is reset
4. Mobile was never approved

**Rule:** Treat this identically to both viewports being reset. Test Desktop first (again), then Mobile.

**Why:** The code state Desktop was approved against no longer exists. Both viewports must be validated against the new code state.

## Frontend Workflow

```
1. User tests Desktop viewport
2. User reports any issues
3. [IF issues] → Delegate to debugger-lite/debugger → Delegate to fixer → Delegate to verifier
4. [LOOP until Desktop approved]

5. User tests Mobile viewport
6. User reports any issues
7. [IF issues] → Delegate to debugger-lite/debugger → Delegate to fixer → Delegate to verifier
8. [LOOP until Mobile approved]

9. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Refinement phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
   - Add regression items to epic's epics/EPIC-XXX/regression.md
```

## Backend-Only Workflow

```
1. Delegate to e2e-tester (Sonnet) to design and run API/integration tests
2. [IF issues found] → Delegate to debugger-lite/debugger → Delegate to fixer → Delegate to verifier
3. [LOOP until e2e-tester passes]
4. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Refinement phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
   - Add regression items to epic's epics/EPIC-XXX/regression.md
```

## Determining Frontend vs Backend

- **Frontend**: Any UI components, styles, user-facing changes
- **Backend**: API changes, database, services, no UI impact

## Phase Gates Checklist

### Frontend

- [ ] Desktop tested and approved by user
- [ ] Mobile tested and approved by user
- [ ] **Remember**: Code changes reset OTHER viewport's approval
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - Regression items added to epic's regression.md

### Backend-Only

- [ ] e2e-tester designed and ran API/integration tests
- [ ] All scenarios passed (or issues fixed via debugger → fixer)
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - Regression items added to epic's regression.md

---

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

Before proceeding to Finalize phase, you MUST complete these steps IN ORDER:

1. Update stage tracking file (mark Refinement phase complete)
2. Update epic tracking file (update stage status in table)
3. Verify regression items were added to epic's regression.md (from workflow step 9)
4. Use Skill tool to invoke `lessons-learned`
5. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Establish facts (phase done, status updated)
- Step 3: Verify artifacts were created during workflow
- Steps 4-5: Capture learnings and feelings based on the now-complete phase

Lessons and journal need the full phase context, including final status updates. Running them before status updates means they lack complete information.

After completing all exit gate steps, use Skill tool to invoke `phase-finalize` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Finalize phase until exit gate is complete.** This includes:

- Announcing "proceeding to Finalize"
- Reading code files for Finalize planning
- Starting code review mentally
- Invoking phase-finalize skill

**Complete ALL exit gate steps FIRST. Then invoke phase-finalize.**
