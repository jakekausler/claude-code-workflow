# Stage 6A: Orchestrator Infrastructure & Session Management — Session Prompt

## Context

Stages 0-5 are complete on the `kanban` branch. Stage 5.5A (Schema & Sync), Stage 5.5B (Skill Updates), and Stage 5.5C (Jira Conversion Enrichment) are also complete. This session implements **Stage 6A: Orchestrator Infrastructure & Session Management** — the foundational infrastructure for the orchestrator that manages stage lifecycle, session spawning, worktree isolation, and crash recovery.

### Dependency Graph

```
Stage 5.5A (Schema & Sync) ✅
  ├── Stage 5.5B (Skill Updates) ✅
  │     └── Stage 6A (Orchestrator Infrastructure) ← THIS STAGE
  └── Stage 5.5C (Jira Conversion Enrichment) ✅
```

### What Has Been Built (Stages 0-5)

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

All 13 commands support `--output/-o <file>` and `--repo <path>`.

**Infrastructure (Stages 0-1):**
- SQLite database with repos, epics, tickets, stages, dependencies, summaries tables
- `session_active`, `locked_at`, `locked_by` fields on stages table
- `pr_url`, `pr_number` fields on stages table
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
- `jira-sync` command: computes workflow event from stage states, status map, `WORKFLOW_JIRA_CONFIRM` support
- Default wrapper scripts: `default-jira-reader.ts` and `default-jira-writer.ts` bridging to atlassian-tools
- Database indexes on `jira_key` columns, `findByJiraKey` repository methods

**Stage 5: Auto-Design + Auto-Analysis:**
- `WORKFLOW_AUTO_DESIGN` behavior in `phase-design`: auto-selects recommended approach when true, skips to Build
- Phase notes files (`-<phase>.md` sister files) for all 6 phase skills: design, user-design-feedback, build, automatic-testing, manual-testing, finalize
- Sibling file reading: every phase reads `STAGE-XXX-YYY-ZZZ-*.md` for prior context
- Summary pipeline integration: `readStageFileContent()` concatenates sister files sorted by mtime with filename headers
- `phase-awaiting-design-decision` skill — "User Design Feedback" as its own session
- `phase-manual-testing` skill — walks user through manual verification based on `refinement_type`
- `ticket-stage-workflow` refactored to slim session context skill (shared data conventions only)
- `kanban-cli learnings-count` command — standalone CLI for counting unanalyzed learnings
- Canonical exit gate pattern across all phases: notes file → tracking updates → lessons-learned → journal

**Stage 5.5A: Schema & Sync (Complete):**
- Multi-parent dependency schema (`depends_on` array with `stage_id` + `relationship` objects)
- `pending_merge_parents` frontmatter field for tracking parent branches awaiting merge
- `is_draft` frontmatter field for draft MR tracking
- `mr_target_branch` frontmatter field for MR target branch logic
- Sync engine updates for new schema fields

**Stage 5.5B: Skill Updates (Complete):**
- Code host adapter methods: `editPRBase(prNumber, newBase)`, `markPRReady(prNumber)`, `getBranchHead(branch)` — for both GitHub and GitLab
- `phase-build` skill: parent branch merge step (reads `pending_merge_parents`, merges each parent branch before build)
- `phase-finalize` skill: draft MR and target branch logic (0 parents → main, 1 parent → parent branch, >1 parents → main; creates as draft if `pending_merge_parents` non-empty)
- `resolve-merge-conflicts` skill: automated conflict resolution during parent merges

**Stage 5.5C: Jira Conversion Enrichment (Complete):**
- `jira-import` captures link manifests (`jira_links` array in ticket frontmatter) from Jira API
- `kanban-cli enrich` command: fetches linked content (Confluence pages, Jira issues, attachments, external URLs) for enriched brainstorming
- `convert-ticket` skill: enrichment step before brainstorming (re-pulls Jira data, reads linked content)
- Jira reading script: extracts issue links, attachments, and remote links from Jira API
- New `jira_links` schema and validation
- Enrichment module (`enrich-ticket`)

**Test Suite:** 729 tests across 51 test files, all passing
**Source Files:** ~70 TypeScript source files

**Workflow Skills** (all in `skills/`):

| Skill | Description |
|-------|-------------|
| `ticket-stage-setup` | Three-level hierarchy creation, YAML frontmatter templates |
| `ticket-stage-workflow` | Shared data conventions, file formats, YAML structure (included in every session) |
| `phase-design` | Design phase, `WORKFLOW_AUTO_DESIGN` awareness, writes `-design.md` notes |
| `phase-awaiting-design-decision` | User Design Feedback phase, reads design research, user selects approach |
| `phase-build` | Build phase, worktree awareness, writes `-build.md` notes |
| `automatic-testing` | Automatic testing with 6 type checklists, writes `-automatic-testing.md` notes |
| `phase-manual-testing` | Manual testing walkthrough by `refinement_type`, hard gate on all areas passing |
| `phase-finalize` | Local mode (merge) + remote mode (MR/PR) + Jira sync, writes `-finalize.md` notes |
| `review-cycle` | MR/PR review comment handling (fetch, classify, fix, push, reply) |
| `migrate-repo` | Interactive old-format repo migration with approval gates |
| `convert-ticket` | Stageless ticket → stages via brainstorming, Jira context aware, enrichment step |
| `resolve-merge-conflicts` | Automated conflict resolution during parent branch merges |
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
- Stage 5 plans: `docs/plans/stage-5-auto-design-analysis/`
- LLM summary design: `docs/plans/2026-02-19-llm-summary-design.md`
- Jira integration design: `docs/plans/2026-02-20-jira-integration-design.md`
- Stage 5 design: `docs/plans/2026-02-20-stage-5-auto-design-analysis-design.md`

---

## What Stage 6A Delivers

### Goal

Build the foundational orchestrator infrastructure: stage discovery, session spawning, worktree isolation, locking, crash recovery, and graceful shutdown. This is the plumbing that all subsequent Stage 6 substages (6B–6E) build on.

### Background: The Three-System Architecture

The full Stage 6 orchestrator is NOT a single loop. It is three concurrent, independent systems:

1. **Main work loop** — picks up stages, spawns Claude sessions (skills), runs resolvers, handles exit gates
2. **MR comment cron** — periodically polls for new MR/PR comments and merged status
3. **Insights threshold cron** — periodically checks if unanalyzed learnings exceed threshold

Stage 6A builds the **infrastructure layer** that all three systems share. Subsequent substages layer on business logic:

```
Stage 6A (Infrastructure & Sessions)       ← THIS STAGE
  ├── Stage 6B (Exit Gates & Resolvers)
  │     └── Stage 6C (Completion Cascade & Backlog)
  │           └── Stage 6D (MR Comment Cron)
  └── Stage 6E (Insights Cron)
```

### Background: The Ralph Loop Pattern

Worker sessions follow the Ralph Loop pattern (Geoffrey Huntley). Each Claude session is spawned fresh with a clean context window, reads current state from files (stage file, spec, codebase), does one unit of work (one phase), commits, and exits. The external loop respawns as needed. This avoids context rot (degraded performance as context fills up) by giving each iteration the full specification.

### What Ships

1. **TypeScript orchestrator entry point** (`tools/orchestrator/`) — An external command-line tool that can run continuously or in single-tick batch mode. Reads pipeline config and environment variables.

2. **Stage discovery** — Calls `kanban-cli next --max N` to find workable stages. Returns priority-sorted list of stages ready for work. Respects `WORKFLOW_MAX_PARALLEL` limit.

3. **Session spawning** — Creates fresh Claude Code sessions with: the `ticket-stage-workflow` shared context + the phase-specific skill prompt + the stage file path. Each session gets an isolated worktree.

4. **Session locking (`session_active` flag)** — Sets `session_active: true` in stage frontmatter before spawn. Sets `session_active: false` after session exits. Prevents multiple workers from picking up the same stage. The `session_active`, `locked_at`, and `locked_by` fields already exist in both YAML frontmatter and the SQLite `stages` table.

5. **Crash recovery** — Detects when a session exits without updating status (unexpected termination). Resets `session_active = false`. Stage stays in current status, eligible for retry next tick. Logs crash for visibility.

6. **Worktree management** — `git worktree add` with `worktree_branch` from stage frontmatter. Spawns session inside the worktree (isolated filesystem). `git worktree remove` after stage completes or times out. Validates branch doesn't already exist.

7. **`$WORKTREE_INDEX` assignment** — Assigns index 0 for main, 1–N for parallel workers. Communicates to spawned session via environment variable. Used by services to isolate ports, databases, etc. (e.g., `PORT = 3000 + $WORKTREE_INDEX`).

8. **Worktree isolation strategy validation** — Reads the target repo's `CLAUDE.md` for a "Worktree Isolation Strategy" section. Verifies the section exists and covers: ports, database, environment, verification command. No worktree created without valid strategy.

9. **Idle behavior** — If no workable stages available, wait N seconds (configurable) and retry discovery. Gracefully handles downtime.

10. **Graceful shutdown** — Handles `SIGINT`/`SIGTERM` signals. Waits for active sessions to finish before exiting. Cleans up orphaned worktrees.

### What Stage 6A Does NOT Include

- ❌ Exit gate logic (verifying status, updating ticket/epic, syncing SQLite) — Stage 6B
- ❌ Resolver execution (pr-status, testing-router) — Stage 6B
- ❌ Completion cascade (stage → ticket → epic propagation) — Stage 6C
- ❌ Backlog re-evaluation (unblocking dependent stages) — Stage 6C
- ❌ MR comment cron loop — Stage 6D
- ❌ Insights threshold cron loop — Stage 6E
- ❌ Any changes to existing phase skills

### Key Architectural Decisions (Already Resolved)

These decisions were made in the design doc and end-state vision. Do NOT re-open them:

| Decision | Resolution |
|----------|-----------|
| Session states set their own status | When a Claude session (skill) completes, it updates the stage frontmatter `status` field before exiting. The loop verifies this but does not drive it. |
| Exit gates are loop behavior | After a session exits, the loop runs a deterministic sequence. Not configurable, not in pipeline config. |
| Journal and lessons-learned are skill-internal | Each phase skill calls journal and lessons-learned before exiting. The loop never sees them. |
| Backlog re-evaluation only on Done | Dependencies can only be resolved when a stage reaches Done. Not on every tick. |
| `kanban-cli sync` is the orchestrator's responsibility | Phase skills do NOT call sync. The orchestrator runs sync after session exit. |
| `pr_url` in frontmatter + SQLite | The finalize skill writes `pr_url` to frontmatter. Synced to SQLite for fast cron queries. |
| The orchestrator is three concurrent systems | Main work loop, MR comment cron, insights threshold cron — independent. |

### Existing Infrastructure Supporting Stage 6A

#### Already Implemented (Use These)

- **`kanban-cli next --max N`**: Returns priority-sorted ready stages as JSON. Already respects session_active locking.
- **`kanban-cli sync`**: Re-parses files into SQLite. Stage 6A will NOT call this (that's 6B's exit gate), but it's available.
- **`session_active`, `locked_at`, `locked_by`**: Already in stage frontmatter schema AND SQLite stages table.
- **`worktree_branch`**: Already in stage frontmatter schema AND SQLite stages table.
- **`pr_url`, `pr_number`**: Already in stage frontmatter schema AND SQLite stages table.
- **`WORKFLOW_MAX_PARALLEL`**: Already defined in `workflowDefaultsSchema` (config/schema.ts), defaults to 1.
- **`WORKFLOW_GIT_PLATFORM`**: Already defined, defaults to 'auto'.
- **Pipeline config loader**: `loadPipelineConfig()` reads `.kanban-workflow.yaml` with Zod validation.
- **Default pipeline YAML**: `tools/kanban-cli/config/default-pipeline.yaml` defines the state machine.
- **Priority queue**: `kanban-cli next` already sorts by Addressing Comments > Manual Testing > Automatic Testing > Build > Design.
- **Code host adapter additions (5.5B)**: `editPRBase()`, `markPRReady()`, `getBranchHead()` on GitHub and GitLab adapters.
- **Parent branch merge step (5.5B)**: `phase-build` reads `pending_merge_parents` and merges parent branches before build.
- **Draft MR logic (5.5B)**: `phase-finalize` sets `is_draft`, `mr_target_branch` based on parent count.
- **`kanban-cli enrich` (5.5C)**: Fetches linked content for enriched brainstorming.
- **`jira_links` in frontmatter (5.5C)**: Link manifests captured by `jira-import` from Jira API.
- **Jira link extraction (5.5C)**: Reading script extracts issue links, attachments, and remote links.

#### Not Yet Implemented (Stage 6A Builds These)

- Orchestrator entry point (`tools/orchestrator/`)
- Session spawning (invoking `claude` CLI with skill prompts)
- Worktree lifecycle management (create, assign index, cleanup)
- Crash recovery and session monitoring
- Idle/retry loop
- Graceful shutdown signal handling
- Worktree isolation strategy validation

### Pipeline Config — Default State Machine

The pipeline defines 8 states. States with `skill:` spawn a Claude session. States with `resolver:` are checked programmatically by the loop.

```yaml
states:
  Design:
    type: skill
    skill: phase-design
    transitions: [Build, User Design Feedback]
  User Design Feedback:
    type: skill
    skill: phase-awaiting-design-decision
    transitions: [Build]
  Build:
    type: skill
    skill: phase-build
    transitions: [Automatic Testing]
  Automatic Testing:
    type: skill
    skill: automatic-testing
    transitions: [Manual Testing]
  Manual Testing:
    type: skill
    skill: phase-manual-testing
    transitions: [Finalize]
  Finalize:
    type: skill
    skill: phase-finalize
    transitions: [Done, PR Created]
  PR Created:
    type: resolver
    resolver: pr-status
    transitions: [Done, Addressing Comments]
  Addressing Comments:
    type: skill
    skill: review-cycle
    transitions: [PR Created]
```

### Worktree Isolation Model

Every active stage runs in its own git worktree:

```
Main Repo (WORKTREE_INDEX=0)
  - main branch
  - Port 3000
  - DB: myapp_dev_0

Worktree 1 (WORKTREE_INDEX=1)
  - worktree_branch from stage frontmatter
  - Port 3001
  - DB: myapp_dev_1

Worktree 2 (WORKTREE_INDEX=2)
  - worktree_branch from stage frontmatter
  - Port 3002
  - DB: myapp_dev_2
```

Each repo defines its isolation strategy in `CLAUDE.md`:
- **Service ports**: Base port + `$WORKTREE_INDEX`
- **Database**: Separate DB per worktree (name includes index)
- **Environment**: `.env.worktree` template with index substitution
- **Verification**: Command that must pass in isolation

The orchestrator validates this strategy exists before creating worktrees. `WORKFLOW_MAX_PARALLEL` caps concurrent worktrees.

---

## Existing Infrastructure Supporting Stage 6A

### Already Implemented

- **`kanban-cli next --max N`**: Returns priority-sorted ready stages as JSON. Already respects session_active locking. Output includes stage ID, current status, next status, phase name.
- **`kanban-cli sync`**: Re-parses all files into SQLite. Stage 6A will NOT call this (that's 6B's exit gate), but it's available for testing.
- **`session_active`, `locked_at`, `locked_by`**: Already in stage frontmatter schema (types/stage.ts) AND SQLite stages table (database/schema.ts).
- **`worktree_branch`**: Already in stage frontmatter schema AND SQLite stages table.
- **`pr_url`, `pr_number`**: Already in stage frontmatter schema AND SQLite stages table.
- **`WORKFLOW_MAX_PARALLEL`**: Already defined in `workflowDefaultsSchema` (config/schema.ts), defaults to 1.
- **`WORKFLOW_GIT_PLATFORM`**: Already defined, defaults to 'auto'.
- **Pipeline config loader**: `loadPipelineConfig()` in config/loader.ts reads `.kanban-workflow.yaml` with Zod validation.
- **Default pipeline YAML**: `tools/kanban-cli/config/default-pipeline.yaml` defines the state machine.
- **Priority queue**: `kanban-cli next` already sorts by Addressing Comments > Manual Testing > Automatic Testing > Build > Design.
- **Frontmatter read/write**: `readYamlFrontmatter()` and `writeYamlFrontmatter()` in utils/yaml.ts handle stage file operations.
- **Stage file discovery**: `discoverStageFiles()` recursively walks epics/ directory.
- **Repo instance**: `createRepository()` factory in database/repository.ts creates typed DB accessor with all query methods.
- **Code host adapter additions (5.5B)**: `editPRBase(prNumber, newBase)`, `markPRReady(prNumber)`, `getBranchHead(branch)` on both GitHub and GitLab adapters.
- **Parent branch merge step (5.5B)**: `phase-build` reads `pending_merge_parents` from frontmatter and merges each parent branch before starting build work.
- **Draft MR creation (5.5B)**: `phase-finalize` sets `is_draft` and `mr_target_branch` based on parent count (0 parents → main, 1 parent → parent branch, >1 parents → main; creates as draft if `pending_merge_parents` non-empty).
- **`kanban-cli enrich` command (5.5C)**: Fetches linked content (Confluence pages, Jira issues, attachments, external URLs) for enriched brainstorming.
- **Jira link extraction (5.5C)**: Jira reading script extracts issue links, attachments, and remote links from Jira API.
- **`jira_links` population (5.5C)**: `jira-import` captures link manifests (`jira_links` array) in ticket frontmatter from Jira API.

### Not Yet Implemented

- Orchestrator entry point (`tools/orchestrator/`)
- Session spawning (invoking `claude` CLI with skill prompts)
- Worktree lifecycle management (create, assign index, cleanup)
- Crash recovery and session monitoring
- Idle/retry loop
- Graceful shutdown signal handling
- Worktree isolation strategy validation

---

## Open Questions (Resolve During Design Phase)

1. **How should the orchestrator invoke Claude Code sessions?** Options: `claude -p` with prompt string, `claude` with `--skill` flag if available, spawning a subprocess with a prompt file. Research the Claude Code CLI invocation options and how it handles stdin/stdout for skill prompts.

2. **Where does the orchestrator live?** The design says `tools/orchestrator/` — is this a separate TypeScript package alongside `tools/kanban-cli/`, or a new command within the existing kanban-cli? Consider: it needs to import kanban-cli logic (config loading, DB access) but has a very different runtime model (long-running loop vs one-shot CLI).

3. **How does the orchestrator read/write `session_active` in frontmatter?** Options: call `kanban-cli sync` after modifying frontmatter directly, use a shared library function, or add a new CLI command like `kanban-cli lock/unlock STAGE-XXX`.

4. **Single-tick vs continuous mode?** The design mentions both. Should the orchestrator support `--once` for single-tick execution (useful for testing and cron-based invocation) vs default continuous loop mode?

5. **How does crash recovery detect "session exited without updating status"?** Options: PID file monitoring, process exit code checking, timeout-based detection, or heartbeat mechanism. What is the timeout, and what constitutes "normal" session completion?

6. **What is the session prompt structure?** Each spawned session needs: the `ticket-stage-workflow` shared context + the phase-specific skill + the stage file path + environment variables. How are these assembled and passed to the Claude Code CLI?

7. **How should session output be captured and logged?** Should the orchestrator save session stdout/stderr, and where? Should it display output in real-time or batch?

---

## Instructions

Use the **brainstorming skill** for design and **subagent-driven development** for execution. Do NOT use epic-stage-workflow.

### Step 1: Brainstorm (Using Brainstorming Skill)

Invoke the brainstorming skill to explore the design space. During brainstorming:

1. Read the design doc sections for Stage 6A (Section 5 of end-state vision, Stage 6A section of redesign design doc)
2. Read the orchestrator flow diagram (`docs/plans/orchestrator-flow.dot`)
3. Study existing infrastructure: `kanban-cli next`, `kanban-cli sync`, pipeline config, `session_active` fields, frontmatter read/write utilities
4. Explore how `claude` CLI is invoked (research Claude Code CLI options for spawning sessions)
5. Resolve the Open Questions listed above
6. Identify what is **in scope** (Stage 6A infrastructure) vs **out of scope** (6B–6E business logic, exit gates, crons) — be explicit about what is future session work
7. Break into tasks with dependency mapping

### Step 2: Write Design Doc + Implementation Plan (MAIN AGENT — NOT Subagents)

The main agent has full brainstorming context — do NOT delegate this to subagents.

1. Write the design doc to `docs/plans/stage-6a-orchestrator-infrastructure-design.md`
   - Capture all resolved questions, architectural decisions, and trade-offs from brainstorming
   - Clearly document what is NOT in scope (deferred to 6B–6E)
2. Write the implementation plan to `docs/plans/stage-6a-orchestrator-infrastructure/IMPLEMENTATION_PLAN.md`
   - Task-level breakdown with full descriptions (subagents will read these verbatim)
   - Dependency graph between tasks
   - Each task specifies: goal, files, changes, tests, status

### Step 3: Execute Plan (Using Subagent-Driven Development)

Invoke the subagent-driven-development skill to execute the implementation plan:

1. Fresh subagent per task (implementer)
2. Spec compliance review after each task
3. Code quality review after each task
4. **Implement ALL review findings, no matter how minor** — reviewers' findings are not suggestions, they are required fixes
5. Review loops continue until both reviewers approve
6. Final code review across entire implementation
7. Integration test with real CLI calls
8. Write handoff for Stage 6B

### Key Constraints

- The existing 729 tests must continue passing throughout
- All CLI commands consume pipeline config (not hardcoded)
- `npm run verify` must pass after every task
- The orchestrator must work with the default pipeline config out of the box
- `WORKFLOW_MAX_PARALLEL` must be respected (default: 1 = sequential execution)
- Worktree creation must validate isolation strategy before proceeding
- Crash recovery must be safe — never leave a stage permanently locked
- Stage 6A is infrastructure only — no exit gate logic, no routing, no crons
- The orchestrator should be testable without actually spawning Claude sessions (injectable session executor)
- All file paths must be absolute when stored in SQLite or config (no relative paths)

### Suggested Sub-Stage Breakdown

This is a starting point — refine during design:

- **6A-1**: Project scaffolding — `tools/orchestrator/` package setup, TypeScript config, entry point, config loading
- **6A-2**: Stage discovery — wrapper around `kanban-cli next`, filtering, respecting `WORKFLOW_MAX_PARALLEL`
- **6A-3**: Session locking — `session_active` frontmatter read/write, lock acquisition, lock release
- **6A-4**: Worktree management — create, assign index, validate isolation strategy, cleanup
- **6A-5**: Session spawning — invoke Claude Code CLI with assembled prompt, capture exit, monitor lifecycle
- **6A-6**: Main loop — tick cycle (discover → lock → worktree → spawn → wait), idle behavior, retry
- **6A-7**: Crash recovery — detect abnormal exit, reset locks, log for visibility
- **6A-8**: Graceful shutdown — SIGINT/SIGTERM handling, drain active sessions, cleanup worktrees
- **6A-9**: Integration testing — end-to-end with mock session executor, verify locking, verify cleanup

### Testing the Current System

```bash
# Seed test repos
cd tools/kanban-cli
bash scripts/seed-test-repo.sh
bash scripts/seed-old-format-repo.sh

# Key commands the orchestrator will use
npx tsx src/cli/index.ts next --repo /tmp/kanban-test-repo --max 3 --pretty
npx tsx src/cli/index.ts sync --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts validate --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts board --repo /tmp/kanban-test-repo --pretty
npx tsx src/cli/index.ts learnings-count --repo /tmp/kanban-test-repo --pretty

# Run full test suite
npm run verify
```

---

## Next Steps After Stage 6A

After this session completes Stage 6A:

- **Stage 6B** will implement exit gate logic (status verification, SQLite updates, resolver execution)
- **Stage 6C** will implement completion cascade (propagating Done status up ticket/epic hierarchy)
- **Stage 6D** will implement the MR comment cron loop (independent 3rd system)
- **Stage 6E** will implement the insights threshold cron loop (independent 3rd system)

Each stage depends on the infrastructure from 6A but is otherwise independent. The cron loops (6D, 6E) can be developed in parallel with the main loop improvements (6B, 6C).
