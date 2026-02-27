---
title: "Move checklist templates to YAML frontmatter"
phase: 11
labels: [feature, kanban-cli]
depends_on: []
---

# Move Checklist Templates to YAML Frontmatter

Migrate stage checklist templates and content from the markdown body to structured YAML frontmatter.

## Rationale

- Checklists in frontmatter become structured data queryable by the CLI and API
- When stage markdown body is rendered on the stage view (issue #016), checklists won't appear in the body (intentional — they're tracking data, not content)
- Enables programmatic checklist management by skills and the orchestrator

## Requirements

- Define checklist schema in frontmatter (template names, items, checked states)
- Migration script to move existing markdown checklists to frontmatter format
- Update kanban-cli parser to read checklists from frontmatter
- Update skills that write checklists to use frontmatter format
- Web UI renders checklists as read-only display from frontmatter data

## Example Frontmatter

```yaml
checklists:
  design:
    - text: "Research existing patterns"
      checked: true
    - text: "Propose 2-3 approaches"
      checked: false
  build:
    - text: "Write failing tests"
      checked: false
    - text: "Implement minimal code"
      checked: false
```

## Migration

- Update `frontmatter-schemas.ts` with checklist schema
- Create migration script to parse markdown checklists and convert to YAML
- Update the `seed-test-repo.sh` to include frontmatter checklists
