---
title: "Jira epic and ticket import UI flow"
phase: 11
labels: [feature, ui]
depends_on: []
---

# Jira Epic and Ticket Import UI Flow

UI-based flow for manually importing epics and tickets from Jira, beyond the automatic auto-pull.

## User Flow

1. User clicks "Import from Jira" in the web UI
2. Browse/search Jira projects and tickets
3. Select which epics and/or tickets to import
4. Map Jira epics to internal epics (or create new ones)
5. Confirm and import — tickets appear in the to_convert column

## Requirements

- Browse Jira projects available to the configured connection
- Search/filter tickets within a project
- Preview ticket details before importing (title, description, status, links)
- Batch import support (select multiple tickets)
- Show import progress and results
- Handle duplicates (skip already-imported tickets, identified by jira_key)

## Notes

- This phase does NOT include permissions gating (Phase 15)
- Uses the existing Jira connection configuration
- Imported tickets get `source: jira` and their `jira_key` set
