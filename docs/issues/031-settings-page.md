---
title: "Settings page"
phase: 14
labels: [feature, ui]
depends_on: []
---

# Settings Page

Full settings page for managing service connections and user preferences.

## Service Connections (Hosted Mode: UI-managed / Local Mode: config file fallback)

### Jira
- Jira instance URL
- Authentication credentials (API token)
- Default project key
- Auto-pull filter configuration (see issue #012)

### GitHub
- GitHub token or OAuth connection
- Default organization/owner
- Repository selection

### GitLab
- GitLab instance URL (self-hosted or gitlab.com)
- Access token
- Default group/project

### Slack
- Webhook URL
- Default channel
- Notification preferences (which events trigger notifications)

## User Preferences

- Theme (light/dark/system)
- Default board view (epic pipeline, ticket pipeline, stage pipeline)
- Session viewer defaults (auto-expand tools, show context panel)
- Display density (compact/comfortable)

## Technical Notes

- Hosted mode: settings stored in PostgreSQL per user
- Local mode: settings stored in config file (e.g., `~/.claude-workflow/settings.json`)
- Settings API endpoints with proper auth in hosted mode
- Settings page accessible from sidebar navigation
