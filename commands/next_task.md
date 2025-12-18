---
name: next_task
description: Read the next task and begin working on it.
---

# Next Task - Epic/Stage/Phase Navigation

Use the task-navigator subagent to find the next work. The subagent scans the epic/stage hierarchy and reports:

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

When complete, run: /finish_phase
═══════════════════════════════════════════════════════════
```

## Phase-Specific Behavior

### Design Phase

**Goal**: Present options with mobile/desktop descriptions, get user choice, confirm seed data

1. Read the stage file to understand what component/interaction this is
2. Present **2-3 UI options** with explicit Desktop and Mobile descriptions:
   ```
   Option N: [Name]
   - Desktop: [layout/behavior]
   - Mobile: [layout/behavior]
   ```
3. Ask user to pick their preferred approach
4. If this stage needs seed data, describe what will be added and ask for confirmation
5. Check if stage has input forms → set `Has Input Forms: [x] Yes` flag
6. Record decisions in stage tracking doc (via doc-updater subagent)
7. Run `/finish_phase` when user has made their choice

### Build Phase

**Goal**: Implement the chosen approach

1. Read the stage file for the user's design choice
2. Implement the chosen UI + backend support
3. Add agreed seed data (if any)
4. Add placeholder stubs for related future features
5. Ensure dev server shows working feature
6. Update tracking doc (via doc-updater subagent)
7. Run `/finish_phase` when feature is working

### Refinement Phase

**Goal**: Dual sign-off — iterate until BOTH desktop and mobile are approved

1. Prompt user to test **Desktop view** on dev site
2. Collect feedback, implement changes
3. Repeat until user explicitly approves Desktop → mark `[x] Desktop Approved`
4. Prompt user to test **Mobile view** on dev site
5. Collect feedback, implement changes
6. Repeat until user explicitly approves Mobile → mark `[x] Mobile Approved`
7. **Important**: Any code change resets the other view's approval
8. After both approved: prompt for regression checklist items
9. Add items to `docs/REGRESSION-CHECKLIST.md` via doc-updater
10. Mark `[x] Regression Items Added` in stage doc
11. Run `/finish_phase` when all three checkboxes are complete

### Finalize Phase

**Goal**: Tests, review, docs, commit (ALL via subagents)

Execute these steps in order:

1. **Code Review (pre-tests)**: Use code-reviewer subagent and address any concerns. If concerns are nitpicks, weigh whether these are worth addressing now. Otherwise address all substantive feedback.
2. **Write Tests**: Use typescript-tester subagent to write unit, integration, e2e tests
   - E2E tests must run at desktop + mobile viewports
   - If stage has `Has Input Forms: [x] Yes`, also test mobileKeyboard viewport
   - Use project's viewport definitions for consistency
3. **Code Review (post-tests)**: Use code-reviewer subagent again. Address any new concerns in the same manner as before.
4. **Update Documentation**: Use doc-updater subagent for:
   - README links if needed
   - Feature documentation
   - Project guidelines if new patterns established
5. **Commit**: Create detailed conventional commit message
6. **CHANGELOG Entry**: Use doc-updater subagent to add entry with commit hash

After all finalize tasks complete, run `/finish_phase`.

## Key Rules

1. **Start every session with `/next_task`** to understand current state
2. **One phase per session** for full context
3. **Update tracking docs via doc-updater subagent** - never edit directly
4. **Prompt user before adding seed data**
5. **Present 2-3 UI options in Design phase**
6. **All Finalize phase tasks use subagents**

## Session Start Protocol

Every session MUST begin with:

1. Run `/next_task` (this command)
2. Confirm: "We're in [Phase] for [Stage] of [Epic]"
3. State goal: "This session's goal is to [phase-specific goal]"
4. Proceed or ask clarifying questions

## Session End Protocol

Before ending any session:

1. Update tracking doc (via doc-updater subagent)
2. State progress: "Completed [X], next session will [Y]"
3. If phase complete: Run `/finish_phase`
