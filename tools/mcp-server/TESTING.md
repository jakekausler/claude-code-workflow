# mcp-server — Test Environment Variables

These environment variables control how tests (and the server) interact with external integrations.

## `KANBAN_MOCK=true`

Activates mock mode. All MCP tools (Jira, Slack, Git, Confluence, Enrich) read from and write to
an in-memory `MockState` instead of making real API calls.

Use this when running the full test suite locally or in CI.

```bash
KANBAN_MOCK=true npm test
```

## `DISABLE_JIRA=true`

Skips real Jira API calls even when the server is configured with live Jira credentials.
Each Jira handler returns a success result with the message `"Jira operation skipped: DISABLE_JIRA is set"`
instead of making a network request.

Intended for test environments where Jira credentials are present in the environment but live
calls are undesirable (e.g. integration tests running against a shared staging account).

Takes effect only in real mode (i.e. when `KANBAN_MOCK` is **not** set to `true`).

## `DISABLE_SLACK=true`

Skips real Slack webhook HTTP calls even when a `webhookUrl` is configured.
The handler returns a success result with the message `"Slack notification skipped: DISABLE_SLACK is set"`
instead of POSTing to the webhook.

Same intent as `DISABLE_JIRA`: use when Slack credentials exist but live delivery is unwanted.

Takes effect only in real mode (i.e. when `KANBAN_MOCK` is **not** set to `true`).

## Summary

| Variable        | Scope      | Effect                                         |
|-----------------|------------|------------------------------------------------|
| `KANBAN_MOCK`   | All tools  | Full mock mode — use `MockState`, no real calls|
| `DISABLE_JIRA`  | Jira tools | Skip real Jira API calls, return success       |
| `DISABLE_SLACK` | Slack tool | Skip real Slack webhook POST, return success   |
