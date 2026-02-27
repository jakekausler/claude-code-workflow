# Stage 8: Global CLI + Multi-Repo — Design Document

**Date**: 2026-02-24
**Branch**: `feat/stage-8-multi-repo` (based on `kanban` + `feat/stage-7-slack-notifications`)
**Status**: Implemented

> This design document was approved and fully implemented. See `/docs/plans/stage-8-global-cli-multi-repo-handoff.md` for the completion summary including all 14 tasks, test counts, files added/modified, and known limitations.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Repo registry location | Separate `~/.config/kanban-workflow/repos.yaml` | Keeps pipeline config clean, independently editable |
| Architecture | Global Middleware Layer (Approach A) | Additive changes, existing single-repo paths untouched |
| Global command sync | Auto-sync all registered repos | Ensures data freshness for cross-repo queries |
| Repo identification in output | `repo` field on every item | Minimal output change, easy to filter downstream |
| Cross-repo dep format | `<repo-name>/ITEM-ID` (slash delimiter) | Simple, no prefix needed — slash distinguishes from local IDs |
| Cross-repo cycle detection | Full Tarjan SCC across repos | Thorough validation prevents hidden circular blocks |
| Slack channel routing | Per-repo `slack_webhook` in `repos.yaml` | MCP tool gets `webhook_url` override, stays stateless |

## 1. Repo Registry

### File: `~/.config/kanban-workflow/repos.yaml`

```yaml
repos:
  - path: /home/user/projects/backend
    name: backend
    slack_webhook: "https://hooks.slack.com/services/T.../B.../backend-channel"
  - path: /home/user/projects/frontend
    name: frontend
    # No slack_webhook — uses global WORKFLOW_SLACK_WEBHOOK
```

### New Module: `src/repos/registry.ts`

Zod-validated registry with DI:

```typescript
const repoEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  slack_webhook: z.string().url().optional(),
});

const reposConfigSchema = z.object({
  repos: z.array(repoEntrySchema).default([]),
});

export interface RegistryDeps {
  readFile: typeof fs.readFileSync;
  writeFile: typeof fs.writeFileSync;
  existsSync: typeof fs.existsSync;
  mkdirSync: typeof fs.mkdirSync;
  registryPath: string;
}

export function createRegistry(deps: Partial<RegistryDeps> = {}) {
  return {
    loadRepos(): RepoEntry[],
    registerRepo(entry: RepoEntry): void,
    unregisterRepo(name: string): void,
    findByName(name: string): RepoEntry | null,
  };
}
```

### CLI Commands

- `register-repo <path> [--name <name>] [--slack-webhook <url>]` — Adds repo, syncs it immediately
- `unregister-repo <name>` — Removes from registry (does NOT delete DB data)
- `list-repos` — Shows all registered repos with last-sync status

### RepoRepository Additions

- `findAll(): RepoRecord[]`
- `findByName(name: string): RepoRecord | null`

## 2. Cross-Repo Dependencies

### Format

```yaml
depends_on:
  - STAGE-001-001-003              # Local dep (no slash)
  - backend/STAGE-002-001-001      # Cross-repo dep (slash present)
  - backend/TICKET-002-001         # Cross-repo ticket reference
```

### Parser: `src/parser/cross-repo-deps.ts`

```typescript
export interface CrossRepoDep {
  repoName: string;
  itemId: string;
}

export function parseDependencyRef(ref: string):
  | { type: 'local'; itemId: string }
  | { type: 'cross-repo'; repoName: string; itemId: string }

export function isCrossRepoDep(ref: string): boolean
export function formatCrossRepoDep(repoName: string, itemId: string): string
```

### Database Change

Add `target_repo_name TEXT` nullable column to `dependencies` table. Local deps keep null. Cross-repo deps store the target repo name.

### Resolution Flow

1. During `syncRepo()`, cross-repo deps are stored with `target_repo_name`
2. During resolution, resolver looks up target repo via `RepoRepository.findByName()`, gets its `repo_id`, queries target item status
3. For `--global` commands, all repos are pre-synced so cross-repo lookups are always fresh

## 3. Global Commands

### `--global` Flag Pattern

```typescript
.option('--global', 'Aggregate across all registered repos', false)
```

When `--global` is set:
1. Load registered repos from `repos.yaml`
2. For each repo: `syncRepo({ repoPath, db, config })`
3. Query all repos from DB, aggregate data
4. Add `repo: "<name>"` field to every item in output
5. Resolve cross-repo dependencies during aggregation

When `--global` is NOT set: existing single-repo behavior, completely unchanged.

### Commands Gaining `--global`

| Command | Global Behavior |
|---------|----------------|
| `board` | Columns contain stages from all repos, each with `repo` field |
| `next` | Ready stages from all repos, cross-repo deps in blocking |
| `graph` | Nodes/edges span all repos, cross-repo edges marked distinctly |
| `validate` | All repos + cross-repo references + cross-repo cycles |

### Shared Helper: `src/repos/multi-repo.ts`

```typescript
export interface MultiRepoDeps {
  registry: ReturnType<typeof createRegistry>;
  db: KanbanDatabase;
  loadConfig: typeof loadConfig;
  syncRepo: typeof syncRepo;
}

export function createMultiRepoHelper(deps: Partial<MultiRepoDeps> = {}) {
  return {
    syncAllRepos(): { repoId: number; repoName: string; repoPath: string }[],
    loadAllRepoData(repoIds: number[]): { epics, tickets, stages, deps },
  };
}
```

### Output Format

Single-repo (unchanged):
```json
{ "repo": "/path/to/repo", "columns": { ... } }
```

Global:
```json
{ "repos": ["backend", "frontend"], "columns": { "backlog": [{ "type": "stage", "id": "STAGE-001-001-001", "repo": "backend", ... }] } }
```

## 4. Slack Channel Routing

### `repos.yaml` Extension

Each repo entry optionally includes `slack_webhook`:
```yaml
repos:
  - path: /home/user/projects/backend
    name: backend
    slack_webhook: "https://hooks.slack.com/services/T.../B.../backend"
```

### Resolution Order

1. Repo-specific `slack_webhook` from `repos.yaml`
2. Global `WORKFLOW_SLACK_WEBHOOK` (env var or config default)
3. No webhook — silently skipped

### MCP Server Change

`slack_notify` gains optional `webhook_url` parameter. When provided, it overrides the global webhook. The MCP server stays stateless — callers resolve the webhook.

### Skill Changes

`phase-finalize` and `review-cycle` skills look up the current repo's webhook from `repos.yaml` and pass it as `webhook_url` to `slack_notify`.

## 5. Validation & Error Handling

### `validate --global` Checks

1. All existing per-repo validation for each registered repo
2. Cross-repo reference existence: `<repoName>/ITEM-ID` must point to registered repo with matching item
3. Cross-repo type rules: same as local (stage→any, ticket→ticket/epic, epic→epic)
4. Cross-repo cycle detection: extended Tarjan SCC spanning all repos
5. Unregistered repo references: error when dep references unknown repo name

### Error Format

```json
{
  "repo": "frontend",
  "file": "epics/EPIC-001/.../STAGE-001-001-001.md",
  "field": "depends_on",
  "error": "Cross-repo dependency 'backend/STAGE-002-001-001' references unregistered repo 'backend'"
}
```

### Single-repo `validate` with cross-repo deps

When running without `--global`, cross-repo deps that can't be resolved (target repo not in DB) produce warnings (not errors), since the other repo may not have been synced yet.

## 6. Repo-to-Item Association

`syncRepo()` already tags all items with `repo_id`. No changes needed to the sync flow. `register-repo` triggers an immediate sync to populate the shared database.
