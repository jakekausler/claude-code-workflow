---
title: "Slack integration test plan"
phase: 10
labels: [testing]
depends_on: [006]
---

# Slack Integration Test Plan

End-to-end testing with a real Slack channel to validate notification webhooks.

## Test Checklist

- [ ] Ping sent when user input is needed (Claude session paused)
- [ ] Ping sent when MR/PR is created
- [ ] Ping sent when MR comments are addressed
- [ ] Messages have correct formatting (markdown, links, metadata)
- [ ] Messages target the correct channel
- [ ] No duplicate notifications for the same event
- [ ] Notification content includes enough context to act on (stage name, repo, link)
