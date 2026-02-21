# Stage 5: Auto-Design + Auto-Analysis — Implementation Plan

**Design doc:** `docs/plans/2026-02-20-stage-5-auto-design-analysis-design.md`
**Branch:** kanban

---

## Dependency Graph

```
Task 1 (summary pipeline) ──── independent
Task 2 (phase-design) ───────── independent
Task 3 (awaiting-design) ────── depends on Task 2 (needs to see phase-design pattern)
Task 4 (workflow routing) ───── depends on Tasks 3 + 4a (needs both new skills to exist)
Task 4a (manual-testing) ────── independent
Task 5 (phase-build notes) ──── independent
Task 6 (auto-testing notes) ─── independent
Task 7 (finalize notes) ─────── independent
Task 8 (learnings-count) ────── independent
Task 9 (verify all) ─────────── depends on all above
```

Parallel groups:
- **Group A** (independent): Tasks 1, 2, 4a, 5, 6, 7, 8
- **Group B** (sequential after 2): Task 3, then Task 4
- **Group C** (after all): Task 9

---

## Task 1: Summary Pipeline — Read Sister Files

**Goal:** Update `readStageFileContent()` to include phase notes sister files.

**File:** `tools/kanban-cli/src/cli/logic/summary.ts`

**Changes:**
1. Update `readStageFileContent(stageFilePath, repoPath)` to:
   - Derive the stage ID prefix from the file path (e.g., `STAGE-001-001-001`)
   - Glob for `STAGE-001-001-001-*.md` in the same directory
   - Sort main file + sister files by modified time (`fs.statSync().mtimeMs`)
   - Concatenate with filename headers: `--- filename.md ---\n[content]\n\n`
   - Return concatenated string (or just main file if no sisters exist)

2. Update content hash in summary engine — hash now covers concatenated content, so cache auto-invalidates when sisters change.

**Tests:**
- Unit test: `readStageFileContent` with no sister files returns same as before
- Unit test: `readStageFileContent` with sister files returns concatenated content with headers
- Unit test: sister files sorted by mtime
- Integration test: summary of stage with sister files produces different hash than without

**Status:** Complete

---

## Task 2: `phase-design` Skill — Auto-Design + Notes File

**Goal:** Update `phase-design` to write design notes file and support auto-design skip.

**File:** `skills/phase-design/SKILL.md`

**Changes:**
1. Add instruction to write full research to `STAGE-XXX-YYY-ZZZ-design.md` sister file
2. Add instruction to write brief options summary to stage file (existing Design Phase section)
3. Add conditional block for `WORKFLOW_AUTO_DESIGN=true`:
   - Auto-select recommended approach
   - Log selection in both stage file and design notes
   - Set status → Build (skip User Design Feedback)
4. Update default flow (`WORKFLOW_AUTO_DESIGN=false`):
   - Write notes file and options summary
   - Set status → User Design Feedback
   - End session (design feedback is now a separate session)
5. Remove `kanban-cli sync` from exit gate if present
6. Verify exit gate includes lessons-learned and journal invocations

**Tests:** Grep skill file for key terms: `design.md`, `WORKFLOW_AUTO_DESIGN`, `lessons-learned`, `journal`, `User Design Feedback`

**Status:** Not Started

---

## Task 3: New `phase-awaiting-design-decision` Skill

**Goal:** Create new skill for the "User Design Feedback" phase as its own session.

**File:** `skills/phase-awaiting-design-decision/SKILL.md` (new)

**Content:**
1. Header: name, description, trigger (status = "User Design Feedback")
2. Session start: read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for context
3. Present design options from stage file + design notes research
4. Go back-and-forth with user to select approach
5. Write discussion/decision to `STAGE-XXX-YYY-ZZZ-user-design-feedback.md`
6. Update stage file Design Phase section with user's choice
7. Exit gate:
   - Update stage tracking (status → Build)
   - Update ticket tracking
   - Invoke `lessons-learned` — mandatory
   - Invoke `journal` — mandatory

**Pattern reference:** Follow `phase-design` and `phase-finalize` exit gate patterns.

**Tests:** Grep for key terms: `sibling`, `user-design-feedback.md`, `lessons-learned`, `journal`, `Build`

**Status:** Not Started

---

## Task 4: `ticket-stage-workflow` Routing Updates

**Goal:** Route "User Design Feedback" and "Manual Testing" statuses to their new dedicated skills.

**File:** `skills/ticket-stage-workflow/SKILL.md`

**Changes:**
1. Update status routing table: "User Design Feedback" → `phase-awaiting-design-decision` (was: `phase-design`)
2. Update status routing table: "Manual Testing" → `phase-manual-testing` (new routing)

**Tests:** Grep for `phase-awaiting-design-decision` and `phase-manual-testing` in skill file.

**Status:** Not Started

---

## Task 4a: New `phase-manual-testing` Skill

**Goal:** Create new skill for the "Manual Testing" phase as its own session. Walks user through what to test based on `refinement_type`, collects approvals, session does not end until all areas approved.

**File:** `skills/phase-manual-testing/SKILL.md` (new)

**Content:**
1. Header: name, description, trigger (status = "Manual Testing")
2. Session start: read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for context
3. Read `refinement_type` from stage file YAML frontmatter
4. Generate testing checklist based on refinement type:
   - **frontend**: Visual checks, responsive layout, accessibility, user interactions
   - **backend**: API endpoint testing, data integrity, error responses
   - **cli**: Command-line argument handling, output format, error messages
   - **database**: Query correctness, migration testing, data consistency
   - **infrastructure**: Deployment verification, config validation
   - **custom**: General functionality verification
5. Walk user through each test area one at a time
6. User tests and reports pass/fail for each area
7. If any area fails: discuss, iterate, user re-tests until pass
8. **Session does not end until all areas approved**
9. Write testing walkthrough and results to `STAGE-XXX-YYY-ZZZ-manual-testing.md`
10. Update stage file's Manual Testing section with approval checklist (checkboxes filled in)
11. Exit gate:
    - Update stage tracking (status → Finalize)
    - Update ticket tracking
    - Invoke `lessons-learned` — mandatory
    - Invoke `journal` — mandatory

**Pattern reference:** Follow `phase-awaiting-design-decision` and `phase-finalize` exit gate patterns.

**Tests:** Grep for key terms: `sibling`, `manual-testing.md`, `refinement_type`, `lessons-learned`, `journal`, `Finalize`

**Status:** Not Started

---

## Task 5: `phase-build` — Add Notes File + Sibling Read

**Goal:** Update `phase-build` to write build notes and read prior phase notes.

**File:** `skills/phase-build/SKILL.md`

**Changes:**
1. Add instruction at session start: read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for prior context
2. Add instruction before exit gate: write session notes to `STAGE-XXX-YYY-ZZZ-build.md`
3. Remove `kanban-cli sync` from exit gate if present
4. Verify exit gate includes lessons-learned and journal invocations

**Tests:** Grep for `sibling`, `build.md`, `lessons-learned`, `journal`

**Status:** Not Started

---

## Task 6: `automatic-testing` — Add Notes File + Sibling Read

**Goal:** Update `automatic-testing` to write testing notes and read prior phase notes.

**File:** `skills/automatic-testing/SKILL.md`

**Changes:**
1. Add instruction at session start: read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for prior context
2. Add instruction before exit gate: write session notes to `STAGE-XXX-YYY-ZZZ-automatic-testing.md`
3. Remove `kanban-cli sync` from exit gate if present
4. Verify exit gate includes lessons-learned and journal invocations

**Tests:** Grep for `sibling`, `automatic-testing.md`, `lessons-learned`, `journal`

**Status:** Not Started

---

## Task 7: `phase-finalize` — Add Notes File + Sibling Read

**Goal:** Update `phase-finalize` to write finalize notes and read prior phase notes.

**File:** `skills/phase-finalize/SKILL.md`

**Changes:**
1. Add instruction at session start: read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for prior context
2. Add instruction before exit gate: write session notes to `STAGE-XXX-YYY-ZZZ-finalize.md`
3. Remove `kanban-cli sync` from exit gate if present
4. Verify exit gate includes lessons-learned and journal invocations

**Tests:** Grep for `sibling`, `finalize.md`, `lessons-learned`, `journal`

**Status:** Not Started

---

## Task 8: `kanban-cli learnings-count` Command

**Goal:** New CLI command that counts unanalyzed learnings.

**Files:**
- `tools/kanban-cli/src/cli/commands/learnings-count.ts` (new)
- `tools/kanban-cli/src/cli/index.ts` (register command)
- `skills/meta-insights/scripts/count-unanalyzed.sh` (new, or reuse `find-unanalyzed.sh`)

**Implementation:**
1. Create command file with options: `--pretty`, `--threshold <n>`
2. Read `WORKFLOW_LEARNINGS_THRESHOLD` from config (default: 10), allow `--threshold` override
3. Call `find-unanalyzed.sh` (or new counting script in `meta-insights/scripts/`)
4. Parse output: count lines, extract filenames
5. Compare count against threshold
6. Output JSON: `{ count, threshold, exceeded, files }`
7. Register in CLI index

**Tests:**
- Unit test: command with mock script output returns correct JSON
- Unit test: threshold comparison logic (exceeded true/false)
- Unit test: `--threshold` flag overrides config default
- Unit test: empty results returns `{ count: 0, exceeded: false }`
- Integration test: command runs against seed repo

**Status:** Not Started

---

## Task 9: Integration Verification

**Goal:** Run full verification and fix any issues.

**Steps:**
1. `npm run verify` — all 578+ tests pass, build clean, lint clean
2. Manual CLI test: `kanban-cli learnings-count --pretty`
3. Manual CLI test: `kanban-cli summary STAGE-XXX --pretty` with sister files
4. Grep all updated skills for mandatory terms: `lessons-learned`, `journal`, exit gate pattern
5. Verify `ticket-stage-workflow` routing is consistent

**Status:** Not Started
