---
title: "New Relic monitoring integration"
phase: 11
labels: [infrastructure, monitoring]
depends_on: []
---

# New Relic Monitoring Integration

Full-stack observability across all services.

## Instrumentation Scope

### Orchestrator
- Session lifecycle events (start, pause, resume, complete, crash)
- Crash rates and error classification
- Session duration metrics
- External service call latency and failures

### Web Server
- API response times per endpoint
- SSE connection health (active connections, drops, reconnects)
- Error rates by route
- Request throughput

### Frontend (Browser)
- Page load performance
- JavaScript errors and stack traces
- User interaction timing (drawer open, session load, board render)
- Long task detection

### External Service Monitoring
- Jira API call success/failure rates and latency
- GitHub/GitLab API call metrics
- Slack webhook delivery status

## Deliverables

- New Relic agent configuration for Node.js services (orchestrator, web-server)
- New Relic Browser agent integration for the React frontend
- Custom dashboards for key metrics
- Alert policies for critical failures (session crashes, API errors > threshold)
