# Stage 3B: Remote Mode Skills — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update phase-finalize for remote mode and create review-cycle skill for MR/PR review handling.

**Status:** Complete

**Prerequisites:** Stage 3A complete (git platform detection available), Stage 1 complete (kanban-cli, skill files, pipeline config all operational)

**Architecture:** Markdown skill file updates following existing patterns. Skills live in `skills/<name>/SKILL.md`. Pipeline config lives in `tools/kanban-cli/config/default-pipeline.yaml`. No TypeScript code changes in this plan — these are Claude Code instruction documents.

**Tech Stack:** Markdown, grep (verification)

---

### Task 1: Update `phase-finalize` Skill with Full Remote Mode Support

**Files:**
- Modify: `skills/phase-finalize/SKILL.md`

**Action:** Replace the entire file content. The current file already has a "Remote Mode Awareness" placeholder section (lines 21-43) with a note saying "Remote mode functionality ships in Stage 3. For now, local mode only." This task replaces the entire file with the production version that has full remote mode operational instructions.

**Step 1: Replace `skills/phase-finalize/SKILL.md` with the following content**

Write the following complete file content:

~~~markdown
---
name: phase-finalize
description: Use when entering Finalize phase of ticket-stage-workflow - guides code review, testing, documentation, and final commits
---

# Finalize Phase

## Purpose

The Finalize phase ensures code quality through review, adds tests if needed, creates documentation, and commits all work. This is the only phase where tracking files are committed.

## Entry Conditions

- Automatic Testing and Manual Testing phases are complete (user testing passed)
- `ticket-stage-workflow` skill has been invoked (shared rules loaded)

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

15. Delegate to doc-updater (Haiku) to update tracking documents via YAML frontmatter:
    - Update stage YAML frontmatter:
      - Set Finalize phase complete
      - Set status to "PR Created" (NOT "Complete")
      - Record MR/PR URL in stage file (in `## Finalize Phase` section under `**MR/PR URL**:`)
    - Update ticket YAML frontmatter in TICKET-XXX-YYY.md (update stage status)
    - Update epic YAML frontmatter in EPIC-XXX.md if needed
    - Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` after status changes

16. Main agent commits tracking files on the worktree branch:
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

### Remote Mode
- [ ] Implementation commit created on worktree branch (NO git add -A)
- [ ] Commit hash added to changelog via doc-updater
- [ ] Changelog committed on worktree branch
- [ ] Branch pushed to remote (`git push -u origin <branch>`)
- [ ] MR/PR created via `gh pr create` or `glab mr create`
- [ ] MR/PR URL captured and recorded
- [ ] IF `WORKFLOW_SLACK_WEBHOOK` set: Slack notification sent
- [ ] IF ticket has `jira_key`: Jira issue transitioned to "In Review"
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
~~~

**Step 2: Verify**

```bash
# Remote mode is now operational (no "ships in Stage 3" note)
grep -c "ships in Stage 3" skills/phase-finalize/SKILL.md
# Expected: 0

# Key remote mode terms are present
grep -c "WORKFLOW_REMOTE_MODE" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "WORKFLOW_GIT_PLATFORM" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "gh pr create" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "glab mr create" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "WORKFLOW_SLACK_WEBHOOK" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "PR Created" skills/phase-finalize/SKILL.md
# Expected: > 0

grep -c "jira_key" skills/phase-finalize/SKILL.md
# Expected: > 0
```

**Step 3: Commit**

```bash
git add skills/phase-finalize/SKILL.md
git commit -m "feat(phase-finalize): add full remote mode support with MR/PR creation, Slack, and Jira"
```

---

### Task 2: Create `review-cycle` Skill

**Files:**
- Create directory: `skills/review-cycle/`
- Create: `skills/review-cycle/SKILL.md`

**Step 1: Create the directory**

```bash
mkdir -p skills/review-cycle
```

**Step 2: Write `skills/review-cycle/SKILL.md` with the following complete content**

~~~markdown
---
name: review-cycle
description: Use when a stage is in PR Created or Addressing Comments status and has MR/PR review comments to address — handles fetching comments, delegating fixes, pushing updates, and replying to reviewers
---

# Review Cycle

## Purpose

The Review Cycle skill handles the MR/PR review feedback loop. When a stage has an open MR/PR with reviewer comments, this skill fetches the comments, delegates fixes, pushes updates, and posts replies. It repeats until all comments are addressed and the MR/PR is approved or merged.

## Entry Conditions

- Stage status is `PR Created` or `Addressing Comments`
- Stage has a recorded MR/PR URL in the stage file (under `## Finalize Phase` → `**MR/PR URL**:`)
- `ticket-stage-workflow` skill has been invoked (shared rules loaded)
- `WORKFLOW_REMOTE_MODE=true` (this skill only applies in remote mode)

## Trigger

This skill is invoked in one of three ways:

1. **Manual invocation:** User runs `/review-cycle STAGE-XXX-YYY-ZZZ`
2. **Phase routing:** `ticket-stage-workflow` routes to this skill when stage status is `Addressing Comments`
3. **Orchestration loop:** Detected by the orchestration loop when a `PR Created` stage has unresolved comments (Stage 6+)

## CRITICAL: Every Step Uses Subagents

**Every step in Review Cycle MUST be delegated to a subagent. Main agent coordinates only.**

## Platform Detection

Use the same platform detection as `phase-finalize`:

1. Check `WORKFLOW_GIT_PLATFORM` env var (`github`, `gitlab`, or `auto`)
2. If `auto`: detect from git remote URL
3. Verify CLI authentication (`gh auth status` or `glab auth status`)

## Extracting MR/PR Number

The MR/PR URL is recorded in the stage file. Extract the number from the URL:

- GitHub: `https://github.com/owner/repo/pull/123` → PR number is `123`
- GitLab: `https://gitlab.com/owner/repo/-/merge_requests/45` → MR number is `45`

If the URL is not in the stage file, attempt to find it:

```bash
# GitHub: find PR for the current branch
gh pr view --json number,url --jq '.number'

# GitLab: find MR for the current branch
glab mr view --output json | jq '.iid'
```

## Review Cycle Workflow

```
1. Transition stage status to "Addressing Comments":
   - Update stage YAML frontmatter: status → "Addressing Comments"
   - Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ`

2. Fetch review comments from MR/PR:

   **GitHub:**
   gh pr view <number> --json reviews,comments \
     --jq '{reviews: .reviews, comments: .comments}'

   # Also fetch inline/file-level review comments:
   gh api repos/{owner}/{repo}/pulls/<number>/comments \
     --jq '.[] | {path: .path, line: .line, body: .body, id: .id, user: .user.login}'

   **GitLab:**
   glab mr notes list <number>

   # For structured data:
   glab api projects/:id/merge_requests/<number>/notes \
     --jq '.[] | {body: .body, id: .id, author: .author.username, resolvable: .resolvable, resolved: .resolved}'

3. Parse comments into categories:

   For each comment, classify as:

   a. **Actionable** — Requires a code change:
      - "Please rename this variable"
      - "Add error handling here"
      - "This should use X instead of Y"
      - "Missing null check"
      - "Fix the typo on line 42"

   b. **Question** — Requires a response, not necessarily a code change:
      - "Why did you choose this approach?"
      - "Is this intentional?"
      - "What happens if X?"

   c. **Discussion** — No action needed, informational:
      - "Nice approach!"
      - "I agree with this pattern"
      - "FYI this is similar to..."

   d. **Already resolved** — Marked as resolved on the platform:
      - GitHub: Check if review thread is resolved
      - GitLab: Check `resolved: true` on resolvable notes

   Report the classification to the user:

   | Category    | Count | Action                                  |
   |-------------|-------|-----------------------------------------|
   | Actionable  | N     | Will address via fixer/scribe           |
   | Question    | N     | Will draft response for user review     |
   | Discussion  | N     | No action needed                        |
   | Resolved    | N     | Already resolved, skipping              |

4. Ensure worktree is active:
   - Check if `worktree_branch` from stage frontmatter is checked out
   - If not, switch to the worktree: `cd <worktree_path>`
   - If worktree doesn't exist, create it:
     ```bash
     git worktree add ../worktrees/<worktree_branch> <worktree_branch>
     ```
   - Pull latest changes:
     ```bash
     git pull origin <worktree_branch>
     ```

5. Address each actionable comment:

   For EACH actionable comment:

   a. Determine severity:
      - Trivial (typo, rename, style): Delegate directly to fixer (Haiku)
      - Medium (logic change, error handling): Delegate to debugger-lite (Sonnet) for instructions, then fixer (Haiku)
      - Complex (architectural change, redesign): Delegate to debugger (Opus) for instructions, then fixer (Haiku)

   b. Delegate the fix:
      - Pass the specific comment text, file path, and line number to the agent
      - Include surrounding code context
      - Fixer applies changes per standard fixer protocol

   c. Verify the fix:
      - Delegate to verifier (Haiku) for build/lint/type-check
      - Delegate to tester (Haiku) for test execution
      - IF verification fails: follow standard error handling flow (debugger → fixer)

   d. Track progress:
      - Maintain a checklist of comments being addressed
      - Report each fix to the user after verification

6. Draft responses to questions:

   For EACH question comment:
   - Draft a response explaining the rationale
   - Present the draft to the user for approval or editing
   - User may want to respond differently than what the agent suggests

7. Create a commit for addressed comments:
   - `git add <specific changed files>`
   - Commit message: "fix(STAGE-XXX-YYY-ZZZ): address review comments round N"
   - **NEVER use `git add -A`**

8. Push updated branch:
   ```bash
   git push origin <worktree_branch>
   ```

9. Post reply comments on MR/PR:

   **GitHub — reply to specific review comments:**
   ```bash
   # Reply to a specific review comment thread
   gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment_id>/replies \
     -f body="Addressed: <description of what was changed>"
   ```

   **GitHub — post general comment:**
   ```bash
   gh pr comment <number> --body "$(cat <<'EOF'
   ## Review Comments Addressed

   **Round N** — Addressed N of M actionable comments:

   - [x] <Comment summary 1> — Fixed in <commit hash short>
   - [x] <Comment summary 2> — Fixed in <commit hash short>
   - [ ] <Question 1> — See response below

   ### Responses to Questions

   **Q: <question text>**
   A: <response text>

   ---
   *Addressed by Claude Code workflow — ready for re-review*
   EOF
   )"
   ```

   **GitLab — post note on MR:**
   ```bash
   glab mr note <number> --message "$(cat <<'EOF'
   ## Review Comments Addressed

   **Round N** — Addressed N of M actionable comments:

   - [x] <Comment summary 1> — Fixed in <commit hash short>
   - [x] <Comment summary 2> — Fixed in <commit hash short>

   ### Responses to Questions

   **Q: <question text>**
   A: <response text>

   ---
   *Addressed by Claude Code workflow — ready for re-review*
   EOF
   )"
   ```

   **GitLab — resolve specific discussion threads:**
   ```bash
   # Resolve a discussion thread after addressing it
   glab api -X PUT projects/:id/merge_requests/<number>/discussions/<discussion_id> \
     -f resolved=true
   ```

10. Transition status back to "PR Created":
    - Update stage YAML frontmatter: status → "PR Created"
    - Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ`
    - This signals that comments have been addressed and MR/PR is awaiting re-review

11. [CONDITIONAL: Slack Notification]
    IF `WORKFLOW_SLACK_WEBHOOK` is set:
      ```bash
      curl -s -X POST "$WORKFLOW_SLACK_WEBHOOK" \
        -H 'Content-Type: application/json' \
        -d '{
          "text": "Review comments addressed",
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "*Review Comments Addressed*\n\n*Stage:* STAGE-XXX-YYY-ZZZ — <stage title>\n*Round:* N\n*Comments addressed:* M\n*URL:* <MR/PR URL>\n\nReady for re-review."
              }
            }
          ]
        }'
      ```

12. Notify user:
    - "All N actionable review comments have been addressed and pushed."
    - "Replies posted on the MR/PR."
    - "Stage status returned to PR Created — awaiting re-review."
    - If questions were drafted: "N question responses posted — please verify they are accurate."
```

## Status Transitions

| From               | To                   | Trigger                                        |
|--------------------|----------------------|------------------------------------------------|
| PR Created         | Addressing Comments  | Review comments detected and work begins       |
| Addressing Comments| PR Created           | All comments addressed, pushed, replies posted |
| PR Created         | Done                 | MR/PR merged (detected by `pr-status` resolver)|

**Note:** The `PR Created → Done` transition is NOT handled by this skill. It is handled by the `pr-status` resolver, which polls the MR/PR status and transitions when merged. This skill only handles the `PR Created ↔ Addressing Comments` cycle.

## Multiple Review Rounds

Reviewers may post multiple rounds of comments. Each round follows the same workflow:

1. New comments appear on the MR/PR
2. `pr-status` resolver (or manual invocation) detects unresolved comments
3. This skill is invoked again
4. Status: `PR Created` → `Addressing Comments`
5. Comments addressed, pushed, replied
6. Status: `Addressing Comments` → `PR Created`
7. Repeat if more comments arrive

There is no limit on the number of review rounds. Each round creates its own commit with a round number in the message.

## Handling Conflicting or Unclear Comments

If reviewer comments are contradictory or unclear:

1. **Contradictory comments from different reviewers:**
   - Report the conflict to the user
   - Present both comments side by side
   - Ask user which direction to follow
   - Do NOT pick a side without user input

2. **Unclear or ambiguous comments:**
   - Draft a clarifying question as a reply
   - Present to user: "This comment is ambiguous. Suggested reply: [draft]. Post this reply?"
   - Do NOT guess the reviewer's intent and implement a guess

3. **Comments requesting changes the user disagrees with:**
   - Present the comment to the user
   - User decides: address it, push back with a reply, or discuss with reviewer
   - The agent does NOT override reviewer feedback or user preferences

## Error Handling

### Push Fails

If `git push` fails:
1. Check if the branch has diverged (someone else pushed)
2. If diverged: `git pull --rebase origin <branch>` then retry push
3. If force-push needed: ask user (never force-push without explicit consent)
4. If auth fails: report error, suggest `gh auth login` or `glab auth login`

### API Rate Limits

If GitHub/GitLab API returns rate limit errors:
1. Report the rate limit to the user
2. Wait the recommended time (from `Retry-After` header)
3. Retry the operation

### No Comments Found

If the MR/PR has no unresolved comments:
1. Report: "No unresolved review comments found on MR/PR #N"
2. Status remains `PR Created` (no transition to Addressing Comments)
3. The MR/PR is either:
   - Approved and waiting for merge (handled by `pr-status` resolver)
   - Still awaiting initial review

## Phase Gates Checklist

- [ ] Stage status transitioned to "Addressing Comments"
- [ ] Review comments fetched and classified
- [ ] Worktree active and up to date
- [ ] Each actionable comment addressed via fixer/scribe
- [ ] Each fix verified (build, lint, tests)
- [ ] Questions drafted and approved by user
- [ ] Commit created with addressed changes (specific file paths, no git add -A)
- [ ] Branch pushed to remote
- [ ] Reply comments posted on MR/PR
- [ ] Status transitioned back to "PR Created"
- [ ] `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ` executed after each status change
- [ ] User notified of results

## Time Pressure Does NOT Override the Review Cycle

**IF USER SAYS:** "Just approve it" / "Skip the comments" / "Merge anyway"

**YOU MUST STILL:**

- Address all actionable comments (or document explicit user waiver per comment)
- Verify fixes pass tests
- Post replies on the MR/PR

**Skipping review comments breaks team trust.** If the user wants to close a comment without addressing it, they must explicitly waive each comment: "Waive comment #N because [reason]." Document the waiver in the MR/PR reply.

---

## Exit Gate (MANDATORY)

After completing a review round, the exit gate is lighter than full phase exit gates because the review cycle may repeat:

1. Verify all actionable comments addressed (or waived with documentation)
2. Verify all fixes pass tests
3. Verify branch is pushed
4. Verify replies are posted
5. Update stage status to "PR Created"
6. Run `kanban-cli sync --stage STAGE-XXX-YYY-ZZZ`

**Note:** `lessons-learned` and `journal` are NOT invoked after each review round. They are invoked once when the stage reaches `Done` (after the MR/PR is merged), as part of the final stage completion handled by the orchestration loop or manual workflow.
~~~

**Step 3: Verify**

```bash
# Skill file exists
ls skills/review-cycle/SKILL.md
# Expected: file exists

# Key terms are present
grep -c "review-cycle" skills/review-cycle/SKILL.md
# Expected: > 0

grep -c "Addressing Comments" skills/review-cycle/SKILL.md
# Expected: > 0

grep -c "PR Created" skills/review-cycle/SKILL.md
# Expected: > 0

grep -c "gh pr" skills/review-cycle/SKILL.md
# Expected: > 0

grep -c "glab mr" skills/review-cycle/SKILL.md
# Expected: > 0

grep -c "WORKFLOW_SLACK_WEBHOOK" skills/review-cycle/SKILL.md
# Expected: > 0
```

**Step 4: Commit**

```bash
git add skills/review-cycle/SKILL.md
git commit -m "feat(review-cycle): create new skill for MR/PR review comment handling"
```

---

### Task 3: Verify Pipeline Config References

**Files:**
- Read (verify only): `tools/kanban-cli/config/default-pipeline.yaml`

**Step 1: Verify pipeline config already references review-cycle**

The pipeline config already has the correct entries (confirmed during research):

```yaml
    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to: [PR Created]
```

And:

```yaml
    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to: [Done, Addressing Comments]
```

**Verification:**

```bash
grep -c "review-cycle" tools/kanban-cli/config/default-pipeline.yaml
# Expected: 1

grep -c "Addressing Comments" tools/kanban-cli/config/default-pipeline.yaml
# Expected: 2 (one in name, one in transitions_to)

grep -c "PR Created" tools/kanban-cli/config/default-pipeline.yaml
# Expected: 3 (name, status, and in Finalize transitions_to)
```

No changes needed to the pipeline config — it already has the correct references from Stage 0/1 work.

---

### Task 4: Verify Skill Registry and Cross-References

**Files:**
- Read (verify only): `skills/ticket-stage-workflow/SKILL.md`

**Step 1: Verify ticket-stage-workflow already routes to review-cycle**

The `ticket-stage-workflow` skill already has the correct phase routing table (confirmed during research):

```markdown
| Addressing Comments     | `review-cycle`       |
```

And the status values reference table includes both:

```markdown
| PR Created           | MR/PR created, awaiting review (remote mode)    |
| Addressing Comments  | Addressing MR/PR review comments (remote mode)  |
```

**Verification:**

```bash
grep -c "review-cycle" skills/ticket-stage-workflow/SKILL.md
# Expected: > 0

grep "Addressing Comments" skills/ticket-stage-workflow/SKILL.md | head -3
# Expected: references in phase routing table and status table
```

No changes needed — the orchestrator skill already references `review-cycle` correctly from Stage 1C work.

---

### Task 5: Remove the Stage 3 Placeholder Note from phase-finalize

This is already handled in Task 1 (the full file replacement removes the old placeholder note). Verify it's gone:

**Verification:**

```bash
# The placeholder note should be gone
grep -c "ships in Stage 3" skills/phase-finalize/SKILL.md
# Expected: 0

# The "Note:" disclaimer should be gone
grep -c "For now, local mode only" skills/phase-finalize/SKILL.md
# Expected: 0
```

---

### Task 6: Final Cross-Cutting Verification

**Step 1: Verify terminology consistency across updated files**

```bash
# Both skills should reference the same status values
grep "PR Created" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md | wc -l
# Expected: > 2 (present in both files)

grep "Addressing Comments" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md | wc -l
# Expected: > 2 (present in both files)

# Both skills reference the same env vars
grep "WORKFLOW_REMOTE_MODE" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md | wc -l
# Expected: > 2

grep "WORKFLOW_GIT_PLATFORM" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md | wc -l
# Expected: > 2

grep "WORKFLOW_SLACK_WEBHOOK" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md | wc -l
# Expected: > 2
```

**Step 2: Verify pipeline config matches skill names exactly**

```bash
# Pipeline says skill name is "review-cycle" — verify skill directory matches
ls skills/review-cycle/SKILL.md
# Expected: file exists

# Pipeline says skill name is "phase-finalize" — verify skill directory matches
ls skills/phase-finalize/SKILL.md
# Expected: file exists
```

**Step 3: Verify no old terminology leaked in**

```bash
# Should NOT reference old skill names or terminology
grep -r "epic-stage-workflow\|epic-stage-setup\|phase-refinement" skills/phase-finalize/SKILL.md skills/review-cycle/SKILL.md
# Expected: no output

# Should NOT have hardcoded status values that don't match pipeline config
grep "Complete\|PR Created\|Addressing Comments" tools/kanban-cli/config/default-pipeline.yaml
# Expected: all three status values present in pipeline config (confirming they match)
```

**Step 4: Verify kanban-cli tests still pass (skill changes should not affect TypeScript tests)**

```bash
cd tools/kanban-cli && npm run verify
# Expected: all tests pass
```

---

### Completion Checklist

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Update phase-finalize with full remote mode | `skills/phase-finalize/SKILL.md` | Complete |
| 2 | Create review-cycle skill | `skills/review-cycle/SKILL.md` | Complete |
| 3 | Verify pipeline config references | `tools/kanban-cli/config/default-pipeline.yaml` | Complete |
| 4 | Verify skill registry cross-references | `skills/ticket-stage-workflow/SKILL.md` | Complete |
| 5 | Verify Stage 3 placeholder removed | `skills/phase-finalize/SKILL.md` | Complete |
| 6 | Final cross-cutting verification | All files | Complete |
