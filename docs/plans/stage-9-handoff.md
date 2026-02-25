# Stage 9 — Session Prompt

## Context

Stages 0-6E are complete on the `kanban` branch. Stage 7 (Slack Notifications) is in PR #2. Stage 8 (Global CLI + Multi-Repo) is in PR #3 (based on Stage 7). Stage 9 is the next stage and its scope should be determined through brainstorming.

### Dependency Graph

```
Stage 0 (Pipeline Config) ✅
  └── Stage 1 (Foundation + SQLite) ✅
        ├── Stage 2 (Migration) ✅
        ├── Stage 3 (Remote Mode) ✅
        ├── Stage 4 (Jira) ✅
        ├── Stage 5 (Auto-Design) ✅
        └── Stage 5.5A-5.5C ✅
              └── Stage 6A-6E ✅
                    ├── Stage 7 (Slack Notifications) 🔄 (PR #2)
                    │     └── Stage 8 (Global CLI + Multi-Repo) 🔄 (PR #3)
                    └── Stage 9 ← THIS STAGE
```

### What Has Been Built (Stages 0-8)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):

| Command | Description | Output Formats |
|---------|-------------|---------------|
| `board` | Kanban board view | JSON, `--html`, `--pretty`, `--global` |
| `graph` | Dependency graph | JSON, `--mermaid`, `--pretty`, `--global` |
| `next` | Priority-sorted ready stages | JSON, `--pretty`, `--global` |
| `validate` | Frontmatter + dependency integrity | JSON, `--pretty`, `--global` |
| `validate-pipeline` | Pipeline config validation (4 layers) | JSON, `--pretty` |
| `sync` | Re-parse files into SQLite | JSON, `--pretty` |
| `summary` | LLM-powered hierarchical summaries | JSON, `--pretty`, `--model`, `--no-cache`, `-q` |
| `migrate` | Old-format repo conversion | JSON, `--pretty`, `--dry-run` |
| `jira-import` | Import Jira issues as local epics/tickets | JSON, `--pretty`, `--epic` |
| `jira-sync` | Sync workflow state to Jira | JSON, `--pretty`, `--dry-run` |
| `learnings-count` | Count unanalyzed learnings entries | JSON, `--pretty`, `--threshold` |
| `enrich` | Fetch linked content for enriched brainstorming | JSON, `--pretty` |
| `register-repo` | Register a repo for multi-repo tracking | JSON, `--pretty` |
| `unregister-repo` | Unregister a repo | JSON, `--pretty` |
| `list-repos` | List all registered repos | JSON, `--pretty` |

All 15 commands support `--output/-o <file>` and `--repo <path>`.

**MCP Server** (`tools/mcp-server/`):
- `slack_notify` tool with per-repo `webhook_url` override

**Orchestrator** (`tools/orchestrator/`):
- Cron scheduler with exit gates, completion cascade, MR comment polling, insights threshold checker
- Single-repo execution model (one instance per repo)

**Test Suite:** 888 tests across 58 test files (kanban-cli). Total growing with each stage.

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

---

## Infrastructure Summary

### Database

- **Location**: `~/.config/kanban-workflow/kanban.db` (single SQLite file, all repos)
- **Schema**: `repos`, `epics`, `tickets`, `stages`, `dependencies`, `summaries`, `parent_branch_tracking`, `mr_comment_tracking` tables
- **Multi-repo**: All major tables reference `repos(id)` with proper scoping via `repo_id` foreign keys
- **Indexes**: Support multi-repo lookups (e.g., `idx_epics_jira_key ON epics(jira_key, repo_id)`)

### Config

- **Global config**: `~/.config/kanban-workflow/config.yaml`
- **Per-repo config**: `<repo>/.kanban-workflow.yaml`
- **Repo registry**: `~/.config/kanban-workflow/repos.yaml`
- **Merge behavior**: Repo phases REPLACE global, defaults MERGE

### Multi-Repo Support (Stage 8)

- **Shared SQLite database** across all registered repos
- **`repos.yaml` registry** with `register-repo`, `unregister-repo`, `list-repos` commands
- **Cross-repo dependency format**: `repo:<name>/ITEM-ID` in frontmatter `depends_on` fields
- **`--global` flag** on `board`, `next`, `graph`, `validate` commands for cross-repo aggregation
- **Cross-repo dependency resolution** via shared database lookups

### MCP Server

- Exposes CLI functionality as MCP tools for Claude Code integration
- `slack_notify` tool with per-repo webhook URL override

### Orchestrator

- Exit gates and resolvers for workflow phase transitions
- Completion cascade for automatic stage/ticket/epic promotion
- MR comment polling cron for GitLab integration
- Insights threshold cron for meta-analysis triggering
- Single-repo execution model (multiple instances for multiple repos)

---

## What Stage 9 Could Deliver

Stage 9 scope is **not yet defined**. The following areas represent natural next steps based on known limitations and the system's evolution. Use brainstorming to determine which area(s) to pursue.

### Potential Areas

1. **Orchestrator Multi-Repo Support** — The orchestrator currently runs as a single-repo instance. Multi-repo orchestration (watching multiple repos, coordinating cross-repo workflows) would complement Stage 8's CLI-level multi-repo support.

2. **Pipeline Config Merging for Global Mode** — Global mode currently uses the first repo's pipeline config. Merging workflow phases from all repos into a superset would give accurate column layout across heterogeneous repos.

3. **Cross-Repo MR Chain Management** — The existing MR chain and parent branch tracking systems work within a single repo. Extending them to handle cross-repo merge dependencies would complete the multi-repo story.

4. **Dashboard / Web UI** — A web-based dashboard for viewing the kanban board, dependency graph, and validation results. The existing `--html` board output and `--mermaid` graph output provide a foundation.

5. **Performance Optimization** — As repos grow, sync and query operations may need optimization. Incremental sync, caching strategies, and database indexing improvements could be explored.

6. **User-Facing Documentation** — Comprehensive user docs, tutorials, and a getting-started guide for the CLI tool and orchestrator.

---

## Instructions

Use the **brainstorming skill** to determine what Stage 9 should deliver. Do NOT use epic-stage-workflow. Use **subagent-driven development** for execution once the scope is defined.

### Process

1. **Brainstorm** — Use the brainstorming skill to evaluate potential areas and determine the scope for Stage 9
2. **Plan** — Break the chosen scope into sub-tasks (similar to the Stage 8 task breakdown)
3. **Execute** — Implement via subagent-driven development, verifying after each task

### Key Constraints

- The existing 888 kanban-cli tests must continue passing
- `npm run verify` must pass in `tools/kanban-cli` after every task
- If modifying the orchestrator, its tests must also pass
- All new functions must be testable via injected dependencies (DI pattern)
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The `KANBAN_MOCK=true` mode is available for integration testing
- Backward compatibility: existing command behavior must not change without `--global` or other explicit opt-in flags

### Testing the Current System

```bash
cd tools/kanban-cli && npm run verify
cd tools/orchestrator && npm run verify
```

---

## Next Steps After Stage 9

Depends on the scope chosen. Remaining potential areas from the list above that are not addressed in Stage 9 become candidates for future stages.
