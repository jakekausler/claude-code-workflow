---
title: "Mocked orchestrator integration test plan"
phase: 10
labels: [testing]
depends_on: []
---

# Mocked Orchestrator Integration Test Plan

Run the orchestrator with mocked MCPs using the seed script (`tools/kanban-cli/scripts/seed-test-repo.sh`) and validate end-to-end behavior.

## Test Checklist

- [ ] Stages move from phase to phase correctly as the orchestrator processes them
- [ ] Users can respond when Claude stops, from the browser
- [ ] Logs indicate external services would have been called correctly
- [ ] Mocked comments are correctly responded to
- [ ] Session log is viewable and live-updated in the phase drawer
- [ ] Manual tickets are convertible in a session on the web UI board drawer
- [ ] Stages move through when dependencies are unlocked

## Setup

1. Run `bash tools/kanban-cli/scripts/seed-test-repo.sh` to create test repo at `/tmp/kanban-test-repo`
2. Configure orchestrator to use mocked MCP implementations
3. Start web server pointing at the test repo
4. Execute orchestrator and verify each checklist item via the web UI
