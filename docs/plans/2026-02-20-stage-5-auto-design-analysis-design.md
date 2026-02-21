# Stage 5: Auto-Design + Auto-Analysis — Design Document

**Date:** 2026-02-20
**Branch:** kanban
**Depends on:** Stage 1 (config system, file format)

---

## 1. Summary

Stage 5 delivers three capabilities:

1. **Auto-design mode** — When `WORKFLOW_AUTO_DESIGN=true`, the Design phase auto-selects the recommended approach and skips to Build without user interaction
2. **Phase notes files** — Every phase writes a `-<phase>.md` sister file alongside the stage file containing detailed session context. Later phases read all sibling notes for prior context
3. **`kanban-cli learnings-count` command** — Standalone CLI command that counts unanalyzed learnings for future Stage 6E cron integration

---

## 2. Phase Notes Files Pattern

### 2.1 Convention

Every phase skill writes a notes file alongside the stage file using the naming convention:

```
STAGE-XXX-YYY-ZZZ-<phase>.md
```

| Phase Skill | Notes File Suffix | Content |
|-------------|-------------------|---------|
| `phase-design` | `-design.md` | Full research context, codebase exploration, all approaches with detailed trade-offs, brainstormer output |
| `phase-awaiting-design-decision` (new) | `-user-design-feedback.md` | Discussion log, user Q&A, rationale for selected approach, rejected alternatives |
| `phase-build` | `-build.md` | Implementation decisions, problems encountered, deviations from design, key code changes |
| `automatic-testing` | `-automatic-testing.md` | Test results, failures found, fixes applied |
| Manual Testing (handled within refinement) | `-manual-testing.md` | User testing notes, feedback, issues found |
| `phase-finalize` | `-finalize.md` | Code review findings, documentation updates, PR details |

### 2.2 Stage File Stays Lean

The main `STAGE-XXX-YYY-ZZZ.md` file contains only structured tracking: YAML frontmatter + phase status checklists + brief summary bullets. Detailed context lives in the notes files.

### 2.3 Sibling File Reading

Phase skills are instructed to "read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for prior context" — no enumeration of specific files. This is future-proof if phases are added or renamed.

### 2.4 Summary Pipeline Integration

`readStageFileContent()` in `tools/kanban-cli/src/cli/logic/summary.ts` is updated to:

1. Glob for `STAGE-XXX-YYY-ZZZ-*.md` sister files in the same directory
2. Sort all files (main + sisters) by file modified time
3. Concatenate with the filename as a header before each file's content:
   ```
   --- STAGE-001-001-001.md ---
   [main stage file content]

   --- STAGE-001-001-001-design.md ---
   [design notes content]

   --- STAGE-001-001-001-build.md ---
   [build notes content]
   ```
4. Content hash covers all files — cache invalidates when any notes file is added or modified

This is completely phase-agnostic. Works with any sister file naming.

---

## 3. Auto-Design

### 3.1 Approach: Skill-Level Skip

The pipeline YAML is unchanged. `phase-design` handles the conditional logic internally.

### 3.2 `phase-design` Changes

**When `WORKFLOW_AUTO_DESIGN=true`:**
1. Brainstormer runs as normal (Opus subagent, 2-3 approaches with recommendation)
2. Auto-selects the recommended approach
3. Writes full research to `STAGE-XXX-YYY-ZZZ-design.md`
4. Writes brief approach options summary to stage file's Design Phase section
5. Logs: "Auto-selected: [Approach Name] — [reasoning]" in both files
6. Transitions stage status → **Build** (skips "User Design Feedback")

**When `WORKFLOW_AUTO_DESIGN=false` or unset (default):**
1. Brainstormer runs, generates approaches
2. Writes full research to `STAGE-XXX-YYY-ZZZ-design.md`
3. Writes approach options summary to stage file
4. Transitions stage status → **User Design Feedback**
5. Session ends — user design feedback happens in a separate session

### 3.3 Phase Exit Gate (Design)

Every exit, regardless of auto-design setting:
1. Write phase notes to `-design.md` sister file
2. Update stage tracking file (mark Design phase complete, set status)
3. Update ticket tracking file
4. Invoke `lessons-learned` skill — **mandatory**
5. Invoke `journal` skill — **mandatory**

Note: `kanban-cli sync` is NOT run by the skill — that is the Stage 6 orchestrator's responsibility.

### 3.4 New `phase-awaiting-design-decision` Skill

**Purpose:** Handles the "User Design Feedback" status as its own session.

**Flow:**
1. Read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for context (will include `-design.md` from prior phase)
2. Read stage file for the approach options summary
3. Present options to user with trade-offs from design research
4. Discuss back-and-forth, answer questions, weigh alternatives
5. User selects approach
6. Write discussion and decision rationale to `STAGE-XXX-YYY-ZZZ-user-design-feedback.md`
7. Update stage file Design Phase section with selected approach
8. Phase exit gate:
   - Update stage tracking file (set status → Build)
   - Update ticket tracking file
   - Invoke `lessons-learned` skill — **mandatory**
   - Invoke `journal` skill — **mandatory**

**When `WORKFLOW_AUTO_DESIGN=true`:** This skill is never entered — `phase-design` transitions directly to Build.

### 3.5 `ticket-stage-workflow` Routing Update

Status "User Design Feedback" routes to `phase-awaiting-design-decision` (currently routes to `phase-design`).

---

## 4. Phase Notes in All Existing Skills

### 4.1 Changes Per Skill

Each existing phase skill gets two additions:

1. **At session start:** Read all `STAGE-XXX-YYY-ZZZ-*.md` sibling files for prior context
2. **Before exit gate:** Write phase notes to the appropriate `-<phase>.md` sister file

### 4.2 Exit Gate Pattern (All Phases)

Every phase skill follows this exit gate order:

1. Write phase notes to sister file
2. Update stage tracking file
3. Update ticket tracking file
4. Invoke `lessons-learned` skill — **mandatory, no exceptions**
5. Invoke `journal` skill — **mandatory, no exceptions**

`kanban-cli sync` is the orchestrator's responsibility (Stage 6), not the skill's.

### 4.3 Skills Requiring Updates

| Skill | Add Notes Write | Add Sibling Read | Exit Gate Already Has lessons-learned + journal |
|-------|----------------|------------------|-----------------------------------------------|
| `phase-design` | `-design.md` | No (first phase) | Yes — verify |
| `phase-awaiting-design-decision` | `-user-design-feedback.md` | Yes | New skill — include |
| `phase-build` | `-build.md` | Yes | Yes — verify |
| `automatic-testing` | `-automatic-testing.md` | Yes | Verify |
| `phase-finalize` | `-finalize.md` | Yes | Yes — verify |

---

## 5. `kanban-cli learnings-count` Command

### 5.1 Command Signature

```bash
kanban-cli learnings-count [options]
```

**Options:**
- `--pretty` — Pretty-print JSON output
- `--threshold <n>` — Override threshold (defaults to `WORKFLOW_LEARNINGS_THRESHOLD` from config, which defaults to 10)

### 5.2 Implementation

- Calls existing `skills/meta-insights/scripts/find-unanalyzed.sh` (or a new script in that directory if the existing one isn't suitable for counting)
- `find-unanalyzed.sh` already greps for `analyzed: false` across `~/docs/claude-learnings/` and `~/docs/claude-journal/`
- CLI counts the results and compares against threshold

### 5.3 Output

```json
{
  "count": 14,
  "threshold": 10,
  "exceeded": true,
  "files": ["2026-02-18T10-30-00.md", "..."]
}
```

### 5.4 No Phase Integration

This is a standalone command. No integration with any phase skill or exit gate. Stage 6E wires it into a cron.

---

## 6. Scope Boundaries

### In Scope (Stage 5)

- Phase notes files pattern across all phase skills
- `phase-design` auto-design behavior + notes file output
- New `phase-awaiting-design-decision` skill
- `ticket-stage-workflow` routing update for "User Design Feedback"
- Phase notes in `phase-build`, `automatic-testing`, `phase-finalize`
- Summary pipeline integration (read sister files)
- `kanban-cli learnings-count` command

### Out of Scope

- `kanban-cli sync` in skill exit gates (Stage 6 orchestrator responsibility)
- Auto-triggering meta-insights from threshold (Stage 6E cron)
- Pipeline YAML changes (skill-level skip, no state machine changes)
- Orchestrator session management

---

## 7. Constraints

- 578 existing tests must continue passing
- `npm run verify` must pass after every task
- Skills are markdown files — no code execution in skills
- Auto-design gracefully degrades when not set or `false`
- Learnings threshold gracefully degrades when not set
- Stage 5 is independent of Stages 2, 3, 4
