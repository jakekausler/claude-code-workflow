---
name: phase-finalize
description: Use when entering Finalize phase of ticket-stage-workflow - guides code review, testing, documentation, and final commits
---

# Finalize Phase

## Purpose

The Finalize phase ensures code quality through review, adds tests if needed, creates documentation, and commits all work. This is the only phase where tracking files are committed.

## Entry Conditions

- Automatic Testing and Manual Testing phases are complete (user testing passed)
- `ticket-stage-workflow` skill has been invoked (shared data conventions loaded)
- Stage YAML frontmatter has been read (status, refinement_type, ticket, epic, worktree_branch, etc.)

**Re-entry note:** If re-entering Finalize (e.g., addressing review comments), read existing `-finalize.md` sibling and overwrite with updated finalization notes.

## CRITICAL: Every Step Uses Subagents

**Every step in Finalize MUST be delegated to a subagent. Main agent coordinates only.**

## Remote Mode Detection

The Finalize phase behaves differently depending on the `WORKFLOW_REMOTE_MODE` environment variable. Check this value at the start of the phase — it controls whether the final steps merge locally or create a remote MR/PR.

### Platform Detection

When remote mode is active, determine which platform CLI to use:

1. Check `WORKFLOW_GIT_PLATFORM` env var:
   - `github` → use `gh` CLI
   - `gitlab` → use `glab` CLI
   - `auto` (default) → auto-detect from git remote URL

2. Auto-detection logic (when `WORKFLOW_GIT_PLATFORM=auto`):
   ```bash
   REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
   if echo "$REMOTE_URL" | grep -qi "github"; then
     PLATFORM="github"
   elif echo "$REMOTE_URL" | grep -qi "gitlab"; then
     PLATFORM="gitlab"
   else
     # Fallback: check which CLI is available
     if command -v gh &>/dev/null; then
       PLATFORM="github"
     elif command -v glab &>/dev/null; then
       PLATFORM="gitlab"
     else
       echo "ERROR: Cannot detect git platform. Set WORKFLOW_GIT_PLATFORM=github or WORKFLOW_GIT_PLATFORM=gitlab"
       exit 1
     fi
   fi
   ```

3. Verify the chosen CLI is installed:
   - GitHub: `gh auth status` (must be authenticated)
   - GitLab: `glab auth status` (must be authenticated)

## Draft MR and Target Branch Logic

When creating MRs in remote mode, the target branch and draft status depend on the stage's `pending_merge_parents`.

### Determining Target Branch and Draft Status

Before creating the MR (step 13 in remote mode), determine:

1. Read `pending_merge_parents` from stage YAML frontmatter
2. Filter to only **unmerged** parents:
   - Read each parent's stage YAML to check if status is "Complete" (preferred). If the parent YAML is unavailable, fall back to checking the parent's PR merge status.

     **Preferred:** Use the `mcp__kanban__pr_get` tool with the parent's PR number to check merge status.

     **Fallback (if MCP unavailable):** `gh pr view` / `glab mr view`.
   - Remove any parent whose stage is Complete or whose PR is merged
3. Determine target branch:
   - **Zero unmerged parents** → default branch (`main` or `master`)
   - **Exactly one unmerged parent** → that parent's MR branch (the `branch` field from the `pending_merge_parents` entry)
   - **Multiple unmerged parents** → default branch (`main` or `master`)

   **Edge case:** If the single unmerged parent has no `worktree_branch` or its branch hasn't been pushed to the remote, fall back to the default branch and still create as draft.

4. Determine draft status:
   - **Any unmerged parents** → create MR as **draft**
   - **Zero unmerged parents** → create MR as **ready** (normal)

### MR Description — Dependencies Section

If there are unmerged parents, append a Dependencies section to the MR body:

```markdown
## Dependencies

This MR depends on the following unmerged parent MRs:

- **STAGE-XXX-YYY-ZZZ**: [branch-name](PR_URL)

⚠️ This MR was created as a **draft** because parent dependencies are not yet merged.
```

Only list **unmerged** parents. Merged parents are omitted entirely.
If zero unmerged parents: no Dependencies section at all.

### Frontmatter Updates After MR Creation

After MR creation, update stage YAML frontmatter with:
- `is_draft: true` (if created as draft; omit or set false if ready)
- `mr_target_branch: <target_branch>` (the branch the MR targets)
- `pr_url` and `pr_number` (already handled by existing finalize logic)

## Phase Workflow

Steps 1-8 are IDENTICAL for local and remote mode. Steps 9+ diverge.

```
1. Read all sibling files for prior context
   Delegate to Explore (built-in) to read ALL `STAGE-XXX-YYY-ZZZ-*.md` sibling
   files in the same ticket directory. This will include:
   - `STAGE-XXX-YYY-ZZZ-design.md` (design research from Design phase)
   - `STAGE-XXX-YYY-ZZZ-build.md` (implementation notes from Build phase)
   - `STAGE-XXX-YYY-ZZZ-user-design-feedback.md` (decision rationale, if present)
   - Any other sibling notes files from prior phases

2. Delegate to code-reviewer (Opus) for pre-test code review

3. [Implement ALL review suggestions]
   → Delegate to fixer (Haiku) or scribe (Haiku) as appropriate
   ALL suggestions are mandatory regardless of severity

4. [CONDITIONAL: Test writing]
   IF tests were NOT written during Build phase:
     → Delegate to test-writer (Sonnet) to write missing tests

5. Delegate to tester (Haiku) to run all tests

6. [CONDITIONAL: Second code review]
   IF implementation code changed after step 3 OR existing code/tests were refactored:
     → Delegate to code-reviewer (Opus) for post-test review
   ELSE (ONLY new test files added, zero changes to existing code):
     → Skip second review

   **Self-check before skipping:** Did you modify ANY existing file after first review?
   - Refactored test utilities? → Second review required
   - Extracted helper functions? → Second review required
   - Renamed variables for clarity? → Second review required
   - Reordered parameters? → Second review required
   - ANY change requiring human judgment? → Second review required
   - ONLY added brand new test files with zero existing file edits? → May skip second review

   **"Formatting" = automated tool output ONLY:**
   - Prettier reformatting whitespace → Not second review trigger
   - ESLint auto-fixes (--fix flag) → Not second review trigger
   - ANY human-decided change → Second review required

   **Test**: Did a human decide to make this change? → Second review required

   **Implementing first review feedback IS a human decision:**
   - First review says "improve naming" → YOU chose WHICH names, HOW to rename
   - First review says "add error handling" → YOU chose WHERE and WHAT kind
   - First review approves the approach; second review verifies execution
   - "I'm just following reviewer guidance" → You still made implementation choices

7. [CONDITIONAL: Documentation]
   IF complex feature OR API OR public-facing:
     → Delegate to doc-writer (Opus)
   ELSE (simple internal change):
     → Delegate to doc-writer-lite (Sonnet) OR skip if minimal

8. Delegate to doc-updater (Haiku) to write to changelog/<date>.changelog.md
```

### Local Mode (default, `WORKFLOW_REMOTE_MODE=false`)

```
9.  Main agent creates implementation commit:
    - ONLY add implementation files (code, tests, docs): `git add <specific files>`
    - Include epic/ticket/stage reference in commit message
      (e.g., "feat(EPIC-001/TICKET-001-001/STAGE-001-001-001): implement login form")
    - **NEVER use `git add -A`** — it picks up uncommitted tracking files

10. Delegate to doc-updater (Haiku) to add commit hash to changelog entry

11. Main agent commits changelog update:
    - ONLY commit changelog: `git add changelog/<date>.changelog.md`
    - Commit message: "chore(TICKET-XXX-YYY): add commit hash to STAGE-XXX-YYY-ZZZ changelog"

12. Delegate to doc-updater (Haiku) to update tracking documents via YAML frontmatter:
    - Update stage YAML frontmatter: set Finalize phase complete, status to "Complete"
    - Update ticket YAML frontmatter in TICKET-XXX-YYY.md (update stage status)
    - Update epic YAML frontmatter in EPIC-XXX.md if all tickets in epic are complete

13. Main agent commits tracking files:
    - ONLY commit tracking files:
      `git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md`
    - Commit message: "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ Complete"
    - **NEVER use `git add -A`** — it picks up unrelated uncommitted files

14. [CONDITIONAL: Jira Status Sync]
    IF ticket has `jira_key` in YAML frontmatter AND `writing_script` is configured in pipeline config:

      **Preferred:** Use the `mcp__kanban__jira_sync` tool:
      - ticket: `TICKET-XXX-YYY`
      - repo: `<path>`
      The tool returns the sync result directly. If confirmation is needed (`WORKFLOW_JIRA_CONFIRM=true`), it will indicate planned changes — show them to the user and ask for confirmation using AskUserQuestion before proceeding.

      **Fallback (if MCP unavailable):**
      → Run: `npx tsx src/cli/index.ts jira-sync TICKET-XXX-YYY --repo <path>`
      → If exit code 0: report sync result to user
      → If exit code 2 (`WORKFLOW_JIRA_CONFIRM=true`): show user the planned Jira changes, ask for confirmation using AskUserQuestion, re-run jira-sync if approved
      → If exit code 1: report error, continue (don't block finalization on Jira failure)
    ELSE (no `jira_key` or no `writing_script`):
      Skip silently.

15. Prepare finalize session notes (DO NOT write files yet — exit gate handles all writes)

    Content for `STAGE-XXX-YYY-ZZZ-finalize.md`:
    - Code review findings and resolutions
    - Documentation updates made
    - Final verification results
```

### Remote Mode (`WORKFLOW_REMOTE_MODE=true`)

```
9.  Main agent creates implementation commit on the WORKTREE BRANCH (not main):
    - Ensure you are on the worktree branch: `git branch --show-current`
    - Branch should match `worktree_branch` from stage YAML frontmatter
    - ONLY add implementation files (code, tests, docs): `git add <specific files>`
    - Include epic/ticket/stage reference in commit message
      (e.g., "feat(EPIC-001/TICKET-001-001/STAGE-001-001-001): implement login form")
    - **NEVER use `git add -A`**

10. Delegate to doc-updater (Haiku) to add commit hash to changelog entry

11. Main agent commits changelog update on the worktree branch:
    - `git add changelog/<date>.changelog.md`
    - Commit message: "chore(TICKET-XXX-YYY): add commit hash to STAGE-XXX-YYY-ZZZ changelog"

12. Push branch to remote:
    ```bash
    git push -u origin <worktree_branch>
    ```
    If push fails due to remote rejection, report the error and stop.

13. Create MR/PR via platform CLI:

    **Determine target branch and draft status** using the "Draft MR and Target Branch Logic" section above.

    **If creating as draft (has unmerged parents):** Add `--draft` flag to the create command. For GitHub, use `--base <target_branch>`. For GitLab, use `--target-branch <target_branch>`. Append a Dependencies section to the MR body listing each unmerged parent with its stage ID, branch name as link text, and PR URL as the link target.

    **If creating as ready (no unmerged parents):** For GitHub, use `--base <target_branch>` (default branch). For GitLab, use `--target-branch <target_branch>` (default branch). No Dependencies section needed.

    **Read stage, ticket, and epic YAML frontmatter** to gather:
    - Stage title (for PR title)
    - Stage overview (for description)
    - Ticket `jira_key` (if set)
    - Epic `jira_key` (if set)
    - Test results summary from steps 4-5

    **Preferred:** Use the `mcp__kanban__pr_create` tool:
    - branch: `<worktree_branch>`
    - base: `<target_branch>`
    - title: `"feat(STAGE-XXX-YYY-ZZZ): <stage title>"`
    - body: the full PR body (see template below)
    - draft: `true` if unmerged parents exist, `false` otherwise

    The tool returns the PR URL and number directly. Store them for use in tracking files and notifications.

    **Fallback (if MCP unavailable):**

    **GitHub (`gh` CLI):**
    ```bash
    gh pr create \
      --base <target_branch> \
      --title "feat(STAGE-XXX-YYY-ZZZ): <stage title>" \
      --body "$(cat <<'PRBODY'
    ## Summary

    **Epic:** EPIC-XXX — <epic title>
    **Ticket:** TICKET-XXX-YYY — <ticket title>
    **Stage:** STAGE-XXX-YYY-ZZZ — <stage title>

    <Summary of what was built — 2-4 sentences covering the implementation approach, key design decisions, and what changed.>

    ## Design Decisions

    - <Key decision 1 and rationale>
    - <Key decision 2 and rationale>

    ## Test Results

    - All unit tests passing
    - <Specific test coverage notes>
    - <Refinement type approvals: e.g., Desktop Approved, Mobile Approved>

    ## Jira

    <If ticket jira_key is set:>
    Closes <TICKET_JIRA_KEY>

    <If epic jira_key is set:>
    Epic: <EPIC_JIRA_KEY>

    <If no jira_key on either:>
    No Jira ticket linked.

    <If unmerged parents exist, insert Dependencies section here:>
    ## Dependencies

    This PR depends on the following unmerged parent PRs:

    - **STAGE-XXX-YYY-ZZZ**: [branch-name](PR_URL)

    ⚠️ This PR was created as a **draft** because parent dependencies are not yet merged.
    <End of conditional Dependencies section>

    ---
    *Generated by Claude Code workflow — [STAGE-XXX-YYY-ZZZ]*
    PRBODY
    )"
    ```

    **GitLab (`glab` CLI):**
    ```bash
    glab mr create \
      --target-branch <target_branch> \
      --title "feat(STAGE-XXX-YYY-ZZZ): <stage title>" \
      --description "$(cat <<'MRBODY'
    ## Summary

    **Epic:** EPIC-XXX — <epic title>
    **Ticket:** TICKET-XXX-YYY — <ticket title>
    **Stage:** STAGE-XXX-YYY-ZZZ — <stage title>

    <Summary of what was built — 2-4 sentences covering the implementation approach, key design decisions, and what changed.>

    ## Design Decisions

    - <Key decision 1 and rationale>
    - <Key decision 2 and rationale>

    ## Test Results

    - All unit tests passing
    - <Specific test coverage notes>
    - <Refinement type approvals: e.g., Desktop Approved, Mobile Approved>

    ## Jira

    <If ticket jira_key is set:>
    Closes <TICKET_JIRA_KEY>

    <If epic jira_key is set:>
    Epic: <EPIC_JIRA_KEY>

    <If no jira_key on either:>
    No Jira ticket linked.

    <If unmerged parents exist, insert Dependencies section here:>
    ## Dependencies

    This MR depends on the following unmerged parent MRs:

    - **STAGE-XXX-YYY-ZZZ**: [branch-name](MR_URL)

    ⚠️ This MR was created as a **draft** because parent dependencies are not yet merged.
    <End of conditional Dependencies section>

    ---
    *Generated by Claude Code workflow — [STAGE-XXX-YYY-ZZZ]*
    MRBODY
    )"
    ```

    **Capture the MR/PR URL** from the command output. Store it for use in tracking files and notifications.

    **PR/MR Body Template** (used by both MCP tool and CLI fallback):

    ```markdown
    ## Summary

    **Epic:** EPIC-XXX — <epic title>
    **Ticket:** TICKET-XXX-YYY — <ticket title>
    **Stage:** STAGE-XXX-YYY-ZZZ — <stage title>

    <Summary of what was built — 2-4 sentences covering the implementation approach, key design decisions, and what changed.>

    ## Design Decisions

    - <Key decision 1 and rationale>
    - <Key decision 2 and rationale>

    ## Test Results

    - All unit tests passing
    - <Specific test coverage notes>
    - <Refinement type approvals: e.g., Desktop Approved, Mobile Approved>

    ## Jira

    <If ticket jira_key is set:> Closes <TICKET_JIRA_KEY>
    <If epic jira_key is set:> Epic: <EPIC_JIRA_KEY>
    <If no jira_key on either:> No Jira ticket linked.

    <If unmerged parents exist:>
    ## Dependencies
    This PR/MR depends on the following unmerged parent PRs/MRs:
    - **STAGE-XXX-YYY-ZZZ**: [branch-name](PR_URL)
    ⚠️ This PR/MR was created as a **draft** because parent dependencies are not yet merged.

    ---
    *Generated by Claude Code workflow — [STAGE-XXX-YYY-ZZZ]*
    ```

14. [CONDITIONAL: Slack Notification]
    IF `WORKFLOW_SLACK_WEBHOOK` environment variable is set:

      **Preferred:** Use the `mcp__kanban__slack_notify` tool:
      - message: `"New MR/PR Ready for Review"`
      - stage: `STAGE-XXX-YYY-ZZZ`
      - title: `<stage title>`
      - ticket: `TICKET-XXX-YYY`
      - ticket_title: `<ticket title>`
      - epic: `EPIC-XXX`
      - epic_title: `<epic title>`
      - url: `<MR/PR URL>`

      **Fallback (if MCP unavailable):**
      ```bash
      curl -s -X POST "$WORKFLOW_SLACK_WEBHOOK" \
        -H 'Content-Type: application/json' \
        -d '{
          "text": "New MR/PR ready for review",
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "*<stage title>*\n\nNew MR/PR Ready for Review\n*Stage:* STAGE-XXX-YYY-ZZZ\n*Ticket:* TICKET-XXX-YYY — <ticket title>\n*Epic:* EPIC-XXX — <epic title>\n<MR/PR URL|View MR/PR>"
              }
            }
          ]
        }'
      ```
    ELSE:
      Skip Slack notification silently (no error).

15. [CONDITIONAL: Jira Transition]
    IF ticket has `jira_key` set:
      → Transition the Jira issue to "In Review" status
      → Use available Jira MCP/skill to perform the transition
      → If `WORKFLOW_JIRA_CONFIRM=true`: ask user before transitioning
      → If transition fails: log warning but do not block the workflow
    ELSE:
      Skip Jira transition.

16. [CONDITIONAL: Jira Status Sync]
    IF ticket has `jira_key` in YAML frontmatter AND `writing_script` is configured in pipeline config:

      **Preferred:** Use the `mcp__kanban__jira_sync` tool:
      - ticket: `TICKET-XXX-YYY`
      - repo: `<path>`
      The tool returns the sync result directly. If confirmation is needed (`WORKFLOW_JIRA_CONFIRM=true`), it will indicate planned changes — show them to the user and ask for confirmation using AskUserQuestion before proceeding.

      **Fallback (if MCP unavailable):**
      → Run: `npx tsx src/cli/index.ts jira-sync TICKET-XXX-YYY --repo <path>`
      → If exit code 0: report sync result to user
      → If exit code 2 (`WORKFLOW_JIRA_CONFIRM=true`): show user the planned Jira changes, ask for confirmation using AskUserQuestion, re-run jira-sync if approved
      → If exit code 1: report error, continue (don't block finalization on Jira failure)
    ELSE (no `jira_key` or no `writing_script`):
      Skip silently.

17. Delegate to doc-updater (Haiku) to update tracking documents via YAML frontmatter:
    - Update stage YAML frontmatter:
      - Set Finalize phase complete
      - Set status to "PR Created" (NOT "Complete")
      - Record MR/PR URL in stage file (in `## Finalize Phase` section under `**MR/PR URL**:`)
      - Set `is_draft: true` if MR was created as draft
      - Set `mr_target_branch` to the target branch used
    - Update ticket YAML frontmatter in TICKET-XXX-YYY.md (update stage status)
    - Update epic YAML frontmatter in EPIC-XXX.md if needed

18. Main agent commits tracking files on the worktree branch:
    - `git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md`
    - Commit message: "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ PR Created"
    - Push the tracking commit: `git push origin <worktree_branch>`
    - **NEVER use `git add -A`**

19. Prepare finalize session notes (DO NOT write files yet — exit gate handles all writes)

    Content for `STAGE-XXX-YYY-ZZZ-finalize.md`:
    - Code review findings and resolutions
    - Documentation updates made
    - PR/MR details (URL, title, platform)
    - Final verification results
```

## Finalize Notes File (`STAGE-XXX-YYY-ZZZ-finalize.md`)

The finalize notes sibling file captures code review and completion context so future sessions (or PR reviewers) can reference it. It lives alongside the stage file:

```
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ.md                        # stage tracking (lean)
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-design.md                 # design research
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-build.md                  # build notes
epics/EPIC-XXX/TICKET-XXX-YYY/STAGE-XXX-YYY-ZZZ-finalize.md               # finalize notes (this phase)
```

**Contents of the finalize notes file:**

- Code review findings and resolutions
- Documentation updates made
- PR/MR details (if remote mode)
- Final verification results

**The main stage file stays lean.** Only finalize phase completion status goes in the stage file. Full finalization context lives in `-finalize.md`.

## Code Review Policy

**ALL code review suggestions must be implemented**, regardless of severity:

- Critical, Important, Minor - all mandatory
- "Nice to have" = "Must have"
- Only skip if implementation would break functionality (document why in stage file)

## The `git add -A` Problem (CRITICAL)

**Never use `git add -A`, `git add .`, or `git commit -a`**

When doc-updater updates tracking files, it does NOT commit them. If tracking files remain uncommitted and a later stage uses `git add -A`, it picks up:

- Changelog entries from previous stages
- Stage files from previous stages
- Epic/ticket files that should have been committed earlier
- Any other uncommitted files in the repo

**ALWAYS use specific file paths:**

```bash
# CORRECT - Tracking files (three-level hierarchy)
git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md

# CORRECT - Changelog
git add changelog/<date>.changelog.md

# CORRECT - Implementation files (list each one)
git add packages/llm/src/file1.ts packages/llm/src/file2.ts docs/guide.md

# WRONG - Picks up everything
git add -A
git add .
git commit -a
```

## Commit Message Convention

Include epic/ticket/stage references in commit messages for traceability:

```
feat(EPIC-001/TICKET-001-001/STAGE-001-001-001): implement login form validation
chore(TICKET-001-001): add commit hash to STAGE-001-001-001 changelog
chore(TICKET-001-001): mark STAGE-001-001-001 Complete
chore(TICKET-001-001): mark STAGE-001-001-001 PR Created
```

## Phase Gates Checklist

### Common (both modes)
- [ ] All sibling files read for context (design, build, user-design-feedback notes)
- [ ] code-reviewer (Opus) completed pre-test review
- [ ] ALL review suggestions implemented via fixer/scribe
- [ ] IF tests not written in Build: test-writer created tests
- [ ] tester ran all tests — passing
- [ ] IF impl code changed after first review: code-reviewer ran post-test review
- [ ] Documentation created (doc-writer OR doc-writer-lite based on complexity)
- [ ] Changelog entry added via doc-updater
- [ ] Finalize session notes prepared for `-finalize.md`

### Local Mode
- [ ] Implementation commit created with SPECIFIC file paths (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed immediately (ONLY changelog file)
- [ ] Tracking documents updated via doc-updater (YAML frontmatter):
  - Finalize phase marked complete in stage file
  - Stage status set to "Complete"
  - Ticket status updated if all stages complete
  - Epic status updated if all tickets complete
- [ ] IF ticket has `jira_key` and `writing_script` configured: `jira-sync` executed

### Remote Mode
- [ ] Implementation commit created on worktree branch (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed on worktree branch
- [ ] Branch pushed to remote (`git push -u origin <branch>`)
- [ ] MR/PR created via `gh pr create` or `glab mr create`
- [ ] Target branch determined from `pending_merge_parents` (zero/one/multiple unmerged parents)
- [ ] MR created as draft if unmerged parents exist
- [ ] Dependencies section included in MR body for unmerged parents only
- [ ] `is_draft` and `mr_target_branch` set in stage YAML frontmatter
- [ ] MR/PR URL captured and recorded
- [ ] IF `WORKFLOW_SLACK_WEBHOOK` set: Slack notification sent
- [ ] IF ticket has `jira_key`: Jira issue transitioned to "In Review"
- [ ] IF ticket has `jira_key` and `writing_script` configured: `jira-sync` executed
- [ ] Tracking documents updated via doc-updater (YAML frontmatter):
  - Finalize phase marked complete in stage file
  - Stage status set to "PR Created"
  - MR/PR URL recorded in stage file
  - Ticket status updated
  - Epic status updated if needed
- [ ] Tracking commit pushed to remote
- [ ] Exit gate completed (finalize notes, lessons-learned, journal)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Write finalize notes to `-finalize.md` sibling file
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before completing the Finalize phase, you MUST complete these steps IN ORDER.
Finalize notes and skill invocations happen here. Implementation commits and tracking updates are handled in the workflow steps above.

### No-Code Stages Still Require Exit Gate

Documentation-only or tracking-only stages:

- [ ] Still invoke lessons-learned (friction can happen in any work type)
- [ ] Still invoke journal (write about the documentation process)
- [ ] "No implementation code" is NOT an exit gate exception
- [ ] "Minimal changes" (even 5 lines) is NOT an exit gate exception
- [ ] Change size does NOT affect exit gate requirements

**Exit gate applies to ALL stages, regardless of work type or change size.**

**Rationalizations that don't work:**

- "Only updated 10 lines of docs" → Change size doesn't matter
- "This was a trivial stage" → Trivial stages still complete the exit gate
- "No code to learn lessons about" → Process lessons exist for all work types
- "Journal would just say 'updated docs'" → Write about the documentation process itself

**Note:** Implementation commits, changelog commits, tracking updates, and tracking commits all happen in the workflow steps BEFORE the exit gate (local steps 9-14, remote steps 9-19). The exit gate only handles finalize notes, lessons-learned, and journal.

1. Delegate to doc-updater (Haiku) to write finalize session notes to `STAGE-XXX-YYY-ZZZ-finalize.md` sibling file (code review findings and resolutions, documentation updates, PR/MR details if remote mode, final verification results)
2. Use Skill tool to invoke `lessons-learned` — **mandatory, no exceptions**
3. Use Skill tool to invoke `journal` — **mandatory, no exceptions**

**Why this order?**

- Step 1: Persist finalize context before anything else (if session crashes, notes are saved)
- Steps 2-3: Capture learnings and feelings based on the now-complete stage

**After exit gate completes:**

Stage is now complete (local mode) or awaiting review (remote mode). No further phase to invoke — the stage workflow is finished. End the session.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT claim the stage is complete until exit gate is done.** This includes:

- Telling user "stage is complete" or "PR created"
- Running `/next_task` for the next stage
- Starting work on another stage
- Closing the session as "successful"

**Complete ALL exit gate steps FIRST. Then the stage is truly complete (or in PR Created state).**
