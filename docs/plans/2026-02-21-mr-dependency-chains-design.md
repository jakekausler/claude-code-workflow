# MR Dependency Chains & Jira Enrichment — Design Document

**Date**: 2026-02-21
**Status**: Approved
**Approach**: Extend Existing Infrastructure (Approach A)

## Table of Contents

1. [Overview](#1-overview)
2. [Graduated Dependency Resolution](#2-graduated-dependency-resolution)
3. [Branch Chain Management](#3-branch-chain-management)
4. [Enhanced MR Cron](#4-enhanced-mr-cron)
5. [Jira Ticket Conversion Enrichment](#5-jira-ticket-conversion-enrichment)
6. [New Delivery Stages](#6-new-delivery-stages)
7. [Impact on Future Stages](#7-impact-on-future-stages)
8. [New Skill: rebase-child-mr](#8-new-skill-rebase-child-mr)
9. [Open Questions](#9-open-questions)

---

## 1. Overview

Four changes to the kanban workflow system, all related to MR/PR handling and dependency management:

1. **Graduated dependency resolution** — Dependencies soft-resolve when a parent enters PR Created, unblocking child stages early with branch lineage tracking.
2. **Branch chain management** — Child stages base their worktree on parent MR branches. Child MRs are created as drafts with dependency documentation.
3. **Enhanced MR cron** — The cron tracks parent→child relationships, rebases on parent updates, retargets MRs, and promotes drafts.
4. **Jira conversion enrichment** — `convert-ticket` fetches linked Confluence pages, Jira issues, attachments, and external URLs for richer brainstorming context.

All changes fit into the existing architecture (Approach A — extend existing infrastructure). No new pipeline states. Three new delivery stages (5.5A, 5.5B, 5.5C) are added before Stage 6A to implement changes to already-completed stages.

---

## 2. Graduated Dependency Resolution

### Current Behavior

A dependency is resolved only when the target reaches `Complete` (merged). Unresolved dependencies keep stages in `Backlog`.

### New Behavior

Dependencies have two resolution levels:

| Resolution Level | Condition | Effect on Dependent Stages |
|---|---|---|
| **Soft-resolved** | Target stage status = `PR Created` or later (`Addressing Comments`) | Dependent stages move to `Ready for Work` with `pending_merge_parents` frontmatter field populated |
| **Hard-resolved** | Target stage status = `Complete` | Dependent stages' `pending_merge_parents` entry for this parent is removed. Normal fully-resolved dependency. |

### Scope

Soft-resolution applies **only to stage-level dependencies**:

- Stage → Stage: Soft-resolves at PR Created ✅
- Stage → Ticket: Hard-resolves only (all ticket stages must be Complete) ❌
- Stage → Epic: Hard-resolves only (all epic stages must be Complete) ❌
- Ticket → Ticket: Hard-resolves only ❌
- Epic → Epic: Hard-resolves only ❌

**Rationale**: A dependency on a ticket or epic means "I need all of that work merged." Soft-resolving a whole ticket when some stages are in PR would be premature — the user explicitly chose a coarser dependency for a reason.

### New Frontmatter Fields

Added to stage files when unblocked by soft-resolved parents:

```yaml
# Stage frontmatter additions
pending_merge_parents:
  - stage_id: STAGE-001-001-001
    branch: epic-001/ticket-001-001/stage-001-001-001
    pr_url: https://github.com/org/repo/pull/42
    pr_number: 42
```

This field is:
- **Set** by the sync engine when a parent stage enters PR Created and the child has all other deps resolved
- **Updated** (entries removed) when parent stages reach Complete
- **Read** by phase-build (worktree creation) and phase-finalize (MR targeting and draft status)

### SQLite Schema Additions

```sql
-- New columns on stages table
ALTER TABLE stages ADD COLUMN is_draft BOOLEAN DEFAULT 0;
ALTER TABLE stages ADD COLUMN pending_merge_parents TEXT;  -- JSON array
```

### Sync Engine Changes

In `sync.ts`, dependency resolution logic expands:

```
Current:
  stage resolved = status === 'Complete'

New:
  stage hard-resolved = status === 'Complete'
  stage soft-resolved = status in ('PR Created', 'Addressing Comments')
  stage resolved (for column assignment) = hard-resolved OR soft-resolved
```

When computing kanban columns:
- A stage with all deps hard-or-soft-resolved moves to `ready_for_work` (not `backlog`)
- The `pending_merge_parents` field is populated for stages whose parents are soft-resolved but not hard-resolved

### Backlog Re-evaluation Trigger Change

Currently, backlog re-evaluation happens only when a stage reaches Done (completion cascade). With graduated resolution, it must also trigger when a stage enters PR Created:

- Stage → Done: triggers completion cascade (existing) + backlog re-evaluation (existing)
- Stage → PR Created: triggers backlog re-evaluation for soft-resolution (new)

This is relevant for Stage 6B/6C orchestrator logic but the sync engine groundwork is laid here.

---

## 3. Branch Chain Management

### Worktree Creation (Build Phase)

When a child stage with `pending_merge_parents` enters Build and a worktree is created:

1. Create worktree branch from the default branch (main/master)
2. For each parent in `pending_merge_parents`, merge the parent's branch:
   ```
   git fetch origin
   git merge origin/<parent_branch> --no-edit
   ```
3. If any merge fails with conflicts, the Build session resolves them (it has full codebase context)
4. After all parent branches are merged, run verification (`npm run verify` or project equivalent) before proceeding with Build work
5. Record the merge state in the worktree

### MR Creation (Finalize Phase, Remote Mode)

When a child stage with `pending_merge_parents` creates its MR:

**MR target branch logic**:

| Unmerged Parents | MR Target |
|---|---|
| Zero (all parents merged by finalize time) | Default branch (main/master) |
| Exactly one | That parent's MR branch |
| Multiple | Default branch (main/master) |

**Draft status**:
- If `pending_merge_parents` is non-empty at MR creation time → create as **draft MR**
- GitHub: `gh pr create --draft`
- GitLab: `glab mr create --draft` (or `--wip` for older versions)

**MR description** includes a dependency section:

```markdown
## Dependencies

⚠️ **This MR is in draft because it depends on unmerged parent MRs:**

- [ ] STAGE-001-001-001 — Login Form (#42)
- [ ] STAGE-001-001-002 — Auth API (#43)

This MR should not be merged until all parent MRs are merged and this branch is rebased.
```

**New frontmatter fields set by finalize**:

```yaml
is_draft: true  # Set when MR created as draft due to pending parents
mr_target_branch: epic-001/ticket-001-001/stage-001-001-001  # or main
```

### Code Host Adapter Additions

New methods on the code host adapter interface:

```typescript
interface CodeHostAdapter {
  // Existing
  getPrStatus(prUrl: string): Promise<PrStatus>;

  // New
  editPrBase(prNumber: number, newBase: string): Promise<void>;
  markPrReady(prNumber: number): Promise<void>;
  getBranchHead(branch: string): Promise<string>;  // returns commit SHA
}
```

GitHub implementations:
- `editPrBase`: `gh pr edit <number> --base <new-base>`
- `markPrReady`: `gh pr ready <number>`
- `getBranchHead`: `git ls-remote origin <branch>` or `gh api repos/{owner}/{repo}/git/ref/heads/{branch}`

GitLab equivalents:
- `editPrBase`: `glab mr update <number> --target-branch <new-base>`
- `markPrReady`: `glab mr update <number> --ready` (or remove WIP prefix)
- `getBranchHead`: `git ls-remote origin <branch>` or `glab api projects/{id}/repository/branches/{branch}`

---

## 4. Enhanced MR Cron (Stage 6D Scope Expansion)

### Current 6D Responsibilities (from original design)

1. Poll for MR comments on `PR Created` stages
2. Detect merge → transition to Done
3. Detect new actionable comments → transition to Addressing Comments

### New 6D Responsibilities

4. **Track parent→child MR relationships**:
   - On each poll cycle, query SQLite for all stages in `PR Created` or `Addressing Comments` that have non-empty `pending_merge_parents`
   - For each parent in their `pending_merge_parents`, check if the parent's PR is still open, merged, or updated

5. **Detect parent merge events**:
   - When a parent stage's MR is detected as merged:
     a. Update the child's `pending_merge_parents` (remove the merged parent entry)
     b. Evaluate retargeting rules (see matrix below)
     c. Spawn a **rebase session** (Claude session with `rebase-child-mr` skill)
     d. The rebase session: rebases child branch, resolves conflicts if any, runs verification, pushes
     e. If zero unmerged parents remain after rebase: promote draft → ready

6. **Detect parent branch updates** (new commits pushed to parent MR branch):
   - Track the HEAD commit SHA of each parent branch in SQLite
   - On each poll cycle, compare stored HEAD with current remote HEAD via `getBranchHead()`
   - If changed: spawn a rebase session for the child

7. **Retarget child MRs** after rebase:

   | Event | Current Target | New Target | Draft Status |
   |---|---|---|---|
   | Multi-parent → one parent merges, still >1 unmerged | main | main (no change) | Stay draft |
   | Multi-parent → all but one parent merge | main | Remaining parent branch | Stay draft |
   | Single-parent → parent merges | parent branch | main/default | Promote to ready |
   | Zero unmerged parents → all merged | main or parent | main/default | Promote to ready |

8. **Promote draft → ready**:
   - After all parents merged and rebase clean:
     - GitHub: `gh pr ready <number>`
     - GitLab: `glab mr update <number> --ready`
   - Update `is_draft: false` and clear `pending_merge_parents` in frontmatter + SQLite

### SQLite Additions for Parent Tracking

```sql
-- New table for tracking parent branch HEAD commits
CREATE TABLE parent_branch_tracking (
  id INTEGER PRIMARY KEY,
  child_stage_id TEXT NOT NULL REFERENCES stages(id),
  parent_stage_id TEXT NOT NULL,
  parent_branch TEXT NOT NULL,
  parent_pr_url TEXT,
  last_known_head TEXT,  -- commit SHA
  is_merged BOOLEAN DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id),
  last_checked TEXT NOT NULL
);

CREATE INDEX idx_parent_tracking_child ON parent_branch_tracking(child_stage_id);
CREATE INDEX idx_parent_tracking_parent ON parent_branch_tracking(parent_stage_id);
```

### Race Condition Mitigation

The cron and main work loop both operate on stages. To prevent conflicts:

- Cron only acts on stages in `PR Created` (not stages in `Addressing Comments` where the main loop may be spawning a review-cycle session)
- Before spawning a rebase session, cron sets `session_active = true` using the same locking mechanism as the main loop
- If `session_active` is already true (main loop is working on it), cron skips and retries next cycle
- The rebase session sets `session_active = false` on exit (same as any other session)

### Propagation Timing

Parent updates propagate to children **only after the child has reached PR Created**. While a child is in earlier phases (Design, Build, Automatic Testing, etc.), no rebasing occurs — the worktree stays on whatever branch base it was created from. This avoids disrupting active sessions.

---

## 5. Jira Ticket Conversion Enrichment

### Import Phase Changes (jira-import)

The import captures a **link manifest** in the ticket frontmatter — metadata only, no content fetched:

```yaml
# New field in ticket frontmatter
jira_links:
  - type: confluence        # confluence | jira_issue | attachment | external
    url: "https://company.atlassian.net/wiki/spaces/TEAM/pages/12345"
    title: "Login Flow Requirements"
  - type: jira_issue
    url: "https://company.atlassian.net/browse/PROJ-999"
    key: "PROJ-999"
    title: "Related: SSO Integration"
    relationship: "blocks"   # blocks, is-blocked-by, relates-to, etc.
  - type: attachment
    url: "https://company.atlassian.net/secure/attachment/67890/wireframes.pdf"
    filename: "wireframes.pdf"
    mime_type: "application/pdf"
  - type: external
    url: "https://docs.google.com/document/d/abc123"
    title: "Design Spec"
```

### Convert-Ticket Phase Changes

Before brainstorming, the converter performs enrichment:

1. **Re-pull Jira ticket** — Fetch fresh ticket data from Jira via jira reader skill/script (not relying on import-time snapshot). This ensures up-to-date title, description, status, comments.

2. **Fetch all linked content** based on `jira_links` manifest:
   - **Confluence pages**: Use Confluence reader skill (when available). Extracts page content as markdown.
   - **Jira issues**: Use Jira reader skill to fetch linked issue details (title, description, status, comments).
   - **Attachments**: Download and read using appropriate tools (PDF reader, image description, document parsing).
   - **External URLs**: Use WebFetch to read content where accessible.

3. **Compile enriched context**: All fetched content is provided to the brainstorming session as context for stage breakdown. Organized by type with clear source attribution.

4. **Graceful degradation**: If a skill/tool isn't available:
   - Log which links couldn't be fetched and why
   - Continue with whatever content was successfully retrieved
   - Note unavailable links in the ticket file for manual review
   - The converter works with whatever tools are present on the system

### Confluence Reader Skill

Not currently installed on this machine. The design assumes it works similarly to the Jira reader skill — an external script/tool that takes a URL and returns content. Integration specifics will be resolved when the skill is available. The `convert-ticket` skill will check for its availability at runtime.

### Ticket Frontmatter Schema Addition

```yaml
# Added to ticket frontmatter schema
jira_links:
  - type: string       # confluence | jira_issue | attachment | external
    url: string         # URL to the linked content
    title: string       # Human-readable title
    key: string         # Optional: Jira issue key (for jira_issue type)
    relationship: string # Optional: Link relationship (blocks, relates-to, etc.)
    filename: string    # Optional: Filename (for attachment type)
    mime_type: string   # Optional: MIME type (for attachment type)
```

---

## 6. New Delivery Stages

Since Stages 1–5 are complete and shipped, changes to their artifacts require new delivery stages. Three new stages are inserted before Stage 6A:

### Stage 5.5A: Schema & Sync — MR Dependency Resolution

**Goal**: The sync engine supports graduated (soft/hard) dependency resolution. New frontmatter fields and SQLite schema are in place. The kanban board correctly shows stages unblocked by parent PR creation.

**What ships**:
1. New stage frontmatter fields: `pending_merge_parents`, `is_draft`, `mr_target_branch`
2. New ticket frontmatter field: `jira_links`
3. SQLite schema additions: `is_draft`, `pending_merge_parents` columns on stages table
4. SQLite `parent_branch_tracking` table
5. Sync engine dual-resolution logic (soft at PR Created, hard at Complete)
6. `pending_merge_parents` population during sync (reads parent stage PR data)
7. Kanban column assignment update (soft-resolved deps → ready_for_work)
8. `kanban-cli validate` updates (validate `pending_merge_parents` references)
9. Zod schema updates for new frontmatter fields
10. Tests for all new behavior

**Depends on**: Stages 0–5 (all complete).

### Stage 5.5B: Skill Updates — Branch Chain & Draft MR

**Goal**: `phase-build` creates worktrees based on parent MR branches. `phase-finalize` creates draft MRs with dependency documentation and correct branch targeting. Code host adapters support MR editing.

**What ships**:
1. Code host adapter additions: `editPrBase()`, `markPrReady()`, `getBranchHead()` for GitHub and GitLab
2. `phase-build` skill update: merge parent branches into worktree at creation, run verification after merge
3. `phase-finalize` skill update: draft MR creation, dependency documentation in MR body, MR target branch logic (single parent → parent branch, else → main)
4. New `is_draft`, `mr_target_branch` frontmatter writes in finalize
5. Tests for code host adapter additions

**Depends on**: Stage 5.5A (schema and sync must be in place).

### Stage 5.5C: Jira Conversion Enrichment

**Goal**: `jira-import` captures link manifests. `convert-ticket` fetches and reads all linked content for enriched brainstorming.

**What ships**:
1. `jira-import` command update: extract and store `jira_links` manifest from Jira ticket data
2. `convert-ticket` skill update: re-pull Jira ticket at conversion time, fetch all linked content based on manifest
3. Graceful degradation for unavailable skills (Confluence reader, etc.)
4. Tests for import manifest extraction

**Depends on**: Stage 5.5A (ticket frontmatter schema with `jira_links` field). Independent of Stage 5.5B.

### Updated Delivery Stage Dependency Graph

```
Stage 0 (Pipeline Configuration) ✅
  └── Stage 1 (Foundation + SQLite + CLI) ✅
        ├── Stage 2 (Migration + Conversion) ✅
        │     └── Stage 4 (Jira + Bidirectional Sync) ✅
        ├── Stage 3 (Remote Mode + MR/PR) ✅
        ├── Stage 5 (Auto-Design + Auto-Analysis) ✅
        │
        └── Stage 5.5A (Schema & Sync — MR Dependency Resolution)
              ├── Stage 5.5B (Skill Updates — Branch Chain & Draft MR)
              │     └── Stage 6A (Orchestrator Infrastructure & Sessions)
              │           ├── Stage 6B (Exit Gates & Resolvers)
              │           │     └── Stage 6C (Completion Cascade & Backlog)
              │           │           └── Stage 6D (MR Comment Cron — expanded scope) ── also depends on 6B
              │           └── Stage 6E (Insights Cron) ── depends on 6A + 6D cron infra
              ├── Stage 5.5C (Jira Conversion Enrichment) ── independent of 5.5B
              │
              ├── Stage 7 (Slack) ── depends on Stage 3
              └── Stage 8 (Global CLI + Multi-Repo) ── depends on Stage 1
                    └── Stage 9 (Web UI)
                          └── Stage 10 (Session Monitor Integration)
```

**Stage 5.5A** must complete before 5.5B and 5.5C (both depend on schema).
**Stage 5.5B** must complete before 6A (orchestrator needs branch chain awareness for worktree creation).
**Stage 5.5C** is independent of 5.5B and can run in parallel.
**Stage 6A** now depends on 5.5B (not just Stage 3).
**Stage 6D** scope is expanded to include parent→child MR tracking, rebase spawning, retargeting, and draft promotion.

---

## 7. Impact on Future Stages

### Stage 6A (Orchestrator Infrastructure)

- Worktree creation must read `pending_merge_parents` and merge parent branches before handing off to Build session
- No other changes — session spawning, locking, crash recovery, shutdown are unaffected

### Stage 6B (Exit Gates & Resolvers)

- Exit gate after a session that transitions a stage to PR Created must trigger backlog re-evaluation for soft-resolution (not just Done)
- This is a minor addition to the completion cascade trigger logic

### Stage 6C (Completion Cascade & Backlog)

- Backlog re-evaluation must handle both triggers:
  - Stage → Done: existing behavior (hard-resolve deps, cascade completion up ticket/epic)
  - Stage → PR Created: new behavior (soft-resolve stage-level deps, populate `pending_merge_parents` on children, move children from Backlog → Ready for Work)
- Hard-resolution (Done) also clears `pending_merge_parents` entries on children

### Stage 6D (MR Comment Cron — Expanded Scope)

This is the most impacted future stage. In addition to original responsibilities, 6D now handles:

- Parent→child MR relationship tracking via `parent_branch_tracking` table
- Parent branch HEAD monitoring (detect pushes)
- Rebase session spawning via `rebase-child-mr` skill
- MR retargeting via code host adapter `editPrBase()`
- Draft → ready promotion via code host adapter `markPrReady()`
- `pending_merge_parents` frontmatter updates after parent merge/rebase

### Stage 6E (Insights Cron)

No impact.

---

## 8. New Skill: rebase-child-mr

A skill that handles rebasing a child MR branch when parent changes are detected.

**Trigger**: Spawned by the MR cron (Stage 6D) when:
- A parent MR branch has new commits (parent was updated)
- A parent MR was merged (need to rebase onto merged target)

**Session context** (provided by the cron when spawning):
- Child stage file (full frontmatter + content)
- All parent stage files (for context on what each parent implements)
- Parent and child ticket info
- The specific trigger (parent push vs parent merge)
- Current `pending_merge_parents` state

**Workflow**:
1. Check out the child's worktree branch
2. Fetch latest from remote
3. Determine rebase target:
   - If parent merged → rebase onto the branch the parent was merged into (usually main)
   - If parent updated → rebase onto (or merge) the updated parent branch
4. Perform rebase/merge
5. If conflicts arise → resolve using codebase context and understanding of both parent and child changes
6. Run verification (`npm run verify` or project equivalent)
7. If verification fails → attempt to fix; if fix fails, flag for human intervention
8. Force-push the rebased branch: `git push --force-with-lease origin <child_branch>`
9. Update child stage frontmatter:
   - Update `pending_merge_parents` (remove merged parents)
   - Update `mr_target_branch` if retargeting needed

**Exit conditions**:
- Success: branch rebased, verification passed, pushed
- Failure: conflicts unresolvable or verification failing after fix attempts → flag stage with `rebase_conflict: true` in frontmatter for human review

---

## 9. Open Questions

### Resolve at Stage 5.5A Start

- How should `pending_merge_parents` interact with `kanban-cli validate`? Should it warn if a parent reference points to a stage that's no longer in PR Created?
- Should `pending_merge_parents` be auto-populated by the sync engine, or explicitly set by the orchestrator's backlog re-evaluation? (Design assumes sync engine populates it.)
- Content hash vs mtime for detecting frontmatter staleness with the new fields?

### Resolve at Stage 5.5B Start

- Should `phase-build` automatically run `git fetch` before attempting parent branch merges, or assume the orchestrator already fetched?
- How should the build session communicate merge conflict details back if it can't resolve them?
- Should verification after parent merge be the full project verify or a lighter check?

### Resolve at Stage 5.5C Start

- Exact Confluence reader skill API contract (URL in → content out). Can be stubbed until the skill is available.
- Should the converter store fetched content as separate files alongside the ticket, or inline it all into the brainstorming context?
- Rate limiting for fetching many linked items from a single Jira ticket.

### Resolve at Stage 6D Start

- How to detect "parent branch has new commits" efficiently? `git ls-remote` per branch per cycle could be expensive with many MRs. Consider batching.
- Should the cron immediately spawn a rebase session, or queue the rebase and let the main loop pick it up? (Design assumes cron spawns directly.)
- How deep can parent chains go? (A depends on B depends on C, all in PR.) Rebase must cascade: when C merges, B rebases, then A rebases off rebased B. The cron needs to handle this sequentially.
- What if a rebase session fails and the branch is in a broken state? The `rebase_conflict` flag + session_active reset should prevent the cron from re-triggering until resolved, but the exact recovery flow needs definition.
