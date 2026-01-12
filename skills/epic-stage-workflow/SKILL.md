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

## Phase-Specific Behavior

### Design Phase

```
1. Delegate to task-navigator (Haiku) to get task card
2. Delegate to Explore (built-in) to gather codebase context

3. [CONDITIONAL: Brainstorming]
   IF task has multiple valid approaches OR is architecturally complex:
     → Delegate to brainstormer (Opus) to present 2-3 options to user
   ELSE (obvious single solution OR trivial task):
     → Skip brainstormer, proceed with obvious approach

4. User selects approach (or confirms obvious one)
5. Delegate to doc-updater (Haiku) to record decision in stage file
```

**Skip brainstormer when:**

- Task is trivial (config change, typo fix)
- Obvious single solution exists
- User explicitly specified approach

### Build Phase

```
1. [CONDITIONAL: Planning]
   IF complex multi-file feature OR architectural change:
     → Delegate to planner (Opus) for detailed implementation spec
   ELSE IF simple single-file OR straightforward change:
     → Delegate to planner-lite (Sonnet) for simple spec
   ELSE (trivial change):
     → Skip planner, main agent instructs scribe directly

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

2. Delegate to scribe (Haiku) to write code from spec

3. Add seed data if agreed in Design phase

4. Add placeholder stubs for related future features

5. Verify dev server works - feature must be testable

6. [PARALLEL] Delegate to verifier (Haiku) + tester (Haiku)
   Run build/lint/type-check AND tests in parallel

7. [IF verification fails] → Error handling flow (see below)

8. [LOOP steps 2-7 until green]

9. Delegate to doc-updater (Haiku) to update stage status
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

9. Delegate to doc-updater (Haiku) to update epic's epics/EPIC-XXX/regression.md
```

**For Backend-Only Changes:**

```
1. Delegate to e2e-tester (Sonnet) to design and run API/integration tests
2. [IF issues found] → Delegate to debugger-lite/debugger → Delegate to fixer → Delegate to verifier
3. [LOOP until e2e-tester passes]
4. Delegate to doc-updater (Haiku) to update epic's epics/EPIC-XXX/regression.md
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
8. Main agent creates commit (include commit hash)
9. Delegate to doc-updater (Haiku) to add commit hash to changelog entry

Phase auto-completes when all steps done.
```

---

## Error Handling Flow

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

**Retry policy:**

- scribe/fixer gets ONE retry with error output
- If still failing → escalate to debugger-lite or debugger
- After debugger → fixer implements
- If STILL failing → surface to user

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
- [ ] Decisions recorded in stage doc via doc-updater

### Build Phase

- [ ] Implementation spec created (planner OR planner-lite OR direct for trivial)
- [ ] Code written via scribe
- [ ] Seed data added (if agreed in Design)
- [ ] Placeholder stubs added for related future features
- [ ] Dev server verified working
- [ ] Verification passed (verifier + tester in parallel)

### Refinement Phase (Frontend)

- [ ] Desktop tested and approved by user
- [ ] Mobile tested and approved by user
- [ ] **Remember**: Code changes reset OTHER viewport's approval
- [ ] Regression items added to epic's regression.md

### Refinement Phase (Backend-Only)

- [ ] e2e-tester designed and ran API/integration tests
- [ ] All scenarios passed (or issues fixed via debugger → fixer)
- [ ] Regression items added to epic's regression.md

### Finalize Phase

- [ ] code-reviewer (Opus) completed pre-test review
- [ ] ALL review suggestions implemented via fixer/scribe
- [ ] IF tests not written in Build: test-writer created tests
- [ ] tester ran all tests - passing
- [ ] IF impl code changed after first review: code-reviewer ran post-test review
- [ ] Documentation created (doc-writer OR doc-writer-lite based on complexity)
- [ ] Changelog entry added via doc-updater
- [ ] Commit created with hash
- [ ] Commit hash added to changelog entry

---

## Common Rationalizations (Don't Fall For These)

| Excuse                                  | Reality                                          | Correct Action                                       |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| "This is simple, skip Design"           | Simple tasks become complex; Design catches this | Present 2-3 options even for "simple" stages         |
| "User wants to skip formality"          | Explicit skips must be documented                | Document in stage: "Skipped by user [reason] [date]" |
| "Just want to see it working"           | Build already provides working implementation    | Refinement is for feedback, not skipping tests       |
| "Documentation overhead isn't worth it" | Tracking docs enable session independence        | Update docs via doc-updater after every phase        |

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
