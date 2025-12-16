---
name: finish_phase
description: Mark current phase complete and advance to next phase.
---

# Finish Phase Command

Marks the current phase as complete and advances to the next work item.

## What This Command Does

1. **Validates phase completion** - Checks requirements are met
2. **Updates tracking documents** - Marks phase complete
3. **Advances to next phase** - Design → Build → Refinement → Finalize → Complete
4. **Reports next steps** - What comes next

## Usage

Run this command when:

- **Design Phase:** User has picked their preferred option and decisions are documented
- **Build Phase:** Feature is implemented and working
- **Refinement Phase:** User has explicitly approved the implementation
- **Finalize Phase:** All finalize tasks are done (review, tests, docs, commit)

## Validation

Before advancing, verify requirements are met:

### Design Phase

- [ ] Options were presented
- [ ] User made a choice
- [ ] Decision is documented

### Build Phase

- [ ] Feature is implemented
- [ ] It works as expected
- [ ] Progress is documented

### Refinement Phase

- [ ] User has tested
- [ ] User explicitly approved
- [ ] Feedback is documented

### Finalize Phase

- [ ] Code review complete
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Changes committed

## Output Format

```
═══════════════════════════════════════════════════════════
PHASE COMPLETE
═══════════════════════════════════════════════════════════
Epic:      [EPIC-XXX: Epic name]
           epics/EPIC-XXX/EPIC-XXX.md
Stage:     [STAGE-XXX-YYY: Stage name]
           epics/EPIC-XXX/STAGE-XXX-YYY.md
Completed: [Phase]
Next:      [Next Phase | Next Stage | All Complete]

[If commit was made:]
Commit: [hash] [message]
═══════════════════════════════════════════════════════════
```

## Phase Transitions

```
Design → Build
  - User chose an approach
  - Next: Implement the chosen design

Build → Refinement
  - Feature is working
  - Next: User tests and provides feedback

Refinement → Finalize
  - User approved
  - Next: Code review, tests, docs, commit

Finalize → Complete
  - All quality gates passed
  - Next: Move to next task
```

## Implementation

Use the doc-updater subagent to update the stage tracking file:

```
Use the Task tool:
- description: "Update tracking - phase complete"
- prompt: "Update the stage file at epics/EPIC-XXX/STAGE-XXX-YYY.md:
  - Mark [Phase] phase as complete
  - Update status to [Next Phase]
  - Add timestamp
  Preserve all existing content.
  Return the Epic and Stage info in the output format."
- subagent_type: "doc-updater"
```

## Session End Protocol

After running `/finish_phase`:

1. **State progress:** "Completed [X], next session will [Y]"
2. **End session** if phase transition requires context reset
3. **Run `/next_task`** in the next session to continue

## Important

- **Don't skip validation** - Each phase has requirements
- **Document before advancing** - Decisions, progress, feedback
- **Commit working code** - Don't leave broken state
- **One phase at a time** - Maintain focus and quality
