#!/usr/bin/env bash
set -euo pipefail

# git-teardown.sh — Clean up GitHub PR/branch and GitLab MR/branch created by seed scripts.
#
# Reads state from:
#   .github-seed-state.json  (written by github-seed.sh)
#   .gitlab-seed-state.json  (written by gitlab-seed.sh)
#
# Required env vars (same as seed scripts):
#   GH_TOKEN      — GitHub personal access token (required if GitHub state file exists)
#   GITLAB_TOKEN  — GitLab personal access token (required if GitLab state file exists)
#
# Usage:
#   GH_TOKEN=... GITLAB_TOKEN=... bash scripts/test-setup/git-teardown.sh

GITHUB_STATE="$(pwd)/.github-seed-state.json"
GITLAB_STATE="$(pwd)/.gitlab-seed-state.json"
ERRORS=0

echo "==> Starting git integration test teardown..."

# ── GitHub teardown ───────────────────────────────────────────────────────────

if [[ -f "$GITHUB_STATE" ]]; then
  echo "==> Reading GitHub state from $GITHUB_STATE"

  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "WARN: GH_TOKEN not set — skipping GitHub teardown" >&2
    ERRORS=$((ERRORS + 1))
  else
    export GITHUB_TOKEN="$GH_TOKEN"

    GH_REPO="$(python3 -c "import json,sys; print(json.load(open('$GITHUB_STATE'))['repo'])")"
    GH_BRANCH="$(python3 -c "import json,sys; print(json.load(open('$GITHUB_STATE'))['branch'])")"
    GH_PR="$(python3 -c "import json,sys; print(json.load(open('$GITHUB_STATE'))['prNumber'])")"

    echo "    Repo:   $GH_REPO"
    echo "    PR:     #$GH_PR"
    echo "    Branch: $GH_BRANCH"

    echo "==> Closing GitHub PR #$GH_PR..."
    if gh pr close "$GH_PR" --repo "$GH_REPO" 2>/dev/null; then
      echo "    PR closed"
    else
      echo "    WARN: PR may already be closed or not found" >&2
    fi

    echo "==> Deleting GitHub branch $GH_BRANCH..."
    if gh api "repos/$GH_REPO/git/refs/heads/$GH_BRANCH" -X DELETE --silent 2>/dev/null; then
      echo "    Branch deleted"
    else
      echo "    WARN: Branch may already be deleted or not found" >&2
    fi

    rm -f "$GITHUB_STATE"
    echo "==> GitHub teardown complete"
  fi
else
  echo "INFO: No GitHub state file found at $GITHUB_STATE — skipping"
fi

# ── GitLab teardown ───────────────────────────────────────────────────────────

if [[ -f "$GITLAB_STATE" ]]; then
  echo "==> Reading GitLab state from $GITLAB_STATE"

  if [[ -z "${GITLAB_TOKEN:-}" ]]; then
    echo "WARN: GITLAB_TOKEN not set — skipping GitLab teardown" >&2
    ERRORS=$((ERRORS + 1))
  else
    export GITLAB_TOKEN="$GITLAB_TOKEN"

    GL_HOST="$(python3 -c "import json,sys; print(json.load(open('$GITLAB_STATE'))['host'])")"
    GL_ENCODED_REPO="$(python3 -c "import json,sys; print(json.load(open('$GITLAB_STATE'))['encodedRepo'])")"
    GL_BRANCH="$(python3 -c "import json,sys; print(json.load(open('$GITLAB_STATE'))['branch'])")"
    GL_MR_IID="$(python3 -c "import json,sys; print(json.load(open('$GITLAB_STATE'))['mrIid'])")"

    echo "    Host:   $GL_HOST"
    echo "    MR:     !$GL_MR_IID"
    echo "    Branch: $GL_BRANCH"

    echo "==> Closing GitLab MR !$GL_MR_IID..."
    if GITLAB_HOST="$GL_HOST" glab api "projects/$GL_ENCODED_REPO/merge_requests/$GL_MR_IID" \
      -X PUT -f "state_event=close" 2>/dev/null; then
      echo "    MR closed"
    else
      echo "    WARN: MR may already be closed or not found" >&2
    fi

    echo "==> Deleting GitLab branch $GL_BRANCH..."
    ENCODED_BRANCH="${GL_BRANCH//\//%2F}"
    if GITLAB_HOST="$GL_HOST" glab api "projects/$GL_ENCODED_REPO/repository/branches/$ENCODED_BRANCH" \
      -X DELETE 2>/dev/null; then
      echo "    Branch deleted"
    else
      echo "    WARN: Branch may already be deleted or not found" >&2
    fi

    rm -f "$GITLAB_STATE"
    echo "==> GitLab teardown complete"
  fi
else
  echo "INFO: No GitLab state file found at $GITLAB_STATE — skipping"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo "Teardown completed with $ERRORS warning(s). Check output above for details." >&2
  exit 1
fi

echo "Teardown complete."
