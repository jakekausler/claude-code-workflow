# Stage 0D: Integration Touchpoints — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Document exactly how Stage 1+ should consume the config-driven pipeline system. Update the Stage 1-10 descriptions in the design doc to reflect modularity impacts. Produce integration specs that Stage 1 implementers can follow without needing context from the brainstorming session.

**Architecture:** This stage is primarily documentation and design doc updates, not new code. It bridges Stage 0 (pipeline config system) and Stage 1 (Foundation) by specifying the integration contracts. It also updates the existing delivery stage descriptions to account for the modularity architecture.

**Tech Stack:** Markdown. The design doc at `docs/plans/2026-02-16-kanban-workflow-redesign-design.md`.

**Depends on:** Stage 0A (Config Schema & Types) + Stage 0B (State Machine Engine) must be complete. Stage 0C (Pipeline Validator) should be complete or near-complete.

---

### Task 1: Write Integration Spec for Stage 1 (Foundation)

**Files:**
- Create: `tools/kanban-cli/docs/integration-spec-stage-1.md`

**Step 1: Write the integration spec**

This document tells the Stage 1 implementer exactly how to consume the pipeline config system. Write the following content:

```markdown
# Stage 1 Integration Spec: How to Consume the Pipeline Config System

## Overview

Stage 0 built the pipeline config system: YAML schema, config loader, state machine,
transition validator, resolver registry, and pipeline validator. Stage 1 builds the
CLI commands (board, graph, next, sync, validate) and SQLite cache. This document
specifies how Stage 1 code should use the Stage 0 modules.

## 1. Config Loading

Every CLI command should start by loading the pipeline config:

    import { loadConfig } from '../config/loader.js';
    const config = loadConfig({ repoPath: options.repo });

This handles global + repo override merging automatically.

## 2. Kanban Board Columns

The `kanban-cli board` command must NOT hardcode column names. Columns come from two sources:

**System columns** (hardcoded — these are structural):
- To Convert: tickets with `stages: []`
- Backlog: stages with unresolved `depends_on`
- Ready for Work: stages with `status: Not Started` and all deps resolved
- Done: stages with `status: Complete`

**Pipeline columns** (from config):

    import { StateMachine } from '../engine/state-machine.js';
    const sm = StateMachine.fromConfig(config);
    const pipelineColumns = sm.getAllStates().map(state => ({
      name: state.name,
      status: state.status,
      type: isSkillState(state) ? 'skill' : 'resolver',
    }));

The board JSON output should include both system and pipeline columns, in order:
`[To Convert, Backlog, Ready for Work, ...pipeline columns..., Done]`

## 3. The `next` Command and session_active

`kanban-cli next` returns stages ready to be picked up. A stage is ready when:
- Its status matches a pipeline state AND
- `session_active` is `false` in the stage frontmatter/SQLite

When filtering stages, check BOTH conditions:

    SELECT * FROM stages
    WHERE session_active = 0
    AND status IN (/* all pipeline state statuses */)
    AND kanban_column != 'backlog'  -- deps resolved

The orchestration loop (Stage 6) calls `next`, picks up a stage, sets
`session_active = true`, spawns a session, and resets it when done.

## 4. Frontmatter Changes

Stage files now include `session_active`:

    ---
    id: STAGE-001-001-001
    status: Design
    session_active: false
    # ... other fields unchanged
    ---

Add `session_active BOOLEAN DEFAULT 0` to the SQLite `stages` table.
Add `locked_at TEXT` and `locked_by TEXT` for debugging stale locks.

## 5. Transition Enforcement

When a skill or the CLI updates a stage's status, validate the transition:

    import { StateMachine } from '../engine/state-machine.js';
    import { TransitionValidator } from '../engine/transitions.js';

    const sm = StateMachine.fromConfig(config);
    const validator = new TransitionValidator(sm);
    const result = validator.validate(currentStatus, newTarget);

    if (!result.valid) {
      throw new Error(`Illegal transition: ${result.error}`);
    }

    const newStatus = validator.resolveTransitionTarget(currentStatus, newTarget);
    // Write newStatus to frontmatter + SQLite

## 6. Resolver Execution (Stage 6 Integration)

The orchestration loop (Stage 6) needs to run resolvers on each tick:

    import { ResolverRegistry } from '../resolvers/registry.js';
    import { registerBuiltinResolvers } from '../resolvers/builtins/index.js';

    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);

    // For each stage in a resolver state:
    const state = sm.getStateByStatus(stage.status);
    if (state && isResolverState(state)) {
      const result = await registry.execute(state.resolver, stage, context);
      if (result) {
        // Validate and apply transition
      }
    }

## 7. Priority Queue

The priority queue in `kanban-cli next` should sort by pipeline position.
Use the phase index from the config as a signal — stages further along the
pipeline (higher index) get higher priority, because they represent more
invested work:

    const phaseIndex = config.workflow.phases.findIndex(p => p.status === stage.status);
    // Higher phaseIndex = higher priority (closer to Done)

Combined with the existing priority rules:
1. Stages in Addressing Comments (high pipeline index)
2. Stages in Manual Testing
3. Stages ready for Automatic Testing
4. Stages ready for Build
5. Stages ready for Design (low pipeline index)
6. Explicit `priority` field
7. `due_date` proximity

## 8. validate Command Integration

`kanban-cli validate` (existing command for frontmatter validation) should
also run `validate-pipeline` and include pipeline validation results in its
output. This means a single `validate` command checks both file integrity
AND pipeline config integrity.
```

**Step 2: Commit**

```bash
git add tools/kanban-cli/docs/integration-spec-stage-1.md
git commit -m "docs(kanban-cli): add Stage 1 integration spec for pipeline config consumption"
```

---

### Task 2: Update Stage 1 Description in Design Doc

**Files:**
- Modify: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md` (Stage 1 section)

**Step 1: Update the Stage 1 "What ships" list**

Find the Stage 1 section and update its description to reflect that it now consumes the pipeline config system from Stage 0. Key changes:

- CLI commands (`board`, `next`) read columns from the pipeline config, not hardcoded
- SQLite schema includes `session_active`, `locked_at`, `locked_by` on stages table
- `kanban-cli validate` also runs `validate-pipeline`
- Phase skills reference transitions from config instead of hardcoding next phases
- `kanban-cli next` filters by `session_active = false`
- Transition enforcement uses `TransitionValidator` for all status changes

Add a note: "Stage 1 depends on Stage 0 (Pipeline Configuration). All CLI commands consume the pipeline config system via `loadConfig()` and `StateMachine.fromConfig()`. See `tools/kanban-cli/docs/integration-spec-stage-1.md` for detailed integration contracts."

**Step 2: Update the "What does NOT ship" list**

Remove items that now ship in Stage 0:
- Pipeline config system (shipped in Stage 0)
- Pipeline validator (shipped in Stage 0)

**Step 3: Commit**

```bash
git add docs/plans/2026-02-16-kanban-workflow-redesign-design.md
git commit -m "docs: update Stage 1 description to reflect Stage 0 pipeline config dependency"
```

---

### Task 3: Update Stages 2-10 Descriptions in Design Doc

**Files:**
- Modify: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md` (Stages 2-10)

**Step 1: Update Stage 2 (Migration + Conversion)**

Add note: "Migration tool must generate config-compatible status values. When migrating stages, set `session_active: false` in frontmatter. `convert-ticket` skill must set stages to `Not Started` status (the system column entry point)."

**Step 2: Update Stage 3 (Remote Mode + MR/PR)**

Add note: "Remote mode behavior is configured in pipeline config via `WORKFLOW_REMOTE_MODE` default. The `pr-status` built-in resolver (created in Stage 0) is the production implementation target — Stage 0 provides the stub, Stage 3 provides the code host API integration that makes it real. The `review-cycle` skill must transition to `PR Created` (using the status from config), not a hardcoded value."

**Step 3: Update Stage 4 (Jira Integration)**

Add note: "Jira integration logic lives in the skills that handle each pipeline state, not in a separate integration layer. When a user creates a custom pipeline, their custom skills handle Jira interaction if needed. The default skills (phase-design, phase-finalize, etc.) include Jira logic. `WORKFLOW_JIRA_CONFIRM` is set in the pipeline config defaults."

**Step 4: Update Stage 5 (Auto-Design + Auto-Analysis)**

Add note: "`WORKFLOW_AUTO_DESIGN` and `WORKFLOW_LEARNINGS_THRESHOLD` are set in the pipeline config defaults section. Skills read these from the config (passed via orchestration context), not directly from environment variables."

**Step 5: Update Stage 6 (Parallel Orchestration)**

Add note: "The orchestration loop is config-driven. It reads the pipeline config to determine which states are skill vs resolver. For skill states: check `session_active`, lock, spawn session. For resolver states: call the resolver function, apply transition. Priority queue ordering uses pipeline phase index as a factor. `WORKFLOW_MAX_PARALLEL` is read from config defaults."

**Step 6: Update Stage 7 (Slack Notifications)**

Add note: "`WORKFLOW_SLACK_WEBHOOK` is set in the pipeline config defaults. Slack notification logic lives in the `phase-finalize` skill (or whatever custom skill handles MR/PR creation). Users with custom pipelines add Slack to their own finalize-equivalent skill."

**Step 7: Update Stage 8 (Global CLI + Multi-Repo)**

Add note: "Cross-repo queries use the same pipeline config loading. Each repo can have its own `.kanban-workflow.yaml` with a different pipeline. The global kanban board shows stages from different repos that may be in different pipelines. The board output includes the pipeline config source (global vs repo) for each stage."

**Step 8: Update Stage 9 (Web UI)**

Add note: "The web UI reads pipeline config to render columns dynamically. Different repos may have different column sets. The UI needs to handle variable pipeline lengths and column names. Column colors and ordering come from the pipeline config phase list order."

**Step 9: Update Stage 10 (Session Monitor Integration)**

Add note: "Session-to-stage mapping uses `session_active` and `locked_by` fields from SQLite. When a session is active for a stage, the monitor knows which pipeline state the stage is in and can display the skill name from config."

**Step 10: Commit**

```bash
git add docs/plans/2026-02-16-kanban-workflow-redesign-design.md
git commit -m "docs: update Stages 2-10 descriptions with modularity integration notes"
```

---

### Task 4: Update Open Questions in Design Doc

**Files:**
- Modify: `docs/plans/2026-02-16-kanban-workflow-redesign-design.md` (Section 5)

**Step 1: Mark resolved questions**

Add to Section 5.1 (Resolved):

| Question | Resolution |
|----------|-----------|
| Where does modularity configuration live? | Global `~/.config/kanban-workflow/config.yaml` + per-repo `.kanban-workflow.yaml`. Phases replace, defaults merge. |
| How are phases customized? | Flat state machine in YAML. Each state has a skill or resolver, plus transitions_to. |
| How are integrations handled? | Integration logic lives in skills. Each skill handles its own integrations. |
| How is the pipeline validated? | `kanban-cli validate-pipeline` — 4 layers: config, graph, skill content (LLM), resolver code. |
| How are custom phases discovered? | Config points to skill names. Skills are Claude Code skills (existing discovery mechanism). |
| What are the two kinds of pipeline states? | Skill states (Claude session) and resolver states (TypeScript function). |
| How is concurrent pickup prevented? | `session_active` field in frontmatter + SQLite. Orchestration loop locks before spawning. |

**Step 2: Add new open questions discovered during Stage 0**

Add any questions that surfaced during Stage 0A-0C implementation to the appropriate stage section in 5.2.

**Step 3: Commit**

```bash
git add docs/plans/2026-02-16-kanban-workflow-redesign-design.md
git commit -m "docs: update open questions with modularity resolutions"
```

---

### Task 5: Update End-State Vision Document

**Files:**
- Modify: `docs/plans/2026-02-16-kanban-workflow-end-state.md`

**Step 1: Update column names throughout**

Apply the four column renames:
- Awaiting Design Decision → User Design Feedback
- Refinement → Automatic Testing
- Awaiting Refinement → Manual Testing
- Awaiting Merge → PR Created

**Step 2: Add modularity section**

Add a section to the end-state vision describing the config-driven architecture:
- Config hierarchy (global + repo)
- Skill vs resolver states
- Pipeline validator
- Custom pipeline examples
- How the web UI handles variable pipelines

**Step 3: Update Mermaid diagrams**

Update any Mermaid diagrams that reference the old column names.

**Step 4: Commit**

```bash
git add docs/plans/2026-02-16-kanban-workflow-end-state.md
git commit -m "docs: update end-state vision with modularity architecture and column renames"
```

---

### Task 6: Update Complete Flowchart Document

**Files:**
- Modify: `docs/plans/2026-02-16-kanban-workflow-complete-flowchart.md`

**Step 1: Update column names in the Mermaid flowchart**

Apply the four column renames throughout the flowchart nodes and labels.

**Step 2: Add a note about config-driven columns**

Add a note at the top: "The pipeline columns shown in this flowchart represent the default pipeline configuration. Users can define custom pipelines with different columns, phases, and transitions. See the design document Section 6 for details."

**Step 3: Commit**

```bash
git add docs/plans/2026-02-16-kanban-workflow-complete-flowchart.md
git commit -m "docs: update flowchart with column renames and modularity note"
```

---

### Completion Checklist

- [ ] Integration spec for Stage 1 written (how CLI commands consume pipeline config)
- [ ] Stage 1 description updated in design doc (config-driven, session_active, transition enforcement)
- [ ] Stages 2-10 descriptions updated with modularity integration notes
- [ ] Open questions updated (new resolutions, new questions from Stage 0)
- [ ] End-state vision updated with column renames and modularity architecture
- [ ] Complete flowchart updated with column renames and modularity note
- [ ] Design doc is self-sufficient — a future session can write Stage 1+ plans from it alone
- [ ] All changes committed incrementally
