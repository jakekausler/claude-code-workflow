---
name: self-reflection
description: Use when completing any phase (Design, Build, Refinement, Finalize) in epic-stage-workflow - prompts reflection on whether anything meaningful happened worth recording
---

# Self-Reflection

## Overview

At the end of each phase, pause and ask: **"Did anything happen this phase worth reflecting on?"** If yes, write a structured musing. If no, state "Nothing to reflect on this phase" and continue.

## When to Use

Invoke at the END of every phase in epic-stage-workflow, AFTER the tracking document commit.

## Categories

| Type                  | Covers                                                           |
| --------------------- | ---------------------------------------------------------------- |
| **Process Friction**  | Workarounds, unexpected difficulty, things that should be easier |
| **Self-Correction**   | Mistakes, user corrections, near-violations, failed attempts     |
| **Pattern Discovery** | Codebase insights, undocumented gotchas, workflow learnings      |

## Valid Triggers (write a musing if ANY apply)

1. **Something took multiple attempts** - Fix, verification, or subagent that failed and retried
2. **User corrected me** - Redirection, mistake pointed out, approach changed
3. **Unexpected friction** - Something "straightforward" that wasn't
4. **Discovered something undocumented** - Pattern, gotcha, or behavior not in CLAUDE.md
5. **Process rule violation** - Almost or actually violated a skill rule (e.g., `git add -A`)

## Invalid Triggers (do NOT write)

- Phase completed smoothly
- Minor typos or trivial fixes
- Things already documented
- Non-actionable observations

## Decision

```
Any valid trigger? → YES → Write musing
                  → NO  → "Nothing to reflect on this phase" → Continue
```

## Musing Format

**Location:** `~/docs/claude-musings/YYYY-MM-DDTHH-MM-SS.md`

```markdown
# YYYY-MM-DDTHH:MM:SS

**Repository:** /path/to/current/repo
**Stage:** EPIC-XXX/STAGE-XXX-YYY (Phase Name)
**Type:** Process Friction | Self-Correction | Pattern Discovery

## Situation

[2-4 sentences: what happened, the context, the problem/discovery]

## Example

[Concrete code, command, error, or interaction that illustrates it]

## Future Guidance

[1-3 actionable bullets on what to do differently]
```

## Workflow

1. Review the phase just completed
2. Check valid triggers
3. If any apply: create `~/docs/claude-musings/<timestamp>.md`
4. If none apply: state "Nothing to reflect on this phase"
5. No git commit - filesystem only

**Create directory on first use:** `mkdir -p ~/docs/claude-musings`

## Example Musing

````markdown
# 2026-01-13T14:32:00

**Repository:** /storage/programs/campaign-manager-with-input
**Stage:** EPIC-043/STAGE-043-012 (Build Phase)
**Type:** Process Friction

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
````

## Future Guidance

- Stop dev server before Prisma migrations
- `ts-node-dev` doesn't watch `node_modules`
- Consider adding to CLAUDE.md gotchas

```

```
