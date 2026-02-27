---
title: "Post-Stage 10 GitHub Issues & Testing Plan"
date: 2026-02-27
status: draft
---

# Post-Stage 10 GitHub Issues & Testing Plan

This document catalogs all planned work after stages 9 and 10 are complete, organized into phased milestones with GitHub issue drafts.

## Milestone Structure

| Phase | Focus | Issue Count |
|-------|-------|-------------|
| **Phase 10** | Testing (validate stages 9-10) | 7 issues |
| **Phase 11** | Infrastructure + Core Features | 7 issues |
| **Phase 12** | Hosted Deployment | 5 issues |
| **Phase 13** | Multi-User & RBAC | 2 issues |
| **Phase 14** | UI Enhancements + GitHub/GitLab Import | 8 issues |
| **Phase 15** | Permissions Gating | 1 issue |
| **Total** | | **30 issues** |

## Phase 10 — Testing

Validate the work from stages 9-10 with both mocked and real-service integration tests.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 001 | Mocked orchestrator integration test plan | testing | — |
| 002 | Jira integration test setup | testing, infrastructure | — |
| 003 | Jira integration test plan | testing | 002 |
| 004 | Git integration test setup | testing, infrastructure | — |
| 005 | Git/MR integration test plan | testing | 004 |
| 006 | Slack integration test setup | testing, infrastructure | — |
| 007 | Slack integration test plan | testing | 006 |

## Phase 11 — Infrastructure + Core Features

Foundation work (CI, monitoring, docs) plus Jira import, epic/ticket creation, and stage view improvements. No permissions required.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 008 | GitHub Actions CI pipeline | infrastructure, ci | — |
| 009 | New Relic monitoring integration | infrastructure, monitoring | — |
| 010 | Credits and attribution | documentation | — |
| 011 | User setup and usage guide | documentation | — |
| 012 | Jira ticket auto-pull filters | feature, orchestrator | — |
| 013 | Jira epic and ticket import UI flow | feature, ui | — |
| 014 | UI-based epic and ticket creation | feature, ui | — |
| 015 | Ticket-to-stage conversion session UI | feature, ui | 014 |
| 016 | Stage view: markdown content + frontmatter metadata | feature, ui | — |
| 017 | Move checklist templates to YAML frontmatter | feature, kanban-cli | — |
| 018 | Phase sibling content rendering | feature, ui | 016 |

## Phase 12 — Hosted Deployment

Authentication, PostgreSQL, scoped filesystem, per-user SSE, and Docker deployment.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 019 | GitHub OAuth + JWT authentication | hosted, security | — |
| 020 | PostgreSQL schema + data layer | hosted, infrastructure | — |
| 021 | ScopedFileSystemProvider | hosted, security | 019 |
| 022 | UserScopedSSE event broadcaster | hosted, infrastructure | 019 |
| 023 | Docker deployment configuration | hosted, infrastructure | 019, 020, 021, 022 |

## Phase 13 — Multi-User & RBAC

Role-based access control and team management.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 024 | Role-based access control (RBAC) | hosted, security | 019, 020 |
| 025 | Team management | hosted, ui | 024 |

## Phase 14 — UI Enhancements + GitHub/GitLab Import

Visual improvements, new pages, performance optimization, and GitHub/GitLab integration.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 026 | Improved dependency graph page | feature, ui | — |
| 027 | MR/branch hierarchy view | feature, ui | — |
| 028 | Tool renderer audit + enrichment | enhancement, ui | — |
| 029 | Long-session rendering performance | enhancement, ui, performance | — |
| 030 | Mobile responsiveness improvements | enhancement, ui | — |
| 031 | Settings page | feature, ui | — |
| 032 | Global search and filter | feature, ui | — |
| 033 | GitHub/GitLab issue import | feature, ui, orchestrator | — |

## Phase 15 — Permissions Gating

Apply RBAC to all create/import/convert flows.

| Issue | Title | Labels | Depends On |
|-------|-------|--------|------------|
| 034 | Permissions gating on create/import/convert flows | hosted, security, ui | 024, 025, 014, 015, 013, 033 |

## Labels

The following labels should be created on the GitHub repository:

- `feature` — New functionality
- `enhancement` — Improvement to existing functionality
- `testing` — Test plans and test infrastructure
- `infrastructure` — CI, monitoring, deployment infrastructure
- `hosted` — Hosted deployment specific
- `security` — Authentication, authorization, access control
- `documentation` — Docs, guides, attribution
- `ui` — Web UI changes
- `orchestrator` — Orchestrator service changes
- `kanban-cli` — CLI tool changes
- `ci` — CI/CD pipeline
- `monitoring` — Observability and monitoring
- `performance` — Performance optimization

## Issue Files

All issue drafts are stored in `docs/issues/` as markdown files with YAML frontmatter containing phase, labels, and dependency metadata. When ready to push to GitHub, these can be batch-created using `gh issue create`.
