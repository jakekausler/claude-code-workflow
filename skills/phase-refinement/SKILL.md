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

## Validation Strategy by Stage Type

Refinement verifies "does this work in reality?" not "does this compile?" (that's Build's job).

### Frontend Stages
**What to validate**: Visual correctness and responsive behavior
**How**:
- Test at standard viewports (desktop + mobile)
- Use Playwright browser automation or manual testing
- Verify UI matches design intent
- Check responsive breakpoints work correctly

**Example**: Stats cards component
- Desktop (1280×720): 3×2 grid layout
- Mobile (375×667): 2×3 grid layout
- Both: correct data display, no console errors

---

### Backend Stages
**What to validate**: Integration with real data and dependencies
**How**:
- E2E tests with actual database/API (not mocks)
- Test with real data volumes
- Verify error handling with invalid inputs
- Check integration points work end-to-end

**Example**: New API endpoint
- Make real HTTP requests to running server
- Use real database with seed data
- Test with actual data structures (not just type-valid mocks)

**Anti-pattern**: Re-running unit tests and type-check (Build already did this)

---

### CLI Tools
**What to validate**: Actual feature behavior through manual command execution
**How**:
- Execute CLI commands with realistic inputs
- Verify output matches expectations
- Test parameter application (not just passing)
- Check error handling and edge cases
- Test help text and usage information

**Example**: New CLI flag for filtering output
- Run command with new flag: `tool list --filter active`
- Verify output is actually filtered (not just parameter accepted)
- Test with various filter values
- Confirm help text documents the flag correctly

**Anti-pattern**: "Unit tests pass, so CLI works" - Tests verify parameters are PASSED, not APPLIED
**Critical insight**: Parameter acceptance ≠ Parameter application (see game-master pattern)

---

### Documentation Stages
**What to validate**: Completeness and accuracy
**How**:
- Verify against success criteria checklist
- Check all promised sections exist
- Spot-check accuracy (file paths, code examples)
- Ensure formatting/structure is correct

**Example**: Component documentation
- All components from spec are documented
- File paths are real and correct
- Code examples are valid
- No placeholders or TODOs

**Anti-pattern**: Looking for functionality to test (docs don't have functionality)

---

### Infrastructure/Tooling Stages
**What to validate**: End-to-end workflow with real usage
**How**:
- Run the tool/script with realistic inputs
- Test integration with existing systems
- Verify it solves the problem it was built for
- Check error messages are helpful

**Example**: New build script
- Run script in real project
- Verify output is as expected
- Test with various inputs
- Confirm it integrates with existing workflow

---

## Key Principle

**Build = "Does the code work?"** (types, tests, lint)
**Refinement = "Does it work in the real world?"** (integration, data, viewports)

If you find yourself just re-running Build's verification commands, you're missing Refinement's purpose.

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

## Debugger Agent Escalation

When encountering errors during Refinement phase, select the appropriate debugger:

| Error Type | Start With | Escalate To |
|------------|------------|-------------|
| Runtime errors (null ref, type errors at runtime) | debugger-lite (Sonnet) | - |
| Test failures with clear stack traces | debugger-lite (Sonnet) | debugger if 2+ attempts fail |
| Build/compilation errors | debugger (Opus) | - |
| Toolchain issues (bundler, transpiler, loader) | debugger (Opus) | - |
| Module resolution / import errors | debugger (Opus) | - |
| CI/environment configuration | debugger (Opus) | - |

**Escalation trigger**: If debugger-lite fails to identify root cause after 2 attempts, escalate to debugger (Opus).

**Common Rationalizations (All Invalid):**

| Rationalization | Reality |
|----------------|---------|
| "Config errors are straightforward" | Toolchain subtleties (path resolution, loader config) need Opus-level reasoning |
| "Module resolution is just config" | Bundler/transpiler interactions are complex - use Opus |
| "I'll try debugger-lite one more time" | After 2 failures, escalate - more of the same won't work |
| "Opus is overkill" | Wasted cycles with wrong agent costs more than using Opus upfront |

**Pattern from journal**: debugger-lite missed compiler/tooling issues that required Opus-level analysis.

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

## CLI Tools Workflow

Use this workflow when the stage adds or modifies CLI commands, flags, or behavior.

```
1. Manual CLI Testing (REQUIRED - cannot be automated):
   a. Identify all CLI commands/flags added or modified in this stage
   b. For each command/flag:
      - Execute command with realistic inputs
      - Verify output matches expectations
      - Test edge cases (empty input, invalid values, missing required args)
      - Verify help text is accurate and helpful

   c. Parameter Application Verification:
      - Run command WITHOUT new parameter → capture baseline behavior
      - Run command WITH new parameter → verify behavior CHANGED
      - Compare outputs to confirm parameter was APPLIED, not just accepted

   **Edge Case Testing (REQUIRED for each parameter):**
   - Empty/null inputs: How does parameter behave with no data?
   - Invalid values: Does parameter reject bad input gracefully?
   - Boundary conditions: Min/max values, length limits, etc.
   - Combination conflicts: Does parameter work with other flags?
   - Error messages: Are errors helpful and accurate?

   **Common "Simple Parameter" Rationalization:**
   | Thought | Why You're Wrong |
   |---------|------------------|
   | "It's just a formatting flag" | Format bugs can break pipelines/scripts |
   | "Edge cases are unlikely" | Production always hits unlikely cases |
   | "I tested the happy path" | Happy path ≠ comprehensive validation |
   | "No business logic changed" | Output layer bugs are still bugs |

   **Anti-pattern Alert:**
   - "Unit tests pass" → Tests verify code execution, NOT actual CLI behavior
   - "Parameter is accepted" → Acceptance ≠ Application (game-master pattern)
   - "Help text is correct" → Documentation ≠ Functionality

   **Real example from baseline testing:**
   - Stage 4.3 added --verbose flag
   - Unit tests passed (flag parsing worked)
   - Manual testing revealed: verbosity parameter was PASSED but NOT APPLIED
   - Output was identical with/without flag

2. [IF issues found] → Report to user with examples:
   - Expected behavior: [command output]
   - Actual behavior: [command output]
   - Delegate to debugger-lite/debugger for investigation
   - Delegate to fixer for implementation
   - Delegate to verifier for build verification
   - RETURN TO STEP 1 (manual CLI testing is REQUIRED after fixes)

3. [LOOP until user approves CLI behavior]

   **What "User Approval" Means for CLI:**

   User approval requires ONE of these outcomes for each tested scenario:

   **Option A: Test passes** → Behavior matches expectation

   **Option B: User waives test** → Explicit documented waiver
   - User states: "I waive [specific scenario] because [reason]"
   - Agent documents in stage file: "Waived: `tool generate --format pdf` (PDF library not installed, user confirmed non-critical)"
   - Waiver is NOT approval of functionality - it's documented risk acceptance

   **Option C: User approves degraded behavior** → Feature intentionally limited
   - Example: "PDF format not supported in this release"
   - Update help text to reflect limitation: `--format (json|xml)` (remove pdf)
   - User approves accurate help text

   **INVALID "Approval":**

   | Statement | Why This Doesn't Count as Approval |
   |-----------|-------------------------------------|
   | "PDF isn't critical" | Doesn't address whether test should pass or be waived |
   | "Just document it" | Ambiguous - document as bug? limitation? known issue? |
   | "Environment issue, not our problem" | Dependencies are part of the product experience |
   | "We'll fix it later" | Not a Refinement resolution - either fix now or formally waive |

   **Environment Issues Require Decision:**
   - Missing dependency is a **bug** if tool requires it but doesn't check for it
   - Missing dependency is a **limitation** if tool gracefully handles absence
   - Agent must present both options to user - never assume "environment issue" = skip test

4. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Refinement phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
   - Add CLI regression items to epic's epics/EPIC-XXX/regression.md
     (e.g., "Run `tool command --flag value` and verify output contains X")
```

**Why Manual CLI Testing Cannot Be Skipped:**

1. **Unit tests verify code paths, not user experience**
   - Test: `parseArgs(['--verbose'])` → Returns `{verbose: true}` ✅
   - Reality: `tool --verbose` → No verbose output 🚫

2. **Integration tests verify components work together, not that parameters are applied**
   - Test: `handler.execute({verbose: true})` → Calls logger.verbose() ✅
   - Reality: `tool --verbose` → Logger not configured to show verbose messages 🚫

3. **The CLI is the user interface for your tool**
   - Frontend gets Refinement testing for visual correctness
   - CLI gets Refinement testing for behavioral correctness
   - Both are user-facing, both require manual validation

**CLI Testing Is Equivalent to Frontend Viewport Testing:**
- Frontend: Test desktop AND mobile (both viewports)
- CLI: Test commands WITHOUT and WITH parameters (both behaviors)
- Both verify the user-facing layer works correctly

**Common Rationalization Patterns (All Invalid):**

| Rationalization | Why You're Wrong |
|----------------|------------------|
| "Tests are passing, CLI must work" | Tests verify code execution, not parameter application |
| "I just need to run it once to confirm" | That IS manual testing - do it systematically |
| "The parameter is definitely being used" | Prove it: show output WITH and WITHOUT parameter |
| "This is simple, nothing to test manually" | Simple code often has simple bugs in wiring |
| "Manual testing is for complex features" | Manual testing is for USER-FACING features (CLI is user-facing) |
| "I'll just spot-check one command" | Spot-checking misses wiring bugs in other commands |

### Backend API Validation Template

For backend-only stages (no frontend changes), use this 4-scenario validation approach to ensure comprehensive coverage:

**1. Existing Tests**
- Run the full test suite at the START of Refinement phase
- Yes, even if Build phase just ran them - verifies no regressions during phase transition
- All tests must pass before proceeding to manual validation
- Check coverage for new code paths

**2. Direct Service-Layer Interaction**
- curl/direct API calls to endpoints
- Bypasses any middleware or frontend layers
- Verifies the service responds correctly in isolation
- Example: `curl -X POST http://localhost:3001/api/activity-logs`

**3. Frontend Layer Interaction**
- GraphQL playground, API explorer, or equivalent
- Tests the full request path through frontend-facing layer
- Verifies serialization, authentication, authorization work correctly
- Example: Query in GraphQL playground with auth headers

**4. Full Flow Verification**
- **If UI exists:** End-to-end feature validation through user journey
- **If no UI yet:** Simulate the intended data lifecycle:
  - Script the complete workflow the UI will eventually perform
  - Verify all CRUD operations work end-to-end
  - Test with realistic data volumes and edge cases
  - Example: Create 50 records, query with pagination, verify ordering

**Why all 4 scenarios matter:**
- Tests alone may miss integration issues
- Service-layer testing may miss middleware problems
- Frontend-layer testing may miss edge cases the UI doesn't trigger
- Full flow testing catches issues only visible in realistic usage

**Edge Case: Internal Refactors (no API changes)**
When the change is purely internal (same API contract, different implementation):
- Scenario 1: **REQUIRED** - Full test suite with coverage analysis
- Scenarios 2-4: **ABBREVIATED** - Run 1-2 smoke tests per scenario
  - Verifies no performance regressions, serialization bugs, or integration issues
  - Example: One curl call, one GraphQL query, one quick flow (5 min total)

**Under time pressure:** All 4 scenarios are still required. Each takes 2-5 minutes. Skipping a layer creates risk of production issues that take hours to debug.

## Documentation-Only Workflow

Use this workflow when the stage ONLY produces documentation (markdown files, guides, READMEs) with NO code changes.

```
1. Detect documentation type and verification requirements:

   **When Does Automated Verification Apply?**

   Documentation stage requires automated verification if it contains ANY of:
   - Environment variable names (even in examples)
   - Command-line commands (even partial/simplified)
   - Class, function, or method names (even in conceptual examples)
   - File paths or directory structures
   - Configuration values or formats
   - Technical claims about behavior ("this is safe", "this will restart")

   **Exclusions (explicit opt-out only):**
   - Design documents explicitly marked "Future API - Not Yet Implemented"
   - Pedagogical examples using obviously fictional names (`ExampleService`, `DemoClass`)
   - Both require clear labeling and disclaimer boxes

   **Decision:**
   - If ANY of above present → Automated verification REQUIRED (step 1a)
   - If pure conceptual/process docs with NO technical references → Skip to step 2

1a. [IF code references exist] Spawn general-purpose subagent for automated accuracy verification:

   Prompt: "Run automated documentation accuracy verification:

   **MANDATORY CROSS-REFERENCE CHECKS:**

   **Verification Completeness (ALL means 100%):**
   When instructions say "ALL" or "EACH":
   - ALL = 100% of items, not "main ones" or "important ones"
   - EACH = every single instance, no shortcuts, no sampling
   - Complete verification or no verification

   **Rationalization check:**
   - Thinking "I'll verify the main classes"? → STOP. ALL means ALL.
   - Thinking "Most examples checked"? → STOP. 100% or nothing.
   - Thinking "I'll spot-check a few"? → STOP. EACH means EACH.

   For each documented class/function/type in [list docs files]:

   1. Extract ALL class names, function names, type names from documentation
      - "ALL" means 100% of items mentioned, regardless of perceived importance
      - No skipping "minor" utilities or "obvious" examples
   2. Grep codebase to verify EACH exists in actual source files
      - Use Grep tool or ripgrep (not manual review)
      - Search for exact names, including case sensitivity
   3. For EACH code example (not spot-checking, not sampling):
      - Extract imports and verify modules/files exist (Read tool)
      - Extract function calls and verify methods exist on documented classes (Grep + Read)
      - Extract type signatures and compare against actual source code (Read source files)
   4. List all discrepancies:
      - Classes referenced but not found in codebase
      - Methods documented with wrong signatures (including parameter names, order, types)
      - Type definitions that don't match actual types
      - Code examples importing non-existent modules
      - Properties documented but not present on actual classes

   **VERIFICATION COMPLETENESS:**
   - Class references: Class exists AND is exported/public
   - Method references: Method exists AND signature matches (params, order, types)
   - Function calls: Function exists AND example usage would compile/run
   - Commands: Command exists in package.json AND subcommands/flags are valid
   - Env vars: Variable referenced in .env.example or code

   **Partial verification = incomplete:**
   - Verifying class exists but not method signatures = INCOMPLETE
   - Spot-checking 4 of 15 examples = INCOMPLETE
   - Manual review without Grep/Read tool calls = NOT verification

   **HOW TO VERIFY (AUTOMATED TOOLS REQUIRED):**
   - REQUIRED: Use Grep tool to search for class/function definitions
   - REQUIRED: Use Read tool to check actual signatures in source files
   - REQUIRED: Compare documented signatures against actual source line-by-line
   - Manual review (reading and thinking) is NOT verification

   **Time estimate:** 10 items = ~5 minutes (30 sec each). Faster than debugging 1 wrong env var (30+ min).

   Return detailed report:
   - Total items checked (classes, functions, types, commands, env vars)
   - Issues found (with line numbers in docs + source file references)
   - Severity: MAJOR (doesn't exist) vs MINOR (signature mismatch)
   - Tool usage: List Grep/Read commands used (proves automated verification)

   **DO NOT rationalize:**
   - 'Looks plausible' is NOT verification
   - Markdown compiling is NOT accuracy verification
   - Manual review is NOT sufficient for code references
   - 'I verified the main classes' is NOT complete (verify ALL)
   - 'These are conceptual examples' does NOT bypass verification (if they use real names, verify them)
   - 'Code doesn't exist yet' requires 'TO BE VERIFIED' markers, not skipping verification"

2. [IF no automated verification OR after verification complete] Spawn general-purpose subagent for usability review:

   Prompt: "Review this documentation for:
   1. Readability: Clear language, appropriate technical level
   2. Completeness: All promised sections present, no TODOs
   3. Structure: Logical flow, good use of headings/lists
   4. Links: All URLs/cross-references work

   Files to review: [list documentation files from this stage]

   Return a review report with specific issues found and severity (minor/major)."

3. User shares feedback:
   - Present verification + usability findings to user
   - If automated verification ran: "Accuracy verification: [N] classes checked, [X] issues found"
   - Usability review: "[N] issues ([X] major, [Y] minor)"
   - Ask: "Ready to review findings together?"
   - User provides feedback on:
     * Which issues to fix
     * Additional concerns from their reading
     * Content accuracy from domain knowledge

4. [IF issues found] → Spawn doc-updater with specific fix instructions
   - Fix class/method/type references (from automated verification)
   - Correct code example imports
   - Update type signatures to match source
   - Address missing sections
   - Fix formatting issues
   - Verify fixes with user
   - **MANDATORY RE-VERIFICATION:** After making ANY changes to technical content:

   **Re-Verification After Changes:**

   | Change Type | Re-Verification Required? |
   |------------|---------------------------|
   | Typo fixes (spelling/grammar only) | NO - original verification still valid |
   | Rewording for clarity (same technical content) | NO - original verification still valid |
   | Restructuring sections (moving content around) | NO - original verification still valid |
   | Changed env vars, commands, or code samples | YES - full re-verification required |
   | Added new examples/sections with code references | YES - verify NEW content only |

   **Verification of Fixes:**
   When you fix an error found in verification, re-verify the fix:
   - Example: Changed `DATABASE_CONNECTION` to `DATABASE_URL`
   - Required: Re-grep codebase to confirm `DATABASE_URL` is correct (typo-check your fix)
   - Why: You might misread codebase or typo the fix - 30 seconds to re-verify prevents shipping different wrong value

   - Repeat until verification passes (0 issues)

5. Final confirmation:
   - Ask user: "Documentation review complete. All issues addressed. Ready to move to Finalize phase?"
   - Wait for explicit approval before exiting Refinement

6. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Refinement phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
   - Add documentation verification items to epic's epics/EPIC-XXX/regression.md
     (e.g., "Verify [feature] documentation still exists and is accurate")
```

**Common Documentation Stage Patterns:**
- **No dev server**: Documentation doesn't run, only reads
- **Automated verification available**: Cross-reference code examples against actual source
- **Quick iterations**: Doc fixes are fast, not like code changes
- **Examples matter**: Broken code examples are major issues

**Edge Cases:**

**Documenting future/unimplemented code:**
- Mark sections as "TO BE VERIFIED (after implementation in Stage XXX)"
- Example:
  ```markdown
  ## Database Setup

  <!-- TO BE VERIFIED: Once auth service is implemented (Stage 3.2) -->
  Set the following environment variables:
  - `AUTH_SERVICE_URL` (verify actual env var name)
  - `AUTH_SECRET_KEY` (verify actual env var name)
  ```
- Include verification task in the implementation stage tracking
- Do NOT skip verification by claiming "code doesn't exist yet" for existing code

**Tutorial/teaching documentation with pedagogical examples:**
- Use obviously fictional names (`ExampleService`, `DemoController`, not `UserService`)
- Add disclaimer box:
  ```markdown
  > **Note:** This example uses simplified fictional code for teaching.
  > For production API documentation, see `/docs/api-reference/`.
  ```
- First pass: Verify tutorial teaches correct concepts
- Second pass: Skip code verification (intentionally fictional)
- IF mixing real and fictional code: Mark fictional sections clearly, verify ALL real code references

**Common Rationalizations (All Invalid):**

| Rationalization | Reality |
|----------------|---------|
| "Markdown compiled without errors - it's accurate" | Markdown syntax ≠ API accuracy |
| "It's just documentation, not code" | Wrong docs are worse than no docs |
| "Examples look plausible" | Visual inspection misses 80% of accuracy bugs |
| "'Accuracy' review done manually" | Manual review can't catch non-existent class references |
| "We're behind schedule, ship it" | Inaccurate docs create support burden (30+ min per wrong env var) - verification takes 5 min total |
| "Users will adapt examples" | Users copy-paste and expect examples to work |
| "I'll verify the main classes, skip utilities" | Author likely copy-pasted utilities too - verify ALL (takes same 30 sec per item) |
| "I'll spot-check 4 examples, rest are probably fine" | Documentation errors cluster - one wrong means others may be wrong |
| "Class names are just conceptual, not real API" | If using real-sounding names, verify they exist (users will search for them) |
| "Automated verification takes too long" | 10 items = 5 minutes. Debugging 1 wrong env var = 30+ minutes. |
| "I'll do manual scan instead, faster" | Manual scan misses 60% of errors. Grep never misses. |
| "User approved the content already" | User approved structure/clarity. Verification checks technical accuracy (different concern). |

**Pattern from meta-insights (game-master, 2 occurrences):**
- Documentation built without errors
- Manual review found 10 real issues:
  - Examples referencing classes that don't exist
  - Wrong type signatures in documentation
  - Code examples not matching actual implementation
- Learning: Automated cross-reference verification catches 80-90% of accuracy issues

## Determining Frontend vs Backend vs Documentation vs CLI

- **Frontend**: Any UI components, styles, user-facing changes
- **Backend**: API changes, database, services, no UI impact
- **CLI Tools**: Command-line interfaces, CLI flags, terminal output
- **Documentation**: Markdown files, guides, READMEs with no code changes

**CLI Detection Logic (parallel to Frontend detection):**

Check for CLI indicators:
1. `bin/` directory exists
2. `package.json` has `bin` field
3. Files with CLI frameworks (Commander, yargs, click, argparse, cobra)
4. Files with CLI-specific code (argument parsing, terminal output)
5. Files in typical CLI locations (`src/cli.ts`, `cmd/`, `cli/`)

**If CLI exists → CLI testing is REQUIRED before claiming Refinement complete**

**Mixed Projects (Frontend + CLI in same project):**
- BOTH Frontend (Desktop + Mobile) AND CLI testing must be complete before exit gate
- User cannot approve "just the Frontend" or "just the CLI" - Refinement is atomic
- Prioritization is a workflow decision, not a testing exemption
- If user needs Frontend shipped urgently, complete BOTH validations, then ship

**Rationalization Alert:**
| Thought | Why You're Wrong |
|---------|------------------|
| "Frontend is more important, CLI can wait" | Both are user-facing, both require validation before Refinement complete |
| "User only cares about Frontend right now" | Urgency doesn't override testing requirements |
| "I'll do CLI testing in next session" | Refinement is atomic - complete all validations before exit gate |
| "CLI changes are small, low risk" | Risk assessment doesn't determine testing requirements |

**What counts as "code changes":**
- ANY modification to source files (.js, .ts, .py, .go, .gql, .sql, etc.)
- Adding comments/docstrings to code files (still changes the file)
- Configuration files (.json, .yaml, .toml)
- **NOT code changes**: Pure markdown files (.md), plain text docs, images

**Common rationalization to avoid:**
"I only changed comments, not real code" → Comments in source files ARE code changes. Use Backend/Frontend/CLI workflow, not Documentation-Only.

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

### CLI Tools

- [ ] CLI detection performed (check bin/, package.json bin field, CLI frameworks)
- [ ] **If CLI exists:**
  - [ ] All modified/added commands manually executed with realistic inputs
  - [ ] Parameter application verified (behavior WITH vs WITHOUT parameters)
  - [ ] Help text accuracy confirmed
  - [ ] Edge cases tested (invalid inputs, missing args, etc.)
  - [ ] User approved CLI behavior
- [ ] **Remember**: "Unit tests passing" ≠ CLI works (tests verify PASSING, not APPLICATION)
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - CLI regression items added to epic's regression.md (specific commands to re-test)

### Documentation-Only

- [ ] **If docs include code references:** general-purpose subagent ran automated accuracy verification
  - Verified all class/function/type names exist in codebase
  - Cross-referenced type signatures against actual source
  - Validated code example imports and methods
- [ ] general-purpose subagent performed usability review
- [ ] User reviewed findings and approved final documentation
- [ ] All issues addressed (or user explicitly waived)
- [ ] **If fixes were made:** Re-ran automated verification to confirm accuracy
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - Documentation verification items added to epic's regression.md

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
