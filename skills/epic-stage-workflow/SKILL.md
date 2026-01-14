---
name: epic-stage-workflow
description: Use when implementing or working on existing epics and stages, after running /next_task, during Design/Build/Refinement/Finalize phases, or when session protocols apply.
---

# Epic/Stage Workflow - Orchestrator

This is the **orchestrator skill**. It contains shared rules that apply to ALL phases. Phase-specific guidance is in separate phase skills.

## Model Tiering

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

## Protocol, Not Advice

This workflow is a **protocol** (exact adherence required), not guidance (adaptable).

**Letter AND Spirit Required:**

- Letter: Follow exact steps, use specified agents, invoke specified skills
- Spirit: Understand WHY each step exists, ensure quality

**"I understand the spirit" is NOT permission to skip the letter.**

## Workflow Authority Hierarchy

**Level 1: User Authority (Highest for WHAT)**

- Defines requirements, priorities, acceptance criteria
- Approves/rejects features
- Requests emergency or abbreviated workflows
- Controls WHAT gets built

**Level 2: Workflow Integrity (Non-Negotiable)**

These steps CANNOT be skipped by user request:

- code-reviewer invocation (can be abbreviated, not skipped)
- Spec file for non-trivial changes (can be bullet-point, not skipped)
- Formal approval workflow (can be batched, not skipped)
- Exit gates (lessons-learned, journal)

**Level 3: Workflow Flexibility (User-Overrideable)**

These CAN be adjusted with explicit user consent:

- Abbreviated formats (bullet-point specs, quick reviews)
- Compressed timelines (smoke tests instead of full suite)
- Reduced documentation scope

**If user requests skipping Level 2 items:**

1. Explain why workflow requires them (prevent regressions, maintain quality)
2. Offer Level 3 alternatives (faster, not absent)
3. If user insists after explanation, document objection in stage file and proceed with Level 3 alternative
4. NEVER skip Level 2 entirely - only abbreviate

**User owns the project. Agent has duty of care for quality. Make trade-offs explicit.**

### Classification Authority

**Level 2 is an EXHAUSTIVE list** - items are Level 2 if and only if they appear in the list above:

1. code-reviewer invocation
2. Spec file for non-trivial changes
3. Formal approval workflow
4. Exit gates (lessons-learned, journal)

**Classification disputes:**

If user claims something is Level 3 (not Level 2):

1. **Check the list**: Is this item explicitly listed above?
   - YES → Level 2 applies, follow Level 2 protocol
   - NO → Level 3, user preference wins

2. **Example resolution:**
   - User: "Skip code-reviewer for this typo"
   - Agent checks list → "code-reviewer invocation" is listed → Level 2
   - Agent: "Code-reviewer is Level 2 (explicit list). I can abbreviate (30-second quick pass) but not skip."

3. **If user still insists after explanation:**
   - Document in stage file: "User overrode Level 2 requirement [item] despite agent objection"
   - Log as workflow deviation in lessons-learned
   - Proceed as directed (user has ultimate project authority)

**KEY PRINCIPLE:** Level 2 classification is OBJECTIVE (explicit list), not subjective (agent judgment). If it's on the list, it's Level 2. Period.

- ❌ "Spirit of exit gate is completeness, I can reorder steps" → Violates letter
- ✅ "Spirit is completeness, I follow steps in order AND explain why each matters" → Follows both

**Why exact adherence matters:**

- Enables session independence (any agent can resume work)
- Prevents compounding errors (shortcuts cause future mistakes)
- Ensures tracking docs stay synchronized
- Makes workflow auditable and improvable

---

## Phase Routing

After loading this skill, determine the current phase and invoke the appropriate phase skill:

| Phase      | Skill to Invoke    |
| ---------- | ------------------ |
| Design     | `phase-design`     |
| Build      | `phase-build`      |
| Refinement | `phase-refinement` |
| Finalize   | `phase-finalize`   |

**To invoke a phase skill:** Use the Skill tool with the skill name (e.g., `phase-design`).

**Each phase skill ends with a mandatory exit gate that invokes `lessons-learned` and `journal` skills.**

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

**CRITICAL: "Success" or "All passed" does NOT mean skip details**

When everything works perfectly, agents often think "there's nothing to explain."

**This is WRONG.** Even for clean successes, explain:

- What was verified
- What passed
- What this means for the next step

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
   - Success → Continue with next task
   - Failure → Escalate to debugger (NOT back to fixer)

4. **Document the cycle**:
   - Note: "Fixer applied changes, verifier confirmed fix"
   - OR: "Fixer applied changes, still failing, escalating to debugger"

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

- Read files to "understand context" (debugger provides context)
- Search for patterns using Grep/Glob (that's exploration)
- Re-read files after editing to "verify" (trust Edit tool worked)
- Run type-check, test, or build commands (verifier/tester's job)
- Make multiple fix attempts (return after first attempt)
- Diagnose why something failed (debugger's job)
- Make design decisions about HOW to fix (coordinator's job)
- Iterate based on verification results (coordinator escalates)

### What Fixer MUST Do

- Read ONLY files being edited (for Edit tool preparation)
- Apply EXACTLY the changes specified
- Return immediately after applying changes
- Report what was changed (files, line numbers)

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
                              Fixed                                    Still failing
                                    │                                           │
                                    ▼                                           ▼
                              Continue                        Escalate back to debugger
                                                              (DO NOT call fixer again)
```

### Instructions Must Be Explicit

**Pattern**: `Edit <file>: Line <N>: Change from <old> to <new>`

**Include**:

1. **File path**: Full path from project root
2. **Line number**: Exact line to edit
3. **Old text**: What's currently there (for Edit tool matching)
4. **New text**: What it should become

**Red Flags - STOP Before Calling Fixer**:

- Instructions use words like "fix", "resolve", "handle" → Too vague
- No specific line numbers provided → Too vague
- No old text → new text provided → Too vague
- Instructions mention "investigate", "check", or "verify" → Wrong role

---

## Error Handling Flow

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

### Calling Debugger Agents

**CORRECT:**
"Diagnose the root cause of [error]. Provide specific fix instructions that fixer agent can implement."

**INCORRECT:**
"Diagnose and fix [error]"
"Fix this error"

---

## Parallel Execution Rules

**ALWAYS run independent operations in parallel:**

- verifier + tester (during Build verification)
- Multiple file reads/explorations
- Independent subagent tasks

**NEVER run as background tasks** - await all parallel calls before proceeding.

**How to parallelize:** Send multiple Task tool calls in a single message.

---

## The `git add -A` Problem (CRITICAL)

**Never use `git add -A`, `git add .`, or `git commit -a`**

When doc-updater updates tracking files, it does NOT commit them. If tracking files remain uncommitted and a later stage uses `git add -A`, it picks up:

- Changelog entries from previous stages
- Stage files from previous stages
- Epic files that should have been committed earlier

**ALWAYS use specific file paths:**

```bash
# CORRECT - Tracking files
git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md

# CORRECT - Changelog
git add changelog/2026-01-13.changelog.md

# WRONG - Picks up everything
git add -A
git add .
```

### Epic File Updates Are MANDATORY

The epic file's stage table MUST be updated when a stage changes status. This is NOT optional.

---

## Exit Gate Error Handling

If an exit gate step fails (e.g., journal skill fails due to disk error):

1. Report the failure to the user with specific error details
2. Ask user: Retry? Skip? Wait?
3. If skipping, document in stage file: "Journal skipped due to [error]"
4. Only proceed to next phase with user consent

**Required steps** (blocking): Update stage file, Update epic file
**Always-attempt steps** (skip only on system error with user consent): lessons-learned, journal

If lessons-learned or journal fails due to system error (not by choice):

1. Report error to user with specific details
2. Ask: Retry? Skip? Wait for resolution?
3. If skipping, document in stage file: "[Skill] skipped due to [error] on [date]"

**Journal and lessons-learned are NEVER skipped by choice - only on system failure.**

### Required Step Failures

If stage file or epic file update fails:

1. **Report failure with full error details** (disk space, permissions, file locks)
2. **Retry ONCE** (transient errors may resolve)
3. **If retry fails, present options:**
   - Wait: User resolves issue (free disk space, fix permissions), then retry
   - Manual update: User edits file manually, confirms when done
   - Abort: Document incomplete exit, roll back phase state
4. **NEVER proceed without required steps complete**

**Why:** Stage/epic files are source of truth. Skipping breaks session independence and `/next_task` navigation.

### Partial Exit Gate Completion

If stage file updates but epic file update fails:

1. **Retry epic file update** (most likely to succeed after stage file worked)
2. **If retry fails:** User manually edits epic file stage table
3. **Rollback option:** Revert stage file to previous phase status, re-run exit gate

**Prevention:** doc-updater should update stage + epic in sequence (stage first, then epic). This makes forward recovery (retry epic) easier than rollback.

### Concurrent Session Detection

Before completing ANY phase exit gate:

1. **Check git status** for unexpected changes:

   ```bash
   git status epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md
   ```

2. **If files show "modified" but you haven't updated them yet:**
   - Another session may have completed the phase
   - Run: `git diff epics/EPIC-XXX/STAGE-XXX-YYY.md`
   - Check if phase is already marked complete

3. **Resolution:**
   - Phase already complete: Inform user, do NOT duplicate work, exit gracefully
   - Different phase complete: Pull changes, proceed with current phase
   - Conflict detected: User must resolve manually

**Prevention:** Sessions should coordinate via user. Tracking files should be committed immediately after phase completion.

---

## Session Protocols

### Starting a Session

1. Run `/next_task` to get assignment
2. This skill loads automatically
3. Invoke the appropriate phase skill based on current phase
4. Begin phase-specific workflow

### Refinement Phase State Interpretation

- "Refinement: In Progress" → Invoke `phase-refinement` (REQUIRED even when resuming from previous session)
- "Refinement: Complete (awaiting feedback)" → Wait for user feedback in main conversation, don't invoke any phase skill yet
- "Refinement: Complete" (no note) + user approved → Invoke `phase-finalize`

**CRITICAL:** Always invoke the phase skill when resuming a session. Do NOT rely on "memory" from previous session context. Phase skills may have been updated, and session independence requires fresh skill invocation every time.

### Handling State Conflicts

If task-navigator returns a different phase than stage file shows:

1. **Report the conflict:** "Task-navigator says [X], but stage file shows [Y]"
2. **Stage file is authoritative** - it contains the detailed phase completion status
3. **Ask user:** "Which should I follow? (A) Stage file state, (B) Investigate discrepancy"
4. **If stage file is corrupted:** Report specific inconsistency, ask user to manually fix

### Corrupted or Malformed Stage Files

If stage file has conflicting or invalid state:

1. **Report specific inconsistency:**
   - "Header says Status: Build but Build section shows [x] Complete"
   - "Refinement shows Desktop: Approved but no approval note found"

2. **Do NOT proceed with ambiguous state**

3. **Ask user for resolution:**
   - "Please check the stage file and confirm the correct current phase"
   - "Once fixed, I'll re-read and continue"

### Ending a Session

1. Complete current phase's exit gate (includes lessons-learned and journal)
2. State progress: "Completed [X], next session will [Y]"
3. Note any blockers or decisions needed

---

## Code Review Policy

**ALL code review suggestions must be implemented**, regardless of severity:

- Critical, Important, Minor - all mandatory
- "Nice to have" = "Must have"
- Only skip if implementation would break functionality (document why)

### User as Technical Reviewer

User's technical expertise does NOT exempt stages from code-reviewer agent:

- User reviewing code = additional quality layer (good)
- Skipping code-reviewer because user reviewed = workflow violation (bad)
- BOTH reviews happen: user's judgment + agent's automated checks
- Findings may overlap (confirms quality)
- Findings may differ (catches different issues)

**User authority controls WHAT to build, not WHETHER to run quality gates.**

### Emergency Situations Do NOT Bypass Workflow

**"Production is down" / "Critical hotfix" / "User has a deadline":**

- Time pressure does NOT skip code-reviewer, verifier, or tester
- Emergency is NOT an exception - it's a reason to be MORE careful
- Fast is achieved through efficient subagent coordination, not skipping steps

**If genuinely time-critical:**

1. Run abbreviated workflow (code-reviewer can be quick for small changes)
2. Document in stage file: "Emergency workflow - abbreviated review due to [reason]"
3. Schedule follow-up full review if abbreviated
4. User must explicitly consent to abbreviated workflow (consent does NOT allow skipping workflow entirely - only abbreviating)

**Abbreviated Workflow Minimums (NEVER skip these - PER STAGE):**

- code-reviewer subagent MUST run **per stage** (even if 30-second quick pass)
- verifier MUST confirm build/type-check passes **per stage**
- For logic changes: At least smoke test **per stage** (full suite can be deferred)
- **Zero review per stage is NEVER okay, regardless of fix size**

**Batched reviews across stages are NOT permitted:**

- ❌ "One review for 5 hotfixes" → Each stage needs its own review
- ❌ "Review them all together" → Each stage reviewed independently
- ✅ "Run 5 abbreviated reviews in parallel" → Each stage gets its own fast review

**Why per-stage matters:** Each stage may introduce different issues. Batching hides which stage caused which problem and makes rollback harder.

**Time-critical with multiple stages?**

- Run abbreviated code-reviewer **per stage** (30 seconds each)
- Run reviews **in parallel** to save time
- Total: 5 stages × 30s = 2.5 minutes (parallel) vs 2.5 minutes (sequential but batched-unsafe)

"Abbreviated" means **faster execution**, not **fewer steps**:

- Spec: Bullet points acceptable (still required unless truly trivial per L5)
- code-reviewer: Focus on critical issues only (still invoked)
- Testing: Smoke tests instead of comprehensive (still run something)

**Explicit Consent Requirements:**

Before requesting emergency consent, agent MUST explain:

> "Abbreviated workflow means: quick code-reviewer pass, verifier only, smoke tests. Full workflow is safer. Use abbreviated workflow for this fix?"

Vague statements do NOT count as consent:

- ❌ "Do what you need to do"
- ❌ "Just fix it ASAP"
- ❌ "I trust you"
- ✅ "Yes, use abbreviated workflow for this hotfix"

**Rationalizations that don't work:**

- "Production is broken" → Broken prod + buggy fix = worse
- "User needs it in 5 minutes" → Skipped review takes longer to fix later
- "Code-reviewer will take too long" → Code-reviewer is usually 2-3 minutes
- "This is different, it's urgent" → Urgency increases error likelihood
- "User said 'do whatever'" → Vague consent ≠ explicit consent

---

## Common Rationalizations (Don't Fall For These)

| Excuse                                             | Reality                                                 | Correct Action                                       |
| -------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| "This is simple, skip Design"                      | Simple tasks become complex; Design catches this        | Present 2-3 options even for "simple" stages         |
| "User wants to skip formality"                     | Explicit skips must be documented                       | Document in stage: "Skipped by user [reason] [date]" |
| "Just want to see it working"                      | Build already provides working implementation           | Refinement is for feedback, not skipping tests       |
| "Documentation overhead isn't worth it"            | Tracking docs enable session independence               | Update docs via doc-updater after every phase        |
| "I already explored, can generate options"         | Coordination ≠ architecture; use specialized agent      | Delegate to brainstormer (Opus) for options          |
| "User said skip code review"                       | User controls WHAT to build, not quality process        | Run code-reviewer, explain findings to user          |
| "Senior dev reviewed verbally"                     | External reviews complement, don't replace, agents      | Run code-reviewer agent for automated check          |
| "User prefers git add -A"                          | User preference doesn't override safety rules           | Use specific paths, explain why                      |
| "User tested it themselves"                        | User testing is Refinement, agent testing is Build      | Run tester agent for automated verification          |
| "User is technical expert, reviewed it themselves" | User expertise complements agents, doesn't replace them | Run code-reviewer, share findings with expert user   |
| "User has more experience than me"                 | Workflow exists for consistency, not hierarchy          | Run code-reviewer regardless of user expertise       |
| "User is paying for this time"                     | User pays for quality process, not shortcuts            | Explain code-reviewer value, run it anyway           |

---

## Critical Red Flags

Signs you're skipping the workflow:

- Creating files before `/next_task`
- Skipping brainstormer because "it's obvious" (when it's not)
- Building without user selecting approach
- Using Opus agents when Haiku would suffice
- Running operations sequentially that could be parallel
- Skipping code review suggestions
- Editing files directly instead of delegating to scribe/fixer/doc-updater
- Reading code files directly instead of using Explore or having subagent read
- Running build/test commands directly instead of delegating to verifier/tester
- Updating stage docs yourself instead of using doc-updater subagent
- **Using `git add -A` or `git add .` instead of specific file paths**
- **Forgetting to update epic file** when stage completes
- **Not invoking phase skill** after loading this orchestrator
- **Skipping exit gate** (lessons-learned and journal) at phase end
