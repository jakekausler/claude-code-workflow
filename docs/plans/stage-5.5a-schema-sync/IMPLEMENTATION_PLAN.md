# Stage 5.5A: Schema & Sync — Implementation Plan

**Design Doc**: `docs/plans/stage-5.5a-schema-sync-design.md`
**Branch**: `kanban`

## Task Dependency Graph

```
Task 1 (Types + Zod)
  ├── Task 2 (SQLite Schema) ── depends on Task 1
  │     └── Task 3 (Sync Engine) ── depends on Tasks 1 + 2
  │           ├── Task 4 (Validate) ── depends on Tasks 1 + 3
  │           ├── Task 5 (Board Output) ── depends on Tasks 1 + 3
  │           └── Task 6 (Integration Tests) ── depends on Tasks 3 + 4 + 5
  └── (Task 1 has no deps)
```

---

## Task 1: Type Definitions & Zod Schemas

**Goal**: Add new TypeScript interfaces and Zod schemas for all new frontmatter fields. Ensure existing files without new fields parse correctly via defaults.

**Status**: Not Started

**Files to modify**:
- `tools/kanban-cli/src/types/work-items.ts` — Add `PendingMergeParent`, `JiraLink` interfaces; extend `Stage` and `Ticket`
- `tools/kanban-cli/src/config/schema.ts` (or wherever Zod frontmatter schemas live) — Add Zod schemas with defaults
- `tools/kanban-cli/src/sync/sync.ts` — Update frontmatter parsing to include new fields (ensure they're read from YAML)

**Changes**:

1. Add `PendingMergeParent` interface:
   ```typescript
   interface PendingMergeParent {
     stage_id: string;
     branch: string;
     pr_url: string;
     pr_number: number;
   }
   ```

2. Add `JiraLink` interface:
   ```typescript
   interface JiraLink {
     type: 'confluence' | 'jira_issue' | 'attachment' | 'external';
     url: string;
     title: string;
     key?: string;
     relationship?: string;
     filename?: string;
     mime_type?: string;
   }
   ```

3. Extend `Stage` interface: `pending_merge_parents: PendingMergeParent[]`, `is_draft: boolean`, `mr_target_branch: string | null`

4. Extend `Ticket` interface: `jira_links: JiraLink[]`

5. Add Zod schemas with `.default([])` / `.default(false)` / `.default(null)` so existing files parse correctly

6. Update sync.ts frontmatter parsing to read new fields with defaults

**Tests**:
- Zod schema parses stage without new fields → defaults applied
- Zod schema parses stage with all new fields → correct types
- Zod schema rejects invalid `pending_merge_parents` entries (missing required fields)
- Zod schema parses ticket without `jira_links` → defaults to `[]`
- Zod schema parses ticket with valid `jira_links` → correct types
- Zod schema rejects invalid `jira_links` entries (missing type/url/title, invalid type value)

**Success Criteria**: `npm run verify` passes. Existing test suite (596 tests) unchanged.

---

## Task 2: SQLite Schema Additions

**Goal**: Add new columns to stages table and create `parent_branch_tracking` table with indexes.

**Status**: Not Started
**Depends on**: Task 1 (types must exist for repository methods)

**Files to modify**:
- `tools/kanban-cli/src/db/schema.ts` — Add columns and table
- `tools/kanban-cli/src/db/repositories/stage-repository.ts` — Update `StageUpsertData` to include new fields, update upsert/find queries

**Changes**:

1. In `schema.ts` `initializeDatabase()`:
   - Add `ALTER TABLE stages ADD COLUMN is_draft BOOLEAN DEFAULT 0` (try/catch for idempotency)
   - Add `ALTER TABLE stages ADD COLUMN pending_merge_parents TEXT` (try/catch)
   - Add `ALTER TABLE stages ADD COLUMN mr_target_branch TEXT` (try/catch)
   - Add `CREATE TABLE IF NOT EXISTS parent_branch_tracking (...)` with all columns and indexes

2. In `stage-repository.ts`:
   - Add `is_draft`, `pending_merge_parents`, `mr_target_branch` to `StageUpsertData`
   - Update `upsert()` INSERT/REPLACE to include new columns
   - Update `findById()` and list methods to return new columns
   - `pending_merge_parents` stored as JSON string in SQLite, parsed to/from `PendingMergeParent[]`
   - Add `updatePendingMergeParents(stageId, parents: PendingMergeParent[])` method for targeted updates

**Tests**:
- Schema migration runs successfully on fresh database
- Schema migration is idempotent (runs twice without error)
- Stage upsert with new fields persists correctly
- Stage upsert without new fields uses defaults (is_draft=false, pending_merge_parents=null, mr_target_branch=null)
- `findById` returns new fields
- `updatePendingMergeParents` updates correctly
- `parent_branch_tracking` table exists with correct columns

**Success Criteria**: `npm run verify` passes. All existing tests pass.

---

## Task 3: Sync Engine — Dual Resolution Logic

**Goal**: Implement soft-resolution for stage→stage dependencies. Populate `pending_merge_parents` in both SQLite and frontmatter when stages are soft-unblocked.

**Status**: Not Started
**Depends on**: Tasks 1 + 2

**Files to modify**:
- `tools/kanban-cli/src/sync/sync.ts` — Core resolution logic changes
- `tools/kanban-cli/src/db/repositories/dependency-repository.ts` — May need minor additions

**Changes**:

1. Add `isStageSoftResolved(stageId, stageStatusMap)` function:
   - Returns true if stage status is in `['PR Created', 'Addressing Comments']`
   - Only applies to stage→stage dependencies

2. Add `isDependencySoftOrHardResolved(depType, targetId, maps)` function:
   - For stage→stage: returns `isDependencyResolved() || isStageSoftResolved()`
   - For all other dep types: returns `isDependencyResolved()` (hard-only, unchanged)

3. Update kanban column computation in sync:
   - Replace `hasUnresolvedDeps = !depRepo.allResolved(stageId)` with a new check that uses `isDependencySoftOrHardResolved()` against all of the stage's dependencies
   - Build a local map of `stageId → allSoftOrHardResolved` boolean

4. Add `pending_merge_parents` population logic:
   - After determining a stage is soft-unblocked (all deps soft-or-hard-resolved):
     - Identify which parent dependencies are soft-resolved only (not hard)
     - For each, read parent's `worktree_branch`, `pr_url`, `pr_number` from parsed data
     - Build `PendingMergeParent[]` array
     - Write to SQLite via `stageRepo.updatePendingMergeParents()`
     - Write to child stage's YAML frontmatter file using gray-matter

5. Add cleanup logic for hard-resolution:
   - When a parent stage reaches Complete, remove its entry from child's `pending_merge_parents`
   - If `pending_merge_parents` becomes empty, clear `is_draft` flag
   - Update both SQLite and frontmatter

**Tests**:
- Stage with all hard-resolved deps → `ready_for_work` column (existing behavior preserved)
- Stage with soft-resolved parent (PR Created) → `ready_for_work` column (new behavior)
- Stage with soft-resolved parent (Addressing Comments) → `ready_for_work` column
- Stage with unresolved parent (Build status) → `backlog` column
- Stage→ticket dependency → hard-resolve only (Complete required)
- Stage→epic dependency → hard-resolve only (Complete required)
- `pending_merge_parents` populated when stage soft-unblocked
- `pending_merge_parents` includes correct parent `worktree_branch`, `pr_url`, `pr_number`
- `pending_merge_parents` entry removed when parent reaches Complete
- `is_draft` cleared when all `pending_merge_parents` entries removed
- Frontmatter file updated with `pending_merge_parents`
- Mixed deps: some hard-resolved, some soft-resolved → `ready_for_work` with pending parents for soft ones
- Stage with no dependencies → no `pending_merge_parents` (unchanged behavior)
- Backward compatibility: existing stages without new fields sync correctly

**Success Criteria**: `npm run verify` passes. All existing tests pass. New sync tests pass.

---

## Task 4: Validate Command Updates

**Goal**: Add validation rules for `pending_merge_parents` and `jira_links` fields.

**Status**: Not Started
**Depends on**: Tasks 1 + 3

**Files to modify**:
- `tools/kanban-cli/src/cli/logic/validate.ts` — Add new validation rules

**Changes**:

1. Stage validation — `pending_merge_parents`:
   - Each entry's `stage_id` must exist in the known stage IDs set → **error** if not
   - Each entry's parent stage status should be in (PR Created, Addressing Comments, Complete) → **warning** if not
   - `is_draft: true` with empty `pending_merge_parents` → **warning** (inconsistent)

2. Ticket validation — `jira_links`:
   - Each entry must have `type`, `url`, `title` → **error** if missing
   - `type` must be one of: `confluence`, `jira_issue`, `attachment`, `external` → **error** if invalid

**Tests**:
- `pending_merge_parents` with valid stage_id references → no error
- `pending_merge_parents` with non-existent stage_id → error
- `pending_merge_parents` parent in PR Created → no warning
- `pending_merge_parents` parent in Build → warning (stale)
- `is_draft: true` with empty `pending_merge_parents` → warning
- `is_draft: false` with non-empty `pending_merge_parents` → no warning
- `jira_links` with all required fields → no error
- `jira_links` missing `type` → error
- `jira_links` with invalid `type` value → error
- `jira_links` empty array → no error
- No `jira_links` field → no error (defaults to empty)

**Success Criteria**: `npm run verify` passes.

---

## Task 5: Board Output Changes

**Goal**: Include `pending_merge_parents` info in board JSON output. Add HTML indicator for pending merge parents.

**Status**: Not Started
**Depends on**: Tasks 1 + 3

**Files to modify**:
- `tools/kanban-cli/src/cli/logic/board.ts` — Add `pending_merge_parents` to stage board items
- `tools/kanban-cli/src/cli/commands/board.ts` — Update HTML rendering

**Changes**:

1. In board logic, when building stage board items:
   - If stage has non-empty `pending_merge_parents`, include it in the output object
   - Only include when present (don't add empty array to all stages)

2. In HTML board rendering:
   - Stages with `pending_merge_parents` show `⚠️` indicator after the title

**Tests**:
- Board JSON includes `pending_merge_parents` for stages that have them
- Board JSON does NOT include `pending_merge_parents` for stages without them
- HTML board shows ⚠️ for stages with pending merge parents
- Board output without any pending merge parents → unchanged from current

**Success Criteria**: `npm run verify` passes.

---

## Task 6: Integration Testing

**Goal**: End-to-end tests with realistic repo scenarios. Verify backward compatibility with existing repos.

**Status**: Not Started
**Depends on**: Tasks 3 + 4 + 5

**Files to create**:
- `tools/kanban-cli/tests/integration/soft-resolution.test.ts` (or similar)

**Changes**:

1. Integration test: Create a test repo with dependent stages where parent is in PR Created
   - Sync → verify child moves to `ready_for_work`
   - Verify `pending_merge_parents` in SQLite
   - Verify `pending_merge_parents` in frontmatter file
   - Verify board output includes pending parents

2. Integration test: Parent transitions to Complete
   - Sync again → verify child's `pending_merge_parents` entry removed
   - Verify frontmatter updated

3. Integration test: Mixed resolution
   - Stage depends on two parents: one Complete, one PR Created
   - Sync → child should be in `ready_for_work` with one pending parent

4. Integration test: Backward compatibility
   - Sync existing repo (no new fields) → all behavior identical
   - Validate existing repo → no new errors or warnings

5. Integration test: Validate with pending_merge_parents
   - Valid references → pass
   - Invalid references → errors reported

**Success Criteria**: All integration tests pass. `npm run verify` passes. Full test suite passes.

---

## Execution Order

1. **Task 1** → verify passes
2. **Task 2** → verify passes
3. **Task 3** → verify passes
4. **Tasks 4 + 5** (parallel, both depend on 3) → verify passes
5. **Task 6** → verify passes
6. Final verification: `npm run verify` with all changes
