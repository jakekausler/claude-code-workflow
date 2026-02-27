---
title: "Team management"
phase: 13
labels: [hosted, ui]
depends_on: [024]
---

# Team Management

Internal team CRUD in the web UI for managing user groups and repo access.

## Requirements

### Team Operations (Admin only)
- Create teams with name and description
- Add/remove members from teams
- Assign repo access with role level per team
- Delete teams (with confirmation)

### Team → Repo Access
- Teams get a role per repo (admin, developer, viewer)
- Individual user roles can override team roles (higher role wins)
- A user's effective role = max(individual role, team roles)

### UI
- Team management page (admin-only section)
- Team list with member counts and repo access summary
- Team detail view: members list, repo access matrix
- Inline member add/remove (search by username/email)
- Repo access assignment (dropdown per repo)

### API
- CRUD endpoints for teams
- Team membership endpoints (add/remove members)
- Team repo access endpoints (assign/revoke)

## Technical Notes

- Teams are internal to the application (no external provider sync)
- Global admins manage all teams; per-repo admins can see teams with access to their repos
- Consider pagination for teams with many members
