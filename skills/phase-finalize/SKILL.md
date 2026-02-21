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

## Phase Workflow

Steps 1-7 are IDENTICAL for local and remote mode. Steps 8+ diverge.

```
1. Delegate to code-reviewer (Opus) for pre-test code review

2. [Implement ALL review suggestions]
   → Delegate to fixer (Haiku) or scribe (Haiku) as appropriate
   ALL suggestions are mandatory regardless of severity

3. [CONDITIONAL: Test writing]
   IF tests were NOT written during Build phase:
     → Delegate to test-writer (Sonnet) to write missing tests

4. Delegate to tester (Haiku) to run all tests

5. [CONDITIONAL: Second code review]
   IF implementation code changed after step 2 OR existing code/tests were refactored:
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

6. [CONDITIONAL: Documentation]
   IF complex feature OR API OR public-facing:
     → Delegate to doc-writer (Opus)
   ELSE (simple internal change):
     → Delegate to doc-writer-lite (Sonnet) OR skip if minimal

7. Delegate to doc-updater (Haiku) to write to changelog/<date>.changelog.md
```

### Local Mode (default, `WORKFLOW_REMOTE_MODE=false`)

```
8. Main agent creates implementation commit:
   - ONLY add implementation files (code, tests, docs): `git add <specific files>`
   - Include epic/ticket/stage reference in commit message
     (e.g., "feat(EPIC-001/TICKET-001-001/STAGE-001-001-001): implement login form")
   - **NEVER use `git add -A`** - it picks up uncommitted tracking files

9. Delegate to doc-updater (Haiku) to add commit hash to changelog entry

10. Main agent commits changelog update:
    - ONLY commit changelog: `git add changelog/<date>.changelog.md`
    - Commit message: "chore(TICKET-XXX-YYY): add commit hash to STAGE-XXX-YYY-ZZZ changelog"

11. Delegate to doc-updater (Haiku) to update tracking documents via YAML frontmatter:
    - Update stage YAML frontmatter: set Finalize phase complete, status to "Complete"
    - Update ticket YAML frontmatter in TICKET-XXX-YYY.md (update stage status)
    - Update epic YAML frontmatter in EPIC-XXX.md if all tickets in epic are complete
    - Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` after status changes

12. Main agent commits tracking files:
    - ONLY commit tracking files:
      `git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md`
    - Commit message: "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ Complete"
    - **NEVER use `git add -A`** - it picks up unrelated uncommitted files

13. [CONDITIONAL: Jira Status Sync]
    IF ticket has `jira_key` in YAML frontmatter AND `writing_script` is configured in pipeline config:
      - Run: `npx tsx src/cli/index.ts jira-sync TICKET-XXX-YYY --repo <path>`
      - If exit code 0: report sync result to user
      - If exit code 2 (`WORKFLOW_JIRA_CONFIRM=true`): show user the planned Jira changes, ask for confirmation using AskUserQuestion, re-run jira-sync if approved
      - If exit code 1: report error, continue (don't block finalization on Jira failure)
    ELSE (no `jira_key` or no `writing_script`):
      Skip silently.
```

### Remote Mode (`WORKFLOW_REMOTE_MODE=true`)

```
8. Main agent creates implementation commit on the WORKTREE BRANCH (not main):
   - Ensure you are on the worktree branch: `git branch --show-current`
   - Branch should match `worktree_branch` from stage YAML frontmatter
   - ONLY add implementation files (code, tests, docs): `git add <specific files>`
   - Include epic/ticket/stage reference in commit message
     (e.g., "feat(EPIC-001/TICKET-001-001/STAGE-001-001-001): implement login form")
   - **NEVER use `git add -A`**

9. Delegate to doc-updater (Haiku) to add commit hash to changelog entry

10. Main agent commits changelog update on the worktree branch:
    - `git add changelog/<date>.changelog.md`
    - Commit message: "chore(TICKET-XXX-YYY): add commit hash to STAGE-XXX-YYY-ZZZ changelog"

11. Push branch to remote:
    ```bash
    git push -u origin <worktree_branch>
    ```
    If push fails due to remote rejection, report the error and stop.

12. Create MR/PR via platform CLI:

    **Read stage, ticket, and epic YAML frontmatter** to gather:
    - Stage title (for PR title)
    - Stage overview (for description)
    - Ticket `jira_key` (if set)
    - Epic `jira_key` (if set)
    - Test results summary from steps 3-4

    **GitHub (`gh` CLI):**
    ```bash
    gh pr create \
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

    ---
    *Generated by Claude Code workflow — [STAGE-XXX-YYY-ZZZ]*
    PRBODY
    )"
    ```

    **GitLab (`glab` CLI):**
    ```bash
    glab mr create \
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

    ---
    *Generated by Claude Code workflow — [STAGE-XXX-YYY-ZZZ]*
    MRBODY
    )"
    ```

    **Capture the MR/PR URL** from the command output. Store it for use in tracking files and notifications.

13. [CONDITIONAL: Slack Notification]
    IF `WORKFLOW_SLACK_WEBHOOK` environment variable is set:
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
                "text": "*New MR/PR Ready for Review*\n\n*Stage:* STAGE-XXX-YYY-ZZZ — <stage title>\n*Ticket:* TICKET-XXX-YYY — <ticket title>\n*Epic:* EPIC-XXX — <epic title>\n*URL:* <MR/PR URL>"
              }
            }
          ]
        }'
      ```
    ELSE:
      Skip Slack notification silently (no error).

14. [CONDITIONAL: Jira Transition]
    IF ticket has `jira_key` set:
      - Transition the Jira issue to "In Review" status
      - Use available Jira MCP/skill to perform the transition
      - If `WORKFLOW_JIRA_CONFIRM=true`: ask user before transitioning
      - If transition fails: log warning but do not block the workflow
    ELSE:
      Skip Jira transition.

15. [CONDITIONAL: Jira Status Sync]
    IF ticket has `jira_key` in YAML frontmatter AND `writing_script` is configured in pipeline config:
      - Run: `npx tsx src/cli/index.ts jira-sync TICKET-XXX-YYY --repo <path>`
      - If exit code 0: report sync result to user
      - If exit code 2 (`WORKFLOW_JIRA_CONFIRM=true`): show user the planned Jira changes, ask for confirmation using AskUserQuestion, re-run jira-sync if approved
      - If exit code 1: report error, continue (don't block finalization on Jira failure)
    ELSE (no `jira_key` or no `writing_script`):
      Skip silently.

16. Delegate to doc-updater (Haiku) to update tracking documents via YAML frontmatter:
    - Update stage YAML frontmatter:
      - Set Finalize phase complete
      - Set status to "PR Created" (NOT "Complete")
      - Record MR/PR URL in stage file (in `## Finalize Phase` section under `**MR/PR URL**:`)
    - Update ticket YAML frontmatter in TICKET-XXX-YYY.md (update stage status)
    - Update epic YAML frontmatter in EPIC-XXX.md if needed
    - Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` after status changes

17. Main agent commits tracking files on the worktree branch:
    - `git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md`
    - Commit message: "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ PR Created"
    - Push the tracking commit: `git push origin <worktree_branch>`
    - **NEVER use `git add -A`**
```

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
- [ ] code-reviewer (Opus) completed pre-test review
- [ ] ALL review suggestions implemented via fixer/scribe
- [ ] IF tests not written in Build: test-writer created tests
- [ ] tester ran all tests - passing
- [ ] IF impl code changed after first review: code-reviewer ran post-test review
- [ ] Documentation created (doc-writer OR doc-writer-lite based on complexity)
- [ ] Changelog entry added via doc-updater

### Local Mode
- [ ] Implementation commit created with SPECIFIC file paths (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed immediately (ONLY changelog file)
- [ ] Tracking documents updated via doc-updater (YAML frontmatter):
  - Finalize phase marked complete in stage file
  - Stage status set to "Complete"
  - Ticket status updated if all stages complete
  - Epic status updated if all tickets complete
- [ ] `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` executed after status changes
- [ ] IF ticket has `jira_key` and `writing_script` configured: `jira-sync` executed

### Remote Mode
- [ ] Implementation commit created on worktree branch (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed on worktree branch
- [ ] Branch pushed to remote (`git push -u origin <branch>`)
- [ ] MR/PR created via `gh pr create` or `glab mr create`
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
- [ ] `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` executed after status changes
- [ ] Tracking commit pushed to remote

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Commit tracking files with specific paths (NEVER git add -A)

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY) - Finalize Only

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

**Note:** The exit gate (steps 1-5 below) covers the final stage-completion steps. Implementation commits (workflow steps 8-10/16) happen BEFORE the exit gate begins.

Before completing the stage, you MUST complete these steps IN ORDER:

1. Update stage tracking file YAML frontmatter (mark Finalize phase complete, stage "Complete" or "PR Created")
2. Update ticket tracking file YAML frontmatter (update stage status, ticket status if all stages done)
3. Update epic tracking file YAML frontmatter (update epic status if all tickets done)
4. Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ`
5. **Main agent commits tracking files** (NOT doc-updater):
   - `git add epics/EPIC-XXX-name/TICKET-XXX-YYY-name/STAGE-XXX-YYY-ZZZ.md epics/EPIC-XXX-name/TICKET-XXX-YYY-name/TICKET-XXX-YYY.md epics/EPIC-XXX-name/EPIC-XXX.md`
   - Commit message: "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ Complete" (local mode) or "chore(TICKET-XXX-YYY): mark STAGE-XXX-YYY-ZZZ PR Created" (remote mode)
   - **NEVER use `git add -A`**
   - **Remote mode**: Push this commit to the remote branch as well
6. Use Skill tool to invoke `lessons-learned`
7. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-3: Update tracking state (YAML frontmatter)
- Step 4: Sync kanban board
- Step 5: Commit tracking state (so it persists even if session ends)
- Steps 6-7: Capture learnings and feelings based on the now-complete stage

Committing before lessons/journal ensures tracking state is saved. Lessons and journal need the commit to have happened (they may reference the commit hash).

Stage is now complete (local mode) or awaiting review (remote mode). No further phase to invoke — the stage workflow is finished.

**DO NOT skip any exit gate step.**

**DO NOT claim the stage is complete until exit gate is done.** This includes:

- Telling user "stage is complete" or "PR created"
- Running `/next_task` for the next stage
- Starting work on another stage
- Closing the session as "successful"

**Complete ALL exit gate steps FIRST. Then the stage is truly complete (or in PR Created state).**
