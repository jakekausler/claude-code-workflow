---
title: "Git integration test setup"
phase: 10
labels: [testing, infrastructure]
depends_on: []
---

# Git Integration Test Setup

Create scriptable test Git repositories on both GitHub and GitLab for repeatable integration testing.

## Requirements

- Create test repositories on GitHub and GitLab (or use existing breakable ones)
- Seed script to create branches, PRs/MRs with review comments, CI status
- Configure branch protection rules matching production expectations
- Teardown script to clean up branches, PRs/MRs, and any test artifacts
- Both GitHub and GitLab must be covered

## Deliverables

- `scripts/test-setup/github-seed.sh` — creates test repo state on GitHub
- `scripts/test-setup/gitlab-seed.sh` — creates test repo state on GitLab
- `scripts/test-setup/git-teardown.sh` — cleans up both providers
- Documentation for required repository configuration
