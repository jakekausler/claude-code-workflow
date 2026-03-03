# Jira Integration Test Setup

Scripts for seeding and tearing down Jira test data used in integration tests.

## Required Environment Variables

| Variable        | Description                                      | Example                              |
| --------------- | ------------------------------------------------ | ------------------------------------ |
| `JIRA_BASE_URL` | Your Atlassian instance base URL                 | `https://yourorg.atlassian.net`      |
| `JIRA_EMAIL`    | Atlassian account email                          | `you@example.com`                    |
| `JIRA_TOKEN`    | [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) | `ATATTxxx...` |
| `JIRA_PROJECT`  | Jira project key to create issues in             | `TEST`                               |

### Optional

| Variable               | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `JIRA_CONFLUENCE_URL`  | A Confluence page URL to attach as a remote link to the seeded epic |

## Seed

Creates one Epic with label `kanban-test`, three child tickets (To Do / In Progress / Done), and a comment on the first ticket.

```bash
npx ts-node scripts/test-setup/jira-seed.ts
```

Issue keys are printed to stdout and written to `.jira-seed-state.json` in the current directory.

## Teardown

Deletes all seeded issues. Reads keys from `.jira-seed-state.json` by default, or accepts keys as CLI arguments.

```bash
# Using state file written by seed script
npx ts-node scripts/test-setup/jira-teardown.ts

# Passing keys explicitly
npx ts-node scripts/test-setup/jira-teardown.ts PROJ-123 PROJ-124 PROJ-125
```

The state file (`.jira-seed-state.json`) is deleted after a successful teardown.

## Notes

- Both scripts use Basic Auth (`JIRA_EMAIL:JIRA_TOKEN` base64-encoded) against the Jira REST API v3.
- Deleting issues requires the "Delete Issues" project permission in Jira. If you see HTTP 403 errors during teardown, check your API token's permissions.
- Status transitions depend on your project's workflow. If a target status is unavailable, a warning is logged and the script continues.

## Git Integration Test Setup

Scripts for seeding and tearing down GitHub and GitLab test data used in integration tests.

### Required Environment Variables

#### GitHub

| Variable | Description | Example |
|---|---|---|
| `GH_TOKEN` | GitHub personal access token with `repo` scope | `ghp_xxx...` |
| `GH_TEST_REPO` | Target repository in `owner/repo` format | `myorg/myrepo` |

#### GitLab

| Variable | Description | Example |
|---|---|---|
| `GITLAB_TOKEN` | GitLab personal access token with `api` scope | `glpat-xxx...` |
| `GITLAB_TEST_REPO` | Target project in `namespace/project` format | `mygroup/myrepo` |
| `GITLAB_HOST` | GitLab hostname (optional, default: `gitlab.com`) | `gitlab.example.com` |

### Seed

Creates a test branch with a placeholder commit, opens a PR/MR, and adds a review comment.

```bash
# GitHub
GH_TOKEN=... GH_TEST_REPO=owner/repo bash scripts/test-setup/github-seed.sh

# GitLab
GITLAB_TOKEN=... GITLAB_TEST_REPO=group/project bash scripts/test-setup/gitlab-seed.sh
```

PR/MR number and branch name are printed to stdout and written to `.github-seed-state.json` / `.gitlab-seed-state.json` in the current directory.

### Teardown

Closes the PR/MR, deletes the test branch, and removes the state files.

```bash
GH_TOKEN=... GITLAB_TOKEN=... bash scripts/test-setup/git-teardown.sh
```

### Notes

- Scripts use the `gh` CLI (GitHub) and `glab` CLI (GitLab). Both must be installed and accessible in `PATH`.
- State files (`.github-seed-state.json`, `.gitlab-seed-state.json`) are written to the current working directory and deleted after a successful teardown.
- Scripts do not need to run against real repositories to be merged — they are validated with `bash -n` for syntax correctness.
