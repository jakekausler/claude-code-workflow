---
name: finish_phase
description: Mark current phase complete and advance to next phase/stage/epic.
---

# Finish Phase

Marks the current phase as complete and advances to the next work item.

## What This Command Does

1. **Updates stage tracking doc** (via doc-updater subagent):
   - Marks current phase checkbox as complete
   - Updates stage status field

2. **Advances to next phase**:
   - Design → Build
   - Build → Refinement
   - Refinement → Finalize
   - Finalize → Stage Complete

3. **If stage is complete**:
   - Updates stage status to "Complete"
   - Advances to next stage in the epic
   - If this was the last stage, marks epic as complete

4. **If Finalize phase just completed**:
   - Adds CHANGELOG entry with timestamp and commit hash
   - Format: `YYYY-MM-DD HH:MM [commit-hash] Epic/Stage: brief description`

## Usage

Run this command when:

- **Design Phase**: User has picked their preferred UI option and seed data is confirmed
- **Build Phase**: Feature is working on dev site
- **Refinement Phase**: User has explicitly approved the implementation
- **Finalize Phase**: All finalize tasks are done (review, tests, docs, commit)

## Validation

Before advancing, this command verifies:

- **Design Phase**:
  - UI choice is recorded with desktop + mobile descriptions
  - Has Input Forms flag is set (Yes or left unchecked for No)
  - Seed data is confirmed (or N/A)

- **Build Phase**:
  - Components/endpoints are documented in tracking doc

- **Refinement Phase** (Dual Sign-off Gate):
  - `[x] Desktop Approved` — user explicitly approved desktop view
  - `[x] Mobile Approved` — user explicitly approved mobile view
  - `[x] Regression Items Added` — checklist updated in `docs/REGRESSION-CHECKLIST.md`
  - **All three must be checked to advance**

- **Finalize Phase**:
  - All checkboxes are complete
  - E2E tests pass at all required viewports
  - Commit hash is recorded

## Approval Reset Detection

During Refinement, if code changes are made after an approval:

1. Detect if change affects desktop/mobile rendering
2. Reset the affected approval checkbox: `[x]` → `[ ]`
3. Announce: "Change detected — [Desktop/Mobile] approval reset, re-test required"

**Reset triggers:**

- CSS/styling changes → reset both
- Layout component changes → reset both
- Mobile-specific logic → reset Mobile only
- Desktop-specific logic → reset Desktop only
- Backend-only changes → ask if re-test needed

## Output

```
═══════════════════════════════════════════════════════════
PHASE COMPLETE
═══════════════════════════════════════════════════════════
Completed: [Phase] for STAGE-XXX-YYY
Next:      [Next Phase | Next Stage | Epic Complete]

[If CHANGELOG entry was added]:
CHANGELOG: YYYY-MM-DD HH:MM [hash] Epic/Stage: description
═══════════════════════════════════════════════════════════
```

## Next Steps

After running `/finish_phase`:

1. If advancing to a new phase: End current session
2. Run `/next_task` in the next session to continue
3. If epic is complete: Celebrate, then `/next_task` for next epic

## Important

- This command uses doc-updater subagent for all file updates
- Never manually edit tracking docs - always use this command
- If validation fails, address the issues before running again
