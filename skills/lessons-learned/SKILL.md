---
name: lessons-learned
description: Use when completing any phase (Design, Build, Refinement, Finalize) in epic-stage-workflow - captures structured lessons when something noteworthy happened
---

# Lessons Learned

## Overview

At the end of each phase, pause and ask: **"Did anything happen this phase worth capturing as a lesson?"** If yes, write a structured learning entry. If no, state "Nothing to capture this phase" and continue.

## When to Use

Invoke at the END of every phase in epic-stage-workflow, BEFORE the journal skill.

## Common Categories (Examples)

These are common category values, but you can use any descriptive category that fits the lesson:

| Category Example      | Typically Covers                                                 |
| --------------------- | ---------------------------------------------------------------- |
| **Process Friction**  | Workarounds, unexpected difficulty, things that should be easier |
| **Self-Correction**   | Mistakes, user corrections, near-violations, failed attempts     |
| **Pattern Discovery** | Codebase insights, undocumented gotchas, workflow learnings      |

## Valid Triggers (write a learning entry if ANY apply)

1. **Something took multiple attempts** - Fix, verification, or subagent that failed and retried
   - Self-check: Did verifier/tester return failure more than once?
   - Self-check: Did I have to re-run a subagent with different instructions?

2. **User corrected me** - Mistake pointed out, or stopped mid-implementation to change direction
   - Self-check: Did user say "that's wrong" or "try this instead"?
   - YES trigger: "That's wrong, do X instead" (I made a mistake)
   - YES trigger: "Stop, let's use approach A instead" (mid-implementation redirection)
   - NO trigger: User choosing between options I presented during Design brainstorming (preference, not correction)
   - **Key distinction:** Was I doing something WRONG? → Trigger. Was user just CHOOSING between valid options? → Not a trigger.

3. **Unexpected friction** - Something "straightforward" that wasn't
   - Self-check: Did you think "this should be quick" and it took 3x longer?
   - Self-check: Did something "obvious" turn out to have hidden complexity?

4. **Discovered something undocumented** - Pattern, gotcha, or behavior not in CLAUDE.md
   - Self-check: Did you learn something that would help your future self?
   - Self-check: Is this pattern/gotcha missing from project documentation?

5. **Process rule violation** - Started or completed a rule violation (even if immediately fixed)
   - Self-check: Did you START the wrong action (not just think about it)?
   - YES trigger: Ran `git add -A`, then realized and ran `git reset` to fix it
   - YES trigger: Used wrong agent, then re-did with correct agent
   - NO trigger: Was about to run `git add -A`, caught yourself, used correct command instead
   - **Key distinction:** Did you START the wrong action? → Trigger. Did you only THINK about it? → Not a trigger.

**Decision process:**

- Review each trigger's self-check questions
- If you answer YES to any self-check → Write a learning entry
- If you answer NO to all self-checks → State "Nothing to capture this phase"
- This is objective assessment, not subjective judgment

## Invalid Triggers (do NOT write)

- Phase completed smoothly
- Minor typos or trivial fixes
- Things already documented
- Non-actionable observations

## Rationalization Self-Check

Before saying "Nothing to capture this phase", read these thoughts:

| If you're thinking... | Why you're wrong                                      | Correct action                              |
| --------------------- | ----------------------------------------------------- | ------------------------------------------- |
| "Phase went smoothly" | Smooth ≠ nothing learned; check all 5 triggers        | Review self-check questions                 |
| "User wants speed"    | Speed ≠ excuse to skip reflection                     | Run through triggers quickly but thoroughly |
| "No errors occurred"  | Valid triggers include discoveries, not just failures | Check trigger #4 (undocumented patterns)    |
| "This feels minor"    | Minor to you may be valuable to future sessions       | If any self-check is YES, write the entry   |

**If ANY self-check question has a YES answer, write the learning entry.**

## Distinguishing Multiple Attempts from Typos

**Write a lesson when:** The failed attempt was "reasonable" but revealed something about the system's design or constraints.

**Don't write when:** The fix was purely mechanical (typo, missing import, syntax error).

**Test:** "Would I tell a teammate about this?" If yes → write it. If no → skip it.

## Decision

```
Any valid trigger? → YES → Write learning entry
                  → NO  → "Nothing to capture this phase" → Continue
```

## Learning Entry Format

**Location:** `~/docs/claude-learnings/YYYY-MM-DDTHH-MM-SS.md`

**CRITICAL: Getting the timestamp - NEVER estimate or hardcode dates:**
```bash
# Get the current timestamp for the filename (dashes instead of colons)
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
# Example output: 2026-01-13T14-32-00

# Get the current timestamp for the metadata (with colons)
METADATA_DATE=$(date +%Y-%m-%dT%H:%M:%S)
# Example output: 2026-01-13T14:32:00
```

**IMPORTANT: Filename convention uses dashes (not colons) for filesystem compatibility: `YYYY-MM-DDTHH-MM-SS.md`**

```markdown
---
date: YYYY-MM-DDTHH:MM:SS
repository: [full repository path]
epic: [epic ID, e.g., EPIC-001]
stage: [stage ID, e.g., STAGE-001-001]
phase: [Design|Build|Refinement|Finalize]
category: [descriptive category value]
analyzed: false
---

# Learning Entry

## Situation

[2-4 sentences: what happened, the context, the problem/discovery]

## Example

[Concrete code, command, error, or interaction that illustrates it]

## Future Guidance

[1-3 actionable bullets on what to do differently]
```

**How to populate metadata fields:**
- **date**: Use the `$METADATA_DATE` value from the bash command above (ISO 8601 format with colons: YYYY-MM-DDTHH:MM:SS). NEVER estimate - always use `date` command.
- **repository**: Use the FULL absolute path to the repository (e.g., "/storage/programs/claude-learnings-viewer"), not just the project name. This is the current working directory path.
- **epic**: Current epic ID from context (e.g., "EPIC-001" from "EPIC-001-foundation-cli-shell")
- **stage**: Current stage ID from context (e.g., "STAGE-001-001")
- **phase**: Current phase from context (Design, Build, Refinement, or Finalize)
- **category**: Any descriptive category value. Common examples include "Process Friction", "Self-Correction", "Pattern Discovery", but you can use other categories as appropriate for the lesson.
- **analyzed**: Always set to `false` when creating new learning entries. This field tracks whether the entry has been processed by the meta-insights analysis system.

## Workflow

1. Review the phase just completed
2. Check valid triggers
3. If any apply: create `~/docs/claude-learnings/<timestamp>.md`
4. If none apply: state "Nothing to capture this phase"
5. No git commit - filesystem only

**Create directory on first use:** `mkdir -p ~/docs/claude-learnings`

## When No Triggers Are Met

If no triggers apply:

1. State: "Nothing to capture this phase - all work proceeded smoothly"
2. Do NOT create a lessons file (no file = nothing noteworthy)
3. This is a successful completion - skill is done, main flow continues

## Example Learning Entry

````markdown
---
date: 2026-01-13T14:32:00
repository: /storage/programs/campaign-manager-with-input
epic: EPIC-043
stage: STAGE-043-012
phase: Build
category: Process Friction
analyzed: false
---

# Learning Entry

## Situation

After running `prisma migrate reset`, the dev server continued returning stale data.
Took 15 minutes to realize the running server had cached the old Prisma client.

## Example

```bash
# This regenerates client but running server doesn't see it
pnpm --filter @campaign/api exec prisma migrate reset --force

# Had to manually restart
pkill -f "ts-node-dev" && pnpm run dev
```

## Future Guidance

- Stop dev server before Prisma migrations
- `ts-node-dev` doesn't watch `node_modules`
- Consider adding to CLAUDE.md gotchas
````
