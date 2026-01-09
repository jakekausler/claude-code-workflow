---
name: next_task
description: Read the next task and begin working on it.
---

# Next Task - Epic/Stage/Phase Navigation

Use the task-navigator subagent to find the next work item in the epic/stage hierarchy.

## How to Use

1. Invoke the task-navigator subagent to scan for the next task
2. The subagent returns a formatted task card with:
   - Epic and Stage identification
   - Current phase (Design, Build, Refinement, or Finalize)
   - Phase-specific instructions
   - Seed data requirements

## Task Output Format

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

## After Finding the Task

**IMMEDIATELY invoke the epic-stage-workflow skill** using the Skill tool:

- Skill name: `epic-stage-workflow`

This loads the complete implementation protocol including:

- Communication Policy (what to explain after every subagent call)
- Phase-specific behavior
- Session protocols
- Code review policy
- Quality gates

Do NOT proceed with any work until both /next_task has run AND epic-stage-workflow skill is invoked.

The workflow skill contains the complete protocol for executing each phase correctly, including:

- Phase-specific behavior (detailed steps for each phase)
- Communication policy (how to explain work to user)
- Session protocols (start and end procedures)
- Key rules and quality gates
- Finalize phase subagent sequence
- Code review policy
