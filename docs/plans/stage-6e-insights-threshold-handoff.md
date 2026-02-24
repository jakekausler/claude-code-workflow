# Stage 6E: Insights Threshold Cron — Session Prompt

## Context

Stages 0-6D are complete on the `kanban` branch. This session implements **Stage 6E: Insights Threshold Cron** — the cron-based job that periodically checks if unanalyzed learnings have accumulated past a configurable threshold and spawns a meta-insights session when triggered.

### Dependency Graph

```
Stage 5.5A (Schema & Sync) ✅
  ├── Stage 5.5B (Skill Updates) ✅
  │     └── Stage 6A (Orchestrator Infrastructure) ✅
  │           ├── Stage 6A.5 (MCP Server) ✅
  │           └── Stage 6B (Exit Gates & Resolvers) ✅
  │                 └── Stage 6C (Completion Cascade) ✅
  │                       └── Stage 6D (MR Comment Cron + MR Chain Manager) ✅
  │                             └── Stage 6E (Insights Threshold Cron) ← THIS STAGE
  └── Stage 5.5C (Jira Conversion Enrichment) ✅
```

### What Has Been Built (Stages 0-6D)

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

**Test Suite:** 775 tests across 51 test files (kanban-cli), 369 tests across 23 test files (orchestrator). **Total: 1,144 tests.**

**Stage 6D: MR Comment Polling Cron & MR Dependency Chain Manager (Complete)**

| Deliverable | Description |
|------------|-------------|
| Cron scheduler | Generic `createCronScheduler(jobs, deps)` with start/stop lifecycle, error isolation, overlap prevention |
| Pipeline config `cron` section | `CronConfig` types, Zod schema (30-3600s bounds), loader merge logic, YAML defaults |
| MR comment poller | `createMRCommentPoller(deps)` — polls stages in PR Created, detects merge (→ Done) and new comments (→ Addressing Comments) via exit gate runner |
| Comment tracking SQLite | `mr_comment_tracking` table with `CommentTrackingRepository` for tracking unresolved thread counts |
| PRStatus extension | `unresolvedThreadCount: number` added to `PRStatus` interface, GitHub and GitLab adapters updated |
| MR chain manager | `createMRChainManager(deps)` — detects parent merges/updates, spawns rebase sessions, retargets MRs, promotes drafts |
| Retargeting matrix | Full implementation: multi-parent >1 remain, exactly 1 remain, single-parent merged, all merged |
| Orchestrator integration | Cron lifecycle wired into `createOrchestrator()` start/stop, shared deps passed through |
| Rebase skill skeleton | `skills/rebase-child-mr/SKILL.md` — skill definition with workflow, exit conditions, frontmatter docs |

**Architectural pattern:** Every module uses factory functions with dependency injection (`createXxx(deps: Partial<XxxDeps> = {})`). All I/O is injectable for testing.

### Key Infrastructure Available for 6E

**Cron scheduler (`tools/orchestrator/src/cron.ts`):**
- `createCronScheduler(jobs, deps)` — accepts `CronJob[]` with name, enabled, intervalMs, execute()
- Already wired into orchestrator lifecycle (start/stop)
- The `insights-threshold` job is already configured as a no-op placeholder in `loop.ts` (lines 165-175)
- Config: `config.pipelineConfig.cron.insights_threshold` with `enabled` and `interval_seconds`

**Pipeline config:**
- `cron.insights_threshold.enabled` and `cron.insights_threshold.interval_seconds` already in schema and defaults
- Default: `enabled: true, interval_seconds: 600` (10 minutes)

**Learnings count CLI:**
- `kanban-cli learnings-count --repo <path> --threshold <n>` already exists
- Returns count of unanalyzed learnings and whether threshold is exceeded

**Orchestrator loop.ts integration point:**
- `buildCronScheduler()` at line 165 has the placeholder:
  ```typescript
  {
    name: 'insights-threshold',
    enabled: insightsConfig?.enabled ?? false,
    intervalMs: (insightsConfig?.interval_seconds ?? 600) * 1000,
    execute: async () => {
      // No-op placeholder -- 6E fills this in
    },
  }
  ```

---

## What Stage 6E Delivers

### Goal

Fill in the `insights-threshold` cron job to periodically check if unanalyzed learnings have accumulated past the configured threshold, and spawn a meta-insights session when triggered.

### What Ships

1. **Insights threshold checker** — Query learnings count, compare against threshold
2. **Meta-insights session spawning** — When threshold exceeded, spawn a Claude session with the `meta-insights` skill
3. **Cooldown tracking** — Prevent repeated spawning (only trigger once per cooldown period)
4. **Wire into orchestrator** — Replace the no-op placeholder in `buildCronScheduler()`

### What Stage 6E Does NOT Include

- Changes to the cron scheduler infrastructure (6D built this)
- Changes to the `cron` config schema (6D built this)
- Changes to MR comment polling or chain management
- Changes to exit gates or completion cascade
- The `meta-insights` skill content (just the spawning mechanism)

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Key Constraints

- The existing 775 kanban-cli tests and 369 orchestrator tests must continue passing
- `npm run verify` must pass in both packages after every task
- All new functions must be testable via injected dependencies (DI pattern)
- Follow the existing DI pattern (`Partial<Deps>` with factory functions)
- The `KANBAN_MOCK=true` mode is available for integration testing

### Testing the Current System

```bash
cd tools/orchestrator && npm run verify
cd ../kanban-cli && npm run verify
```

---

## Next Steps After Stage 6E

- **Stage 7** (Slack Notifications) and **Stage 8** (Global CLI + Multi-Repo) can proceed independently
- Stage 6E completes the cron system — both MR comment polling (6D) and insights threshold (6E) will be operational
