---
title: "User setup and usage guide"
phase: 11
labels: [documentation]
depends_on: []
---

# User Setup and Usage Guide

End-user documentation for installing, configuring, and using the system.

## Sections

### Installation
- Prerequisites (Node.js, npm, etc.)
- Clone and build instructions for each tool
- Quick start for local mode

### Configuration
- Local mode setup (config files, environment variables)
- Jira connection configuration
- GitHub/GitLab connection configuration
- Slack webhook configuration
- Orchestrator configuration (cron schedules, session limits)

### Web UI Usage
- Dashboard overview
- Kanban board (epic, ticket, stage pipelines)
- Detail drawers (stage, ticket, epic)
- Session viewer (navigating chunks, tool calls, subagent trees)
- Dependency graph

### CLI Reference
- kanban-cli commands (sync, board, next, graph, validate, migrate)
- MCP server usage with Claude Code

### Orchestrator Guide
- How the orchestrator manages sessions
- Phase lifecycle (Design → Build → Refinement → Finalize)
- Dependency resolution and stage unlocking
