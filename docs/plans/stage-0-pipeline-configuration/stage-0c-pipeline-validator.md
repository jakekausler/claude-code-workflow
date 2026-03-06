# Stage 0C: Pipeline Validator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the four-layer pipeline validator (`kanban-cli validate-pipeline`) that audits config structure, graph integrity, skill content alignment, and resolver code correctness.

**Architecture:** Four independent validator modules, each returning errors/warnings. An orchestrator runs all four and aggregates results. The CLI command wraps the orchestrator. Layers 1-2 are pure logic (no I/O beyond config). Layer 3 uses an LLM to read skill content. Layer 4 does TypeScript import analysis and dry-runs.

**Tech Stack:** TypeScript, vitest (testing), commander (CLI). Layers 3-4 may need additional utilities for skill file discovery and TypeScript analysis.

**Depends on:** Stage 0A (Config Schema & Types) + Stage 0B (State Machine Engine) must be complete.

---

### Task 1: Layer 1 — Config Validation

**Files:**
- Create: `tools/kanban-cli/src/validators/config-validator.ts`
- Create: `tools/kanban-cli/tests/validators/config-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/validators/config-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateConfig (Layer 1)', () => {
  const validConfig: PipelineConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
        { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
      ],
    },
  };

  it('accepts a valid config with no errors', () => {
    const result = validateConfig(validConfig);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when entry_phase references nonexistent state', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'NonExistent',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('entry_phase'))).toBe(true);
  });

  it('errors when transitions_to references nonexistent state (not Done)', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['NonExistent'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('NonExistent'))).toBe(true);
  });

  it('accepts Done as a valid transition target', () => {
    const result = validateConfig(validConfig);
    // Build → Done is valid
    expect(result.errors).toHaveLength(0);
  });

  it('errors on duplicate status values', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Active', transitions_to: ['Build'] },
          { name: 'Build', skill: 'phase-build', status: 'Active', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('duplicate') || e.includes('Duplicate'))).toBe(true);
  });

  it('errors on duplicate state names', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Design2'] },
          { name: 'Design', skill: 'phase-build', status: 'Design2', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.errors.some((e) => e.includes('duplicate') || e.includes('Duplicate'))).toBe(true);
  });

  it('warns on phases not reachable via transitions (orphans caught here as warning)', () => {
    // Note: full reachability is Layer 2, but obvious disconnects can be warned here
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
          { name: 'Orphan', skill: 'orphan-skill', status: 'Orphan', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.warnings.some((w) => w.includes('Orphan'))).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/config-validator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement config validator**

```typescript
import type { PipelineConfig } from '../types/pipeline.js';
import { DONE_TARGET } from '../types/pipeline.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Layer 1: Config Validation (static parsing).
 *
 * Checks:
 * - entry_phase references an existing state name
 * - All transitions_to targets reference existing state names or "Done"
 * - No duplicate status values
 * - No duplicate state names
 * - Warns on states not reachable from any other state's transitions_to
 */
export function validateConfig(config: PipelineConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { phases, entry_phase } = config.workflow;

  const stateNames = new Set(phases.map((p) => p.name));
  const statusValues = new Map<string, string>(); // status → name

  // Check for duplicate names
  const namesSeen = new Set<string>();
  for (const phase of phases) {
    if (namesSeen.has(phase.name)) {
      errors.push(`Duplicate state name: "${phase.name}"`);
    }
    namesSeen.add(phase.name);
  }

  // Check for duplicate statuses
  for (const phase of phases) {
    const existing = statusValues.get(phase.status);
    if (existing) {
      errors.push(
        `Duplicate status value "${phase.status}" used by both "${existing}" and "${phase.name}"`
      );
    }
    statusValues.set(phase.status, phase.name);
  }

  // Check entry_phase exists
  if (!stateNames.has(entry_phase)) {
    errors.push(`entry_phase "${entry_phase}" does not reference an existing state name`);
  }

  // Check all transitions_to targets exist
  for (const phase of phases) {
    for (const target of phase.transitions_to) {
      if (target !== DONE_TARGET && !stateNames.has(target)) {
        errors.push(
          `State "${phase.name}": transitions_to target "${target}" does not exist in the pipeline`
        );
      }
    }
  }

  // Warn on unreachable states (not targeted by any transition and not the entry phase)
  const targetedStates = new Set<string>([entry_phase]);
  for (const phase of phases) {
    for (const target of phase.transitions_to) {
      if (target !== DONE_TARGET) {
        targetedStates.add(target);
      }
    }
  }
  for (const phase of phases) {
    if (!targetedStates.has(phase.name)) {
      warnings.push(
        `State "${phase.name}" is not reachable from any other state's transitions_to or entry_phase`
      );
    }
  }

  return { errors, warnings };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/config-validator.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/validators/config-validator.ts tools/kanban-cli/tests/validators/config-validator.test.ts
git commit -m "feat(kanban-cli): add Layer 1 config validator (static parsing)"
```

---

### Task 2: Layer 2 — Graph Validation

**Files:**
- Create: `tools/kanban-cli/src/validators/graph-validator.ts`
- Create: `tools/kanban-cli/tests/validators/graph-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validateGraph } from '../../src/validators/graph-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateGraph (Layer 2)', () => {
  it('accepts a simple linear pipeline', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when a state cannot reach Done', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['A'] }, // cycle, no Done
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors.some((e) => e.includes('cannot reach Done'))).toBe(true);
  });

  it('accepts a cycle that has an exit to Done', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['A', 'Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on unreachable state from entry', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'A',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['Done'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['Done'] }, // unreachable
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('accepts a branching/converging DAG', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Router',
        phases: [
          { name: 'Router', resolver: 'stage-router', status: 'Routing', transitions_to: ['A', 'B'] },
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['C'] },
          { name: 'B', skill: 's-b', status: 'B', transitions_to: ['C'] },
          { name: 'C', skill: 's-c', status: 'C', transitions_to: ['Done'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts the default pipeline', () => {
    // Import and test against the actual default config
    const { defaultPipelineConfig } = await import('../../src/config/defaults.js');
    const result = validateGraph(defaultPipelineConfig);
    expect(result.errors).toHaveLength(0);
  });

  it('handles complex cycle with exit path', () => {
    // PR Created ↔ Addressing Comments, with PR Created → Done
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Finalize',
        phases: [
          { name: 'Finalize', skill: 's-f', status: 'Finalize', transitions_to: ['PR Created'] },
          { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done', 'Addressing Comments'] },
          { name: 'Addressing Comments', skill: 'review-cycle', status: 'Addressing Comments', transitions_to: ['PR Created'] },
        ],
      },
    };
    const result = validateGraph(config);
    expect(result.errors).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/graph-validator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement graph validator**

```typescript
import type { PipelineConfig } from '../types/pipeline.js';
import { DONE_TARGET } from '../types/pipeline.js';
import type { ValidationResult } from './config-validator.js';

/**
 * Layer 2: Graph Validation (traversal).
 *
 * Checks:
 * - All states reachable from entry_phase via transitions_to chains
 * - All states can reach Done via some path
 * - No dead ends (states with no path to Done)
 * - Cycles are allowed if at least one state in the cycle can reach Done
 */
export function validateGraph(config: PipelineConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { phases, entry_phase } = config.workflow;

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const phase of phases) {
    adjacency.set(phase.name, phase.transitions_to.filter((t) => t !== DONE_TARGET));
  }

  // Track which states can reach Done
  const canReachDone = new Set<string>();
  for (const phase of phases) {
    if (phase.transitions_to.includes(DONE_TARGET)) {
      canReachDone.add(phase.name);
    }
  }

  // BFS backward from Done-reaching states to find all states that can eventually reach Done
  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of phases) {
      if (canReachDone.has(phase.name)) continue;
      // If any of this phase's transitions_to targets can reach Done, so can this phase
      const targets = phase.transitions_to.filter((t) => t !== DONE_TARGET);
      if (targets.some((t) => canReachDone.has(t))) {
        canReachDone.add(phase.name);
        changed = true;
      }
    }
  }

  // Check all states can reach Done
  for (const phase of phases) {
    if (!canReachDone.has(phase.name)) {
      errors.push(
        `State "${phase.name}" cannot reach Done via any transition path`
      );
    }
  }

  // BFS forward from entry_phase to find reachable states
  const reachable = new Set<string>();
  const queue: string[] = [entry_phase];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const targets = adjacency.get(current) ?? [];
    for (const target of targets) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  // Check all states are reachable from entry
  for (const phase of phases) {
    if (!reachable.has(phase.name)) {
      errors.push(
        `State "${phase.name}" is not reachable from entry_phase "${entry_phase}"`
      );
    }
  }

  return { errors, warnings };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/graph-validator.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/validators/graph-validator.ts tools/kanban-cli/tests/validators/graph-validator.test.ts
git commit -m "feat(kanban-cli): add Layer 2 graph validator (reachability, terminability)"
```

---

### Task 3: Layer 3 — Skill Content Validation (Stub)

Layer 3 requires LLM access to read and analyze skill file content. This task creates the interface and a stub implementation. The full LLM-powered implementation will be completed when the skill files exist (Stage 1+).

**Files:**
- Create: `tools/kanban-cli/src/validators/skill-validator.ts`
- Create: `tools/kanban-cli/tests/validators/skill-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validateSkillContent, type SkillFileReader } from '../../src/validators/skill-validator.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateSkillContent (Layer 3)', () => {
  const config: PipelineConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
        { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
        { name: 'Check', resolver: 'pr-status', status: 'Check', transitions_to: ['Done'] },
      ],
    },
  };

  it('returns no errors when skill reader is not provided (skip mode)', async () => {
    const result = await validateSkillContent(config);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });

  it('returns no errors when skill files are found and valid', async () => {
    const reader: SkillFileReader = async (skillName: string) => {
      if (skillName === 'phase-design') return 'Set status to Build when design is complete.';
      if (skillName === 'phase-build') return 'Set status to Done when build is complete.';
      return null;
    };
    const result = await validateSkillContent(config, { skillFileReader: reader });
    expect(result.errors).toHaveLength(0);
  });

  it('warns when a skill file is not found', async () => {
    const reader: SkillFileReader = async () => null;
    const result = await validateSkillContent(config, { skillFileReader: reader });
    expect(result.warnings.some((w) => w.includes('not found'))).toBe(true);
  });

  it('skips resolver states (only validates skill states)', async () => {
    const reader: SkillFileReader = async (skillName: string) => {
      if (skillName === 'phase-design') return 'Set status to Build.';
      if (skillName === 'phase-build') return 'Set status to Done.';
      return null;
    };
    const result = await validateSkillContent(config, { skillFileReader: reader });
    // Should not warn about 'pr-status' since it's a resolver, not a skill
    expect(result.warnings.every((w) => !w.includes('pr-status'))).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/skill-validator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement skill content validator**

```typescript
import type { PipelineConfig } from '../types/pipeline.js';
import { isSkillState } from '../types/pipeline.js';
import type { ValidationResult } from './config-validator.js';

/**
 * Function that reads a skill file's content by skill name.
 * Returns the file content as a string, or null if not found.
 */
export type SkillFileReader = (skillName: string) => Promise<string | null>;

/**
 * Function that validates skill content against expected transitions.
 * Returns true if the skill content appears to reference the expected transitions.
 *
 * Default implementation does a simple string search. LLM-powered implementation
 * can be injected for deeper semantic analysis.
 */
export type SkillContentAnalyzer = (
  skillContent: string,
  expectedTransitions: string[],
  stateName: string
) => Promise<{ valid: boolean; issues: string[] }>;

export interface SkillValidatorOptions {
  skillFileReader?: SkillFileReader;
  skillContentAnalyzer?: SkillContentAnalyzer;
}

/**
 * Default analyzer: checks if skill content mentions the expected transition targets.
 * This is a basic string-matching heuristic. For production use, inject an LLM-powered
 * analyzer that understands natural language instructions.
 */
const defaultAnalyzer: SkillContentAnalyzer = async (
  content,
  expectedTransitions,
  stateName
) => {
  const issues: string[] = [];
  for (const target of expectedTransitions) {
    if (!content.includes(target)) {
      issues.push(
        `Skill for "${stateName}" does not appear to reference transition target "${target}"`
      );
    }
  }
  return { valid: issues.length === 0, issues };
};

/**
 * Layer 3: Skill Content Validation.
 *
 * For each skill state, reads the skill file and checks that the content
 * references the expected transition targets. Skips resolver states.
 *
 * If no skillFileReader is provided, skips validation with a warning.
 */
export async function validateSkillContent(
  config: PipelineConfig,
  options: SkillValidatorOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { skillFileReader, skillContentAnalyzer } = options;

  if (!skillFileReader) {
    warnings.push('Layer 3 (skill content validation) skipped: no skill file reader provided');
    return { errors, warnings };
  }

  const analyzer = skillContentAnalyzer ?? defaultAnalyzer;

  for (const phase of config.workflow.phases) {
    if (!isSkillState(phase)) continue;

    const content = await skillFileReader(phase.skill);
    if (content === null) {
      warnings.push(`Skill file for "${phase.skill}" (state "${phase.name}") not found`);
      continue;
    }

    const result = await analyzer(content, phase.transitions_to, phase.name);
    if (!result.valid) {
      for (const issue of result.issues) {
        warnings.push(issue);
      }
    }
  }

  return { errors, warnings };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/skill-validator.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/validators/skill-validator.ts tools/kanban-cli/tests/validators/skill-validator.test.ts
git commit -m "feat(kanban-cli): add Layer 3 skill content validator (with injectable LLM analyzer)"
```

---

### Task 4: Layer 4 — Resolver Validation

**Files:**
- Create: `tools/kanban-cli/src/validators/resolver-validator.ts`
- Create: `tools/kanban-cli/tests/validators/resolver-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validateResolvers } from '../../src/validators/resolver-validator.js';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import { registerBuiltinResolvers } from '../../src/resolvers/builtins/index.js';
import type { PipelineConfig } from '../../src/types/pipeline.js';

describe('validateResolvers (Layer 4)', () => {
  it('passes when all resolvers are registered', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Finalize',
        phases: [
          { name: 'Finalize', skill: 'phase-finalize', status: 'Finalize', transitions_to: ['PR Created'] },
          { name: 'PR Created', resolver: 'pr-status', status: 'PR Created', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    const result = validateResolvers(config, registry);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when a resolver is not registered', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          { name: 'Check', resolver: 'nonexistent-resolver', status: 'Check', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    const result = validateResolvers(config, registry);
    expect(result.errors.some((e) => e.includes('nonexistent-resolver'))).toBe(true);
  });

  it('skips skill states', () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    const result = validateResolvers(config, registry);
    expect(result.errors).toHaveLength(0);
  });

  it('dry-runs resolver with mock data and reports errors', async () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          { name: 'Check', resolver: 'throwing-resolver', status: 'Check', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    registry.register('throwing-resolver', () => { throw new Error('boom'); });
    const result = await validateResolvers(config, registry, { dryRun: true });
    expect(result.errors.some((e) => e.includes('boom'))).toBe(true);
  });

  it('dry-run warns when resolver returns invalid transition target', async () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          { name: 'Check', resolver: 'bad-target', status: 'Check', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    registry.register('bad-target', () => 'NonExistentState');
    const result = await validateResolvers(config, registry, { dryRun: true });
    expect(result.warnings.some((w) => w.includes('NonExistentState'))).toBe(true);
  });

  it('dry-run accepts resolver returning null', async () => {
    const config: PipelineConfig = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          { name: 'Check', resolver: 'null-resolver', status: 'Check', transitions_to: ['Done'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    registry.register('null-resolver', () => null);
    const result = await validateResolvers(config, registry, { dryRun: true });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/resolver-validator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement resolver validator**

```typescript
import type { PipelineConfig } from '../types/pipeline.js';
import { isResolverState, DONE_TARGET } from '../types/pipeline.js';
import type { ResolverRegistry } from '../resolvers/registry.js';
import type { ValidationResult } from './config-validator.js';

export interface ResolverValidatorOptions {
  /** If true, execute each resolver with mock data to check for errors. */
  dryRun?: boolean;
}

/**
 * Layer 4: Resolver Validation.
 *
 * Checks:
 * - All resolver states reference a registered resolver function
 * - (dry-run) Resolver executes without throwing
 * - (dry-run) Resolver return value is in transitions_to or null
 */
export async function validateResolvers(
  config: PipelineConfig,
  registry: ResolverRegistry,
  options: ResolverValidatorOptions = {}
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stateNames = new Set(config.workflow.phases.map((p) => p.name));

  for (const phase of config.workflow.phases) {
    if (!isResolverState(phase)) continue;

    // Check resolver is registered
    if (!registry.has(phase.resolver)) {
      errors.push(
        `State "${phase.name}": resolver "${phase.resolver}" is not registered`
      );
      continue;
    }

    // Dry-run if requested
    if (options.dryRun) {
      const mockStage = { id: 'MOCK-STAGE', status: phase.status };
      const mockContext = { env: {} };

      try {
        const result = await registry.execute(phase.resolver, mockStage, mockContext);
        if (result !== null) {
          // Check that the result is a valid transition target
          if (!phase.transitions_to.includes(result)) {
            warnings.push(
              `State "${phase.name}": resolver "${phase.resolver}" returned "${result}" which is not in transitions_to [${phase.transitions_to.join(', ')}]`
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          `State "${phase.name}": resolver "${phase.resolver}" threw during dry-run: ${message}`
        );
      }
    }
  }

  return { errors, warnings };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/resolver-validator.test.ts`
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/validators/resolver-validator.ts tools/kanban-cli/tests/validators/resolver-validator.test.ts
git commit -m "feat(kanban-cli): add Layer 4 resolver validator (registration check + dry-run)"
```

---

### Task 5: Pipeline Validator Orchestrator

**Files:**
- Create: `tools/kanban-cli/src/validators/pipeline-validator.ts`
- Create: `tools/kanban-cli/tests/validators/pipeline-validator.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validatePipeline } from '../../src/validators/pipeline-validator.js';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import { registerBuiltinResolvers } from '../../src/resolvers/builtins/index.js';
import { defaultPipelineConfig } from '../../src/config/defaults.js';

describe('validatePipeline (orchestrator)', () => {
  it('validates the default pipeline with no errors', async () => {
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    const result = await validatePipeline(defaultPipelineConfig, { registry });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('aggregates errors from all layers', async () => {
    const badConfig = {
      workflow: {
        entry_phase: 'NonExistent',
        phases: [
          { name: 'A', skill: 's-a', status: 'A', transitions_to: ['B'] },
          { name: 'B', resolver: 'missing-resolver', status: 'B', transitions_to: ['A'] },
        ],
      },
    };
    const registry = new ResolverRegistry();
    const result = await validatePipeline(badConfig as any, { registry });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Should have errors from Layer 1 (bad entry_phase) and Layer 2 (no path to Done)
    // and Layer 4 (missing resolver)
  });

  it('returns structured output with layer attribution', async () => {
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    const result = await validatePipeline(defaultPipelineConfig, { registry });
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('layers');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/pipeline-validator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the orchestrator**

```typescript
import type { PipelineConfig } from '../types/pipeline.js';
import type { ResolverRegistry } from '../resolvers/registry.js';
import { validateConfig, type ValidationResult } from './config-validator.js';
import { validateGraph } from './graph-validator.js';
import { validateSkillContent, type SkillValidatorOptions } from './skill-validator.js';
import { validateResolvers, type ResolverValidatorOptions } from './resolver-validator.js';

export interface PipelineValidationOptions {
  registry?: ResolverRegistry;
  skillOptions?: SkillValidatorOptions;
  resolverOptions?: ResolverValidatorOptions;
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  layers: {
    config: ValidationResult;
    graph: ValidationResult;
    skillContent: ValidationResult;
    resolver: ValidationResult;
  };
}

/**
 * Run all four validation layers on a pipeline config and aggregate results.
 */
export async function validatePipeline(
  config: PipelineConfig,
  options: PipelineValidationOptions = {}
): Promise<PipelineValidationResult> {
  // Layer 1: Config validation
  const configResult = validateConfig(config);

  // Layer 2: Graph validation (only if Layer 1 passed — graph needs valid structure)
  const graphResult =
    configResult.errors.length === 0
      ? validateGraph(config)
      : { errors: [], warnings: ['Layer 2 skipped due to Layer 1 errors'] };

  // Layer 3: Skill content validation
  const skillResult = await validateSkillContent(config, options.skillOptions);

  // Layer 4: Resolver validation
  const resolverResult = options.registry
    ? await validateResolvers(config, options.registry, options.resolverOptions)
    : { errors: [], warnings: ['Layer 4 skipped: no resolver registry provided'] };

  // Aggregate
  const allErrors = [
    ...configResult.errors,
    ...graphResult.errors,
    ...skillResult.errors,
    ...resolverResult.errors,
  ];
  const allWarnings = [
    ...configResult.warnings,
    ...graphResult.warnings,
    ...skillResult.warnings,
    ...resolverResult.warnings,
  ];

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    layers: {
      config: configResult,
      graph: graphResult,
      skillContent: skillResult,
      resolver: resolverResult,
    },
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/validators/pipeline-validator.test.ts`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/validators/pipeline-validator.ts tools/kanban-cli/tests/validators/pipeline-validator.test.ts
git commit -m "feat(kanban-cli): add pipeline validator orchestrator (aggregates all 4 layers)"
```

---

### Task 6: CLI Command — validate-pipeline

**Files:**
- Create: `tools/kanban-cli/src/cli/index.ts`
- Create: `tools/kanban-cli/src/cli/commands/validate-pipeline.ts`

**Step 1: Create the CLI entry point**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { validatePipelineCommand } from './commands/validate-pipeline.js';

const program = new Command();

program
  .name('kanban-cli')
  .description('Config-driven kanban workflow CLI for Claude Code')
  .version('0.1.0');

program.addCommand(validatePipelineCommand);

program.parse();
```

**Step 2: Create the validate-pipeline command**

```typescript
import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { validatePipeline } from '../../validators/pipeline-validator.js';
import { ResolverRegistry } from '../../resolvers/registry.js';
import { registerBuiltinResolvers } from '../../resolvers/builtins/index.js';

export const validatePipelineCommand = new Command('validate-pipeline')
  .description('Validate workflow pipeline config (4-layer audit)')
  .option('--repo <path>', 'Path to repo (default: current directory)')
  .option('--global-config <path>', 'Path to global config file')
  .option('--dry-run', 'Execute resolver dry-runs', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .action(async (options) => {
    try {
      const config = loadConfig({
        globalConfigPath: options.globalConfig,
        repoPath: options.repo,
      });

      const registry = new ResolverRegistry();
      registerBuiltinResolvers(registry);

      const result = await validatePipeline(config, {
        registry,
        resolverOptions: { dryRun: options.dryRun },
      });

      const indent = options.pretty ? 2 : undefined;
      process.stdout.write(JSON.stringify(result, null, indent) + '\n');
      process.exit(result.valid ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 3: Test the CLI manually**

Run: `cd tools/kanban-cli && npx tsx src/cli/index.ts validate-pipeline --pretty`
Expected: JSON output with `"valid": true` for the default config (assuming no global or repo config file overrides).

**Step 4: Run all tests**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/cli/index.ts tools/kanban-cli/src/cli/commands/validate-pipeline.ts
git commit -m "feat(kanban-cli): add validate-pipeline CLI command"
```

---

### Task 7: Update Index Exports and Final Verification

**Files:**
- Modify: `tools/kanban-cli/src/index.ts`

**Step 1: Add validator exports**

Add to `src/index.ts`:

```typescript
// Validators
export { validateConfig } from './validators/config-validator.js';
export { validateGraph } from './validators/graph-validator.js';
export { validateSkillContent } from './validators/skill-validator.js';
export type { SkillFileReader, SkillContentAnalyzer } from './validators/skill-validator.js';
export { validateResolvers } from './validators/resolver-validator.js';
export { validatePipeline } from './validators/pipeline-validator.js';
export type { PipelineValidationResult, PipelineValidationOptions } from './validators/pipeline-validator.js';
```

**Step 2: Run full verification**

Run: `cd tools/kanban-cli && npm run verify`
Expected: All tests pass, no lint errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): export all validator modules"
```

---

### Completion Checklist

- [ ] Layer 1: Config validator (entry_phase, transitions_to targets, duplicates, orphans)
- [ ] Layer 2: Graph validator (reachability from entry, terminability to Done, cycle analysis)
- [ ] Layer 3: Skill content validator (injectable reader + analyzer, default string-matching, LLM-ready)
- [ ] Layer 4: Resolver validator (registration check, dry-run execution, return value validation)
- [ ] Pipeline validator orchestrator (runs all 4 layers, aggregates results)
- [ ] `kanban-cli validate-pipeline` CLI command with --repo, --dry-run, --pretty flags
- [ ] Default pipeline passes all 4 validation layers
- [ ] All tests passing
- [ ] All code compiles cleanly
- [ ] Each task committed incrementally
