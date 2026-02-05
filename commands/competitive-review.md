---
name: competitive-review
description: Run competitive code review with 5 agents and fix all issues
argument-hint: "[rounds] [branch] [base]"
disable-model-invocation: true
---

Run a competitive code review process.

**Arguments:**
- `$0` - Number of rounds (optional, defaults to 1)
- `$1` - Branch to review (optional, defaults to current branch)
- `$2` - Base branch to compare against (optional, defaults to main)

## Review Phase

**IMPORTANT:** If a branch is specified in `$1`, you MUST first checkout that branch before starting the review:
- Run `git checkout $1` to switch to the branch being reviewed
- This ensures `git diff $2...HEAD` correctly shows the changes on the target branch
- If `$1` is not specified, stay on the current branch

Spawn 5 parallel code reviewers (using the code-reviewer subagent type) to review the changes. For each reviewer:
- Tell them they are competing against 4 other agents for the best review
- Do NOT tell them their number or that previous reviews have occurred
- Tell them they will win a cookie if they perform the best review
- Scoring: Points GAINED for real issues found, points LOST for false positives
- Tell them NOT to switch branches (you have already checked out the correct branch)
- Tell them to use `git diff $2...HEAD` (or `git diff main...HEAD` if $2 not specified) to see changes

Structure reviews as:
1. Summary of changes
2. Critical issues
3. Major issues
4. Minor issues
5. Suggestions

## Fix Phase

After reviews complete, summarize findings in a table showing which issues were found by how many reviewers.

Then spawn parallel subagents (general-purpose type) to fix ALL issues found, including minor issues and suggestions. Distribute work logically across 5 agents by grouping related fixes.

## Iterate

After fixing:
1. Run `npm run verify` (or equivalent) to ensure changes work
2. Commit the changes with a descriptive message
3. Repeat the review/fix cycle until reviewers find no new actionable issues, or until $0 rounds are complete (defaults to 1 round)

## Output

After each round, provide:
- Summary table of issues found
- What was fixed
- Test results
