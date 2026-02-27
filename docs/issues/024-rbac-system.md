---
title: "Role-based access control (RBAC)"
phase: 13
labels: [hosted, security]
depends_on: [019, 020]
---

# Role-Based Access Control (RBAC)

Per-repo roles with global admin override.

## Role Definitions

| Role | Scope | Permissions |
|------|-------|-------------|
| **Global Admin** | All repos | Full access everywhere. Can manage teams, users, system settings. |
| **Admin** | Per-repo | Full access within repo. Can manage team membership for that repo. |
| **Developer** | Per-repo | Read + write access to epics, tickets, stages. Can trigger sessions. |
| **Viewer** | Per-repo | Read-only access to all data within repo. Cannot modify or trigger. |

## Requirements

### Data Model
- `roles` table: user_id, repo_id (nullable for global), role_name
- A user can have different roles on different repos
- Global admin role has `repo_id = NULL`

### Access Enforcement
- Middleware that checks role before allowing write operations
- Read access scoped to repos where user has any role
- API endpoints return 403 for unauthorized operations
- UI hides/disables actions the user doesn't have permission for

### Assignment
- Global admins can assign any role to any user on any repo
- Per-repo admins can assign roles within their repo
- Self-service: users cannot elevate their own roles

## Technical Notes

- First user to register becomes global admin (bootstrap problem)
- Role checks must be efficient (cache or join on every request)
- Consider role inheritance: admin > developer > viewer
