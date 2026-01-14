---
name: epic-stage-workflow
description: Use when implementing or working on existing epics and stages, after running /next_task, during Design/Build/Refinement/Finalize phases, or when session protocols apply.
---

# Epic/Stage Workflow - Cost-Optimized Multi-Model Agent Flow

This workflow uses tiered models to optimize cost while maintaining quality:

- **Opus**: Complex reasoning (brainstormer, planner, debugger, code-reviewer, doc-writer)
- **Sonnet**: Medium reasoning (main agent, planner-lite, debugger-lite, doc-writer-lite, test-writer, e2e-tester)
- **Haiku**: Execution (task-navigator, doc-updater, tester, fixer, scribe, verifier)

---

## CRITICAL: Main Agent Coordination Only

**The main agent (Sonnet) is a COORDINATOR, not an executor.**

- Main agent DELEGATES all work to subagents
- Main agent NEVER reads, writes, or modifies files directly
- Main agent NEVER runs commands directly (except simple git commands)
- Use the Task tool to spawn subagents for ALL execution work

**If you're about to read a file, write code, or run a command → STOP → Delegate to a subagent instead.**

## When to Use

- After running `/next_task` to get your task assignment
- During any Design, Build, Refinement, or Finalize phase
- When session protocols apply

## When NOT to Use

- Initial project setup (use epic-stage-setup instead)
- Creating new epics or stages
- Tasks outside the epic/stage system

---

## Communication Policy (CRITICAL)

After EVERY subagent call or significant action, explain:

### The Three Things to Explain

1. **What was found** (for exploration) - Key discoveries, patterns identified, relevant files
2. **What was done** (for implementation) - Files created/modified, specific changes made
3. **The outcome** - Success/failure, verification results, any issues

### Format Requirements

| Format               | When to Use                                             |
| -------------------- | ------------------------------------------------------- |
| **Tables**           | Structured data (files modified, test results, options) |
| **Code blocks**      | Specific changes, file snippets, commands run           |
| **Insight callouts** | Educational context about WHY a choice was made         |

### What NOT to Do

**NEVER** respond with just: "Done", "Task completed", "Fixed", "Updated"

Always provide context even for simple operations.

**CRITICAL: Speed pressure does NOT override communication standards**

User says "Go fast" or "I'm waiting"?
→ You still provide full three-part explanations
→ Transparency and context are non-negotiable
→ Clear communication prevents misunderstandings that cost more time

**Example under speed pressure:**

❌ WRONG (terse):
"Fixed the error. Moving to next task."

✅ CORRECT (full context):
"**What was done**: Fixed TypeScript error in Button.tsx by adding missing 'key' prop type to ButtonProps interface.

**Why it failed**: TypeScript requires all React props to be explicitly typed.

**Outcome**: Tests passing, build ready to verify after test updates.

**Next**: Updating test file now."

Speed comes from efficient delegation, not abbreviated communication.

**CRITICAL: "Success" or "All passed" does NOT mean skip details**

When everything works perfectly, agents often think "there's nothing to explain."

**This is WRONG.** Even for clean successes, explain:

- What was verified
- What passed
- What this means for the next step

❌ WRONG (abbreviated success):
"Build passed. Moving to next phase."

✅ CORRECT (full context for success):
"**What was verified**: Build compiled all packages, type-check found no TypeScript errors, lint found no style issues.

**Outcome**: All checks passed in 12.3s - code is production-ready.

**Next**: Proceeding to Refinement phase for user testing."

**Why this matters**: Users need to understand WHAT was verified, not just that "it passed." Success reports are documentation of what works, not just checkmarks.

"Context even for simple operations" means ESPECIALLY for simple operations - those are the ones agents skip.

### After Fixer Returns

**Mandatory flow**:

1. **Report what fixer changed**:
   - File paths modified
   - Lines changed
   - Summary of edits applied

2. **Immediately verify the fix**:
   - Call verifier (for build/type-check/lint)
   - Call tester (for test failures)
   - **NEVER assume fix worked without verification**

3. **Handle verification result**:
   - ✅ Success → Continue with next task
   - ❌ Failure → Escalate to debugger (NOT back to fixer)

4. **Document the cycle**:
   - Note: "Fixer applied changes, verifier confirmed fix"
   - OR: "Fixer applied changes, still failing, escalating to debugger"

**Never**:

- Skip the verification step
- Call fixer again without new debugger diagnosis
- Assume fixer's changes worked based on its report

---

## Agent Role Boundaries (CRITICAL)

### Specialized Agents Are NOT General-Purpose

Each specialized agent does EXACTLY ONE THING:

| Agent         | Does                                               | Does NOT        |
| ------------- | -------------------------------------------------- | --------------- |
| debugger-lite | Diagnose medium errors → provide fix instructions  | Implement fixes |
| debugger      | Diagnose complex errors → provide fix instructions | Implement fixes |
| fixer         | Implement provided instructions                    | Diagnose issues |

### The Pipeline Model

Errors are resolved through a PIPELINE, not by choosing a single agent:

```
ERROR → DIAGNOSTIC AGENT → FIXER AGENT → RESOLUTION
        [analyzes]         [implements]
        [produces plan]    [executes plan]
```

**NEVER:**

- Skip diagnostic step for medium/high errors
- Tell diagnostic agent to implement
- Expect fixer to diagnose

**ALWAYS:**

- Route through appropriate diagnostic agent first
- Get diagnostic instructions
- Pass instructions to fixer for implementation

---

## Agent Roster Quick Reference

| Agent           | Model  | Purpose                           |
| --------------- | ------ | --------------------------------- |
| task-navigator  | Haiku  | Find next task                    |
| brainstormer    | Opus   | Generate 2-3 architecture options |
| planner         | Opus   | Complex multi-file specs          |
| planner-lite    | Sonnet | Simple specs                      |
| scribe          | Haiku  | Write code from specs             |
| verifier        | Haiku  | Run build/lint/type-check         |
| tester          | Haiku  | Run tests                         |
| debugger        | Opus   | Complex root cause analysis       |
| debugger-lite   | Sonnet | Medium error analysis             |
| fixer           | Haiku  | Apply fix instructions            |
| code-reviewer   | Opus   | Deep code review                  |
| test-writer     | Sonnet | Write tests for existing code     |
| e2e-tester      | Sonnet | Backend API/integration testing   |
| doc-writer      | Opus   | Complex documentation             |
| doc-writer-lite | Sonnet | Simple documentation              |
| doc-updater     | Haiku  | Update tracking files             |

---

## Fixer Agent Constraints (CRITICAL)

**Fixer's ONLY job: Apply explicit line-by-line instructions**

### What Fixer MUST NOT Do

- ❌ Read files to "understand context" (debugger provides context)
- ❌ Search for patterns using Grep/Glob (that's exploration)
- ❌ Re-read files after editing to "verify" (trust Edit tool worked)
- ❌ Run type-check, test, or build commands (verifier/tester's job)
- ❌ Make multiple fix attempts (return after first attempt)
- ❌ Diagnose why something failed (debugger's job)
- ❌ Make design decisions about HOW to fix (coordinator's job)
- ❌ Iterate based on verification results (coordinator escalates)

### What Fixer MUST Do

- ✅ Read ONLY files being edited (for Edit tool preparation)
- ✅ Apply EXACTLY the changes specified
- ✅ Return immediately after applying changes
- ✅ Report what was changed (files, line numbers)

### Retry Policy

**Fixer gets ONE attempt per instruction set**

```
Error occurs → debugger diagnoses → fixer applies fix → return
                                                          │
                                                          ▼
                                              verifier checks result
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    │                                           │
                              ✅ Fixed                                    ❌ Still failing
                                    │                                           │
                                    ▼                                           ▼
                              Continue                        Escalate back to debugger
                                                              (DO NOT call fixer again)
```

- If Edit fails → return error to main agent immediately
- Main agent escalates to debugger for new diagnosis
- **NO internal retry loops in fixer**

### Why This Matters

**Without constraints**: Fixer becomes a junior developer (8-12 tool calls)

- Investigates files (4-5 calls)
- Decides how to fix (design work)
- Verifies and iterates (feedback loop)

**With constraints**: Fixer is a code editor (2-3 tool calls)

- Reads file to edit (1 call)
- Applies exact changes (1-2 calls)
- Returns immediately

**Cost difference**: 75% reduction in tool calls when instructions are explicit.

### Enforcement

**If fixer violates these constraints**, the main agent must:

1. **Stop the fixer immediately** (don't wait for completion)
2. **Document the violation** (what fixer did vs. what was instructed)
3. **Revise instructions** to be more explicit
4. **Call fixer again** with corrected instructions

**Fixer itself must check**:

- Before reading a file: "Am I editing this file?" (No → STOP, report back)
- Before running a command: "Am I a verifier/tester?" (No → STOP, report back)
- Before searching for patterns: "Were these patterns in my instructions?" (No → STOP, report back)

**Self-check template for fixer**:

```
I received instructions to edit <file>.
I am about to <action>.
Is this action "apply the exact edit specified"? [Yes/No]
If No → STOP and report: "Instructions unclear, need explicit line-by-line changes"
```

### Red Flags for Fixer (Signs You're Exceeding Your Role)

**If fixer is thinking ANY of these thoughts, STOP immediately**:

| Thought                                                     | What's Wrong                    | What To Do                                           |
| ----------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| "Let me read this related file to understand the pattern"   | That's exploration              | STOP - Report: "Need context about pattern"          |
| "Let me search for similar code"                            | That's research                 | STOP - Report: "Need example of correct pattern"     |
| "Let me run type-check to see if this worked"               | That's verification             | STOP - Return, let main agent verify                 |
| "This error is still here, let me try a different approach" | That's iteration                | STOP - Return, let main agent escalate               |
| "I need to understand what this function does"              | That's analysis                 | STOP - Report: "Need explicit change instructions"   |
| "The instructions say 'fix' but not how"                    | That's a goal, not instructions | STOP - Report: "Need line-by-line edit instructions" |

**Remember**: You are a code editor, not a developer. Apply edits, don't solve problems.

---

## Instructions for Fixer Must Be Explicit

**The main agent is responsible for instruction quality.**

### ❌ WRONG - Vague Instructions (Goal-Based)

```
Fix the TypeScript errors in useValidation.ts:
- Line 15: Property 'data' does not exist on type '{}'
- Line 20: Cannot find module 'validation-utils'
```

**Why wrong**: This gives fixer a GOAL, not INSTRUCTIONS. Fixer will investigate, explore, and decide how to fix.

### ✅ CORRECT - Explicit Instructions (Edit-Based)

```
Edit packages/frontend/src/hooks/useValidation.ts:

Line 15: Change from:
  const result = response;
To:
  const result = response.data as ValidationResult;

Line 20: Change from:
  import { validate } from 'validation-utils';
To:
  import { validate } from '@campaign/shared/utils/validation';
```

**Why correct**: Fixer knows EXACTLY what to change. No investigation, no decisions, just apply edits.

### How to Write Good Instructions

**Pattern**: `Edit <file>: Line <N>: Change from <old> to <new>`

**Include**:

1. **File path**: Full path from project root
2. **Line number**: Exact line to edit
3. **Old text**: What's currently there (for Edit tool matching)
4. **New text**: What it should become

**For multi-line changes**: Provide code blocks showing before/after

### When Instructions Are Unclear

**Fixer should return**: "Instructions unclear - need specific line numbers and exact text to change"

**Main agent should**: Escalate to debugger for more detailed diagnosis, then call fixer with explicit instructions.

### Self-Check for Main Agent

Before calling fixer, ask:

- [ ] Did I provide specific file paths?
- [ ] Did I provide exact line numbers?
- [ ] Did I provide old text → new text for each change?
- [ ] Can fixer apply these changes WITHOUT reading other files?
- [ ] Can fixer apply these changes WITHOUT making decisions?

If ANY answer is "no" → instructions are too vague, refine them first.

### Common Main Agent Rationalizations (STOP if you're thinking these)

When preparing fixer instructions, watch for these thoughts:

| Thought                                         | Why You're Wrong                          | Correct Action                                      |
| ----------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| "Fixer can figure out the details"              | Fixer will explore and waste tokens       | Read files first, provide exact changes             |
| "The error message is clear enough"             | Error messages don't specify HOW to fix   | Diagnose with debugger, then give explicit edits    |
| "Fixer is smart, just describe the goal"        | Goal-based = fixer becomes problem-solver | Provide edit-based instructions (line X: old → new) |
| "Let fixer verify its own work"                 | Fixer will run type-check and iterate     | Return immediately, main agent verifies             |
| "Fixer can read the file to understand context" | Reading = investigation = wrong role      | Main agent provides file content in instructions    |
| "It's faster to let fixer handle it"            | Vague instructions = 8-12 tool calls      | Explicit instructions = 2-3 tool calls (faster!)    |

**If you're thinking ANY of these** → your instructions are too vague. Stop and refine them first.

### Red Flags - STOP Before Calling Fixer

Before calling fixer, check for these red flags in your instructions:

**🚩 Red Flag 1**: Instructions use words like "fix", "resolve", "handle"

- ❌ "Fix the TypeScript errors"
- ✅ "Change line 15 from X to Y"

**🚩 Red Flag 2**: No specific line numbers provided

- ❌ "Update the import statement"
- ✅ "Line 20: Change import from 'A' to 'B'"

**🚩 Red Flag 3**: No old text → new text provided

- ❌ "Add proper type annotation"
- ✅ "Change `const x` to `const x: string`"

**🚩 Red Flag 4**: File content not included in instructions

- ❌ "Edit useValidation.ts to fix data property"
- ✅ "Edit useValidation.ts - current content: [code block] - change line 15..."

**🚩 Red Flag 5**: Instructions mention "investigate", "check", or "verify"

- ❌ "Check if the import path is correct"
- ✅ "Change import to '../utils/validation' (confirmed correct path)"

**If ANY red flag is present** → instructions are goal-based, not edit-based. Refine before calling fixer.

---

## Phase-Specific Behavior

### Spec Handoff Protocol (CRITICAL)

**Problem:** Planner output doesn't automatically transfer to implementer subagents. Main agent context is NOT inherited by subagents.

**Required workflow:**

1. **Planner/planner-lite agents MUST:**
   - Save spec to `/tmp/spec-YYYY-MM-DD-HH-MM-SS.md` (timestamp format)
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

**Common mistake to avoid:**

❌ WRONG:

```
Main → Planner: "Create spec"
Planner → Main: [500 lines of spec in response]
Main → Scribe: "Implement using spec above"
Scribe → [Can't see spec, invents own design]
```

✅ CORRECT:

```
Main → Planner: "Create spec and save to /tmp/spec-*.md"
Planner → Main: [Spec saved to /tmp/spec-2026-01-12-15-30-45.md]
Main → Scribe: "Read and implement: /tmp/spec-2026-01-12-15-30-45.md"
Scribe → [Reads file, implements correctly]
```

**Why this matters:** Without file handoff, implementers can't see planner output and will invent their own design, wasting 30+ minutes fixing misalignment.

### Design Phase

```
1. Delegate to task-navigator (Haiku) to get task card
2. Delegate to Explore (built-in) to gather codebase context

3. [CONDITIONAL: Brainstorming]
   IF task has multiple valid approaches OR is architecturally complex:
     → Delegate to brainstormer (Opus) to present 2-3 options to user
   ELSE (obvious single solution OR trivial task):
     → Skip brainstormer, proceed with obvious approach

   **⚠️ SELF-CHECK: Are you about to skip brainstormer?**

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
6. Main agent commits tracking files immediately:
   - ONLY commit specific files: `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md`
   - Commit message: "chore: complete STAGE-XXX-YYY Design phase"
   - **NEVER use `git add -A`** - it picks up unrelated uncommitted files
```

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

### Build Phase

```
1. [CONDITIONAL: Planning]
   IF complex multi-file feature OR architectural change:
     → Delegate to planner (Opus) for detailed implementation spec
     → Planner MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE IF simple single-file OR straightforward change:
     → Delegate to planner-lite (Sonnet) for simple spec
     → Planner-lite MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE (trivial change):
     → Skip planner, main agent instructs scribe directly (no spec file needed)

**When to use planner (Opus) - DO NOT under-escalate:**

Use planner (Opus) when ANY of these apply:
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

2. Delegate to scribe (Haiku) to write code from spec file
   → Pass spec file path explicitly: "Read and implement: /tmp/spec-YYYY-MM-DD-HH-MM-SS.md"

3. Add seed data if agreed in Design phase

4. Add placeholder stubs for related future features

5. Verify dev server works - feature must be testable

6. [PARALLEL] Delegate to verifier (Haiku) + tester (Haiku)
   Run build/lint/type-check AND tests in parallel

7. [IF verification fails] → Error handling flow (see below)

8. [LOOP steps 2-7 until green]

9. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Build phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
10. Main agent commits tracking files immediately:
   - ONLY commit specific files: `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md`
   - Commit message: "chore: complete STAGE-XXX-YYY Build phase"
   - **NEVER use `git add -A`** - it picks up unrelated uncommitted files
```

**Skip planner when:**

- Single-file change with clear requirements
- Bug fix with known solution
- Simple config or documentation change

### Refinement Phase

## ⛔ RED FLAGS - Read BEFORE Making ANY Viewport Decisions

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

**The Absolute Workflow Rule:**

```
if (ANY_code_changed_during_refinement) {
    reset_BOTH_viewport_approvals();
    require_re_test_for_BOTH_viewports();
}
```

**There are ZERO exceptions based on:**

- ❌ CSS specificity or targeting
- ❌ Technical impact analysis
- ❌ Change severity (padding vs layout)
- ❌ Timing (before/after approval)
- ❌ Developer judgment of scope
- ❌ "Common sense" about what "should" affect what

**This is a WORKFLOW rule, not a technical rule.** It exists to ensure comprehensive testing coverage regardless of what you think the technical impact is.

---

**CRITICAL: Any code change during Refinement resets the OTHER viewport's approval!**

- If Desktop is approved and you change code for Mobile → Desktop approval is reset
- If Mobile is approved and you change code for Desktop → Mobile approval is reset
- Both viewports must be re-tested after any code change

**No exceptions. Ever.**

**For Frontend Changes:**

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
10. Main agent commits tracking files immediately:
   - ONLY commit specific files: `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md epics/EPIC-XXX/regression.md`
   - Commit message: "chore: complete STAGE-XXX-YYY Refinement phase"
   - **NEVER use `git add -A`** - it picks up unrelated uncommitted files
```

**For Backend-Only Changes:**

```
1. Delegate to e2e-tester (Sonnet) to design and run API/integration tests
2. [IF issues found] → Delegate to debugger-lite/debugger → Delegate to fixer → Delegate to verifier
3. [LOOP until e2e-tester passes]
4. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Refinement phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
   - Add regression items to epic's epics/EPIC-XXX/regression.md
5. Main agent commits tracking files immediately:
   - ONLY commit specific files: `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md epics/EPIC-XXX/regression.md`
   - Commit message: "chore: complete STAGE-XXX-YYY Refinement phase"
   - **NEVER use `git add -A`** - it picks up unrelated uncommitted files
```

**Determine frontend vs backend:**

- Frontend: Any UI components, styles, user-facing changes
- Backend: API changes, database, services, no UI impact

### Finalize Phase (ALL via subagents)

**CRITICAL: Every step in Finalize MUST be delegated to a subagent. Main agent coordinates only.**

```
1. Delegate to code-reviewer (Opus) for pre-test code review

2. [Implement ALL review suggestions]
   → Delegate to fixer (Haiku) or scribe (Haiku) as appropriate
   ALL suggestions are mandatory regardless of severity

3. [CONDITIONAL: Test writing]
   IF tests were NOT written during Build phase:
     → Delegate to test-writer (Sonnet) to write missing tests

4. Delegate to tester (Haiku) to run all tests

5. [CONDITIONAL: Second code review]
   IF implementation code changed after step 2:
     → Delegate to code-reviewer (Opus) for post-test review
   ELSE (only tests added, no impl changes):
     → Skip second review

6. [CONDITIONAL: Documentation]
   IF complex feature OR API OR public-facing:
     → Delegate to doc-writer (Opus)
   ELSE (simple internal change):
     → Delegate to doc-writer-lite (Sonnet) OR skip if minimal

7. Delegate to doc-updater (Haiku) to write to changelog/<date>.changelog.md
8. Main agent creates implementation commit:
   - ONLY add implementation files (code, tests, docs): `git add <specific files>`
   - Include commit hash in message
   - **NEVER use `git add -A`** - it picks up uncommitted tracking files
9. Delegate to doc-updater (Haiku) to add commit hash to changelog entry
10. Main agent commits changelog update:
    - ONLY commit changelog: `git add changelog/<date>.changelog.md`
    - Commit message: "chore: add commit hash to STAGE-XXX-YYY changelog"
11. Delegate to doc-updater (Haiku) to update tracking documents:
    - Mark Finalize phase complete in STAGE-XXX-YYY.md
    - Update stage status to "Complete" in STAGE-XXX-YYY.md
    - Update stage status in epic's EPIC-XXX.md table (MANDATORY - mark as Complete)
    - Update epic "Current Stage" to next stage
12. Main agent commits tracking files:
    - ONLY commit tracking files: `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md`
    - Commit message: "chore: mark STAGE-XXX-YYY Complete"
    - **NEVER use `git add -A`** - it picks up unrelated uncommitted files

Phase auto-completes when all steps done.
```

---

## Error Handling Flow

## Error Resolution Decision Tree

```
                    ┌─────────────┐
                    │ Error Occurs│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Severity?  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
  ┌─────▼─────┐  ┌─────────▼─────────┐  ┌────▼─────┐
  │ Trivial   │  │     Medium        │  │   High   │
  │  Low      │  │                   │  │          │
  └─────┬─────┘  └─────────┬─────────┘  └────┬─────┘
        │                  │                  │
        │         ┌────────▼────────┐  ┌──────▼──────┐
        │         │  debugger-lite  │  │  debugger   │
        │         │    (Sonnet)     │  │   (Opus)    │
        │         └────────┬────────┘  └──────┬──────┘
        │                  │                  │
        │         ┌────────▼──────────────────┘
        │         │   Get Instructions        │
        │         └────────┬──────────────────┘
        │                  │
        └──────────────────┼────────────────────┐
                           │                    │
                    ┌──────▼──────┐             │
                    │    fixer    │◄────────────┘
                    │   (Haiku)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Resolved   │
                    └─────────────┘
```

**Key Points:**

- Trivial/Low: Direct to fixer
- Medium/High: Through diagnostic agent first
- All paths converge at fixer for implementation

When tests fail or errors occur, route by severity:

```
┌─────────────────────────────────────────────────────────┐
│   Main Agent (Sonnet) ROUTES by severity (does not     │
│                   analyze directly)                     │
└─────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    Simple Error     Medium Error     Complex Error
    (import, typo,   (single-file     (multi-file,
    type mismatch)   logic, clear     unclear cause)
         │           stack trace)          │
         ▼                │                ▼
    fixer (Haiku)         ▼           debugger (Opus)
    directly         debugger-lite         │
                     (Sonnet)              ▼
                          │           fixer (Haiku)
                          ▼
                     fixer (Haiku)
```

### Error Severity Routing

| Severity | First Agent            | Purpose           | Next Agent    | Purpose      |
| -------- | ---------------------- | ----------------- | ------------- | ------------ |
| Trivial  | fixer (Haiku)          | Direct fix        | -             | -            |
| Low      | fixer (Haiku)          | Direct fix        | -             | -            |
| Medium   | debugger-lite (Sonnet) | Diagnose + plan   | fixer (Haiku) | Execute plan |
| High     | debugger (Opus)        | Complex diagnosis | fixer (Haiku) | Execute plan |

**CRITICAL:**

- Medium/High errors ALWAYS involve TWO agents in sequence
- First agent provides instructions
- Second agent implements instructions
- NEVER tell first agent to implement
- NEVER expect second agent to diagnose

### Fixer Retry Policy (ONE ATTEMPT ONLY)

**Critical rule**: Fixer gets exactly ONE attempt per instruction set.

**Flow**:

```
1. Main agent calls fixer with explicit instructions
2. Fixer applies changes and returns
3. Main agent calls verifier/tester to check result
4. If still failing → main agent escalates to debugger for NEW diagnosis
5. Debugger provides NEW instructions → back to step 1
```

**What NOT to do**:

- ❌ Call fixer multiple times with same instructions
- ❌ Call fixer with "try again" or "fix it differently"
- ❌ Let fixer iterate internally on failures

**Why this matters**: Prevents wasted tokens on repeated failed attempts. Forces proper diagnosis before each fix attempt.

**Legacy retry policy (for scribe only)**:

- scribe gets ONE retry with error output
- If still failing → escalate to debugger-lite or debugger
- After debugger → fixer implements (not scribe)
- If STILL failing → surface to user

---

## Calling Debugger Agents (debugger-lite / debugger)

### Correct Instructions Format

When calling debugger-lite or debugger:

✅ **CORRECT:**
"Diagnose the root cause of [error]. Provide specific fix instructions that fixer agent can implement."

❌ **INCORRECT:**
"Diagnose and fix [error]"
"Fix this error"
"Resolve this issue"

### After Receiving Diagnostic

1. Review the diagnostic agent's instructions
2. Call fixer agent with those instructions:
   "Implement the following fix: [diagnostic agent's instructions]"

### Example Flow

```
Main → debugger-lite: "Diagnose ESLint error in tool-registry. Provide fix instructions."
debugger-lite → Main: "Error caused by missing import. Fix: Add import statement at line 3."
Main → fixer: "Implement fix: Add import statement at line 3 as specified."
```

---

## Common Mistakes (AVOID THESE)

### ❌ Calling Fixer Directly for Medium/High Errors

**Wrong:**

```
Medium error → fixer agent
```

**Right:**

```
Medium error → debugger-lite → fixer agent
```

### ❌ Telling Debugger to Implement

**Wrong:**

```
debugger-lite: "Diagnose and fix this error"
```

**Right:**

```
debugger-lite: "Diagnose and provide fix instructions"
fixer: "Implement these instructions: [...]"
```

### ❌ Repeating Same Agent Without Strategy Change

**Wrong:**

```
fixer → fails
fixer → fails
fixer → fails
```

**Right:**

```
fixer → fails
debugger-lite → diagnose why it failed
fixer → implement diagnostic fix
```

### Why These Are Wrong

1. **Skip diagnosis**: Leads to repeated failures
2. **Mixed concerns**: Agents optimized for specific roles
3. **Cost inefficiency**: Wrong agent for the task
4. **Violated pipeline**: Each error severity has a defined flow

---

## Parallel Execution Rules

**ALWAYS run independent operations in parallel:**

- verifier + tester (during Build verification)
- Multiple file reads/explorations
- Independent subagent tasks

**NEVER run as background tasks** - await all parallel calls before proceeding.

**How to parallelize:** Send multiple Task tool calls in a single message.

---

## Key Rules

1. **Main agent coordinates, subagents execute** - Never do execution work directly
2. **Update tracking docs via doc-updater subagent** - Never edit stage files or docs directly
3. **All Finalize phase tasks use subagents** - code-reviewer, test-writer, tester, doc-writer, doc-updater
4. **Delegate file operations** - Use scribe/fixer for code, doc-updater for docs
5. **Delegate verification** - Use verifier for build/lint, tester for tests

---

## Code Review Policy

**ALL code review suggestions must be implemented**, regardless of severity:

- Critical, Important, Minor - all mandatory
- "Nice to have" = "Must have"
- Only skip if implementation would break functionality (document why)

---

## Session Protocols

### Starting a Session

1. Run `/next_task` to get assignment
2. This skill loads automatically
3. Confirm current phase and goal with user
4. Begin phase-specific workflow

### Ending a Session

1. Delegate to doc-updater to update tracking docs
2. State progress: "Completed [X], next session will [Y]"
3. Note any blockers or decisions needed
4. Phase auto-advances when all gates complete

---

## Task Navigator Output Format

When `/next_task` runs, expect this format:

```
═══════════════════════════════════════════════════════════
NEXT TASK
═══════════════════════════════════════════════════════════
Epic:   EPIC-XXX [Name]
Stage:  STAGE-XXX-YYY [Name]
Phase:  [Design | Build | Refinement | Finalize]

Instructions:
[Phase-specific instructions]

Seed data needed: [Yes - describe | No | Already agreed]
═══════════════════════════════════════════════════════════
```

---

## Changelog Pattern

Agent writes to `changelog/<YYYY-MM-DD>.changelog.md`:

- Multiple entries same day → PREPEND to same file
- Include commit hash in entry
- User runs `changelog/create_changelog.sh` to consolidate

---

## Regression Tracking

Each epic has its own regression file: `epics/EPIC-XXX/regression.md`

- Only read/write regression for current epic
- Add items during Refinement phase

---

## Phase Gates (Must Complete All)

### Design Phase

- [ ] Task card received from task-navigator
- [ ] Context gathered via Explore
- [ ] IF multiple approaches: brainstormer presented 2-3 options, user selected one
- [ ] IF obvious solution: Confirmed approach with user
- [ ] Seed data requirements confirmed (if applicable)
- [ ] Tracking documents updated via doc-updater:
  - Selected approach recorded in stage file
  - Design phase marked complete
  - Epic stage status updated (MANDATORY)
- [ ] Tracking files committed immediately with specific git add (NO git add -A)

### Build Phase

- [ ] Implementation spec created (planner OR planner-lite OR direct for trivial)
- [ ] Code written via scribe
- [ ] Seed data added (if agreed in Design)
- [ ] Placeholder stubs added for related future features
- [ ] Dev server verified working
- [ ] Verification passed (verifier + tester in parallel)
- [ ] Tracking documents updated via doc-updater:
  - Build phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
- [ ] Tracking files committed immediately with specific git add (NO git add -A)

### Refinement Phase (Frontend)

- [ ] Desktop tested and approved by user
- [ ] Mobile tested and approved by user
- [ ] **Remember**: Code changes reset OTHER viewport's approval
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - Regression items added to epic's regression.md
- [ ] Tracking files committed immediately with specific git add (NO git add -A)

### Refinement Phase (Backend-Only)

- [ ] e2e-tester designed and ran API/integration tests
- [ ] All scenarios passed (or issues fixed via debugger → fixer)
- [ ] Tracking documents updated via doc-updater:
  - Refinement phase marked complete in stage file
  - Epic stage status updated (MANDATORY)
  - Regression items added to epic's regression.md
- [ ] Tracking files committed immediately with specific git add (NO git add -A)

### Finalize Phase

- [ ] code-reviewer (Opus) completed pre-test review
- [ ] ALL review suggestions implemented via fixer/scribe
- [ ] IF tests not written in Build: test-writer created tests
- [ ] tester ran all tests - passing
- [ ] IF impl code changed after first review: code-reviewer ran post-test review
- [ ] Documentation created (doc-writer OR doc-writer-lite based on complexity)
- [ ] Changelog entry added via doc-updater
- [ ] Implementation commit created with SPECIFIC file paths (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed immediately (ONLY changelog file)
- [ ] Tracking documents updated via doc-updater:
  - Finalize phase marked complete in stage file
  - Stage status set to "Complete"
  - Epic stage status updated to "Complete" (MANDATORY)
  - Epic "Current Stage" updated to next stage
- [ ] Tracking files committed immediately with specific git add (NO git add -A)

---

## Common Rationalizations (Don't Fall For These)

| Excuse                                     | Reality                                            | Correct Action                                       |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| "This is simple, skip Design"              | Simple tasks become complex; Design catches this   | Present 2-3 options even for "simple" stages         |
| "User wants to skip formality"             | Explicit skips must be documented                  | Document in stage: "Skipped by user [reason] [date]" |
| "Just want to see it working"              | Build already provides working implementation      | Refinement is for feedback, not skipping tests       |
| "Documentation overhead isn't worth it"    | Tracking docs enable session independence          | Update docs via doc-updater after every phase        |
| "I already explored, can generate options" | Coordination ≠ architecture; use specialized agent | Delegate to brainstormer (Opus) for options          |

---

## Critical Red Flags

Signs you're skipping the workflow:

- Creating files before `/next_task`
- Skipping brainstormer because "it's obvious" (when it's not)
- Building without user selecting approach
- Using Opus agents when Haiku would suffice
- Running operations sequentially that could be parallel
- Skipping code review suggestions
- Not using conditional routing (always using Opus planner for simple tasks)
- Editing files directly instead of delegating to scribe/fixer/doc-updater
- Reading code files directly instead of using Explore or having subagent read
- Running build/test commands directly instead of delegating to verifier/tester
- Updating stage docs yourself instead of using doc-updater subagent
- **Using `git add -A` or `git add .` instead of specific file paths**
- **Forgetting to update epic file** when stage completes
- **Not committing tracking files immediately** after doc-updater updates them

---

## The `git add -A` Problem (CRITICAL)

**Never use `git add -A`, `git add .`, or `git commit -a`**

### Why This Causes Bugs

When doc-updater updates tracking files, it does NOT commit them. If tracking files remain uncommitted and a later stage uses `git add -A`, it picks up:

- Changelog entries from previous stages
- Stage files from previous stages
- Epic files that should have been committed earlier
- Any other uncommitted files in the repo

**Example from STAGE-007-003:**
- STAGE-007-001 and 002 left tracking files uncommitted
- STAGE-007-003 used `git add -A` for its implementation commit
- Result: STAGE-007-003 commit included EPIC-006 files and STAGE-007-001/002 tracking files

### The Fix

**ALWAYS use specific file paths:**

```bash
# ✅ CORRECT - Tracking files
git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md

# ✅ CORRECT - Changelog
git add changelog/2026-01-13.changelog.md

# ✅ CORRECT - Implementation files (list each one)
git add packages/llm/src/file1.ts packages/llm/src/file2.ts docs/guide.md

# ❌ WRONG - Picks up everything
git add -A
git add .
git commit -a
```

### Commit Immediately After doc-updater

**Every doc-updater call must be followed by an immediate commit:**

```
1. Delegate to doc-updater
2. Main agent commits ONLY those specific files
3. Continue with next step
```

**Never batch commits.** Commit tracking files separately from implementation files.

### Epic File Updates Are MANDATORY

The epic file's stage table MUST be updated when a stage changes status. This is NOT optional ("if needed").

**Every stage completion requires:**
1. Update stage status in STAGE-XXX-YYY.md
2. Update stage status in EPIC-XXX.md table (same status)
3. Update epic "Current Stage" field
4. Commit both files immediately
