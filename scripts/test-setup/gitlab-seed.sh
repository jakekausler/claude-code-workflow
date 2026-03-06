#!/usr/bin/env bash
set -euo pipefail

# gitlab-seed.sh — Create test GitLab branch, MR, and review comment for integration testing.
#
# Creates:
#   - 1 test branch with a committed placeholder file
#   - 1 merge request targeting the default branch
#   - 1 discussion comment on the MR
#
# Outputs MR IID and branch name to stdout and writes them to
# .gitlab-seed-state.json in the current working directory for use
# by git-teardown.sh.
#
# Required env vars:
#   GITLAB_TOKEN     — GitLab personal access token with api scope
#   GITLAB_TEST_REPO — Target project in namespace/project format (e.g. mygroup/myrepo)
#
# Optional env vars:
#   GITLAB_HOST      — GitLab hostname (default: gitlab.com)
#
# Usage:
#   GITLAB_TOKEN=... GITLAB_TEST_REPO=group/project bash scripts/test-setup/gitlab-seed.sh

# ── Validate env vars ─────────────────────────────────────────────────────────

REQUIRED_VARS=(GITLAB_TOKEN GITLAB_TEST_REPO)
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set" >&2
    exit 1
  fi
done

# ── Configuration ─────────────────────────────────────────────────────────────

export GITLAB_TOKEN="$GITLAB_TOKEN"
GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"
REPO="$GITLAB_TEST_REPO"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BRANCH_NAME="test/claude-code-workflow-integration-${TIMESTAMP}"
STATE_FILE="$(pwd)/.gitlab-seed-state.json"

# URL-encode the project path (replace / with %2F)
ENCODED_REPO="${REPO//\//%2F}"

echo "==> Starting GitLab seed for project: $REPO on $GITLAB_HOST"

# ── Resolve default branch ────────────────────────────────────────────────────

echo "==> Resolving default branch..."
DEFAULT_BRANCH="$(GITLAB_HOST="$GITLAB_HOST" glab api "projects/$ENCODED_REPO" --field . | python3 -c "import json,sys; print(json.load(sys.stdin)['default_branch'])")"
echo "    Default branch: $DEFAULT_BRANCH"

# ── Create test branch ────────────────────────────────────────────────────────

echo "==> Creating test branch: $BRANCH_NAME"
GITLAB_HOST="$GITLAB_HOST" glab api "projects/$ENCODED_REPO/repository/branches" \
  -X POST \
  -f "branch=$BRANCH_NAME" \
  -f "ref=$DEFAULT_BRANCH"
echo "    Branch created"

# ── Create a test commit ──────────────────────────────────────────────────────

echo "==> Creating test commit on $BRANCH_NAME..."
FILE_PATH="test-integration-${TIMESTAMP}.txt"
GITLAB_HOST="$GITLAB_HOST" glab api "projects/$ENCODED_REPO/repository/files/$FILE_PATH" \
  -X POST \
  -f "branch=$BRANCH_NAME" \
  -f "content=Integration test file created by claude-code-workflow gitlab-seed.sh at $TIMESTAMP" \
  -f "commit_message=test: add integration test file ($TIMESTAMP)" \
  -f "encoding=text"
echo "    File committed: $FILE_PATH"

# ── Open MR ───────────────────────────────────────────────────────────────────

echo "==> Opening merge request..."
MR_IID="$(GITLAB_HOST="$GITLAB_HOST" glab api "projects/$ENCODED_REPO/merge_requests" \
  -X POST \
  -f "source_branch=$BRANCH_NAME" \
  -f "target_branch=$DEFAULT_BRANCH" \
  -f "title=test: claude-code-workflow integration test MR ($TIMESTAMP)" \
  -f "description=This MR was created automatically by the claude-code-workflow integration test suite (gitlab-seed.sh). It can be safely closed." | python3 -c "import json,sys; print(json.load(sys.stdin)['iid'])")"
echo "    MR !$MR_IID created"

# ── Add review comment (discussion) ──────────────────────────────────────────

echo "==> Adding review comment to MR !$MR_IID..."
GITLAB_HOST="$GITLAB_HOST" glab api "projects/$ENCODED_REPO/merge_requests/$MR_IID/notes" \
  -X POST \
  -f "body=Integration test review comment from claude-code-workflow gitlab-seed.sh"
echo "    Review comment added"

# ── Write state file ──────────────────────────────────────────────────────────

echo "==> Writing state file to $STATE_FILE..."
cat > "$STATE_FILE" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$GITLAB_HOST",
  "repo": "$REPO",
  "encodedRepo": "$ENCODED_REPO",
  "defaultBranch": "$DEFAULT_BRANCH",
  "branch": "$BRANCH_NAME",
  "mrIid": $MR_IID
}
EOF

echo ""
echo "Seed complete."
echo "Host:   $GITLAB_HOST"
echo "Repo:   $REPO"
echo "Branch: $BRANCH_NAME"
echo "MR:     !$MR_IID"
echo "State written to: $STATE_FILE"
