---
title: "Global search and filter"
phase: 14
labels: [feature, ui]
depends_on: []
---

# Global Search and Filter

Cross-entity search across epics, tickets, stages, and sessions.

## Requirements

### Search
- Search bar in the top navigation or sidebar
- Searches across entity titles, descriptions, and optionally session content
- Results grouped by entity type (epics, tickets, stages, sessions)
- Results show title, status, and parent context (e.g., "Stage X in Ticket Y in Epic Z")
- Click result to navigate to detail view or open drawer

### Filters
- Filter by entity type (epic, ticket, stage)
- Filter by status (Not Started, In Progress, Complete, etc.)
- Filter by date range (created, last modified)
- Filter by labels/tags (if applicable)
- Filters persist across navigation (URL-encoded or store-based)

### Implementation Options
- Client-side filtering for smaller datasets (< 1000 items)
- Server-side search endpoint for larger datasets or session content search
- Consider full-text search (SQLite FTS5 for local, PostgreSQL tsvector for hosted)

## Technical Notes

- Keyboard shortcut for quick search (e.g., Cmd+K / Ctrl+K)
- Debounced input to avoid excessive API calls
- Recent searches history (local storage)
