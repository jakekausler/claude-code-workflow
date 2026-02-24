---
name: rebase-child-mr
description: Spawned by the MR comment cron when a parent MR is merged or updated — rebases the child branch, resolves conflicts, runs verification, and force-pushes
---

# Rebase Child MR

## Purpose

Rebase a child MR branch when a parent branch changes. This skill runs as a Claude Code session in a worktree, spawned by the MR comment cron (Stage 6D) when it detects that a parent MR has been merged or a parent branch has new commits. It rebases the child branch onto the appropriate target, resolves any conflicts using full codebase context, verifies the result, and force-pushes the updated branch.

## Entry Conditions

This skill is spawned by the MR cron system. It is never invoked manually or by phase routing.

| Trigger | Source | Description |
|---------|--------|-------------|
| `parent_merged` | MR cron chain manager | A parent MR was merged into its target branch (usually main) |
| `parent_updated` | MR cron chain manager | A parent branch has new commits (detected via HEAD SHA change) |

**Pre-spawn guards** (checked by the cron before spawning):
- `session_active` must be `false` for the child stage (cron sets it to `true` before spawning)
- `rebase_conflict` must not be `true` in the child stage frontmatter (skip if set; human must clear after resolving)

## Session Context Requirements

The cron provides the following context when spawning the session:

| Context | Source | Description |
|---------|--------|-------------|
| Child stage file | Frontmatter + markdown body | The stage being rebased; includes `worktree_branch`, `pending_merge_parents`, `rebase_conflict`, and informational fields (`mr_target_branch`, `is_draft`, `pr_url`, `pr_number`) |
| Parent stage files | Frontmatter + markdown body | All parent stages listed in `pending_merge_parents`; includes design docs and build notes for conflict resolution context |
| Trigger type | Cron parameter | `parent_merged` or `parent_updated` |
| Triggering parent | Cron parameter | The specific parent stage ID and branch that triggered this rebase |
| Repo path | Cron parameter | Absolute path to the repository root |

## Skill Flow

### Step 1: Check Out Child Worktree

Ensure the child's worktree branch is checked out and the working directory is clean.

```bash
# Verify worktree exists
git worktree list | grep <worktree_branch>

# If not, create it
git worktree add ../worktrees/<worktree_branch> <worktree_branch>

# Switch to worktree directory
cd ../worktrees/<worktree_branch>

# Ensure clean state (abort any in-progress rebase/merge)
git rebase --abort 2>/dev/null || true
git merge --abort 2>/dev/null || true
```

### Step 2: Fetch Latest from Remote

```bash
git fetch origin
```

This ensures all remote branches (parent branches, main/default) are up to date locally.

### Step 3: Determine Rebase Target

The target depends on the trigger type:

**If `parent_merged`:**
- The parent MR was merged into its target (usually `main` or `master`)
- Rebase target: the branch the parent was merged into (typically the default branch)
- Read the default branch: `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`
- Rebase onto: `origin/<default_branch>`

**If `parent_updated`:**
- The parent branch has new commits but is still open
- Rebase target: the updated parent branch
- Rebase onto: `origin/<parent_worktree_branch>`

### Step 4: Perform Rebase

```bash
git rebase <rebase_target>
```

**If rebase succeeds cleanly:** Proceed to Step 6 (verification).

**If rebase conflicts:** Proceed to Step 5 (conflict resolution).

### Step 5: Resolve Conflicts

Invoke the `resolve-merge-conflicts` skill. This skill handles:

1. Identifying conflicting files (`git diff --name-only --diff-filter=U`)
2. Auto-resolving trivial conflicts (lock files, generated files, additive config)
3. Context-driven resolution for remaining files using:
   - Parent stage design docs and build notes
   - Child stage design docs and build notes
   - Surrounding codebase context
4. Completing the rebase (`git rebase --continue`)

See `skills/resolve-merge-conflicts/SKILL.md` for the full conflict resolution workflow.

**If `resolve-merge-conflicts` cannot resolve all conflicts** (escalation criteria met — genuinely ambiguous logic conflicts with no contextual signal):
- Abort the rebase: `git rebase --abort`
- Set `rebase_conflict: true` in child stage frontmatter
- Exit with failure (see Exit Conditions below)

**Note:** This skill runs in an automated (unattended) context — `AskUserQuestion` is not available. Unresolvable conflicts must always result in abort and `rebase_conflict: true` rather than user escalation. A human must clear the flag manually after resolving the conflict.

### Step 6: Run Verification

After a clean rebase (or successful conflict resolution), run full project verification:

```bash
npm run verify  # or project equivalent
```

This typically runs build, lint, type-check, and tests.

**If verification passes:** Proceed to Step 7 (push).

**If verification fails:**

1. Analyze failures using full codebase context plus parent and child stage design/build docs
2. Fix issues (type errors, test failures, lint issues from rebase integration)
3. Re-run verification
4. Repeat until passing or until the direction is genuinely ambiguous
5. If unable to fix after exhausting context-driven attempts:
   - Set `rebase_conflict: true` in child stage frontmatter
   - Exit with failure

### Step 7: Force-Push Rebased Branch

```bash
git push --force-with-lease origin <worktree_branch>
```

`--force-with-lease` is used instead of `--force` to prevent overwriting commits pushed by someone else since the last fetch.

**If push fails:**
- If `--force-with-lease` rejects (remote has unexpected commits): fetch again, re-evaluate, and retry once
- If auth fails: exit with failure and log the error

### Step 8: Clear Rebase Conflict Flag

On successful rebase and verification, clear `rebase_conflict` (set to `false` or remove) in the child stage frontmatter — the stage is now clean.

**Note:** The chain manager handles all other frontmatter and tracking updates (removing merged parents from `pending_merge_parents`, retargeting, draft promotion) in the main repo after this session exits. This skill only writes `rebase_conflict`.

## Exit Conditions

### Success

All of the following are true:
- Child branch is rebased onto the correct target
- All conflicts resolved (if any arose)
- Verification passes (build, lint, type-check, tests)
- Branch force-pushed to remote
- `rebase_conflict` cleared in frontmatter

After a successful exit, the cron handles post-rebase actions:
- MR retargeting (via `editPRBase()` on code host adapter)
- Draft-to-ready promotion (via `markPRReady()` if zero unmerged parents remain)
- `is_draft` and `mr_target_branch` frontmatter updates
- `session_active` lock release

### Failure

One or more of the following are true:
- Conflicts could not be resolved (genuinely ambiguous, escalation criteria met)
- Verification fails after fix attempts are exhausted
- Push fails and cannot be recovered

On failure:
- Set `rebase_conflict: true` in child stage frontmatter
- The cron releases `session_active` lock
- The cron skips this stage on subsequent cycles until `rebase_conflict` is cleared by a human
- Human must: resolve the conflict manually, clear `rebase_conflict: true` from frontmatter, and re-trigger (or wait for next cron cycle)

## Frontmatter Fields Read

| Field | Type | Description |
|-------|------|-------------|
| `worktree_branch` | string | Git branch name for the child's worktree |
| `pending_merge_parents` | array | List of parent stages with `stage_id`, `branch`, `pr_url`, `pr_number` |
| `rebase_conflict` | boolean | Whether a previous rebase failed with unresolvable conflicts |

**Informational context** (passed by the cron for session context but not directly used by rebase logic):
- `mr_target_branch` — current MR target branch
- `is_draft` — whether the MR is currently a draft
- `pr_url` — child's PR/MR URL
- `pr_number` — child's PR/MR number

## Frontmatter Fields Written

| Field | Trigger | Value |
|-------|---------|-------|
| `rebase_conflict` | Success | `false` (or removed) |
| `rebase_conflict` | Failure | `true` |

**Fields NOT written by this skill** (handled by the chain manager / cron after session exit):
- `pending_merge_parents` — chain manager removes merged parent entries before spawning the rebase session
- `mr_target_branch` — cron evaluates retargeting matrix and calls `editPRBase()`
- `is_draft` — cron evaluates draft promotion and calls `markPRReady()`

## What This Skill Does NOT Do

- **Does not update `pending_merge_parents`** — the chain manager removes merged parent entries before spawning the rebase session
- **Does not retarget the MR** — that is the cron's responsibility after session exit (via `editPRBase()`)
- **Does not promote draft to ready** — that is the cron's responsibility (via `markPRReady()`)
- **Does not transition stage status** — the stage stays in `PR Created` throughout
- **Does not modify parent stage files** — only `rebase_conflict` in the child stage frontmatter is written
- **Does not handle comment detection or review-cycle** — separate cron job and skill
- **Does not release the `session_active` lock** — the cron handles lock lifecycle

## Relationship to Other Skills and Systems

| Component | Relationship |
|-----------|-------------|
| `resolve-merge-conflicts` | Invoked by this skill when rebase produces conflicts |
| `review-cycle` | Separate skill for MR review comments; not involved in rebasing |
| `phase-build` | Also merges parent branches, but at build time (before MR creation); this skill handles post-MR rebasing |
| `phase-finalize` | Sets initial `pending_merge_parents`, `is_draft`, `mr_target_branch` when creating the MR |
| MR comment cron | Spawns this skill; handles post-rebase retargeting and promotion |
| MR chain manager | Detects parent merges/updates and triggers this skill via the cron |

## Race Condition Mitigation

- **`session_active` locking**: The cron sets `session_active = true` before spawning this session and clears it after the session exits. If `session_active` is already `true`, the cron skips this stage and retries next cycle.
- **`--force-with-lease`**: Prevents overwriting unexpected remote commits during push.
- **`rebase_conflict` guard**: Prevents the cron from re-spawning rebase sessions for stages with known unresolvable conflicts.
- **One rebase per child per cycle**: The cron serializes rebase sessions via the `session_active` lock. Deep parent chains cascade over multiple cron cycles (bottom-up in topological order).
