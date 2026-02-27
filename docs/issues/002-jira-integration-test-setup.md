---
title: "Jira integration test setup"
phase: 10
labels: [testing, infrastructure]
depends_on: []
---

# Jira Integration Test Setup

Create a scriptable Jira test environment for repeatable integration testing.

## Requirements

- Create a dedicated Jira test project (or use an existing breakable one)
- Seed script to populate the board with tickets in various states, with labels, attachments, comments, Confluence links
- Configure labels and statuses that match the auto-pull filter criteria
- Teardown script to clean up all seeded data
- Document the expected Jira project configuration (custom fields, workflows, etc.)

## Deliverables

- `scripts/test-setup/jira-seed.ts` — creates test tickets with diverse metadata
- `scripts/test-setup/jira-teardown.ts` — removes all seeded data
- Documentation for required Jira project configuration
