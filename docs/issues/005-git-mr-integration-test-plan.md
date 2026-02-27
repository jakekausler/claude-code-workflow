---
title: "Git/MR integration test plan"
phase: 10
labels: [testing]
depends_on: [004]
---

# Git/MR Integration Test Plan

End-to-end testing with real GitHub and GitLab repositories to validate MR/PR lifecycle.

## Test Checklist

- [ ] Stages create MRs/PRs on the correct target branch
- [ ] Comments on MRs are pulled in by the orchestrator
- [ ] Comments are responded to and addressed (code changes made)
- [ ] Stage progress continues when dependencies in MR are resolved
- [ ] Works correctly with GitHub PRs
- [ ] Works correctly with GitLab MRs
- [ ] Branch hierarchy is maintained correctly (parent branch tracking)
- [ ] MR status updates are reflected on the kanban board
