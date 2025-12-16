---
name: next_task
description: Find the next task to work on and display session context.
---

# Next Task Command

Finds the next work item by scanning tracking documents.

## Session Start Protocol

Every session should begin with `/next_task` to:

1. **Understand current state** - What's been done, what's in progress
2. **Confirm context** - "We're working on [X] for [Y]"
3. **State goal** - "This session's goal is to [specific outcome]"
4. **Proceed or clarify** - Start work or ask questions

## What This Command Does

1. **Scans tracking documents** (epics/ directory) to find current work
2. **Identifies the Epic and Stage** being worked on
3. **Identifies the current phase** (Design, Build, Refinement, Finalize)
4. **Returns specific instructions** for that phase

Use the task-navigator subagent to perform the navigation:

```
Use the Task tool:
- description: "Find next task"
- prompt: "Scan tracking documents in epics/ directory to find the next work item.
  Look for EPIC-XXX folders containing stage files (STAGE-XXX-YYY.md).
  Find the first incomplete stage and return:
  - Epic file path and name
  - Stage file path and name
  - Current phase
  - Status
  - Phase-specific instructions"
- subagent_type: "task-navigator"
```

## Output Format

```
═══════════════════════════════════════════════════════════
NEXT TASK
═══════════════════════════════════════════════════════════
Epic:   [EPIC-XXX: Epic name]
        epics/EPIC-XXX/EPIC-XXX.md
Stage:  [STAGE-XXX-YYY: Stage name]
        epics/EPIC-XXX/STAGE-XXX-YYY.md
Phase:  [Design | Build | Refinement | Finalize]
Status: [Current status from stage file]

Instructions:
[Phase-specific instructions]

When complete, run: /finish_phase
═══════════════════════════════════════════════════════════
```

## Phase-Specific Behavior

### Design Phase

**Goal:** Present options, get user choice, document decisions

1. Read the task description
2. Present 2-3 options/approaches
3. User picks preferred approach
4. Document the decision
5. Run `/finish_phase`

### Build Phase

**Goal:** Implement the chosen approach

1. Read design decisions
2. Implement the feature
3. Ensure it's working
4. Document what was built
5. Run `/finish_phase`

### Refinement Phase

**Goal:** Iterate until user approves

1. User tests the implementation
2. Collect feedback
3. Make changes based on feedback
4. Repeat until approved
5. Run `/finish_phase`

### Finalize Phase

**Goal:** Review, test, document, commit

1. Code review (use code-reviewer agent)
2. Write tests (use typescript-tester agent)
3. Update documentation (use doc-updater agent)
4. Commit with clear message
5. Run `/finish_phase`

## Key Rules

1. **Start every session with `/next_task`**
2. **One phase per session** for full context
3. **Update tracking docs** after each phase
4. **Don't skip phases** - each serves a purpose
