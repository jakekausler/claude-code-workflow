# Stage 5.5A: Schema & Sync — MR Dependency Resolution — Session Prompt

## Context

Stages 0-5 are complete on the `kanban` branch. This session implements **Stage 5.5A: Schema & Sync — MR Dependency Resolution** — the foundational schema and sync engine changes that enable graduated dependency resolution (soft-resolve at PR Created, hard-resolve at Complete).

### What Has Been Built (Stages 0-5)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):

| Command | Description | Output Formats |
|---------|-------------|---------------|
| `board` | Kanban board view | JSON, `--html`, `--pretty` |
| `graph` | Dependency graph | JSON, `--mermaid`, `--pretty` |
| `next` | Priority-sorted ready stages | JSON, `--pretty` |
| `validate` | Frontmatter + dependency integrity | JSON, `--pretty` |
| `validate-pipeline` | Pipeline config validation (4 layers) | JSON, `--pretty` |
| `sync` | Re-parse files into SQLite | JSON, `--pretty` |
| `summary` | LLM-powered hierarchical summaries | JSON, `--pretty`, `--model`, `--no-cache`, `-q` |
| `migrate` | Old-format repo conversion | JSON, `--pretty`, `--dry-run` |
| `jira-import` | Import Jira issues as local epics/tickets | JSON, `--pretty`, `--epic` |
| `jira-sync` | Sync workflow state to Jira | JSON, `--pretty`, `--dry-run` |
| `learnings-count` | Count unanalyzed learnings entries | JSON, `--pretty`, `--threshold` |

All commands support `--output/-o <file>` and `--repo <path>`.

**Infrastructure (Stages 0-1):**
- SQLite database with repos, epics, tickets, stages, dependencies, summaries tables
- `session_active`, `locked_at`, `locked_by` fields on stages table
- `pr_url`, `pr_number` fields on stages table
- YAML frontmatter parser (gray-matter) for epics, tickets, stages
- File discovery (recursive walk of epics/ directory)
- Kanban column calculator (pipeline config-driven, not hardcoded)
- Sync engine handling all 5 dependency types (stage→stage, stage→ticket, stage→epic, ticket→ticket, epic→epic)
- Dependency resolution: stage=Complete, ticket=all stages Complete, epic=all stages Complete
- Pipeline config system (YAML state machine, skill/resolver states, transition validator)

**Stage 2: Migration + Conversion:**
- `kanban-cli migrate` command, migration modules, `migrate-repo` skill, `convert-ticket` skill

**Stage 3: Remote Mode:**
- Git platform auto-detection, GitHub/GitLab adapters, `pr-status` resolver, `phase-finalize` with MR/PR creation, `review-cycle` skill

**Stage 4: Jira Integration:**
- Jira config in `.kanban-workflow.yaml`, JiraScriptExecutor, `jira-import` command, `jira-sync` command

**Stage 5: Auto-Design + Auto-Analysis:**
- `WORKFLOW_AUTO_DESIGN`, phase notes files, sibling file reading, `phase-awaiting-design-decision`, `phase-manual-testing`, `learnings-count` command, canonical exit gate pattern

**Test Suite:** 596 tests across 46 test files, all passing
**Source Files:** ~70 TypeScript source files

### Key Design References

- Full design doc: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`
- **MR dependency chains design**: `docs/plans/2026-02-21-mr-dependency-chains-design.md` ← PRIMARY REFERENCE FOR THIS STAGE
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`
- Integration spec: `tools/kanban-cli/docs/integration-spec-stage-1.md`

---

## What Stage 5.5A Delivers

### Goal

Add graduated dependency resolution to the sync engine and all supporting schema. When a parent stage enters `PR Created`, its dependent child stages can be soft-unblocked — moved from Backlog to Ready for Work — with metadata tracking which parent MR branches they depend on. This is the foundation for branch chain management (5.5B) and the enhanced MR cron (6D).

### What Ships

1. **New stage frontmatter fields**:
   - `pending_merge_parents`: Array of `{stage_id, branch, pr_url, pr_number}` objects tracking unmerged parent dependencies
   - `is_draft`: Boolean indicating this stage's MR was created as draft due to pending parents
   - `mr_target_branch`: String recording what branch this stage's MR targets (parent branch or main)

2. **New ticket frontmatter field**:
   - `jira_links`: Array of `{type, url, title, key?, relationship?, filename?, mime_type?}` objects — link manifest for Jira enrichment (used by Stage 5.5C)

3. **SQLite schema additions**:
   - `is_draft BOOLEAN DEFAULT 0` column on stages table
   - `pending_merge_parents TEXT` column on stages table (JSON array)
   - `mr_target_branch TEXT` column on stages table
   - New `parent_branch_tracking` table:
     ```sql
     CREATE TABLE parent_branch_tracking (
       id INTEGER PRIMARY KEY,
       child_stage_id TEXT NOT NULL,
       parent_stage_id TEXT NOT NULL,
       parent_branch TEXT NOT NULL,
       parent_pr_url TEXT,
       last_known_head TEXT,
       is_merged BOOLEAN DEFAULT 0,
       repo_id INTEGER REFERENCES repos(id),
       last_checked TEXT NOT NULL
     );
     ```
   - Indexes: `idx_parent_tracking_child`, `idx_parent_tracking_parent`

4. **Sync engine dual-resolution logic**:
   - Stage dependencies: **hard-resolved** when status = `Complete`, **soft-resolved** when status in (`PR Created`, `Addressing Comments`)
   - Ticket dependencies: hard-resolved only (all stages Complete)
   - Epic dependencies: hard-resolved only (all stages Complete)
   - A stage with ALL dependencies either hard-resolved or soft-resolved is eligible for `ready_for_work` column

5. **`pending_merge_parents` population during sync**:
   - When a stage moves from Backlog to Ready for Work via soft-resolution:
     - Read the parent stage's `worktree_branch`, `pr_url`, `pr_number` from SQLite
     - Populate child stage's `pending_merge_parents` in both frontmatter and SQLite
   - When a parent stage reaches Complete (hard-resolved):
     - Remove that parent's entry from child's `pending_merge_parents`
     - If `pending_merge_parents` is now empty, clear `is_draft` flag

6. **Kanban column assignment update**:
   - Current: unresolved deps → `backlog`, `Not Started` + all resolved → `ready_for_work`
   - New: unresolved deps (none soft-or-hard-resolved) → `backlog`, `Not Started` + all soft-or-hard-resolved → `ready_for_work`
   - Stages in `ready_for_work` may have non-empty `pending_merge_parents` — this is normal

7. **`kanban-cli validate` updates**:
   - Validate `pending_merge_parents` entries reference existing stages
   - Validate `pending_merge_parents` parent stages are in PR Created or later (or Complete)
   - Validate `jira_links` format when present on tickets
   - Warn if `is_draft` is true but `pending_merge_parents` is empty (inconsistent state)

8. **Zod schema updates**:
   - Stage schema: add `pending_merge_parents`, `is_draft`, `mr_target_branch` with correct types and defaults
   - Ticket schema: add `jira_links` with correct type structure

9. **Board output changes**:
   - Stages in `ready_for_work` with non-empty `pending_merge_parents` include parent info in board JSON output
   - HTML board can optionally show a "⚠️ pending merge" indicator

### What Stage 5.5A Does NOT Include

- ❌ Branch chain management in phase-build/phase-finalize (Stage 5.5B)
- ❌ Code host adapter additions (editPrBase, markPrReady, getBranchHead) (Stage 5.5B)
- ❌ Draft MR creation logic (Stage 5.5B)
- ❌ Jira link manifest extraction during import (Stage 5.5C)
- ❌ Confluence/attachment content fetching (Stage 5.5C)
- ❌ MR cron parent tracking or rebase logic (Stage 6D)
- ❌ Orchestrator infrastructure (Stage 6A)
- ❌ Any changes to phase skills (other than consuming new frontmatter fields if already reading them)

---

## Existing Infrastructure (Key Files to Modify)

### Sync Engine

**Primary file**: `tools/kanban-cli/src/sync/sync.ts`

Current dependency resolution logic (around lines 128-200):
- Resolves dependencies based on target entity status
- Stage → resolved when `status === 'Complete'`
- Ticket → resolved when all stages Complete
- Epic → resolved when all stages Complete

This is where the soft-resolution logic must be added.

### SQLite Schema

**Primary file**: `tools/kanban-cli/src/db/schema.ts`

Contains table definitions. New columns and table must be added here.

### Dependency Repository

**Primary file**: `tools/kanban-cli/src/db/repositories/dependency-repository.ts`

Methods: `upsert()`, `resolve()`, `allResolved()`, `listByTarget()`, `listBySource()`. May need a new `allSoftOrHardResolved()` method or modification to `allResolved()` to accept a resolution mode.

### Stage Repository

**Primary file**: `tools/kanban-cli/src/db/repositories/stage-repository.ts`

Needs methods for reading/writing `pending_merge_parents`, `is_draft`, `mr_target_branch`.

### Kanban Column Calculator

**Primary file**: `tools/kanban-cli/src/engine/kanban-columns.ts`

Current logic maps status + dependency state to kanban columns. Must be updated to treat soft-resolved stages as "resolved enough" for column assignment.

### Frontmatter Types

**Primary file**: `tools/kanban-cli/src/types/work-items.ts`

Stage and Ticket TypeScript interfaces. Add new fields here.

### Zod Schemas

**Primary file**: `tools/kanban-cli/src/config/schema.ts` (or wherever Zod frontmatter schemas live)

Add validation for new fields.

### Validate Command

**Primary file**: `tools/kanban-cli/src/cli/commands/validate.ts` and `tools/kanban-cli/src/cli/logic/validate.ts`

Add validation rules for `pending_merge_parents` references and `jira_links` format.

---

## Open Questions (Resolve During Design Phase)

1. **Should `pending_merge_parents` be auto-populated by the sync engine during `kanban-cli sync`, or should it be explicitly managed by the orchestrator (Stage 6)?**

   The design doc says sync engine populates it. This means `kanban-cli sync` has a side effect of writing to child stage frontmatter (not just reading). This is a change from the current model where sync only reads files and writes to SQLite. Consider: should sync detect the soft-resolution condition and write `pending_merge_parents` to the child stage file? Or should it only update SQLite, leaving frontmatter writes to the orchestrator?

   **Recommended resolution**: Sync populates in SQLite only. Frontmatter writes happen via the orchestrator (Stage 6C backlog re-evaluation). Until the orchestrator exists, `pending_merge_parents` in frontmatter is empty — the SQLite column is the source of truth for "this stage has pending parents." This avoids sync having write side-effects on stage files.

   **Alternative**: Sync writes to both. Simpler for Stage 5.5A but creates a precedent of sync modifying source files.

2. **How should `kanban-cli validate` handle `pending_merge_parents` entries whose parent stage has been manually moved backward (e.g., from PR Created back to Build)?**

   Options: Error (strict), warning (lenient), auto-clean (remove stale entries).

3. **Should the `parent_branch_tracking` table be populated by sync or only by the orchestrator's cron (Stage 6D)?**

   Recommendation: Only by 6D's cron. Stage 5.5A creates the table schema but doesn't populate it. The cron fills it when it starts tracking parent MRs.

4. **Content hash vs mtime for detecting frontmatter staleness with the new fields?**

   The existing sync uses file mtime for staleness detection. Adding more fields increases the chance of external edits that mtime might miss. Worth considering content hashing, but this may be overkill for Stage 5.5A — defer to Stage 6A?

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the MR dependency chains design doc (`docs/plans/2026-02-21-mr-dependency-chains-design.md`)
2. Study the existing sync engine (`tools/kanban-cli/src/sync/sync.ts`) — understand how dependency resolution currently works
3. Study the SQLite schema (`tools/kanban-cli/src/db/schema.ts`) — understand current table structure
4. Study the kanban column calculator (`tools/kanban-cli/src/engine/kanban-columns.ts`) — understand column assignment logic
5. Study the frontmatter types (`tools/kanban-cli/src/types/work-items.ts`) — understand current type definitions
6. Study the dependency repository (`tools/kanban-cli/src/db/repositories/dependency-repository.ts`) — understand query patterns
7. Resolve the Open Questions listed above
8. Identify what is **in scope** (5.5A schema + sync) vs **out of scope** (5.5B skills, 5.5C Jira, 6A+ orchestrator)
9. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-5.5a-schema-sync-design.md`
2. Write the implementation plan to `docs/plans/stage-5.5a-schema-sync/IMPLEMENTATION_PLAN.md`
   - Task-level breakdown with full descriptions
   - Dependency graph between tasks
   - Each task specifies: goal, files, changes, tests, status

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill to execute:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor**
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Integration test with real CLI calls
8. Write handoff for Stage 5.5B

### Key Constraints

- The existing 596 tests must continue passing throughout
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass after every task
- New frontmatter fields must have sensible defaults (empty arrays, false, null) so existing stage files remain valid
- Backward compatibility: stages without the new fields must work identically to before
- The sync engine should NOT write to stage frontmatter files (only read files, write SQLite) — see Open Question 1
- The `parent_branch_tracking` table is created but not populated (Stage 6D's responsibility)
- Schema changes must include proper SQLite migrations (ALTER TABLE or recreate if needed)

### Suggested Sub-Stage Breakdown

This is a starting point — refine during design:

- **5.5A-1**: Type definitions — Add new fields to Stage and Ticket TypeScript interfaces, Zod schemas
- **5.5A-2**: SQLite schema — New columns on stages table, new `parent_branch_tracking` table, indexes
- **5.5A-3**: Sync engine — Dual-resolution logic (soft/hard), `pending_merge_parents` population in SQLite
- **5.5A-4**: Kanban columns — Update column calculator for soft-resolved dependencies
- **5.5A-5**: Validate command — New validation rules for `pending_merge_parents` and `jira_links`
- **5.5A-6**: Board output — Include `pending_merge_parents` info in board JSON, optional HTML indicator
- **5.5A-7**: Repository methods — New queries for parent tracking, pending merge parents
- **5.5A-8**: Integration testing — End-to-end with test repo scenarios, verify backward compatibility

### Testing the Current System

```bash
# Seed test repos
cd tools/kanban-cli
bash scripts/seed-test-repo.sh
bash scripts/seed-old-format-repo.sh

# Key commands to verify backward compatibility
npx tsx src/cli/index.ts sync --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts board --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts validate --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts next --repo /tmp/kanban-test-repo --max 3 --pretty
npx tsx src/cli/index.ts graph --repo /tmp/kanban-test-repo --pretty

# Run full test suite
npm run verify
```

---

## Next Steps After Stage 5.5A

After this session completes Stage 5.5A:

- **Stage 5.5B** will add code host adapter methods (`editPrBase`, `markPrReady`, `getBranchHead`), update `phase-build` for parent branch merging, and update `phase-finalize` for draft MR creation
- **Stage 5.5C** will add `jira_links` manifest extraction to `jira-import` and enriched content fetching to `convert-ticket`
- **Stage 6A** will build the orchestrator infrastructure (session spawning, worktree management, locking) with awareness of `pending_merge_parents` for worktree creation

Stage 5.5B depends on 5.5A. Stage 5.5C depends on 5.5A (for `jira_links` schema). Stage 5.5C is independent of 5.5B and can be developed in parallel.
