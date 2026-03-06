#!/usr/bin/env bash
set -euo pipefail

# github-seed.sh — Create test GitHub branch, PR, and review comment for integration testing.
#
# Creates:
#   - 1 test branch with a committed placeholder file
#   - 1 pull request targeting the default branch
#   - 1 inline review comment on the PR
#
# Outputs PR number and branch name to stdout and writes them to
# .github-seed-state.json in the current working directory for use
# by git-teardown.sh.
#
# Required env vars:
#   GH_TOKEN      — GitHub personal access token with repo scope
#   GH_TEST_REPO  — Target repository in owner/repo format (e.g. myorg/myrepo)
#
# Usage:
#   GH_TOKEN=... GH_TEST_REPO=owner/repo bash scripts/test-setup/github-seed.sh

# ── Validate env vars ─────────────────────────────────────────────────────────

REQUIRED_VARS=(GH_TOKEN GH_TEST_REPO)
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set" >&2
    exit 1
  fi
done

# ── Configuration ─────────────────────────────────────────────────────────────

export GITHUB_TOKEN="$GH_TOKEN"
REPO="$GH_TEST_REPO"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BRANCH_NAME="test/claude-code-workflow-integration-${TIMESTAMP}"
STATE_FILE="$(pwd)/.github-seed-state.json"

echo "==> Starting GitHub seed for repo: $REPO"

# ── Resolve default branch ────────────────────────────────────────────────────

echo "==> Resolving default branch..."
DEFAULT_BRANCH="$(gh api "repos/$REPO" --jq '.default_branch')"
echo "    Default branch: $DEFAULT_BRANCH"

# ── Get base SHA ──────────────────────────────────────────────────────────────

BASE_SHA="$(gh api "repos/$REPO/git/ref/heads/$DEFAULT_BRANCH" --jq '.object.sha')"
echo "    Base SHA: $BASE_SHA"

# ── Create test branch ────────────────────────────────────────────────────────

echo "==> Creating test branch: $BRANCH_NAME"
gh api "repos/$REPO/git/refs" \
  -X POST \
  -f "ref=refs/heads/$BRANCH_NAME" \
  -f "sha=$BASE_SHA" \
  --silent
echo "    Branch created"

# ── Create a file blob ───────────────────────────────────────────────────────

echo "==> Creating test commit on $BRANCH_NAME..."
BLOB_SHA="$(gh api "repos/$REPO/git/blobs" \
  -X POST \
  -f "content=Integration test file created by claude-code-workflow github-seed.sh at $TIMESTAMP" \
  -f "encoding=utf-8" \
  --jq '.sha')"

TREE_SHA="$(gh api "repos/$REPO/git/trees" \
  -X POST \
  --raw-field "tree=[{\"path\":\"test-integration-$TIMESTAMP.txt\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"$BLOB_SHA\"}]" \
  -f "base_tree=$BASE_SHA" \
  --jq '.sha')"

COMMIT_SHA="$(gh api "repos/$REPO/git/commits" \
  -X POST \
  -f "message=test: add integration test file ($TIMESTAMP)" \
  -f "tree=$TREE_SHA" \
  --raw-field "parents=[\"$BASE_SHA\"]" \
  --jq '.sha')"

gh api "repos/$REPO/git/refs/heads/$BRANCH_NAME" \
  -X PATCH \
  -f "sha=$COMMIT_SHA" \
  --silent
echo "    Committed: $COMMIT_SHA"

# ── Open PR ───────────────────────────────────────────────────────────────────

echo "==> Opening pull request..."
PR_NUMBER="$(gh api "repos/$REPO/pulls" \
  -X POST \
  -f "title=test: claude-code-workflow integration test PR ($TIMESTAMP)" \
  -f "body=This PR was created automatically by the claude-code-workflow integration test suite (github-seed.sh). It can be safely closed." \
  -f "head=$BRANCH_NAME" \
  -f "base=$DEFAULT_BRANCH" \
  --jq '.number')"
echo "    PR #$PR_NUMBER created"

# ── Add inline review comment ─────────────────────────────────────────────────

echo "==> Adding review comment to PR #$PR_NUMBER..."
gh api "repos/$REPO/pulls/$PR_NUMBER/comments" \
  -X POST \
  -f "body=Integration test review comment from claude-code-workflow github-seed.sh" \
  -f "commit_id=$COMMIT_SHA" \
  -f "path=test-integration-$TIMESTAMP.txt" \
  -F "line=1" \
  --silent
echo "    Review comment added"

# ── Write state file ──────────────────────────────────────────────────────────

echo "==> Writing state file to $STATE_FILE..."
cat > "$STATE_FILE" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo": "$REPO",
  "defaultBranch": "$DEFAULT_BRANCH",
  "branch": "$BRANCH_NAME",
  "commitSha": "$COMMIT_SHA",
  "prNumber": $PR_NUMBER
}
EOF

echo ""
echo "Seed complete."
echo "Repo:   $REPO"
echo "Branch: $BRANCH_NAME"
echo "PR:     #$PR_NUMBER"
echo "State written to: $STATE_FILE"
