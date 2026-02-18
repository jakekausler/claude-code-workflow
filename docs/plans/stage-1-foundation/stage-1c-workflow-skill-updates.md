# Stage 1C: Workflow Skill Updates — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update all workflow skills, commands, and metadata to use new terminology (epic→ticket hierarchy, three-level naming, YAML frontmatter) and add new capabilities (refinement_type, environment variables, kanban-cli integration).

**Architecture:** Pure markdown file updates. Skills live in `skills/<name>/SKILL.md`, commands in `commands/<name>.md`. Renaming directories via `git mv`. No TypeScript code — these are Claude Code instruction documents.

**Tech Stack:** Markdown, YAML frontmatter, git mv, grep (verification)

---

### Task 1: Rename epic-stage-setup → ticket-stage-setup

**Files:**
- Rename: `skills/epic-stage-setup/` → `skills/ticket-stage-setup/`
- Rewrite: `skills/ticket-stage-setup/SKILL.md`

**Step 1: Rename directory**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow
git mv skills/epic-stage-setup skills/ticket-stage-setup
```

**Step 2: Rewrite SKILL.md**

The new `ticket-stage-setup` skill must:

- **Frontmatter**: Update `name: ticket-stage-setup` and `description: Use when creating new projects requiring structured phased development, bootstrapping epic/ticket/stage hierarchy, creating new epics, tickets, or stages.`
- **Title**: `# Ticket-Stage Setup`
- **Three-level hierarchy**: Epic → Ticket → Stage (was only Epic → Stage)
- **New command syntax**:
  - `/setup epic "Name"` — Creates `EPIC-XXX` dir + file
  - `/setup ticket EPIC-XXX "Name"` — Creates `TICKET-XXX-YYY` dir + file under epic
  - `/setup stage TICKET-XXX-YYY "Name"` — Creates `STAGE-XXX-YYY-ZZZ` file under ticket
- **YAML frontmatter templates** for all three levels:
  - Epic: `id, title, status, jira_key, tickets, depends_on`
  - Ticket: `id, epic, title, status, jira_key, source, stages, depends_on`
  - Stage: `id, ticket, epic, title, status, session_active, refinement_type, depends_on, worktree_branch, priority, due_date` plus phase sections (Design Phase, Build Phase, Refinement Phase, Finalize Phase)
- **Directory layout**: `epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md`
- **Auto-ID generation**: Scan existing epics dir for next available ID
- **refinement_type**: Prompt user for type (frontend/backend/cli/database/infrastructure/custom) or infer from context
- **worktree_branch**: Auto-generate as `epic-xxx/ticket-xxx-yyy/stage-xxx-yyy-zzz`
- **Ticket without stages**: When creating a ticket, if no stages given, set `stages: []`
- **Run `kanban-cli sync`** after creating files

Replace entire file content. The old skill only knew about epics and stages (two levels). The new one must handle all three levels with YAML frontmatter.

**Step 3: Verify**

```bash
# Should find zero occurrences of old skill name
grep -r "epic-stage-setup" skills/ commands/ | grep -v ".git" | wc -l
# Expected: 0

# Should find the new skill
ls skills/ticket-stage-setup/SKILL.md
# Expected: file exists
```

**Step 4: Commit**

```bash
git add skills/ticket-stage-setup/
git commit -m "feat: rename epic-stage-setup to ticket-stage-setup with three-level hierarchy"
```

---

### Task 2: Rename epic-stage-workflow → ticket-stage-workflow

**Files:**
- Rename: `skills/epic-stage-workflow/` → `skills/ticket-stage-workflow/`
- Rewrite: `skills/ticket-stage-workflow/SKILL.md`

**Step 1: Rename directory**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow
git mv skills/epic-stage-workflow skills/ticket-stage-workflow
```

**Step 2: Update SKILL.md**

Key changes from the existing skill (642 lines):

- **Frontmatter**: `name: ticket-stage-workflow`, update description
- **All references** to "epic" (as work unit) → "ticket". The word "epic" now refers to the container ABOVE tickets.
- **Three-level hierarchy awareness**: Epic → Ticket → Stage
- **File path references**: `epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md`
- **ID references**: `EPIC-XXX` for epics, `TICKET-XXX-YYY` for tickets, `STAGE-XXX-YYY-ZZZ` for stages
- **Environment variables section** (new):
  - `WORKFLOW_REMOTE_MODE` (true/false, default false)
  - `WORKFLOW_AUTO_DESIGN` (true/false, default false)
  - `WORKFLOW_MAX_PARALLEL` (integer, default 1)
  - `WORKFLOW_GIT_PLATFORM` (github/gitlab/auto)
  - `WORKFLOW_LEARNINGS_THRESHOLD` (integer, default 10)
  Note: These are documented but not all are functional in Stage 1. Remote mode, Jira, Slack are Stage 2+.
- **Phase routing**: Update skill references (phase-refinement → automatic-testing)
- **Status values**: Update to match pipeline config (Design, User Design Feedback, Build, Automatic Testing, Manual Testing, Finalize, PR Created, Addressing Comments, Complete)
- **kanban-cli integration**: After any status change, run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ`
- **Session protocol**: Read YAML frontmatter from stage file instead of markdown headers
- **Refinement type**: Pass `refinement_type` from stage frontmatter to the automatic-testing skill

The existing content structure (Session Protocol, Phase Routing, Model Tiering, Communication Policy, Error Handling, Exit Gates) stays but with terminology updates throughout.

**Step 3: Verify**

```bash
grep -c "epic-stage-workflow" skills/ticket-stage-workflow/SKILL.md
# Expected: 0 (no old name references)

grep -c "ticket-stage-workflow" skills/ticket-stage-workflow/SKILL.md
# Expected: > 0

grep -c "WORKFLOW_REMOTE_MODE\|WORKFLOW_AUTO_DESIGN" skills/ticket-stage-workflow/SKILL.md
# Expected: > 0
```

**Step 4: Commit**

```bash
git add skills/ticket-stage-workflow/
git commit -m "feat: rename epic-stage-workflow to ticket-stage-workflow with env var awareness"
```

---

### Task 3: Update phase-design

**Files:**
- Modify: `skills/phase-design/SKILL.md`

**Changes:**
- **Terminology**: All "epic" (work unit) → "ticket", add "epic" as container references
- **YAML frontmatter reading**: Read from stage's YAML frontmatter, not markdown headers
- **File paths**: `epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md`
- **Auto-design awareness**: Add section about `WORKFLOW_AUTO_DESIGN`:
  - When `true`: brainstormer still runs, but proceeds with recommended option. Log recommendation + reasoning in stage file.
  - When `false` (default): existing behavior (present options, wait for user)
- **Entry conditions**: Update to reference `ticket-stage-workflow`
- **Exit gate**: Update to include `kanban-cli sync --stage`
- **Description**: Update to mention three-level hierarchy

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/phase-design/SKILL.md
# Expected: 0

grep -c "WORKFLOW_AUTO_DESIGN" skills/phase-design/SKILL.md
# Expected: > 0
```

**Commit:**

```bash
git add skills/phase-design/SKILL.md
git commit -m "feat: update phase-design with terminology rename and auto-design awareness"
```

---

### Task 4: Update phase-build

**Files:**
- Modify: `skills/phase-build/SKILL.md`

**Changes:**
- **Terminology**: All "epic" (work unit) → "ticket", add "epic" as container
- **File paths and IDs**: Updated to three-level hierarchy
- **Worktree awareness** (new section): Before implementation begins, check if `worktree_branch` is set in stage frontmatter. If so, ensure the worktree exists (`git worktree add` with the branch name). This is preparatory — full worktree management is Stage 6.
- **Entry conditions**: Reference `ticket-stage-workflow`
- **Exit gate**: Include `kanban-cli sync --stage`

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/phase-build/SKILL.md
# Expected: 0

grep -c "worktree" skills/phase-build/SKILL.md
# Expected: > 0
```

**Commit:**

```bash
git add skills/phase-build/SKILL.md
git commit -m "feat: update phase-build with terminology rename and worktree awareness"
```

---

### Task 5: Rename phase-refinement → automatic-testing

**Files:**
- Rename: `skills/phase-refinement/` → `skills/automatic-testing/`
- Rewrite: `skills/automatic-testing/SKILL.md`

**Step 1: Rename**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow
git mv skills/phase-refinement skills/automatic-testing
```

**Step 2: Rewrite SKILL.md**

Major changes:
- **Frontmatter**: `name: automatic-testing`, description updated
- **Title**: `# Automatic Testing Phase`
- **Terminology**: All updates
- **refinement_type support** (major new feature):
  - Read `refinement_type` from stage YAML frontmatter (array)
  - Load checklist based on type(s):
    - `frontend`: Desktop Approved, Mobile Approved, Regression Items Added
    - `backend`: E2E Tests Approved, Regression Items Added
    - `cli`: CLI Behavior Approved, Regression Items Added
    - `database`: Migration Verified, Data Integrity Approved, Regression Items Added
    - `infrastructure`: Deployment Verified, Regression Items Added
    - `custom`: User-defined approvals from Design phase, Regression Items Added
  - Combined checklists when multiple types listed (all approvals required)
- **Reset rule generalized**: ANY code change during testing resets ALL approvals for ALL refinement types. No exceptions. This replaces the old "viewport reset" specific to frontend.
- **Session boundary rules**: Updated to check YAML frontmatter
- **Exit gate**: Include `kanban-cli sync --stage`
- **Status values**: "Automatic Testing" and "Manual Testing" instead of "Refinement"

**Step 3: Verify**

```bash
grep -c "phase-refinement" skills/automatic-testing/SKILL.md
# Expected: 0

grep -c "refinement_type" skills/automatic-testing/SKILL.md
# Expected: > 0

grep -c "frontend\|backend\|cli\|database\|infrastructure\|custom" skills/automatic-testing/SKILL.md
# Expected: > 0
```

**Step 4: Commit**

```bash
git add skills/automatic-testing/
git commit -m "feat: rename phase-refinement to automatic-testing with refinement_type support"
```

---

### Task 6: Update phase-finalize

**Files:**
- Modify: `skills/phase-finalize/SKILL.md`

**Changes:**
- **Terminology**: All updates
- **File paths**: Three-level hierarchy
- **Remote mode awareness** (conditional text):
  - Add section explaining local vs remote mode
  - Local mode (default): unchanged behavior, merge to main, status → Complete
  - Remote mode (`WORKFLOW_REMOTE_MODE=true`): push branch, create MR/PR, status → PR Created
  - Note: "Remote mode functionality ships in Stage 3. For now, local mode only."
- **Tracking file updates**: Use YAML frontmatter updates instead of markdown header updates
- **kanban-cli sync**: After status changes
- **Entry conditions**: Reference `ticket-stage-workflow`
- **Commit messages**: Reference epic/ticket/stage in commit messages

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/phase-finalize/SKILL.md
# Expected: 0

grep -c "WORKFLOW_REMOTE_MODE" skills/phase-finalize/SKILL.md
# Expected: > 0
```

**Commit:**

```bash
git add skills/phase-finalize/SKILL.md
git commit -m "feat: update phase-finalize with terminology rename and remote mode awareness"
```

---

### Task 7: Update lessons-learned

**Files:**
- Modify: `skills/lessons-learned/SKILL.md`

**Changes:**
- **Terminology**: "epic" (work unit) → "ticket" throughout
- **Metadata fields**: Update YAML frontmatter template in entries to include:
  - `repository` (unchanged)
  - `epic` (NEW — the epic ID, e.g., EPIC-001)
  - `ticket` (was "epic" — the ticket ID, e.g., TICKET-001-001)
  - `stage` (unchanged but with new ID format)
  - `phase` (unchanged)
  - `analyzed` (unchanged)
- **Entry path**: Unchanged (`~/docs/claude-learnings/YYYY-MM-DDTHH-MM-SS.md`)
- **References**: Update skill references (epic-stage-workflow → ticket-stage-workflow)

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/lessons-learned/SKILL.md
# Expected: 0

grep "epic:" skills/lessons-learned/SKILL.md | head -3
# Expected: references to the epic field in metadata template
```

**Commit:**

```bash
git add skills/lessons-learned/SKILL.md
git commit -m "feat: update lessons-learned with three-level metadata (epic, ticket, stage)"
```

---

### Task 8: Update journal

**Files:**
- Modify: `skills/journal/SKILL.md`

**Changes:**
- **Terminology**: Same as lessons-learned
- **Metadata fields**: Same additions (epic, ticket, stage)
- **Entry path**: Unchanged (`~/docs/claude-journal/YYYY-MM-DDTHH-MM-SS.md`)
- **References**: Update skill references

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/journal/SKILL.md
# Expected: 0
```

**Commit:**

```bash
git add skills/journal/SKILL.md
git commit -m "feat: update journal with three-level metadata"
```

---

### Task 9: Update meta-insights

**Files:**
- Modify: `skills/meta-insights/SKILL.md`

**Changes:**
- **Terminology**: All updates
- **Metadata references**: Epic, ticket, stage fields
- **Threshold trigger note**: Add note that when unanalyzed learnings exceed `WORKFLOW_LEARNINGS_THRESHOLD`, meta-insights should be auto-invoked. Note: "Auto-trigger implementation ships in Stage 5. For now, manual invocation only via /analyze_learnings."
- **Helper scripts**: Check if any scripts reference old terminology and update
- **References**: Update skill references

**Verify:**

```bash
grep -c "epic-stage-workflow" skills/meta-insights/SKILL.md
# Expected: 0

grep -c "WORKFLOW_LEARNINGS_THRESHOLD" skills/meta-insights/SKILL.md
# Expected: > 0
```

**Commit:**

```bash
git add skills/meta-insights/
git commit -m "feat: update meta-insights with terminology and threshold trigger note"
```

---

### Task 10: Update next_task command

**Files:**
- Rewrite: `commands/next_task.md`

**Changes (major rewrite):**

- **Frontmatter**: Keep `name: next_task`, update description
- **Core behavior**: Call `kanban-cli next --max 1` to get next workable stage
- **Task card format**: New three-level display:
  ```
  ═══════════════════════════════════════════════════════════
  NEXT TASK
  ═══════════════════════════════════════════════════════════
  Epic:     EPIC-001 [User Authentication]
  Ticket:   TICKET-001-001 [Login Flow]
  Stage:    STAGE-001-001-001 [Login Form]
  Phase:    Design
  Type:     frontend

  Instructions:
  [Phase-specific instructions]

  Dependencies: All resolved
  Worktree:     epic-001/ticket-001-001/stage-001-001-001
  ═══════════════════════════════════════════════════════════
  ```
- **Fallback**: If `kanban-cli` is not available, fall back to scanning `epics/` directory directly
- **To Convert handling**: If `kanban-cli next` returns a ticket needing conversion, display that with instructions to run `convert-ticket` (note: convert-ticket ships in Stage 2)
- **Phase-specific instructions**: Route to appropriate skill based on stage status
- **Invoke ticket-stage-workflow**: After displaying the card, invoke the workflow skill

**Verify:**

```bash
grep -c "kanban-cli next" commands/next_task.md
# Expected: > 0

grep -c "EPIC-" commands/next_task.md
# Expected: > 0 (references to epic in task card)
```

**Commit:**

```bash
git add commands/next_task.md
git commit -m "feat: rewrite next_task to use kanban-cli next with three-level task card"
```

---

### Task 11: Update analyze_learnings command

**Files:**
- Modify: `commands/analyze_learnings.md`

**Changes:**
- **Terminology**: Update any references to old skill names
- **Reference**: Point to `meta-insights` skill (unchanged name)

**Verify:**

```bash
grep -c "epic-stage" commands/analyze_learnings.md
# Expected: 0
```

**Commit:**

```bash
git add commands/analyze_learnings.md
git commit -m "feat: update analyze_learnings with terminology changes"
```

---

### Task 12: Final Verification

**Step 1: Check for remaining old terminology across ALL skills and commands**

```bash
# Check for old skill name references (should be zero)
grep -r "epic-stage-setup\|epic-stage-workflow" skills/ commands/ --include="*.md" | grep -v ".git"
# Expected: empty output

# Check for old phase name reference
grep -r "phase-refinement" skills/ commands/ --include="*.md" | grep -v ".git"
# Expected: empty output (may appear in historical context — that's OK)

# Verify all new skill directories exist
ls -d skills/ticket-stage-setup skills/ticket-stage-workflow skills/automatic-testing skills/phase-design skills/phase-build skills/phase-finalize skills/journal skills/lessons-learned skills/meta-insights
# Expected: all listed

# Verify old directories are gone
ls -d skills/epic-stage-setup skills/epic-stage-workflow skills/phase-refinement 2>&1
# Expected: all "No such file or directory"
```

**Step 2: Verify npm run verify still passes**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
npm run verify
```

Expected: All 84+ tests pass. Skill changes don't affect TypeScript tests.

**Step 3: Commit if any remaining fixes needed**

```bash
git status
# If any unstaged changes remain, stage and commit
```

---

### Completion Checklist

- [ ] `epic-stage-setup` → `ticket-stage-setup` (renamed + rewritten with three-level hierarchy)
- [ ] `epic-stage-workflow` → `ticket-stage-workflow` (renamed + updated with env vars)
- [ ] `phase-design` updated (auto-design awareness, terminology)
- [ ] `phase-build` updated (worktree awareness, terminology)
- [ ] `phase-refinement` → `automatic-testing` (renamed + refinement_type support)
- [ ] `phase-finalize` updated (remote mode awareness, terminology)
- [ ] `lessons-learned` updated (three-level metadata)
- [ ] `journal` updated (three-level metadata)
- [ ] `meta-insights` updated (threshold trigger note, terminology)
- [ ] `next_task` command rewritten (kanban-cli next integration)
- [ ] `analyze_learnings` command updated
- [ ] No remaining old terminology in skills/commands
- [ ] npm run verify still passes
- [ ] Each task committed incrementally
