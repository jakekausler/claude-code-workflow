---
name: resolve-merge-conflicts
description: Use when git merge or git rebase results in conflicts - automates conflict resolution using codebase and stage context
---

# Resolve Merge Conflicts

## Purpose

Resolve git merge or rebase conflicts using full codebase context, parent/child stage documentation, and structured heuristics. Designed to be invoked from `phase-build` (during parent branch merging) and `rebase-child-mr` (Stage 6D, during child branch rebasing).

## Entry Conditions

- A `git merge` or `git rebase` operation has resulted in conflicts
- The working directory is in a merge/rebase conflict state
- Caller has context about which parent stage(s) are being merged/rebased

## Skill Flow

### Step 1: Identify Conflicting Files

```bash
git diff --name-only --diff-filter=U
```

Capture the list of all files with unresolved conflicts.

### Step 2: Auto-Resolve Trivially Conflicting Files

Handle these file types mechanically before any contextual analysis:

**Lock files** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`):
- Accept the current branch version: `git checkout --ours <file>`
- Regenerate: run `npm install` (or `yarn install` / `pnpm install` as appropriate)
- If regeneration fails, do NOT `git add` the file. Escalate to user — dependency conflicts require human judgment.
- `git add <file>`

**Generated files** (`*.generated.ts`, `*.generated.graphql`, or other project-specific generated patterns):
- Accept the current branch version: `git checkout --ours <file>`
- Regenerate via project tooling (e.g., `npm run codegen`)
- If regeneration fails, do NOT `git add` the file. Escalate to user — codegen configuration may need manual intervention.
- `git add <file>`

**Config files with additive changes** (`.gitignore`, `.prettierrc`, `tsconfig.json`):
- Read the file with conflict markers
- For additive array fields (e.g., `include`, `exclude`, `plugins`): merge both lists, deduplicate
- For scalar fields with conflicting values: treat as a logic conflict (defer to Step 3 heuristics)
- For nested object fields: recursive merge; if both sides modify the same key differently, defer to Step 3
- `git add <file>`

**Purely additive files** (changelogs, migration lists):
- Read the file with conflict markers
- Concatenate entries from both sides in chronological order
- `git add <file>`

Remove auto-resolved files from the conflicting files list before proceeding.

### Step 3: Context-Driven Resolution for Remaining Files

For each remaining conflicting file:

1. **Read the file** with conflict markers (shows `<<<<<<<`, `=======`, `>>>>>>>` blocks)

2. **Gather context**:
   - Read the parent stage's design doc (`STAGE-*-design.md`) and build notes (`STAGE-*-build.md`)
   - Read the current stage's design doc
   - Read relevant ticket descriptions if the conflict spans ticket boundaries
   - Examine surrounding code in the file for patterns and intent

3. **Apply resolution heuristics** (in priority order):

   | Priority | Pattern | Resolution |
   |----------|---------|------------|
   | 1 | **Complementary changes** — both sides add different things to different areas | Keep both, order logically |
   | 2 | **Superset** — one side includes the other's changes plus more | Keep the superset |
   | 3 | **Import/export conflicts** — both sides add imports or exports | Merge both lists, deduplicate |
   | 4 | **Type definition conflicts** — both sides add fields or methods | Merge both sets of fields/methods |
   | 5 | **Logic conflicts** — behavioral differences in code | Read stage design docs to determine intended direction; child stage intent generally takes precedence since parent is "done" (in PR), unless the parent stage explicitly revises the area the child modified |
   | 6 | **Genuinely ambiguous** — two opposing patterns, no contextual signal | Escalate to user via AskUserQuestion |

4. **Resolve the conflict**: Replace conflict markers with the resolved content

5. **Mark as resolved**: `git add <file>`

### Step 4: Complete the Merge/Rebase

Determine which operation is in progress and complete it:

```bash
# git rev-parse --git-dir works in both main working tree and linked worktrees
if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
  git merge --continue
else
  git rebase --continue
fi
```

### Step 5: Return Control to Caller

Return control to the calling skill (`phase-build` or `rebase-child-mr` in Stage 6D). The caller is responsible for:
- Running verification (`npm run verify` or equivalent)
- Handling verification failures
- Deciding whether to escalate to the user

## What This Skill Does NOT Do

- **Does not run verification** — caller's responsibility
- **Does not modify stage frontmatter** or tracking files
- **Does not make architectural decisions** — resolves merge mechanics only
- **Does not push** — caller handles git push if needed

## Escalation Criteria

Only escalate to user via `AskUserQuestion` when ALL of these are true:
- The conflict involves logic/behavior (not just additive changes)
- Both sides implement contradictory behavior (not complementary)
- Neither stage design doc provides clear direction on intended behavior
- The codebase context doesn't suggest which direction is correct

Most conflicts are additive (new features on both sides) and can be resolved by keeping both changes.

## Stage 6D Reuse Note

The `rebase-child-mr` (planned) skill (Stage 6D) invokes this skill identically. The only difference is:
- `phase-build` triggers this after `git merge origin/<parent_branch>` fails
- `rebase-child-mr` triggers this after `git rebase <target>` fails

Step 4 handles both cases by checking whether `MERGE_HEAD` exists in the git directory.
