# Stage 5.5B: Skill Updates — Branch Chain & Draft MR — Session Prompt

## Context

Stage 5.5A is complete on the `kanban` branch. This session implements **Stage 5.5B: Skill Updates — Branch Chain & Draft MR** — the phase skill changes that consume the graduated dependency resolution infrastructure built in 5.5A.

### What Stage 5.5A Built

**New types and schemas**:
- `PendingMergeParent` interface: `{ stage_id, branch, pr_url, pr_number }`
- `JiraLink` interface: `{ type, url, title, key?, relationship?, filename?, mime_type? }`
- Zod schemas with defaults in `src/parser/frontmatter-schemas.ts`
- Stage interface extended with: `pending_merge_parents`, `is_draft`, `mr_target_branch`
- Ticket interface extended with: `jira_links`

**SQLite schema**:
- `stages` table has new columns: `is_draft` (BOOLEAN DEFAULT 0), `pending_merge_parents` (TEXT/JSON), `mr_target_branch` (TEXT)
- `parent_branch_tracking` table exists (schema only, not populated — Stage 6D's responsibility)
- `StageRepository.updatePendingMergeParents(stageId, parents)` method exists

**Sync engine dual resolution**:
- Stage→stage deps: soft-resolved at `PR Created`/`Addressing Comments`, hard-resolved at `Complete`
- All other dep types: hard-resolved only (unchanged)
- `pending_merge_parents` populated in both SQLite and frontmatter during sync
- Cleanup: entries removed when parent reaches Complete, `is_draft` cleared when empty
- `computeKanbanColumn()` unchanged — input computation changed in sync.ts

**Validate command**:
- Validates `pending_merge_parents` references (error if stage_id doesn't exist, warning if parent in wrong status)
- Validates `jira_links` format (error if missing type/url/title, error if invalid type)
- Warning for `is_draft: true` with empty `pending_merge_parents`

**Board output**:
- JSON includes `pending_merge_parents` for stages that have them
- HTML shows ⚠️ indicator for stages with pending merge parents

**Test suite**: 687 tests across 49 files, all passing

### Key Design References

- MR dependency chains design: `docs/plans/2026-02-21-mr-dependency-chains-design.md`
- Stage 5.5A design: `docs/plans/stage-5.5a-schema-sync-design.md`
- Stage 5.5A implementation plan: `docs/plans/stage-5.5a-schema-sync/IMPLEMENTATION_PLAN.md`

---

## What Stage 5.5B Delivers

### Goal

Update `phase-build` to create worktrees based on parent MR branches. Update `phase-finalize` to create draft MRs with dependency documentation and correct branch targeting. Add code host adapter methods for MR editing.

### What Ships

1. **Code host adapter additions**:
   - `editPrBase(prNumber, newBase)` — retarget MR to different base branch
   - `markPrReady(prNumber)` — promote draft MR to ready
   - `getBranchHead(branch)` — get commit SHA of branch head
   - Implementations for both GitHub and GitLab adapters

2. **`phase-build` skill update**:
   - Read `pending_merge_parents` from stage frontmatter
   - For each parent: `git fetch origin && git merge origin/<parent_branch> --no-edit`
   - Resolve conflicts if any (build session has full codebase context)
   - Run verification after parent branch merges, before proceeding with Build work

3. **`phase-finalize` skill update**:
   - MR target branch logic:
     - Zero unmerged parents → default branch (main)
     - Exactly one unmerged parent → that parent's MR branch
     - Multiple unmerged parents → default branch (main)
   - Draft status: create as draft if `pending_merge_parents` non-empty
   - MR description includes Dependencies section listing unmerged parents
   - Set `is_draft` and `mr_target_branch` in frontmatter

4. **Tests for all new behavior**

### What Stage 5.5B Does NOT Include

- ❌ MR cron parent tracking or rebase logic (Stage 6D)
- ❌ Orchestrator infrastructure (Stage 6A)
- ❌ `rebase-child-mr` skill (Stage 6D)
- ❌ Jira link manifest extraction (Stage 5.5C)
- ❌ Any changes to the sync engine or schema (Stage 5.5A already handled these)

---

## Open Questions (Resolve During Design Phase)

1. Should `phase-build` automatically run `git fetch` before attempting parent branch merges, or assume the orchestrator already fetched?
2. How should the build session communicate merge conflict details back if it can't resolve them?
3. Should verification after parent merge be the full project verify or a lighter check?

---

## Key Files

### Code Host Adapters

- `tools/kanban-cli/src/adapters/github-adapter.ts`
- `tools/kanban-cli/src/adapters/gitlab-adapter.ts`
- `tools/kanban-cli/src/adapters/types.ts` (CodeHostAdapter interface)

### Phase Skills

The phase skills are NOT in the kanban-cli tool — they are Claude Code skills. Check the skills directory for:
- `phase-build` skill
- `phase-finalize` skill

### Stage Data Access

- `tools/kanban-cli/src/db/repositories/stage-repository.ts` — has `updatePendingMergeParents()`, `upsert()` with `is_draft`, `mr_target_branch`
- `tools/kanban-cli/src/types/work-items.ts` — `PendingMergeParent` type, `Stage` interface

---

## Next Steps After Stage 5.5B

- **Stage 5.5C** (independent of 5.5B): Jira link manifest extraction in `jira-import`, enriched content fetching in `convert-ticket`
- **Stage 6A**: Orchestrator infrastructure — session spawning, worktree management with `pending_merge_parents` awareness
