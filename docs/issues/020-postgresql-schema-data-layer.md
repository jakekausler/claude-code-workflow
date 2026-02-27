---
title: "PostgreSQL schema + data layer"
phase: 12
labels: [hosted, infrastructure]
depends_on: []
---

# PostgreSQL Schema + Data Layer

PostgreSQL database for hosted mode, alongside the existing SQLite for local mode.

## Schema

### Auth Tables (new)
- `users` — UUID PKs, email, OS username mapping to Unix accounts
- `auth_sessions` — Session tracking and revocation
- `oauth_accounts` — Multi-provider support (GitHub initially)
- `revoked_refresh_tokens` — Token theft detection

### Kanban Tables (migrated from SQLite)
- All existing kanban-cli tables: repos, epics, tickets, stages, dependencies, summaries, parent_branch_tracking, mr_comment_tracking, stage_sessions, ticket_sessions

## Requirements

- PostgreSQL schema creation scripts/migrations
- Dual DB support via DeploymentContext abstraction — SQLite for local, PostgreSQL for hosted
- Data layer that works with both databases (abstract over better-sqlite3 vs pg)
- Include DB migration as part of this issue (SQLite → PostgreSQL schema translation)

## Technical Notes

- The existing `DeploymentContext` interface in `types.ts` already defines the abstraction boundary
- Local mode continues using SQLite with no changes
- Hosted mode uses PostgreSQL with the same data access patterns
