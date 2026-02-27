---
title: "Jira ticket auto-pull filters"
phase: 11
labels: [feature, orchestrator]
depends_on: []
---

# Jira Ticket Auto-Pull Filters

Multi-dimensional filtering for controlling which Jira tickets are automatically pulled into the system.

## Filter Dimensions

- **Labels** — Only pull tickets with specific Jira labels (e.g., `claude-workflow`)
- **Status** — Filter by Jira status (e.g., only "To Do", "Ready for Dev")
- **Assignee** — Filter by assigned user
- **Custom fields** — Support arbitrary Jira custom field filters
- **AND/OR logic** — Config-driven combination of filter criteria

## Advanced: JQL Override

For power users, allow providing a raw JQL query string that overrides the multi-dimensional filters. This gives full flexibility for complex filtering needs.

## Configuration

Filters should be configurable via:
- Config file (local mode)
- Settings page (when available)

```yaml
jira:
  filters:
    labels: ["claude-workflow"]
    statuses: ["To Do", "Ready for Dev"]
    assignee: null  # any assignee
    custom_fields:
      priority: ["High", "Critical"]
    logic: "AND"  # AND | OR
  jql_override: null  # raw JQL, overrides above if set
```
