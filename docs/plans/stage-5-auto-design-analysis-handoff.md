# Stage 5: Auto-Design + Auto-Analysis — Session Prompt

## Context

Stages 0-4 plus the LLM Summary redesign are complete on the `kanban` branch. This session implements **Stage 5: Auto-Design + Auto-Analysis**.

### What Has Been Built (Stages 0-4 + LLM Summary)

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

All commands support `--output/-o <file>` and `--repo <path>`.

**Infrastructure (Stage 0 + Stage 1):**
- SQLite database with repos, epics, tickets, stages, dependencies, summaries tables
- `session_active`, `locked_at`, `locked_by` fields on stages
- `pr_url`, `pr_number` fields on stages
- YAML frontmatter parser (gray-matter) for epics, tickets, stages
- File discovery (recursive walk of epics/ directory)
- Kanban column calculator (pipeline config-driven, not hardcoded)
- Sync engine handling all 5 dependency types (stage→stage, stage→ticket, stage→epic, ticket→ticket, epic→epic)
- Dependency resolution: stage=Complete, ticket=all stages Complete, epic=all stages Complete
- Pipeline config system (YAML state machine, skill/resolver states, transition validator)
- HTML board formatter (standalone, inline CSS)
- Mermaid graph formatter (three-level subgraphs: epic > ticket > stages)
- Priority queue (Addressing Comments > Manual Testing > Automatic Testing > Build > Design)

**Stage 2: Migration + Conversion:**
- `kanban-cli migrate` command — non-interactive migration from old format
- Migration modules: `src/migration/` (detector, id-mapper, frontmatter-generator, types)
- `migrate-repo` skill, `convert-ticket` skill
- Seed script: `scripts/seed-old-format-repo.sh`

**Stage 3: Remote Mode:**
- Git platform auto-detection (`WORKFLOW_GIT_PLATFORM`): env var > config > git remote URL parsing
- GitHub adapter (`gh pr view`) and GitLab adapter (`glab mr view`) with injectable execFn
- Production `pr-status` resolver: merged→Done, unresolved comments→Addressing Comments, else→null
- Code host factory: `createCodeHostAdapter(platform)`
- `phase-finalize` skill with remote mode (MR/PR creation, Jira linking, Slack webhook, status→PR Created)
- `review-cycle` skill — MR/PR review feedback loop

**Stage 4: Jira Integration:**
- Jira config section in `.kanban-workflow.yaml` (`reading_script`, `writing_script`, `project`, `assignee`, `status_map`)
- JiraScriptExecutor module: spawns external scripts with JSON stdin/stdout, Zod schema validation
- `jira-import` command: auto-detects epic vs ticket from Jira type, parent resolution via `jira_key` DB lookup
- `jira-sync` command: computes workflow event from stage states (`all_stages_done` > `stage_pr_created` > `first_stage_design`), status map, `WORKFLOW_JIRA_CONFIRM` support, per-action error isolation
- Default wrapper scripts: `default-jira-reader.ts` and `default-jira-writer.ts` bridging to atlassian-tools
- `phase-finalize` and `convert-ticket` skills updated with Jira awareness
- Database indexes on `jira_key` columns, `findByJiraKey` repository methods
- Cross-repo stage isolation fix in `listByTicket`

**LLM Summary Redesign:**
- `claude -p` based summarization with hierarchical caching
- SQLite cache with SHA-256 content hash invalidation
- `--model`, `--no-cache`, `-q/--quiet` flags, progress bar

**Test Suite:** 578 tests across 44 test files, all passing
**Source Files:** ~70 TypeScript source files

**Workflow Skills** (all in `skills/`):

| Skill | Description |
|-------|-------------|
| `ticket-stage-setup` | Three-level hierarchy creation, YAML frontmatter templates |
| `ticket-stage-workflow` | Phase routing, env var awareness, kanban-cli sync |
| `phase-design` | Design phase, WORKFLOW_AUTO_DESIGN awareness |
| `phase-build` | Build phase, worktree awareness |
| `automatic-testing` | Refinement with 6 type checklists (frontend, backend, cli, db, infra, custom) |
| `phase-finalize` | Local mode (merge to main) + remote mode (MR/PR creation) + Jira sync |
| `review-cycle` | MR/PR review comment handling (fetch, classify, fix, push, reply) |
| `migrate-repo` | Interactive old-format repo migration with approval gates |
| `convert-ticket` | Stageless ticket → stages via brainstorming, Jira context aware |
| `lessons-learned` | Phase completion lessons with three-level metadata |
| `journal` | Post-phase feelings journal |
| `meta-insights` | Cross-cutting learnings analysis with scripts in `meta-insights/scripts/` |

### Key Design References

- Full design doc: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`
- End-state vision: `docs/plans/2026-02-16-kanban-workflow-end-state.md`
- Orchestrator flow: `docs/plans/orchestrator-flow.dot` and `docs/plans/flow.svg`
- Integration spec: `tools/kanban-cli/docs/integration-spec-stage-1.md`
- Stage 0 plans: `docs/plans/stage-0-pipeline-configuration/`
- Stage 1 plans: `docs/plans/stage-1-foundation/`
- Stage 2 plans: `docs/plans/stage-2-migration/`
- Stage 3 plans: `docs/plans/stage-3-remote-mode/`
- Stage 4 plans: `docs/plans/stage-4-jira-integration/`
- LLM summary design: `docs/plans/2026-02-19-llm-summary-design.md`
- Jira integration design: `docs/plans/2026-02-20-jira-integration-design.md`

---

## What Stage 5 Delivers

### Goal

Reduce manual intervention for routine decisions. Two environment-variable-driven features that gate existing skill behavior.

### What Ships

1. **`WORKFLOW_AUTO_DESIGN` behavior in `phase-design` skill** — When `true`, the Design phase brainstormer still runs and presents 2-3 approaches, but instead of pausing for user selection, it automatically proceeds with the recommended option. The recommendation and reasoning are logged in the stage file's Design Phase section. When `false` (default), current behavior is preserved (brainstormer presents options, pauses at User Design Feedback state for user selection).

2. **`WORKFLOW_AUTO_DESIGN` behavior in `ticket-stage-workflow` skill** — The workflow router needs to understand that when `WORKFLOW_AUTO_DESIGN=true`, the Design phase should not route to "User Design Feedback" but instead proceed directly to the next phase (Build). This may require updates to the pipeline config or the workflow routing logic.

3. **`WORKFLOW_LEARNINGS_THRESHOLD` integration with `lessons-learned` skill** — After each phase exit gate, the system counts unanalyzed learnings. When the count exceeds `WORKFLOW_LEARNINGS_THRESHOLD` (default: 10), `meta-insights` is auto-spawned. This is preparation for Stage 6E's insights threshold cron, but the counting and threshold check logic should be implemented now.

4. **Pipeline config defaults** — Both `WORKFLOW_AUTO_DESIGN` and `WORKFLOW_LEARNINGS_THRESHOLD` are already defined in the `workflowDefaultsSchema` (from Stage 0). Stage 5 implements the skill-side behavior that reads and acts on these values.

### Where Auto-Design Lives in the Pipeline

The default pipeline has this flow for the Design phase:

```
Design → User Design Feedback → Build
```

When `WORKFLOW_AUTO_DESIGN=true`:
- The `phase-design` skill runs the brainstormer
- Instead of transitioning to "User Design Feedback" (which pauses for human input), it transitions directly to "Build"
- The recommendation is logged in the stage file
- No user interaction required

When `WORKFLOW_AUTO_DESIGN=false` (default):
- Current behavior: brainstormer presents options → stage goes to "User Design Feedback" → user selects → stage transitions to "Build"

### Where Learnings Threshold Lives

The threshold check is a **session responsibility** — after each phase exit gate (in `lessons-learned` skill), the system counts how many unanalyzed learnings exist. If the count exceeds `WORKFLOW_LEARNINGS_THRESHOLD`, it logs a note that meta-insights should run. The actual auto-spawning of a meta-insights session is a Stage 6E cron concern, but the counting infrastructure ships now.

---

## Existing Infrastructure Supporting Stage 5

### Already Implemented

- **`WORKFLOW_AUTO_DESIGN`**: defined in `workflowDefaultsSchema` (config/schema.ts) and `WorkflowDefaults` type (types/pipeline.ts) — boolean, optional
- **`WORKFLOW_LEARNINGS_THRESHOLD`**: defined in `workflowDefaultsSchema` (config/schema.ts) and `WorkflowDefaults` type (types/pipeline.ts) — positive integer, optional
- **`phase-design` skill**: already exists with `WORKFLOW_AUTO_DESIGN` awareness mentioned in description
- **`ticket-stage-workflow` skill**: handles phase routing and env var awareness
- **`lessons-learned` skill**: invoked at every phase exit gate, captures structured lessons
- **`meta-insights` skill**: cross-cutting learnings analysis with scripts
- **Pipeline config defaults**: both env vars can be set in `.kanban-workflow.yaml` workflow.defaults section
- **Default pipeline**: defines Design → User Design Feedback → Build flow

### Not Yet Implemented

- Actual auto-design behavior in `phase-design` skill (proceeding without user selection)
- Skip "User Design Feedback" routing when `WORKFLOW_AUTO_DESIGN=true`
- Learnings counting logic after phase exit gates
- Threshold check against `WORKFLOW_LEARNINGS_THRESHOLD`
- Integration between threshold check and meta-insights triggering

---

## Open Questions (from design doc)

Stage 5 has no explicit open questions in Section 5.2 — the design is straightforward feature flag configuration. However, resolve these during the design phase:

1. **How does auto-design interact with the pipeline state machine?** The default pipeline has a "User Design Feedback" state that acts as a human gate. When auto-design is enabled, should the pipeline skip this state entirely (transition Design → Build), or should the state still be entered but auto-exited?

2. **Where should the learnings count check run?** Options: in the `lessons-learned` skill itself (after writing a lesson), in the phase exit gate logic, or as a separate utility that skills invoke. The design doc says it's a cron concern (Stage 6E), but the counting logic should be ready.

3. **How are "unanalyzed learnings" counted?** Need to define what makes a learning "unanalyzed" — likely a flag in the learning file, a separate index, or timestamp comparison against last meta-insights run.

---

## Instructions

Follow the same process as Stages 2-4:

1. Read the design doc sections for Stage 5 (Section 4 Stage 5, Section 3.4, Section 3.13)
2. Read the end-state vision for auto-design and learnings threshold behavior
3. Break into sub-stages with dependency mapping
4. Write implementation plans to `docs/plans/stage-5-auto-design-analysis/`
5. Execute with subagent-driven development
6. Integration test with real CLI calls
7. Write handoff for subsequent stages

### Key Constraints

- The existing 578 tests must continue passing throughout
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass after every task
- Skills are markdown files — test with grep for terminology
- Auto-design must gracefully degrade: when `WORKFLOW_AUTO_DESIGN` is not set or false, behavior is identical to current
- Learnings threshold must gracefully degrade: when `WORKFLOW_LEARNINGS_THRESHOLD` is not set, no auto-triggering occurs
- Stage 5 is independent of Stages 2, 3, 4 — it only depends on Stage 1 (config system, file format)

### Suggested Sub-Stage Breakdown

This is a starting point — refine during design:

- **5a**: Auto-design in `phase-design` skill — read `WORKFLOW_AUTO_DESIGN`, skip user selection when true, log recommendation, transition to Build
- **5b**: Auto-design pipeline routing — update `ticket-stage-workflow` or pipeline config to handle Design → Build skip when auto-design is enabled
- **5c**: Learnings counting infrastructure — utility to count unanalyzed learnings in a repo
- **5d**: Threshold check in `lessons-learned` skill — after writing lesson, check count against `WORKFLOW_LEARNINGS_THRESHOLD`, log/trigger meta-insights if exceeded
- **5e**: Integration testing — test both features end-to-end with config variations

### Testing the Current System

```bash
# Seed test repos
cd tools/kanban-cli
bash scripts/seed-test-repo.sh
bash scripts/seed-old-format-repo.sh

# Run commands
npx tsx src/cli/index.ts board --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts board --repo /tmp/kanban-test-repo --html -o /tmp/board.html
npx tsx src/cli/index.ts graph --repo /tmp/kanban-test-repo --mermaid
npx tsx src/cli/index.ts next --repo /tmp/kanban-test-repo --max 5 --pretty
npx tsx src/cli/index.ts validate --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts sync --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts summary STAGE-001-001-001 --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts summary TICKET-001-001 --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts summary EPIC-001 --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts migrate --repo /tmp/kanban-old-format-repo --dry-run --pretty
npx tsx src/cli/index.ts migrate --repo /tmp/kanban-old-format-repo --pretty

# Jira integration (requires mock scripts)
npx tsx src/cli/index.ts jira-import TEST-100 --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts jira-sync TICKET-001-001 --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts jira-sync TICKET-001-001 --repo /tmp/kanban-test-repo --dry-run --pretty

# Run full test suite
npm run verify
```
