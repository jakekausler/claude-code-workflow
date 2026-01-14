---
name: phase-finalize
description: Use when entering Finalize phase of epic-stage-workflow - guides code review, testing, documentation, and final commits
---

# Finalize Phase

## Purpose

The Finalize phase ensures code quality through review, adds tests if needed, creates documentation, and commits all work. This is the only phase where tracking files are committed.

## Entry Conditions

- Refinement phase is complete (user testing passed)
- `epic-stage-workflow` skill has been invoked (shared rules loaded)

## CRITICAL: Every Step Uses Subagents

**Every step in Finalize MUST be delegated to a subagent. Main agent coordinates only.**

## Phase Workflow

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
   IF implementation code changed after step 2 OR existing code/tests were refactored:
     → Delegate to code-reviewer (Opus) for post-test review
   ELSE (ONLY new test files added, zero changes to existing code):
     → Skip second review

   **Self-check before skipping:** Did you modify ANY existing file after first review?
   - Refactored test utilities? → Second review required
   - Extracted helper functions? → Second review required
   - Renamed variables for clarity? → Second review required
   - Reordered parameters? → Second review required
   - ANY change requiring human judgment? → Second review required
   - ONLY added brand new test files with zero existing file edits? → May skip second review

   **"Formatting" = automated tool output ONLY:**
   - Prettier reformatting whitespace → Not second review trigger
   - ESLint auto-fixes (--fix flag) → Not second review trigger
   - ANY human-decided change → Second review required

   **Test**: Did a human decide to make this change? → Second review required

   **Implementing first review feedback IS a human decision:**
   - First review says "improve naming" → YOU chose WHICH names, HOW to rename
   - First review says "add error handling" → YOU chose WHERE and WHAT kind
   - First review approves the approach; second review verifies execution
   - "I'm just following reviewer guidance" → You still made implementation choices

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
```

## Code Review Policy

**ALL code review suggestions must be implemented**, regardless of severity:

- Critical, Important, Minor - all mandatory
- "Nice to have" = "Must have"
- Only skip if implementation would break functionality (document why in stage file)

## The `git add -A` Problem (CRITICAL)

**Never use `git add -A`, `git add .`, or `git commit -a`**

When doc-updater updates tracking files, it does NOT commit them. If tracking files remain uncommitted and a later stage uses `git add -A`, it picks up:

- Changelog entries from previous stages
- Stage files from previous stages
- Epic files that should have been committed earlier
- Any other uncommitted files in the repo

**ALWAYS use specific file paths:**

```bash
# CORRECT - Tracking files
git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md

# CORRECT - Changelog
git add changelog/2026-01-13.changelog.md

# CORRECT - Implementation files (list each one)
git add packages/llm/src/file1.ts packages/llm/src/file2.ts docs/guide.md

# WRONG - Picks up everything
git add -A
git add .
git commit -a
```

## Phase Gates Checklist

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

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Commit tracking files with specific paths (NEVER git add -A)

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY) - Finalize Only

### No-Code Stages Still Require Exit Gate

Documentation-only or tracking-only stages:

- [ ] Still invoke lessons-learned (friction can happen in any work type)
- [ ] Still invoke journal (write about the documentation process)
- [ ] "No implementation code" is NOT an exit gate exception
- [ ] "Minimal changes" (even 5 lines) is NOT an exit gate exception
- [ ] Change size does NOT affect exit gate requirements

**Exit gate applies to ALL stages, regardless of work type or change size.**

**Rationalizations that don't work:**

- "Only updated 10 lines of docs" → Change size doesn't matter
- "This was a trivial stage" → Trivial stages still complete the exit gate
- "No code to learn lessons about" → Process lessons exist for all work types
- "Journal would just say 'updated docs'" → Write about the documentation process itself

**Note:** The exit gate (steps 1-5 below) covers the final stage-completion steps. Implementation commits (workflow steps 8-10) happen BEFORE the exit gate begins.

Before completing the stage, you MUST complete these steps IN ORDER:

1. Update stage tracking file (mark Finalize phase complete, stage Complete)
2. Update epic tracking file (update stage status to Complete, update Current Stage)
3. **Main agent commits tracking files** (NOT doc-updater):
   - `git add epics/EPIC-XXX/STAGE-XXX-YYY.md epics/EPIC-XXX/EPIC-XXX.md`
   - Commit message: "chore: mark STAGE-XXX-YYY Complete"
   - **NEVER use `git add -A`**
4. Use Skill tool to invoke `lessons-learned`
5. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Update tracking state
- Step 3: Commit tracking state (so it persists even if session ends)
- Steps 4-5: Capture learnings and feelings based on the now-complete stage

Committing before lessons/journal ensures tracking state is saved. Lessons and journal need the commit to have happened (they may reference the commit hash).

Stage is now complete. No further phase to invoke - the stage workflow is finished.

**DO NOT skip any exit gate step.**

**DO NOT claim the stage is complete until exit gate is done.** This includes:

- Telling user "stage is complete"
- Running `/next_task` for the next stage
- Starting work on another stage
- Closing the session as "successful"

**Complete ALL exit gate steps FIRST. Then the stage is truly complete.**
