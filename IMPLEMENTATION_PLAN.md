# Stage 8: Global CLI + Multi-Repo — Implementation Plan

**Design Doc**: `docs/plans/2026-02-24-stage-8-multi-repo-design.md`
**Branch**: `feat/stage-8-multi-repo`

## Task Dependency Graph

```
Task 8-1 (RepoRepository methods)
Task 8-2 (Repo registry module) ──depends-on──▶ 8-1
Task 8-3 (Cross-repo dep parser)
Task 8-4 (DB schema migration) ──depends-on──▶ 8-1
Task 8-5 (Multi-repo helper) ──depends-on──▶ 8-1, 8-2
Task 8-6 (CLI: register/unregister/list) ──depends-on──▶ 8-2, 8-5
Task 8-7 (Cross-repo dep resolution in sync) ──depends-on──▶ 8-3, 8-4, 8-1
Task 8-8 (board --global) ──depends-on──▶ 8-5, 8-7
Task 8-9 (next --global) ──depends-on──▶ 8-5, 8-7
Task 8-10 (graph --global) ──depends-on──▶ 8-5, 8-7
Task 8-11 (validate --global) ──depends-on──▶ 8-5, 8-7
Task 8-12 (Slack webhook_url override) ──depends-on──▶ 8-2
Task 8-13 (Integration tests) ──depends-on──▶ 8-8, 8-9, 8-10, 8-11
Task 8-14 (Documentation + handoff) ──depends-on──▶ 8-13
```

## Parallelization Strategy

**Wave 1** (independent foundations): 8-1, 8-3 — run in parallel
**Wave 2** (depends on Wave 1): 8-2, 8-4 — run in parallel
**Wave 3** (depends on Wave 2): 8-5, 8-7 — run in parallel
**Wave 4** (depends on Wave 3): 8-6, 8-8, 8-9, 8-10, 8-11, 8-12 — run in parallel (6 tasks)
**Wave 5** (integration): 8-13
**Wave 6** (docs): 8-14

---

## Task 8-1: RepoRepository Methods

**Goal**: Add `findAll()` and `findByName()` to `RepoRepository`

**Files**:
- `tools/kanban-cli/src/db/repositories/repo-repository.ts` — Add methods
- `tools/kanban-cli/tests/db/repositories.test.ts` — Add tests

**Tests**:
- `findAll()` returns empty array when no repos exist
- `findAll()` returns all registered repos after multiple upserts
- `findByName()` returns null when name not found
- `findByName()` returns correct repo when name matches
- `findByName()` is case-sensitive

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-2: Repo Registry Module

**Goal**: Create `repos.yaml` loader/writer with Zod validation and DI

**Files**:
- `tools/kanban-cli/src/repos/registry.ts` — New module
- `tools/kanban-cli/tests/repos/registry.test.ts` — New tests
- `tools/kanban-cli/src/config/loader.ts` — Add `REPOS_PATH` to CONFIG_PATHS

**Implementation**:
- Zod schema: `repoEntrySchema` (path, name, slack_webhook optional)
- `reposConfigSchema` with `repos` array
- `createRegistry(deps)` factory with:
  - `loadRepos()`: Parse repos.yaml, validate, return entries
  - `registerRepo(entry)`: Add to list, validate unique name/path, write file
  - `unregisterRepo(name)`: Remove by name, write file
  - `findByName(name)`: Lookup by name
- DI: `readFile`, `writeFile`, `existsSync`, `mkdirSync`, `registryPath`

**Tests**:
- `loadRepos()` returns empty when file doesn't exist
- `loadRepos()` parses valid YAML with multiple repos
- `loadRepos()` throws on invalid YAML (missing name, bad schema)
- `registerRepo()` adds to file, creates dir if needed
- `registerRepo()` rejects duplicate name
- `registerRepo()` rejects duplicate path
- `unregisterRepo()` removes entry
- `unregisterRepo()` throws when name not found
- `findByName()` returns match or null
- `slack_webhook` is optional and validated as URL when present

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-3: Cross-Repo Dependency Parser

**Goal**: Parse `<repoName>/ITEM-ID` format in `depends_on` values

**Files**:
- `tools/kanban-cli/src/parser/cross-repo-deps.ts` — New module
- `tools/kanban-cli/tests/parser/cross-repo-deps.test.ts` — New tests

**Implementation**:
- `parseDependencyRef(ref)`: Split on first `/`. If no slash → `{ type: 'local', itemId: ref }`. If slash → `{ type: 'cross-repo', repoName, itemId }`
- `isCrossRepoDep(ref)`: Returns `ref.includes('/')`
- `formatCrossRepoDep(repoName, itemId)`: Returns `${repoName}/${itemId}`

**Tests**:
- Local dep: `"STAGE-001-001-001"` → `{ type: 'local', itemId: 'STAGE-001-001-001' }`
- Cross-repo: `"backend/STAGE-002-001-001"` → `{ type: 'cross-repo', repoName: 'backend', itemId: 'STAGE-002-001-001' }`
- Cross-repo ticket: `"backend/TICKET-002-001"` → correct parse
- Format roundtrip: `formatCrossRepoDep('backend', 'STAGE-001')` → `'backend/STAGE-001'`
- `isCrossRepoDep` returns true/false correctly

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-4: Database Schema Migration

**Goal**: Add `target_repo_name` column to `dependencies` table

**Files**:
- `tools/kanban-cli/src/db/schema.ts` — Add column to CREATE TABLE + migration logic
- `tools/kanban-cli/tests/db/database.test.ts` — Add migration test

**Implementation**:
- Add `target_repo_name TEXT` to dependencies table definition (nullable)
- Add migration: `ALTER TABLE dependencies ADD COLUMN target_repo_name TEXT` for existing DBs
- Migration runs on database open (same pattern as existing migrations if any)

**Tests**:
- Fresh DB creates table with `target_repo_name` column
- Existing DB without column gets it added via migration
- Column accepts NULL (local deps) and text values (cross-repo deps)

**Success Criteria**: `npm run verify` passes, existing tests still pass

**Status**: Not Started

---

## Task 8-5: Multi-Repo Helper

**Goal**: Shared utility for syncing all repos and loading aggregated data

**Files**:
- `tools/kanban-cli/src/repos/multi-repo.ts` — New module
- `tools/kanban-cli/tests/repos/multi-repo.test.ts` — New tests

**Implementation**:
- `createMultiRepoHelper(deps)` factory with DI
- `syncAllRepos()`: Load registry → for each repo, call syncRepo → return repo info list
- `loadAllRepoData(repoIds)`: Query all repositories for given repo IDs, return aggregated { epics, tickets, stages, deps }

**Tests**:
- `syncAllRepos()` syncs each registered repo
- `syncAllRepos()` returns correct repo info list
- `syncAllRepos()` handles empty registry (no repos)
- `loadAllRepoData()` aggregates data from multiple repos
- `loadAllRepoData()` adds `repo` field to each item

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-6: CLI Commands — register-repo, unregister-repo, list-repos

**Goal**: Three new CLI commands for repo management

**Files**:
- `tools/kanban-cli/src/cli/commands/register-repo.ts` — New
- `tools/kanban-cli/src/cli/commands/unregister-repo.ts` — New
- `tools/kanban-cli/src/cli/commands/list-repos.ts` — New
- `tools/kanban-cli/src/cli/index.ts` — Register commands
- `tools/kanban-cli/tests/cli/commands/register-repo.test.ts` — New
- `tools/kanban-cli/tests/cli/commands/unregister-repo.test.ts` — New
- `tools/kanban-cli/tests/cli/commands/list-repos.test.ts` — New

**Implementation**:
- `register-repo <path> [--name <name>] [--slack-webhook <url>]`
  - Resolves path, validates it exists and has `epics/` dir
  - Name defaults to `path.basename(path)`
  - Adds to registry, then calls `syncRepo()` immediately
  - Outputs registered repo info as JSON
- `unregister-repo <name>`
  - Removes from registry
  - Does NOT delete DB data (user can re-register later)
- `list-repos`
  - Shows all registered repos with name, path, and last sync time from DB
  - Supports `--pretty` and `-o <file>`

**Tests**:
- register-repo adds to registry and syncs
- register-repo rejects non-existent path
- register-repo rejects duplicate
- unregister-repo removes entry
- unregister-repo errors on unknown name
- list-repos shows all repos
- list-repos handles empty registry

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-7: Cross-Repo Dependency Resolution in Sync

**Goal**: Store and resolve cross-repo dependencies during syncRepo

**Files**:
- `tools/kanban-cli/src/sync/sync.ts` — Extend dependency handling
- `tools/kanban-cli/src/db/repositories/dependency-repository.ts` — Support target_repo_name
- `tools/kanban-cli/tests/sync/sync.test.ts` — Add cross-repo dep tests
- `tools/kanban-cli/tests/db/repositories.test.ts` — Add target_repo_name tests

**Implementation**:
- In `syncRepo()`, when processing `depends_on` entries:
  - Use `parseDependencyRef()` to detect cross-repo deps
  - Store `target_repo_name` in dependency record
  - For resolution: look up target repo by name, get its repo_id, check target item status
- `DependencyRepository.upsert()` accepts optional `target_repo_name`
- Cross-repo deps that can't be resolved (repo not in DB) stay unresolved

**Tests**:
- Local deps continue working unchanged
- Cross-repo dep stored with `target_repo_name`
- Cross-repo dep resolves when target repo synced and item is Complete
- Cross-repo dep stays unresolved when target repo not in DB
- Cross-repo dep stays unresolved when target item not Complete

**Success Criteria**: `npm run verify` passes, all existing sync tests still pass

**Status**: Not Started

---

## Task 8-8: `board --global`

**Goal**: Add `--global` flag to board command for cross-repo aggregation

**Files**:
- `tools/kanban-cli/src/cli/commands/board.ts` — Add `--global` branch
- `tools/kanban-cli/src/cli/logic/board.ts` — Add repo field to output types
- `tools/kanban-cli/tests/cli/logic/board.test.ts` — Add global board tests

**Implementation**:
- Add `.option('--global', 'Aggregate across all registered repos', false)`
- When `--global`: use multi-repo helper to sync all + aggregate
- Each item in columns gets `repo: "<name>"` field
- Top-level output: `repos: string[]` array replacing single `repo` path
- When not `--global`: existing behavior unchanged, no `repo` field on items

**Tests**:
- `--global` aggregates stages from multiple repos
- Each item has `repo` field set to repo name
- Columns work correctly with mixed-repo items
- Filtering by epic/ticket still works in global mode
- Without `--global`, output unchanged (backward-compatible)

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-9: `next --global`

**Goal**: Add `--global` flag to next command for cross-repo ready stages

**Files**:
- `tools/kanban-cli/src/cli/commands/next.ts` — Add `--global` branch
- `tools/kanban-cli/src/cli/logic/next.ts` — Add repo field to output types
- `tools/kanban-cli/tests/cli/logic/next.test.ts` — Add global next tests

**Implementation**:
- Add `.option('--global', 'Show ready stages across all registered repos', false)`
- When `--global`: sync all repos, aggregate stage data, consider cross-repo deps
- Each ready stage gets `repo: "<name>"` field
- Cross-repo deps factor into blocking determination
- Without `--global`: unchanged

**Tests**:
- `--global` shows ready stages from all repos
- Cross-repo blocked stage excluded from ready list
- Cross-repo resolved dep allows stage to be ready
- Each result has `repo` field
- Without `--global`, output unchanged

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-10: `graph --global`

**Goal**: Add `--global` flag to graph command for cross-repo dependency visualization

**Files**:
- `tools/kanban-cli/src/cli/commands/graph.ts` — Add `--global` branch
- `tools/kanban-cli/src/cli/logic/graph.ts` — Support cross-repo nodes/edges
- `tools/kanban-cli/tests/cli/logic/graph.test.ts` — Add global graph tests

**Implementation**:
- Add `.option('--global', 'Show dependency graph across all registered repos', false)`
- When `--global`: nodes from all repos with `repo` field, edges include cross-repo
- Cross-repo edges marked with `cross_repo: true` in edge data
- Mermaid output groups nodes by repo subgraph
- Cycle detection spans all repos

**Tests**:
- `--global` includes nodes from multiple repos
- Cross-repo edges have `cross_repo: true` flag
- Cycle detection catches cross-repo cycles
- Mermaid output renders repo subgraphs
- Without `--global`, unchanged

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-11: `validate --global`

**Goal**: Add `--global` flag to validate command for cross-repo validation

**Files**:
- `tools/kanban-cli/src/cli/commands/validate.ts` — Add `--global` branch
- `tools/kanban-cli/src/cli/logic/validate.ts` — Support cross-repo validation
- `tools/kanban-cli/tests/cli/logic/validate.test.ts` — Add global validate tests

**Implementation**:
- Add `.option('--global', 'Validate across all registered repos', false)`
- When `--global`:
  - Run per-repo validation for each registered repo
  - Check cross-repo reference existence (target repo registered, target item exists)
  - Check cross-repo dep type validity (same rules as local)
  - Run cross-repo cycle detection (extended Tarjan)
  - Include `repo` field in error/warning objects
- Without `--global`: cross-repo deps produce warnings (not errors) if target can't be resolved

**Tests**:
- `--global` validates all repos
- Reports error for reference to unregistered repo
- Reports error for reference to non-existent item in registered repo
- Detects cross-repo circular dependencies
- Type rules enforced across repos
- Errors include `repo` field
- Without `--global`, cross-repo deps produce warnings

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-12: Slack webhook_url Override

**Goal**: Add `webhook_url` parameter to `slack_notify` MCP tool and per-repo routing

**Files**:
- `tools/mcp-server/src/tools/slack.ts` — Add `webhook_url` param
- `tools/mcp-server/tests/slack.test.ts` — Add override tests
- `skills/phase-finalize/SKILL.md` — Document repo webhook lookup
- `skills/review-cycle/SKILL.md` — Document repo webhook lookup

**Implementation**:
- `SlackNotifyArgs` gains optional `webhook_url: string`
- When `webhook_url` is provided, use it instead of global `WORKFLOW_SLACK_WEBHOOK`
- Resolution: `webhook_url` param > global env var > skip
- Skills updated to look up repo webhook from `repos.yaml` before calling `slack_notify`

**Tests**:
- `webhook_url` override sends to specified URL
- Without `webhook_url`, existing global behavior unchanged
- `webhook_url` takes precedence over global webhook
- Mock mode still works with `webhook_url` override

**Success Criteria**: `npm run verify` passes (in both mcp-server and kanban-cli)

**Status**: Not Started

---

## Task 8-13: Integration Tests

**Goal**: End-to-end tests with two repos, cross-repo dependencies, and global commands

**Files**:
- `tools/kanban-cli/tests/integration/multi-repo.test.ts` — New

**Implementation**:
- Set up two temp repo directories with epics/tickets/stages
- Repo A has stage depending on `repoB/STAGE-xxx`
- Register both repos
- Test sync, board --global, next --global, graph --global, validate --global
- Verify cross-repo dep resolution
- Verify cross-repo cycle detection
- Verify repo field in output

**Tests**:
- Two repos register and sync successfully
- Global board shows stages from both repos
- Global next excludes cross-repo blocked stages
- Global graph includes cross-repo edges
- Global validate detects cross-repo errors
- Cross-repo dep resolves when target completes

**Success Criteria**: `npm run verify` passes

**Status**: Not Started

---

## Task 8-14: Documentation + Handoff

**Goal**: Update handoff doc with completion summary

**Files**:
- `docs/plans/stage-8-global-cli-multi-repo-handoff.md` — Update with completion summary
- `docs/plans/2026-02-24-stage-8-multi-repo-design.md` — Mark as complete

**Implementation**:
- Add completion summary to handoff doc
- Document any deferred items or known limitations
- Update test count

**Success Criteria**: Docs accurately reflect what shipped

**Status**: Not Started
