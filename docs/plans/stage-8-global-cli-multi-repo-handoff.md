# Stage 8: Global CLI + Multi-Repo — Session Prompt

## Context

Stages 0-6E are complete on the `kanban` branch. Stage 7 (Slack Notifications) is in PR review. This session implements **Stage 8: Global CLI + Multi-Repo** — making the CLI and orchestrator work across multiple repositories with cross-repo dependency resolution.

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
                    ├── Stage 7 (Slack Notifications) 🔄 (PR review)
                    └── Stage 8 (Global CLI + Multi-Repo) ← THIS STAGE
```

### What Has Been Built (Stages 0-7)

**kanban-cli TypeScript CLI tool** (`tools/kanban-cli/`):

| Command | Description | Output Formats |
|---------|-------------|---------------|
| `board` | Kanban board view | JSON, `--html`, `--pretty` |
| `graph` | Dependency graph | JSON, `--mermaid`, `--pretty` |
| `next` | Priority-sorted ready stages | JSON, `--pretty` |
| `validate` | Frontmatter + dependency integrity | JSON, `--pretty` |
| `validate-pipeline` | Pipeline config validation (4 layers) | JSON, `--pretty` |
| `sync` | Re-parse files into SQLite | JSON, `--pretty` |
| `summary` | LLM-powered hierarchical summaries | JSON, `--pretty`, `--model`, `--no-cache`, `-q` |
| `migrate` | Old-format repo conversion | JSON, `--pretty`, `--dry-run` |
| `jira-import` | Import Jira issues as local epics/tickets | JSON, `--pretty`, `--epic` |
| `jira-sync` | Sync workflow state to Jira | JSON, `--pretty`, `--dry-run` |
| `learnings-count` | Count unanalyzed learnings entries | JSON, `--pretty`, `--threshold` |
| `enrich` | Fetch linked content for enriched brainstorming | JSON, `--pretty` |

All 12 commands support `--output/-o <file>` and `--repo <path>`.

**Test Suite:** 775 tests across 51 test files (kanban-cli), 396 tests across 25 test files (orchestrator). **Total: ~1,171 tests.**

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

---

## Multi-Repo Infrastructure Already Built

The database schema and repository layer were **designed for multi-repo from the start**. This is significant — Stage 8 builds on existing foundations rather than retrofitting.

### Database Schema (`tools/kanban-cli/src/db/schema.ts`)

**`repos` table** (lines 6-12):
```sql
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL
)
```

**All major tables reference `repos(id)`:**

| Table | Column | Purpose |
|-------|--------|---------|
| `epics` | `repo_id INTEGER REFERENCES repos(id)` | Which repo owns the epic |
| `tickets` | `repo_id INTEGER REFERENCES repos(id)` | Which repo owns the ticket |
| `stages` | `repo_id INTEGER REFERENCES repos(id)` | Which repo owns the stage |
| `dependencies` | `repo_id INTEGER REFERENCES repos(id)` | Dependencies scoped to repo |
| `summaries` | `repo_id INTEGER REFERENCES repos(id)` | Summaries scoped to repo |
| `parent_branch_tracking` | `repo_id INTEGER REFERENCES repos(id)` | MR parent branch tracking |
| `mr_comment_tracking` | `repo_id INTEGER REFERENCES repos(id)` | MR comment polling |

**Indexes** support multi-repo lookups:
```sql
CREATE INDEX idx_epics_jira_key ON epics(jira_key, repo_id)
CREATE INDEX idx_tickets_jira_key ON tickets(jira_key, repo_id)
```

### RepoRepository (`tools/kanban-cli/src/db/repositories/repo-repository.ts`)

```typescript
export class RepoRepository {
  upsert(repoPath: string, name: string): number    // Insert or update, returns id
  findByPath(repoPath: string): RepoRecord | null    // Lookup by filesystem path
  findById(id: number): RepoRecord | null            // Lookup by numeric id
}
```

**Current usage**: Repos are auto-registered during `syncRepo()`. Jira import explicitly calls `repoRepo.upsert()`.

**Missing methods for Stage 8**: `findAll()`, `findByName()`.

### Repository Query Scoping

All data repositories already scope queries by `repo_id`. Example from `epic-repository.ts`:
```typescript
findByJiraKey(repoId: number, jiraKey: string): EpicRecord | null {
  return this.db.raw()
    .prepare('SELECT * FROM epics WHERE jira_key = ? AND repo_id = ?')
    .get(jiraKey, repoId);
}
```

### Config Structure

- **Global config**: `~/.config/kanban-workflow/config.yaml`
- **Per-repo config**: `<repo>/.kanban-workflow.yaml`
- **Merge behavior**: Repo phases REPLACE global, defaults MERGE
- **SQLite database**: `~/.config/kanban-workflow/kanban.db` (single file, all repos)

---

## What Stage 8 Delivers

### Goal

CLI works across registered repos. Cross-repo dependencies resolve. Global board and next commands aggregate all repos.

### What Ships

1. **Repo registration system** — Config file listing participating repos, CLI commands to manage registrations
2. **Repo-to-ticket/stage association during conversion** — The `migrate` and `jira-import` commands must tag all created items with their owning repo. This likely means ensuring `syncRepo()` properly associates all parsed items with the repo's `repo_id` (verify this works correctly for multi-repo scenarios where two repos share the same SQLite database)
3. **`board --global`** — Kanban board aggregating stages from all registered repos, showing which repo each item belongs to
4. **`next --global`** — Priority-sorted ready stages across all repos, considering cross-repo dependencies
5. **Cross-repo dependency format** — Parse `repo:<repo-name>/STAGE-XXX-YYY-ZZZ` in frontmatter `depends_on` fields
6. **Cross-repo dependency resolution** — Look up foreign repo stages in the shared SQLite database, resolve completion status
7. **`graph --global`** — Dependency graph spanning all repos, cross-repo edges shown distinctly
8. **`validate --global`** — Validate cross-repo dependency references exist and are well-formed
9. **Repo management commands** — `register-repo`, `unregister-repo`, `list-repos`

### What Stage 8 Does NOT Include

- Changes to the orchestrator's single-repo execution model (each orchestrator instance watches one repo — multiple instances for multiple repos)
- Changes to the cron scheduler infrastructure
- Changes to exit gates, completion cascade, or MR chain management
- Changes to Slack notifications
- New skills or session spawning changes
- Changes to the MCP server

---

## Design Considerations

### Repo Registration

**Where does the repo list live?**

The global config at `~/.config/kanban-workflow/config.yaml` already exists and is loaded by the config loader. The simplest approach is to add a `repos` section:

```yaml
repos:
  - path: /home/user/projects/backend
    name: backend
  - path: /home/user/projects/frontend
    name: frontend
```

Alternatively, a separate `~/.config/kanban-workflow/repos.yaml` keeps concerns separated. The config loader (`tools/kanban-cli/src/config/loader.ts`) already defines `CONFIG_PATHS` and would need a new entry.

### Repo-Ticket Association During Conversion

**Key constraint from user**: Tickets and stages must note which repo they belong to. This should happen during initial conversion (migrate/sync).

Current state:
- `syncRepo()` already calls `repoRepo.upsert()` to register the repo and get a `repo_id`
- All `INSERT` statements for epics/tickets/stages already include `repo_id`
- **Verify**: When two repos share the same SQLite database and both call `syncRepo()`, do their items stay properly scoped? The `upsert` uses `path` as unique key, so each repo gets its own `id`. Items are tagged with that `id`. This should work, but needs integration testing with two actual repos.

### Cross-Repo Dependencies

**Format**: `repo:backend/STAGE-001-002-003`

**Resolution flow**:
1. Parse the `repo:` prefix from `depends_on` value
2. Split into repo name + stage ID
3. Look up repo by name → get `repo_id`
4. Query stage status in that repo's scope
5. Return completion status

**Edge cases**:
- Referenced repo not registered → validation error
- Referenced stage doesn't exist → validation error
- Circular cross-repo dependencies → detect and report

### Global Commands

**Pattern**: Each command that supports `--global` needs to:
1. Load the registered repos list
2. Sync each repo's data (or trust existing sync)
3. Query across all repos
4. Include repo name in output (so items are distinguishable)
5. Handle cross-repo dependencies in sorting/filtering

**Output format change**: Global board/next output must include a `repo` field on each item so the consumer knows which repo it belongs to.

### Per-Repo Pipeline Modularity

Each repo can have its own `.kanban-workflow.yaml` with a different pipeline. The global board shows stages from different repos with different pipelines. Board output should include the pipeline config source for each stage.

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Key Constraints

- The existing 775 kanban-cli tests and ~396 orchestrator tests must continue passing
- `npm run verify` must pass in both packages after every task
- All new functions must be testable via injected dependencies (DI pattern)
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The `KANBAN_MOCK=true` mode is available for integration testing
- Do NOT modify the orchestrator's single-repo execution model
- Cross-repo dependency format must be `repo:<name>/ITEM-ID`
- Global commands must be backward-compatible (without `--global`, behavior is unchanged)

### Testing the Current System

```bash
cd tools/orchestrator && npm run verify
cd ../kanban-cli && npm run verify
```

---

## Suggested Sub-Task Breakdown

| Task | Description |
|------|-------------|
| 8-1 | Add `repos` section to global config schema + Zod validation + loader |
| 8-2 | Add `RepoRepository.findAll()` and `RepoRepository.findByName()` methods |
| 8-3 | Add `register-repo`, `unregister-repo`, `list-repos` CLI commands |
| 8-4 | Verify/fix repo-to-item association in `syncRepo()` for multi-repo scenarios |
| 8-5 | Parse `repo:<name>/ITEM-ID` format in dependency frontmatter |
| 8-6 | Implement cross-repo dependency resolution in dependency resolver |
| 8-7 | Add `--global` flag to `board` command with cross-repo aggregation |
| 8-8 | Add `--global` flag to `next` command with cross-repo dependency resolution |
| 8-9 | Add `--global` flag to `graph` command with cross-repo edges |
| 8-10 | Add `--global` flag to `validate` command for cross-repo reference checking |
| 8-11 | Integration tests: two-repo scenario with cross-repo dependencies |
| 8-12 | Documentation: update handoff doc with completion summary |

---

## Next Steps After Stage 8

Stage 8 completes the core feature set. After this:
- The system supports multiple repos with cross-repo dependencies
- The orchestrator can run as multiple instances (one per repo)
- All CLI commands work in both single-repo and global modes
