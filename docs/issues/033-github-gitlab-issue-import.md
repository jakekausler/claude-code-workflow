---
title: "GitHub/GitLab issue import (on-demand + periodic sync)"
phase: 14
labels: [feature, ui, orchestrator]
depends_on: []
---

# GitHub/GitLab Issue Import

Import GitHub Issues and GitLab Issues as tickets, with both on-demand and periodic sync modes.

## On-Demand Import

### User Flow
1. User clicks "Import" and selects provider (GitHub or GitLab)
2. Browse/search repositories and issues
3. Select issues to import
4. Choose existing epic or create new one for association
5. Confirm import — tickets appear in to_convert column

### Requirements
- GitHub Issues API integration (list, search, get details)
- GitLab Issues API integration (list, search, get details)
- Preview issue details before importing (title, description, labels, assignee)
- Batch selection and import
- Duplicate detection (skip already-imported issues)
- Imported tickets get `source: github` or `source: gitlab`

## Periodic Sync

### Configuration
- Configure a repo connection with sync criteria (labels, milestones, assignees)
- System periodically checks for new issues matching criteria
- New issues auto-imported as tickets in to_convert column
- Sync interval configurable (e.g., every 15 minutes, hourly)

### Requirements
- Sync scheduler (similar to Jira auto-pull but for GitHub/GitLab)
- Filter criteria configuration per repo connection
- Sync status tracking (last sync time, items synced)
- Conflict handling (issue updated externally since last sync)

## Technical Notes

- This phase does NOT include permissions gating (Phase 15)
- Manual epic management for imported issues (no automatic epic mapping from GitHub/GitLab)
- Consider using `octokit` for GitHub and `@gitbeaker/rest` for GitLab
