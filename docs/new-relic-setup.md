# New Relic Setup

This document covers how to enable New Relic APM and Browser monitoring for the `claude-code-workflow` web-server.

## Required environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEW_RELIC_LICENSE_KEY` | Yes (to enable) | _(empty)_ | Your New Relic ingest license key. Leave blank to disable the agent entirely. |
| `NEW_RELIC_APP_NAME` | No | `claude-code-workflow` | Application name shown in the New Relic UI. |

Copy `.env.example` and fill in your license key:

```sh
cp .env.example .env
# then set NEW_RELIC_LICENSE_KEY=<your key>
```

## How to enable / disable

The agent is **enabled** when `NEW_RELIC_LICENSE_KEY` is set to a non-empty string. It is disabled (no-op) when the variable is absent or empty. This is controlled in `tools/web-server/newrelic.js`:

```js
agent_enabled: !!(process.env.NEW_RELIC_LICENSE_KEY),
```

No code changes are needed to toggle monitoring — just set or unset the environment variable.

## Browser agent (frontend)

A placeholder comment in `tools/web-server/index.html` marks where the New Relic Browser snippet should be pasted:

```html
<!-- NEW RELIC BROWSER AGENT: Paste snippet from New Relic One > Browser > App > Settings > JavaScript snippet -->
```

To enable browser monitoring:
1. Open **New Relic One → Browser → Add data** and create a Browser application.
2. Copy the generated JavaScript snippet.
3. Replace the comment in `index.html` with the snippet (keep it as the first child of `<head>`).

## Custom events reference

### `SessionLifecycle`

Emitted at session state transitions in `src/server/app.ts` via `recordSessionLifecycle()`.

| Attribute | Type | Values |
|---|---|---|
| `event` | string | `start`, `pause`, `resume`, `complete`, `crash` |
| `sessionId` | string | Claude session ID |
| `stageId` | string | Kanban stage ID |

Example NRQL:
```sql
SELECT count(*) FROM SessionLifecycle FACET event TIMESERIES AUTO
```

Alert suggestion: session `crash` rate > 5% over 5 minutes.

### `SSEConnection`

Emitted when a browser connects to or disconnects from the `/api/events` SSE endpoint in `src/server/routes/events.ts` via `recordSSEConnection()`.

| Attribute | Type | Values |
|---|---|---|
| `event` | string | `connect`, `drop`, `reconnect` |

Example NRQL:
```sql
SELECT count(*) FROM SSEConnection FACET event TIMESERIES AUTO
```

Alert suggestion: `drop` count > 50 per minute.

### API segments (`withApiSegment`)

External API calls (Jira, GitHub, GitLab) can be wrapped with `withApiSegment(name, fn)` from `src/server/services/newrelic-instrumentation.ts`. Segments appear in distributed traces and transaction breakdowns.

Example usage:
```ts
import { withApiSegment } from '../services/newrelic-instrumentation.js';

const result = await withApiSegment('JiraAPI:createIssue', () =>
  jiraClient.createIssue(payload)
);
```

Segment name convention: `<Service>:<method>`, e.g. `JiraAPI:getIssue`, `GitHubAPI:listPRs`.

## Recommended NRQL alerts

```sql
-- Session crash rate
SELECT percentage(count(*), WHERE event = 'crash') FROM SessionLifecycle
WHERE event IN ('start', 'crash') SINCE 5 minutes ago

-- SSE drop rate
SELECT count(*) FROM SSEConnection WHERE event = 'drop' SINCE 1 minute ago

-- API error rate (requires New Relic APM errors inbox)
SELECT count(*) FROM TransactionError FACET request.uri TIMESERIES AUTO
```

## Recommended dashboard queries

```sql
-- Active sessions over time
SELECT count(*) FROM SessionLifecycle WHERE event = 'start' TIMESERIES AUTO

-- SSE connection health
SELECT count(*) FROM SSEConnection FACET event TIMESERIES AUTO

-- Top slowest API segments
SELECT average(duration) FROM Span WHERE name LIKE '%API:%' FACET name LIMIT 20

-- Web transaction throughput
SELECT rate(count(*), 1 minute) FROM Transaction FACET request.uri TIMESERIES AUTO
```
