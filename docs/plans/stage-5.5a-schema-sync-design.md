# Stage 5.5A: Schema & Sync — MR Dependency Resolution — Design

**Date**: 2026-02-22
**Status**: Approved
**Primary Reference**: `docs/plans/2026-02-21-mr-dependency-chains-design.md`

## Overview

Stage 5.5A adds graduated dependency resolution to the kanban-cli sync engine. When a parent stage enters `PR Created`, its dependent child stages can be soft-unblocked — moved from Backlog to Ready for Work — with metadata tracking which parent MR branches they depend on.

This is the foundation for branch chain management (5.5B) and the enhanced MR cron (6D).

## Design Decisions

### Open Question Resolutions

| Question | Resolution | Rationale |
|----------|-----------|-----------|
| Sync writes to frontmatter? | **Yes, both SQLite + frontmatter** | Frontmatter is updated throughout stage lifecycle. No reason to keep sync read-only on files. Data immediately consistent. |
| Stale `pending_merge_parents` in validate? | **Warning** (not error) | Non-blocking. User may be mid-intervention. Orchestrator can auto-clean later. |
| `parent_branch_tracking` population? | **Schema-only in 5.5A** | Table created but not populated. Stage 6D's cron fills it. Keeps 5.5A focused. |
| Content hash vs mtime? | **Keep mtime** | Sync writes update mtime naturally. Content hashing adds complexity for minimal benefit. Defer if ever needed. |

### Dependency Resolution Approach: Computed at Sync Time

The `dependencies.resolved` flag stays boolean — `1` means hard-resolved (Complete) only. Soft-resolution is **not stored** in the dependency table. Instead, during sync:

1. Build `stageStatusMap` as today
2. For column assignment, check if all deps are "at least soft-resolved" by inspecting target status from the map
3. `computeKanbanColumn` input `hasUnresolvedDeps` reflects this new "soft-or-hard" check

**Why this approach**: Minimal schema change, fully backward compatible, resolution logic stays in sync.ts where it naturally belongs.

## Architecture

### Type Definitions

**New types** (`work-items.ts`):

```typescript
interface PendingMergeParent {
  stage_id: string;
  branch: string;
  pr_url: string;
  pr_number: number;
}

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

**Stage additions**: `pending_merge_parents: PendingMergeParent[]`, `is_draft: boolean`, `mr_target_branch: string | null`

**Ticket additions**: `jira_links: JiraLink[]`

All new fields have sensible defaults (empty arrays, false, null) so existing files remain valid.

### SQLite Schema

**New columns on stages table**:
```sql
ALTER TABLE stages ADD COLUMN is_draft BOOLEAN DEFAULT 0;
ALTER TABLE stages ADD COLUMN pending_merge_parents TEXT;  -- JSON array
ALTER TABLE stages ADD COLUMN mr_target_branch TEXT;
```

**New table** (schema only, not populated until Stage 6D):
```sql
CREATE TABLE IF NOT EXISTS parent_branch_tracking (
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
CREATE INDEX IF NOT EXISTS idx_parent_tracking_child ON parent_branch_tracking(child_stage_id);
CREATE INDEX IF NOT EXISTS idx_parent_tracking_parent ON parent_branch_tracking(parent_stage_id);
```

**Migration**: `ALTER TABLE ADD COLUMN` wrapped in try/catch for idempotency. `CREATE TABLE IF NOT EXISTS` for the new table.

### Sync Engine: Dual Resolution

**Resolution model**:

| Dependency Type | Hard-Resolved | Soft-Resolved | Used for Column Assignment |
|----------------|---------------|---------------|---------------------------|
| Stage → Stage | status = Complete | status in (PR Created, Addressing Comments) | soft OR hard |
| Stage → Ticket | all stages Complete | N/A | hard only |
| Stage → Epic | all stages Complete | N/A | hard only |
| Ticket → Ticket | all stages Complete | N/A | hard only |
| Epic → Epic | all stages Complete | N/A | hard only |

**Sync flow changes**:

1. `isDependencyResolved()` unchanged — still returns true only for hard-resolution (Complete)
2. New `isDependencySoftOrHardResolved()` — returns true for hard OR soft resolution (stage deps only)
3. Column assignment uses `isDependencySoftOrHardResolved()` for the `hasUnresolvedDeps` check
4. The `resolved` flag on dependency records is still set only for hard-resolution

**`pending_merge_parents` population**:

During sync, when a stage has all dependencies soft-or-hard-resolved:
1. Identify which parent stage dependencies are soft-resolved (not hard-resolved)
2. For each, read parent's `worktree_branch`, `pr_url`, `pr_number`
3. Build `pending_merge_parents` array
4. Write to SQLite `stages.pending_merge_parents` (JSON string)
5. Write to child stage's YAML frontmatter file

When a parent reaches Complete on subsequent sync:
1. Remove that parent from child's `pending_merge_parents`
2. Update both SQLite and frontmatter
3. If `pending_merge_parents` now empty, clear `is_draft` flag

### Kanban Column Calculator

**No changes to `computeKanbanColumn()`**. The semantic shift happens in the caller — sync.ts passes `hasUnresolvedDeps: false` when all deps are at least soft-resolved. The column calculator doesn't need to know about resolution levels.

### Validate Command

New rules:

| Rule | Severity | Condition |
|------|----------|-----------|
| `pending_merge_parents` stage_id exists | Error | Entry references non-existent stage |
| `pending_merge_parents` parent status | Warning | Parent not in PR Created/Addressing Comments/Complete |
| `is_draft` consistency | Warning | `is_draft: true` with empty `pending_merge_parents` |
| `jira_links` required fields | Error | Missing `type`, `url`, or `title` |
| `jira_links` type value | Error | `type` not in allowed set |

### Board Output

**JSON**: Stages with non-empty `pending_merge_parents` include the array in output.

**HTML**: Stages with pending merge parents show a `⚠️` indicator.

## Scope Boundaries

### In Scope (5.5A)
- Type definitions and Zod schemas for new fields
- SQLite schema additions (columns + table)
- Sync engine dual-resolution logic
- `pending_merge_parents` population (SQLite + frontmatter)
- Kanban column assignment update
- Validate command updates
- Board output changes
- Comprehensive tests

### Out of Scope
- Branch chain management in phase-build/phase-finalize (5.5B)
- Code host adapter additions (5.5B)
- Draft MR creation logic (5.5B)
- Jira link manifest extraction during import (5.5C)
- MR cron parent tracking or rebase logic (6D)
- Orchestrator infrastructure (6A)
- Changes to phase skills

## Downstream Impact

- **5.5B**: Reads `pending_merge_parents` in phase-build (worktree creation) and phase-finalize (MR targeting/draft)
- **5.5C**: Uses `jira_links` schema on tickets
- **6A**: Worktree creation reads `pending_merge_parents`
- **6C**: Backlog re-evaluation uses soft-resolution triggers
- **6D**: Populates `parent_branch_tracking` table, monitors parent branches
