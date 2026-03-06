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

**System columns** (hardcoded -- these are structural):
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
Use the phase index from the config as a signal -- stages further along the
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
