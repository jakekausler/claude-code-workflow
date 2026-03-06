# Stage 0B: State Machine Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the state machine from parsed config, enforce transition rules at runtime, define the resolver interface, and provide a resolver registration/loading mechanism with built-in stubs.

**Architecture:** A StateMachine class built from a validated PipelineConfig. It provides state lookups, transition validation, and resolver management. The resolver interface is a simple function signature. Built-in resolvers are stubs (real implementations come in later stages).

**Tech Stack:** TypeScript, vitest (testing). No new dependencies — builds on types and config from Stage 0A.

**Depends on:** Stage 0A (Config Schema & Types) must be complete.

---

### Task 1: Build State Machine Core

**Files:**
- Create: `tools/kanban-cli/src/engine/state-machine.ts`
- Create: `tools/kanban-cli/tests/engine/state-machine.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      {
        name: 'Design',
        skill: 'phase-design',
        status: 'Design',
        transitions_to: ['Build', 'User Design Feedback'],
      },
      {
        name: 'User Design Feedback',
        skill: 'user-design-feedback',
        status: 'User Design Feedback',
        transitions_to: ['Build'],
      },
      {
        name: 'Build',
        skill: 'phase-build',
        status: 'Build',
        transitions_to: ['Done'],
      },
    ],
  },
};

describe('StateMachine', () => {
  it('creates from a valid config', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm).toBeDefined();
  });

  it('returns the entry state', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const entry = sm.getEntryState();
    expect(entry.name).toBe('Design');
  });

  it('looks up state by status', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const state = sm.getStateByStatus('Build');
    expect(state?.name).toBe('Build');
  });

  it('looks up state by name', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const state = sm.getStateByName('User Design Feedback');
    expect(state?.status).toBe('User Design Feedback');
  });

  it('returns null for unknown status', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm.getStateByStatus('NonExistent')).toBeNull();
  });

  it('returns all states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    expect(sm.getAllStates()).toHaveLength(3);
  });

  it('returns all status values', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const statuses = sm.getAllStatuses();
    expect(statuses).toContain('Design');
    expect(statuses).toContain('Build');
    expect(statuses).toContain('User Design Feedback');
  });

  it('identifies skill states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const skillStates = sm.getSkillStates();
    expect(skillStates).toHaveLength(3);
  });

  it('identifies resolver states', () => {
    const sm = StateMachine.fromConfig(testConfig);
    const resolverStates = sm.getResolverStates();
    expect(resolverStates).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/engine/state-machine.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement StateMachine**

```typescript
import type {
  PipelineConfig,
  PipelineState,
  SkillState,
  ResolverState,
} from '../types/pipeline.js';
import { isSkillState, isResolverState } from '../types/pipeline.js';

export class StateMachine {
  private statesByName: Map<string, PipelineState>;
  private statesByStatus: Map<string, PipelineState>;
  private entryPhaseName: string;

  private constructor(config: PipelineConfig) {
    this.statesByName = new Map();
    this.statesByStatus = new Map();
    this.entryPhaseName = config.workflow.entry_phase;

    for (const phase of config.workflow.phases) {
      this.statesByName.set(phase.name, phase);
      this.statesByStatus.set(phase.status, phase);
    }
  }

  static fromConfig(config: PipelineConfig): StateMachine {
    return new StateMachine(config);
  }

  getEntryState(): PipelineState {
    const entry = this.statesByName.get(this.entryPhaseName);
    if (!entry) {
      throw new Error(`Entry phase "${this.entryPhaseName}" not found in pipeline config`);
    }
    return entry;
  }

  getStateByStatus(status: string): PipelineState | null {
    return this.statesByStatus.get(status) ?? null;
  }

  getStateByName(name: string): PipelineState | null {
    return this.statesByName.get(name) ?? null;
  }

  getAllStates(): PipelineState[] {
    return Array.from(this.statesByName.values());
  }

  getAllStatuses(): string[] {
    return Array.from(this.statesByStatus.keys());
  }

  getSkillStates(): SkillState[] {
    return this.getAllStates().filter(isSkillState);
  }

  getResolverStates(): ResolverState[] {
    return this.getAllStates().filter(isResolverState);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/engine/state-machine.test.ts`
Expected: All 9 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/engine/state-machine.ts tools/kanban-cli/tests/engine/state-machine.test.ts
git commit -m "feat(kanban-cli): add StateMachine class with state lookups"
```

---

### Task 2: Add Transition Validation

**Files:**
- Create: `tools/kanban-cli/src/engine/transitions.ts`
- Create: `tools/kanban-cli/tests/engine/transitions.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { TransitionValidator } from '../../src/engine/transitions.js';
import { StateMachine } from '../../src/engine/state-machine.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';
import { DONE_TARGET } from '../../src/types/pipeline.js';

const testConfig: PipelineConfig = {
  workflow: {
    entry_phase: 'Design',
    phases: [
      {
        name: 'Design',
        skill: 'phase-design',
        status: 'Design',
        transitions_to: ['Build', 'User Design Feedback'],
      },
      {
        name: 'User Design Feedback',
        skill: 'user-design-feedback',
        status: 'User Design Feedback',
        transitions_to: ['Build'],
      },
      {
        name: 'Build',
        skill: 'phase-build',
        status: 'Build',
        transitions_to: ['Done'],
      },
    ],
  },
};

describe('TransitionValidator', () => {
  const sm = StateMachine.fromConfig(testConfig);
  const validator = new TransitionValidator(sm);

  it('allows a valid transition (Design → Build)', () => {
    const result = validator.validate('Design', 'Build');
    expect(result.valid).toBe(true);
  });

  it('allows a valid transition (Design → User Design Feedback)', () => {
    const result = validator.validate('Design', 'User Design Feedback');
    expect(result.valid).toBe(true);
  });

  it('allows transition to Done when declared', () => {
    const result = validator.validate('Build', 'Done');
    expect(result.valid).toBe(true);
  });

  it('rejects an undeclared transition (Design → Done)', () => {
    const result = validator.validate('Design', 'Done');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('rejects transition from unknown status', () => {
    const result = validator.validate('NonExistent', 'Build');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects transition to unknown status (not a state and not Done)', () => {
    const result = validator.validate('Design', 'NonExistent');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('rejects self-transition', () => {
    const result = validator.validate('Design', 'Design');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid transition');
  });

  it('resolves target name to target status', () => {
    // transitions_to uses names, but the status field is what's stored in frontmatter
    // "User Design Feedback" (name) has status "User Design Feedback" (same in default config)
    const result = validator.resolveTransitionTarget('Design', 'User Design Feedback');
    expect(result).toBe('User Design Feedback');
  });

  it('resolves Done target', () => {
    const result = validator.resolveTransitionTarget('Build', 'Done');
    expect(result).toBe('Complete');
  });

  it('returns null for invalid target', () => {
    const result = validator.resolveTransitionTarget('Design', 'NonExistent');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/engine/transitions.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement TransitionValidator**

```typescript
import type { StateMachine } from './state-machine.js';
import { DONE_TARGET } from '../types/pipeline.js';

export interface TransitionResult {
  valid: boolean;
  error?: string;
}

export class TransitionValidator {
  constructor(private stateMachine: StateMachine) {}

  /**
   * Check if transitioning from one status to a target name is valid.
   *
   * @param fromStatus - Current status value (from frontmatter)
   * @param toName - Target state name (from transitions_to list)
   */
  validate(fromStatus: string, toName: string): TransitionResult {
    const fromState = this.stateMachine.getStateByStatus(fromStatus);
    if (!fromState) {
      return { valid: false, error: `Source status "${fromStatus}" not found in pipeline` };
    }

    if (!fromState.transitions_to.includes(toName)) {
      return {
        valid: false,
        error: `"${toName}" is not a valid transition from "${fromState.name}". Valid targets: ${fromState.transitions_to.join(', ')}`,
      };
    }

    // Verify target exists (or is Done)
    if (toName !== DONE_TARGET) {
      const toState = this.stateMachine.getStateByName(toName);
      if (!toState) {
        return {
          valid: false,
          error: `Target state "${toName}" not found in pipeline`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Resolve a transition target name to the status value that should be
   * written to frontmatter.
   *
   * @param fromStatus - Current status value
   * @param toName - Target state name
   * @returns The status string to write, or null if invalid
   */
  resolveTransitionTarget(fromStatus: string, toName: string): string | null {
    const result = this.validate(fromStatus, toName);
    if (!result.valid) return null;

    if (toName === DONE_TARGET) return 'Complete';

    const toState = this.stateMachine.getStateByName(toName);
    return toState?.status ?? null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/engine/transitions.test.ts`
Expected: All 10 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/engine/transitions.ts tools/kanban-cli/tests/engine/transitions.test.ts
git commit -m "feat(kanban-cli): add TransitionValidator for runtime transition enforcement"
```

---

### Task 3: Define Resolver Interface & Registry

**Files:**
- Create: `tools/kanban-cli/src/resolvers/types.ts`
- Create: `tools/kanban-cli/src/resolvers/registry.ts`
- Create: `tools/kanban-cli/tests/resolvers/registry.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import type { ResolverFn, ResolverContext } from '../../src/resolvers/types.js';

describe('ResolverRegistry', () => {
  it('registers and retrieves a resolver', () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = () => null;
    registry.register('test-resolver', fn);
    expect(registry.get('test-resolver')).toBe(fn);
  });

  it('returns null for unregistered resolver', () => {
    const registry = new ResolverRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('checks if a resolver is registered', () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = () => null;
    registry.register('test-resolver', fn);
    expect(registry.has('test-resolver')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all registered resolver names', () => {
    const registry = new ResolverRegistry();
    registry.register('resolver-a', () => null);
    registry.register('resolver-b', () => null);
    const names = registry.listNames();
    expect(names).toContain('resolver-a');
    expect(names).toContain('resolver-b');
    expect(names).toHaveLength(2);
  });

  it('throws when registering duplicate name', () => {
    const registry = new ResolverRegistry();
    registry.register('test-resolver', () => null);
    expect(() => registry.register('test-resolver', () => null)).toThrow('already registered');
  });

  it('executes a resolver and returns its result', async () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = (_stage, _ctx) => 'Done';
    registry.register('always-done', fn);

    const result = await registry.execute('always-done', { id: 'STAGE-001' } as any, {} as any);
    expect(result).toBe('Done');
  });

  it('execute returns null for unregistered resolver', async () => {
    const registry = new ResolverRegistry();
    const result = await registry.execute('nonexistent', {} as any, {} as any);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/resolvers/registry.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the resolver types**

```typescript
/**
 * Minimal stage data passed to resolvers.
 * Full stage type will be defined in Stage 1 when frontmatter parsing is built.
 */
export interface ResolverStageInput {
  id: string;
  status: string;
  ticket_id?: string;
  epic_id?: string;
  pr_url?: string;
  worktree_branch?: string;
  refinement_type?: string[];
  [key: string]: unknown;
}

/**
 * Context provided to resolver functions by the orchestration loop.
 */
export interface ResolverContext {
  /** Access to code host API (GitHub/GitLab) — injected by orchestration loop */
  codeHost?: {
    getPRStatus(prUrl: string): Promise<{
      merged: boolean;
      hasNewUnresolvedComments: boolean;
      state: string;
    }>;
  };
  /** Current environment variable values */
  env: Record<string, string | undefined>;
}

/**
 * A resolver function. Called by the orchestration loop on each tick
 * for stages in a resolver state.
 *
 * @returns A transition target name (from transitions_to), or null for no change.
 */
export type ResolverFn = (
  stage: ResolverStageInput,
  context: ResolverContext
) => string | null | Promise<string | null>;
```

**Step 4: Write the resolver registry**

```typescript
import type { ResolverFn, ResolverStageInput, ResolverContext } from './types.js';

export class ResolverRegistry {
  private resolvers: Map<string, ResolverFn> = new Map();

  /**
   * Register a resolver function by name.
   * @throws If a resolver with this name is already registered.
   */
  register(name: string, fn: ResolverFn): void {
    if (this.resolvers.has(name)) {
      throw new Error(`Resolver "${name}" is already registered`);
    }
    this.resolvers.set(name, fn);
  }

  /** Get a resolver function by name, or null if not registered. */
  get(name: string): ResolverFn | null {
    return this.resolvers.get(name) ?? null;
  }

  /** Check if a resolver is registered. */
  has(name: string): boolean {
    return this.resolvers.has(name);
  }

  /** List all registered resolver names. */
  listNames(): string[] {
    return Array.from(this.resolvers.keys());
  }

  /**
   * Execute a resolver by name.
   * @returns The resolver's return value, or null if the resolver is not registered.
   */
  async execute(
    name: string,
    stage: ResolverStageInput,
    context: ResolverContext
  ): Promise<string | null> {
    const fn = this.resolvers.get(name);
    if (!fn) return null;
    return fn(stage, context);
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/resolvers/registry.test.ts`
Expected: All 7 tests PASS.

**Step 6: Commit**

```bash
git add tools/kanban-cli/src/resolvers/types.ts tools/kanban-cli/src/resolvers/registry.ts tools/kanban-cli/tests/resolvers/registry.test.ts
git commit -m "feat(kanban-cli): add resolver interface and registry"
```

---

### Task 4: Built-in Resolver Stubs

**Files:**
- Create: `tools/kanban-cli/src/resolvers/builtins/pr-status.ts`
- Create: `tools/kanban-cli/src/resolvers/builtins/stage-router.ts`
- Create: `tools/kanban-cli/src/resolvers/builtins/index.ts`
- Create: `tools/kanban-cli/tests/resolvers/builtins.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import { stageRouterResolver } from '../../src/resolvers/builtins/stage-router.js';
import { registerBuiltinResolvers } from '../../src/resolvers/builtins/index.js';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import type { ResolverStageInput, ResolverContext } from '../../src/resolvers/types.js';

const baseContext: ResolverContext = { env: {} };

describe('prStatusResolver', () => {
  it('returns Done when PR is merged', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: async () => ({ merged: true, hasNewUnresolvedComments: false, state: 'merged' }),
      },
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('returns Addressing Comments when PR has new comments', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: async () => ({ merged: false, hasNewUnresolvedComments: true, state: 'open' }),
      },
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBe('Addressing Comments');
  });

  it('returns null when no changes', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: async () => ({ merged: false, hasNewUnresolvedComments: false, state: 'open' }),
      },
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });

  it('returns null when no code host available', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const result = await prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  it('returns null when no pr_url on stage', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created' };
    const result = await prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });
});

describe('stageRouterResolver', () => {
  it('returns null by default (no routing configured)', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing' };
    const result = stageRouterResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  // Note: The stage-router is a stub. Real routing logic will be configured
  // per-repo by users who create custom resolvers. This built-in is a no-op
  // placeholder that demonstrates the resolver pattern.
});

describe('registerBuiltinResolvers', () => {
  it('registers all built-in resolvers', () => {
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    expect(registry.has('pr-status')).toBe(true);
    expect(registry.has('stage-router')).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/resolvers/builtins.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement pr-status resolver**

```typescript
import type { ResolverFn } from '../types.js';

/**
 * Built-in resolver for the "PR Created" state.
 * Polls the code host API to check PR status.
 *
 * Returns:
 * - "Done" if PR is merged
 * - "Addressing Comments" if PR has new unresolved comments
 * - null if no change (PR still open, no new comments)
 */
export const prStatusResolver: ResolverFn = async (stage, context) => {
  if (!context.codeHost || !stage.pr_url) {
    return null;
  }

  const status = await context.codeHost.getPRStatus(stage.pr_url);

  if (status.merged) return 'Done';
  if (status.hasNewUnresolvedComments) return 'Addressing Comments';
  return null;
};
```

**Step 4: Implement stage-router resolver (stub)**

```typescript
import type { ResolverFn } from '../types.js';

/**
 * Built-in stub resolver for stage routing.
 *
 * This is a no-op placeholder. Users who need routing create custom resolvers
 * that read stage metadata (e.g., refinement_type) and return the appropriate
 * first phase. See docs/plans/2026-02-16-kanban-workflow-redesign-design.md
 * Section 6.4 for examples.
 *
 * Returns null (no routing — stages should use entry_phase directly).
 */
export const stageRouterResolver: ResolverFn = (_stage, _context) => {
  return null;
};
```

**Step 5: Implement registration function**

```typescript
import type { ResolverRegistry } from '../registry.js';
import { prStatusResolver } from './pr-status.js';
import { stageRouterResolver } from './stage-router.js';

/**
 * Register all built-in resolvers with the given registry.
 */
export function registerBuiltinResolvers(registry: ResolverRegistry): void {
  registry.register('pr-status', prStatusResolver);
  registry.register('stage-router', stageRouterResolver);
}
```

**Step 6: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/resolvers/builtins.test.ts`
Expected: All 7 tests PASS.

**Step 7: Run all tests**

Run: `cd tools/kanban-cli && npm run verify`
Expected: All tests pass, lint passes.

**Step 8: Commit**

```bash
git add tools/kanban-cli/src/resolvers/builtins/ tools/kanban-cli/tests/resolvers/builtins.test.ts
git commit -m "feat(kanban-cli): add built-in resolver stubs (pr-status, stage-router)"
```

---

### Task 5: Update Index Exports

**Files:**
- Modify: `tools/kanban-cli/src/index.ts`

**Step 1: Add engine and resolver exports**

Add the following to the existing `src/index.ts`:

```typescript
// Engine
export { StateMachine } from './engine/state-machine.js';
export { TransitionValidator } from './engine/transitions.js';
export type { TransitionResult } from './engine/transitions.js';

// Resolvers
export type { ResolverFn, ResolverStageInput, ResolverContext } from './resolvers/types.js';
export { ResolverRegistry } from './resolvers/registry.js';
export { registerBuiltinResolvers } from './resolvers/builtins/index.js';
export { prStatusResolver } from './resolvers/builtins/pr-status.js';
export { stageRouterResolver } from './resolvers/builtins/stage-router.js';
```

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): export engine and resolver modules"
```

---

### Completion Checklist

- [ ] StateMachine class built from PipelineConfig with state lookups (by name, by status)
- [ ] TransitionValidator enforces legal transitions at runtime
- [ ] Resolver interface defined (ResolverFn type, ResolverContext, ResolverStageInput)
- [ ] ResolverRegistry provides register/get/has/execute/listNames
- [ ] Built-in pr-status resolver (polls code host, returns Done/Addressing Comments/null)
- [ ] Built-in stage-router resolver (stub — no-op placeholder for custom implementations)
- [ ] All tests passing
- [ ] All code compiles cleanly
- [ ] Each task committed incrementally
