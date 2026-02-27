---
title: "Jira integration test plan"
phase: 10
labels: [testing]
depends_on: [002]
---

# Jira Integration Test Plan

End-to-end testing with a real Jira instance to validate the full Jira integration pipeline.

## Test Checklist

- [ ] Jira tickets are pulled in if they are in the configured project and have correct settings (label, status, etc.)
- [ ] Pulled Jira tickets appear in the to_convert column
- [ ] Conversion session gets all linked info from the ticket (comments, attachments, Confluence links, issue links)
- [ ] Tickets on Jira move through In Progress as stages begin
- [ ] Tickets on Jira move to Testing as stages reach refinement
- [ ] Tickets on Jira move to Done as all stages complete
- [ ] Tickets that don't match filter criteria are NOT pulled in
- [ ] Changes to Jira tickets (new comments, status changes) are detected on subsequent syncs
