---
title: "Permissions gating on create/import/convert flows"
phase: 15
labels: [hosted, security, ui]
depends_on: [024, 025, 014, 015, 013, 033]
---

# Permissions Gating

Apply RBAC permissions to all create, import, and convert flows across the application.

## Flows to Gate

### Epic/Ticket Creation (from issue #014)
- Only users with Developer or Admin role on the repo can create epics/tickets
- Viewers see read-only board with no creation buttons

### Jira Import (from issue #013)
- Only Admins can configure Jira connections and filters
- Developers can trigger manual imports within configured repos
- Viewers cannot import

### GitHub/GitLab Import (from issue #033)
- Only Admins can configure GitHub/GitLab connections
- Developers can trigger imports within repos they have access to
- Viewers cannot import

### Ticket-to-Stage Conversion (from issue #015)
- Only Developers and Admins can trigger conversion sessions
- Viewers cannot convert tickets

### Settings (from issue #031)
- Service connections: Admin only
- User preferences: Any authenticated user
- Team management: Global Admin or per-repo Admin

## Implementation

### API Layer
- Middleware that extracts user role from JWT context
- Per-route permission checks (or decorator-based)
- Return 403 with descriptive message for unauthorized operations

### UI Layer
- Hide action buttons for unauthorized users (don't just disable — hide)
- Show appropriate empty states ("You don't have permission to...")
- Role-aware navigation (admin sections hidden for non-admins)

## Technical Notes

- Must work with the RBAC system from issue #024
- Permission checks should be efficient (cached role lookups)
- Consider a permission helper: `can(user, 'create:ticket', repo)` pattern
