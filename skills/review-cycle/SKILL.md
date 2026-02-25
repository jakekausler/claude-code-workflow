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

**Preferred:** Use the `mcp__kanban__pr_get` tool with the current branch name to retrieve the PR number and URL.

**Fallback (if MCP unavailable):**
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

   **Preferred:** Use the `mcp__kanban__pr_get_comments` tool:
   - pr_number: `<number>`
   This returns all review comments (general and inline) with path, line, body, id, and author information.

   **Fallback (if MCP unavailable):**

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

   **Preferred:** Use the `mcp__kanban__pr_add_comment` tool:
   - pr_number: `<number>`
   - body: the comment text (see template below)
   - comment_id: `<comment_id>` (if replying to a specific review thread; omit for a general comment)

   Use this tool once for the general summary comment and once per specific thread reply.

   **Fallback (if MCP unavailable):**

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

      **Per-repo webhook routing:** Before calling `slack_notify`, check if `~/.config/kanban-workflow/repos.yaml` exists. If it does, look up the current repo's entry by matching the repo path. If the entry has a `slack_webhook` field, pass it as `webhook_url` to `slack_notify` — this routes the notification to a repo-specific Slack channel instead of the global one.

      **Preferred:** Use the `mcp__kanban__slack_notify` tool:
      - message: `"Review Comments Addressed"`
      - webhook_url: `<repo slack_webhook from repos.yaml, if found>` (omit if not found)
      - stage: `STAGE-XXX-YYY-ZZZ`
      - title: `<stage title>`
      - round: `N`
      - comments_addressed: `M`
      - url: `<MR/PR URL>`

      **Fallback (if MCP unavailable):**
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
