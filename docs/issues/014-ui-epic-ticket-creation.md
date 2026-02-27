---
title: "UI-based epic and ticket creation"
phase: 11
labels: [feature, ui]
depends_on: []
---

# UI-Based Epic and Ticket Creation

Create non-Jira epics and tickets directly from the web UI.

## Requirements

### Epic Creation
- Create new epics with title, status, and optional description
- Generate proper epic ID and directory structure (`epics/EPIC-XXX/EPIC-XXX.md`)
- Epic appears on the board immediately after creation

### Ticket Creation
- Create tickets associated with an existing epic
- Required fields: title, status, epic association
- Optional fields: description, depends_on
- Generate proper ticket ID and directory structure (`epics/EPIC-XXX/TICKET-XXX-YYY/TICKET-XXX-YYY.md`)
- Ticket appears in the to_convert column (no stages yet)

### When Importing Issues
- Allow selecting an existing epic to associate with
- Allow creating a new epic inline during the import flow

## Technical Notes

- Must write valid YAML frontmatter matching `ticketFrontmatterSchema` and `epicFrontmatterSchema`
- Currently, tickets REQUIRE an epic in frontmatter (`epic` field is required in the Zod schema)
- Creating tickets without epics would require a schema change — defer to a future decision
- This phase does NOT include permissions gating (Phase 15)
