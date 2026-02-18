# Stage 0A: Config Schema & Types — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the TypeScript project, type system, YAML config schema, config loader with global+repo override merging, and default pipeline config.

**Architecture:** A TypeScript library in `tools/kanban-cli/` that defines the pipeline config schema using Zod, loads YAML configs from global and repo locations with override semantics (phases replace, defaults merge), and embeds a default pipeline config. This is the foundation all other Stage 0 work builds on.

**Tech Stack:** TypeScript, Zod (schema validation), yaml (YAML parsing), vitest (testing), commander (CLI framework), tsx (TypeScript execution)

---

### Task 1: Initialize TypeScript Project

**Files:**
- Create: `tools/kanban-cli/package.json`
- Create: `tools/kanban-cli/tsconfig.json`
- Create: `tools/kanban-cli/vitest.config.ts`
- Create: `tools/kanban-cli/.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "kanban-cli",
  "version": "0.1.0",
  "description": "Config-driven kanban workflow CLI for Claude Code",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "kanban-cli": "dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "verify": "npm run lint && npm run test"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "yaml": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

**Step 5: Install dependencies**

Run: `cd tools/kanban-cli && npm install`
Expected: Clean install, `node_modules/` created, `package-lock.json` generated.

**Step 6: Verify project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors (nothing to compile yet, but config is valid).

**Step 7: Commit**

```bash
git add tools/kanban-cli/package.json tools/kanban-cli/tsconfig.json tools/kanban-cli/vitest.config.ts tools/kanban-cli/.gitignore tools/kanban-cli/package-lock.json
git commit -m "feat(kanban-cli): initialize TypeScript project with dependencies"
```

---

### Task 2: Define Core Types

**Files:**
- Create: `tools/kanban-cli/src/types/pipeline.ts`

**Step 1: Write the type definitions**

These are the core types that represent the pipeline config data model. No behavior — just shapes.

```typescript
/**
 * A single state in the workflow pipeline.
 * Every state has either a `skill` (Claude session) or a `resolver` (TypeScript function).
 */
export interface PipelineState {
  /** Display name for this state (e.g., "Design", "PR Created") */
  name: string;

  /** Unique status value written to stage frontmatter */
  status: string;

  /** Claude skill reference — spawns a Claude session. Mutually exclusive with `resolver`. */
  skill?: string;

  /** TypeScript resolver function name — lightweight automation. Mutually exclusive with `skill`. */
  resolver?: string;

  /** Valid next states this state can transition to. "Done" is always valid. */
  transitions_to: string[];
}

/**
 * Environment variable defaults that can be set in config.
 */
export interface WorkflowDefaults {
  WORKFLOW_REMOTE_MODE?: boolean;
  WORKFLOW_AUTO_DESIGN?: boolean;
  WORKFLOW_MAX_PARALLEL?: number;
  WORKFLOW_GIT_PLATFORM?: 'github' | 'gitlab' | 'auto';
  WORKFLOW_LEARNINGS_THRESHOLD?: number;
  WORKFLOW_JIRA_CONFIRM?: boolean;
  WORKFLOW_SLACK_WEBHOOK?: string;
}

/**
 * The complete workflow pipeline configuration.
 * Loaded from YAML, validated by Zod schema.
 */
export interface PipelineConfig {
  workflow: {
    /** Name of the first state a stage enters from Ready for Work */
    entry_phase: string;

    /** Ordered list of pipeline states */
    phases: PipelineState[];

    /** Environment variable defaults (overridable by actual env vars) */
    defaults?: WorkflowDefaults;
  };
}

/**
 * Reserved status values used by system columns. Pipeline states cannot use these.
 */
export const RESERVED_STATUSES = ['Not Started', 'Complete'] as const;

/**
 * Reserved transition target representing the terminal state.
 */
export const DONE_TARGET = 'Done' as const;

/**
 * Discriminated state types for the orchestration loop.
 */
export type SkillState = PipelineState & { skill: string; resolver?: undefined };
export type ResolverState = PipelineState & { resolver: string; skill?: undefined };

/**
 * Type guard: is this a skill state?
 */
export function isSkillState(state: PipelineState): state is SkillState {
  return state.skill !== undefined && state.resolver === undefined;
}

/**
 * Type guard: is this a resolver state?
 */
export function isResolverState(state: PipelineState): state is ResolverState {
  return state.resolver !== undefined && state.skill === undefined;
}
```

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add tools/kanban-cli/src/types/pipeline.ts
git commit -m "feat(kanban-cli): define core pipeline type definitions"
```

---

### Task 3: Define Zod Schema

**Files:**
- Create: `tools/kanban-cli/src/config/schema.ts`
- Create: `tools/kanban-cli/tests/config/schema.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { pipelineConfigSchema } from '../../src/config/schema.js';

describe('pipelineConfigSchema', () => {
  it('accepts a valid minimal config', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects a phase with both skill and resolver', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            resolver: 'some-resolver',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a phase with neither skill nor resolver', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a phase using a reserved status', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Not Started',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts a config with defaults', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: ['Done'],
          },
        ],
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
          WORKFLOW_MAX_PARALLEL: 3,
        },
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts a resolver state without skill', () => {
    const config = {
      workflow: {
        entry_phase: 'Check',
        phases: [
          {
            name: 'Check',
            resolver: 'pr-status',
            status: 'Checking',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('requires at least one phase', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty transitions_to', () => {
    const config = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          {
            name: 'Design',
            skill: 'phase-design',
            status: 'Design',
            transitions_to: [],
          },
        ],
      },
    };
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/config/schema.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the Zod schema**

```typescript
import { z } from 'zod';
import { RESERVED_STATUSES } from '../types/pipeline.js';

const pipelineStateSchema = z
  .object({
    name: z.string().min(1),
    status: z
      .string()
      .min(1)
      .refine((s) => !(RESERVED_STATUSES as readonly string[]).includes(s), {
        message: `Status cannot be a reserved value: ${RESERVED_STATUSES.join(', ')}`,
      }),
    skill: z.string().min(1).optional(),
    resolver: z.string().min(1).optional(),
    transitions_to: z.array(z.string().min(1)).min(1),
  })
  .refine(
    (state) => {
      const hasSkill = state.skill !== undefined;
      const hasResolver = state.resolver !== undefined;
      return hasSkill !== hasResolver; // exactly one must be set (XOR)
    },
    {
      message: 'Each phase must have exactly one of "skill" or "resolver" (not both, not neither)',
    }
  );

const workflowDefaultsSchema = z.object({
  WORKFLOW_REMOTE_MODE: z.boolean().optional(),
  WORKFLOW_AUTO_DESIGN: z.boolean().optional(),
  WORKFLOW_MAX_PARALLEL: z.number().int().positive().optional(),
  WORKFLOW_GIT_PLATFORM: z.enum(['github', 'gitlab', 'auto']).optional(),
  WORKFLOW_LEARNINGS_THRESHOLD: z.number().int().positive().optional(),
  WORKFLOW_JIRA_CONFIRM: z.boolean().optional(),
  WORKFLOW_SLACK_WEBHOOK: z.string().url().optional(),
});

export const pipelineConfigSchema = z.object({
  workflow: z.object({
    entry_phase: z.string().min(1),
    phases: z.array(pipelineStateSchema).min(1),
    defaults: workflowDefaultsSchema.optional(),
  }),
});

export type ValidatedPipelineConfig = z.infer<typeof pipelineConfigSchema>;
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/config/schema.test.ts`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add tools/kanban-cli/src/config/schema.ts tools/kanban-cli/tests/config/schema.test.ts
git commit -m "feat(kanban-cli): add Zod schema for pipeline config validation"
```

---

### Task 4: Build Config Loader

**Files:**
- Create: `tools/kanban-cli/src/config/loader.ts`
- Create: `tools/kanban-cli/tests/config/loader.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, mergeConfigs, CONFIG_PATHS } from '../../src/config/loader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We'll test mergeConfigs directly (pure function, no I/O)
// and loadConfig with fs mocking

describe('mergeConfigs', () => {
  const globalConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        {
          name: 'Design',
          skill: 'phase-design',
          status: 'Design',
          transitions_to: ['Build'],
        },
        {
          name: 'Build',
          skill: 'phase-build',
          status: 'Build',
          transitions_to: ['Done'],
        },
      ],
      defaults: {
        WORKFLOW_REMOTE_MODE: false,
        WORKFLOW_MAX_PARALLEL: 1,
      },
    },
  };

  it('returns global config when repo config is null', () => {
    const result = mergeConfigs(globalConfig, null);
    expect(result).toEqual(globalConfig);
  });

  it('replaces phases entirely when repo config defines phases', () => {
    const repoConfig = {
      workflow: {
        entry_phase: 'Spike',
        phases: [
          {
            name: 'Spike',
            skill: 'my-spike',
            status: 'Spike',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('Spike');
    expect(result.workflow.entry_phase).toBe('Spike');
  });

  it('merges defaults when repo config only overrides defaults', () => {
    const repoConfig = {
      workflow: {
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
        },
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    // Phases unchanged from global
    expect(result.workflow.phases).toHaveLength(2);
    expect(result.workflow.entry_phase).toBe('Design');
    // Defaults merged
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(true);
    expect(result.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(1);
  });

  it('repo phases replace global phases completely (no merge)', () => {
    const repoConfig = {
      workflow: {
        entry_phase: 'QA',
        phases: [
          {
            name: 'QA',
            skill: 'qa-phase',
            status: 'QA',
            transitions_to: ['Done'],
          },
        ],
        defaults: {
          WORKFLOW_MAX_PARALLEL: 5,
        },
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('QA');
    expect(result.workflow.entry_phase).toBe('QA');
    // Defaults merged (not replaced)
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(false);
    expect(result.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(5);
  });
});

describe('loadConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-cli-test-' + Date.now());
  const globalDir = path.join(tmpDir, '.config', 'kanban-workflow');
  const repoDir = path.join(tmpDir, 'repo');

  beforeEach(() => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads global config when no repo config exists', () => {
    const globalYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Done]
`;
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), globalYaml);

    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('Design');
  });

  it('uses default config when no files exist', () => {
    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    // Should return the embedded default pipeline
    expect(result.workflow.entry_phase).toBe('Design');
    expect(result.workflow.phases.length).toBeGreaterThan(0);
  });

  it('merges repo config over global config', () => {
    const globalYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Done]
  defaults:
    WORKFLOW_REMOTE_MODE: false
`;
    const repoYaml = `
workflow:
  defaults:
    WORKFLOW_REMOTE_MODE: true
`;
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), globalYaml);
    fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), repoYaml);

    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(true);
    expect(result.workflow.phases[0].name).toBe('Design');
  });

  it('throws on invalid YAML in global config', () => {
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), '{{invalid yaml');
    expect(() =>
      loadConfig({
        globalConfigPath: path.join(globalDir, 'config.yaml'),
        repoPath: repoDir,
      })
    ).toThrow();
  });

  it('throws on schema-invalid config', () => {
    const badYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      status: Design
      transitions_to: [Done]
`;
    // Missing skill or resolver
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), badYaml);
    expect(() =>
      loadConfig({
        globalConfigPath: path.join(globalDir, 'config.yaml'),
        repoPath: repoDir,
      })
    ).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd tools/kanban-cli && npx vitest run tests/config/loader.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the config loader**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pipelineConfigSchema } from './schema.js';
import { defaultPipelineConfig } from './defaults.js';
import type { PipelineConfig } from '../types/pipeline.js';

export const CONFIG_PATHS = {
  globalConfig: path.join(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.config',
    'kanban-workflow',
    'config.yaml'
  ),
  repoConfigName: '.kanban-workflow.yaml',
} as const;

export interface LoadConfigOptions {
  globalConfigPath?: string;
  repoPath?: string;
}

/**
 * Merge a repo config over a global config.
 *
 * Rules:
 * - If repo defines `phases`, it REPLACES global phases entirely (no merge).
 * - If repo defines `entry_phase`, it replaces global entry_phase.
 * - `defaults` are MERGED (repo values override global values, but unset keys are preserved).
 */
export function mergeConfigs(
  global: PipelineConfig,
  repo: Partial<PipelineConfig> | null
): PipelineConfig {
  if (!repo || !repo.workflow) {
    return global;
  }

  const merged: PipelineConfig = {
    workflow: {
      entry_phase: repo.workflow.entry_phase ?? global.workflow.entry_phase,
      phases: repo.workflow.phases ?? global.workflow.phases,
      defaults: {
        ...global.workflow.defaults,
        ...repo.workflow.defaults,
      },
    },
  };

  return merged;
}

/**
 * Load and merge pipeline config from global and repo locations.
 *
 * Priority: repo config > global config > embedded default.
 * Validates the final merged result against the Zod schema.
 */
export function loadConfig(options: LoadConfigOptions = {}): PipelineConfig {
  const globalPath = options.globalConfigPath ?? CONFIG_PATHS.globalConfig;
  const repoPath = options.repoPath ?? process.cwd();
  const repoConfigPath = path.join(repoPath, CONFIG_PATHS.repoConfigName);

  // Load global config (or use embedded default)
  let globalConfig: PipelineConfig;
  if (fs.existsSync(globalPath)) {
    const raw = fs.readFileSync(globalPath, 'utf-8');
    const parsed = parseYaml(raw);
    const result = pipelineConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid global config at ${globalPath}: ${result.error.issues.map((i) => i.message).join(', ')}`
      );
    }
    globalConfig = result.data;
  } else {
    globalConfig = defaultPipelineConfig;
  }

  // Load repo config (optional)
  let repoConfig: Partial<PipelineConfig> | null = null;
  if (fs.existsSync(repoConfigPath)) {
    const raw = fs.readFileSync(repoConfigPath, 'utf-8');
    const parsed = parseYaml(raw);
    // Repo config is partial — don't validate against full schema yet
    repoConfig = parsed as Partial<PipelineConfig>;
  }

  // Merge
  const merged = mergeConfigs(globalConfig, repoConfig);

  // Validate final result
  const result = pipelineConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Invalid merged config: ${result.error.issues.map((i) => i.message).join(', ')}`
    );
  }

  return result.data;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run tests/config/loader.test.ts`
Expected: FAIL — `defaults.js` doesn't exist yet. That's Task 5.

**Step 5: Commit (partial — loader only, tests will pass after Task 5)**

```bash
git add tools/kanban-cli/src/config/loader.ts tools/kanban-cli/tests/config/loader.test.ts
git commit -m "feat(kanban-cli): add config loader with global+repo merge semantics"
```

---

### Task 5: Create Default Pipeline Config

**Files:**
- Create: `tools/kanban-cli/src/config/defaults.ts`
- Create: `tools/kanban-cli/config/default-pipeline.yaml`
- Create: `tools/kanban-cli/tests/config/defaults.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { defaultPipelineConfig } from '../../src/config/defaults.js';
import { pipelineConfigSchema } from '../../src/config/schema.js';

describe('defaultPipelineConfig', () => {
  it('passes schema validation', () => {
    const result = pipelineConfigSchema.safeParse(defaultPipelineConfig);
    expect(result.success).toBe(true);
  });

  it('has Design as entry_phase', () => {
    expect(defaultPipelineConfig.workflow.entry_phase).toBe('Design');
  });

  it('contains all expected default phases', () => {
    const names = defaultPipelineConfig.workflow.phases.map((p) => p.name);
    expect(names).toEqual([
      'Design',
      'User Design Feedback',
      'Build',
      'Automatic Testing',
      'Manual Testing',
      'Finalize',
      'PR Created',
      'Addressing Comments',
    ]);
  });

  it('has exactly one resolver state (PR Created)', () => {
    const resolvers = defaultPipelineConfig.workflow.phases.filter((p) => p.resolver);
    expect(resolvers).toHaveLength(1);
    expect(resolvers[0].name).toBe('PR Created');
  });

  it('has all other phases as skill states', () => {
    const skills = defaultPipelineConfig.workflow.phases.filter((p) => p.skill);
    expect(skills).toHaveLength(7);
  });

  it('has sensible defaults', () => {
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(false);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_AUTO_DESIGN).toBe(false);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(1);
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_GIT_PLATFORM).toBe('auto');
    expect(defaultPipelineConfig.workflow.defaults?.WORKFLOW_LEARNINGS_THRESHOLD).toBe(10);
  });

  it('Finalize can transition to both Done and PR Created', () => {
    const finalize = defaultPipelineConfig.workflow.phases.find((p) => p.name === 'Finalize');
    expect(finalize?.transitions_to).toContain('Done');
    expect(finalize?.transitions_to).toContain('PR Created');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/kanban-cli && npx vitest run tests/config/defaults.test.ts`
Expected: FAIL — module not found.

**Step 3: Create the default YAML config file**

Create `tools/kanban-cli/config/default-pipeline.yaml`:

```yaml
workflow:
  entry_phase: Design

  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build, User Design Feedback]

    - name: User Design Feedback
      skill: user-design-feedback
      status: User Design Feedback
      transitions_to: [Build]

    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Automatic Testing]

    - name: Automatic Testing
      skill: automatic-testing
      status: Automatic Testing
      transitions_to: [Manual Testing]

    - name: Manual Testing
      skill: manual-testing
      status: Manual Testing
      transitions_to: [Finalize]

    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done, PR Created]

    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to: [Done, Addressing Comments]

    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to: [PR Created]

  defaults:
    WORKFLOW_REMOTE_MODE: false
    WORKFLOW_AUTO_DESIGN: false
    WORKFLOW_MAX_PARALLEL: 1
    WORKFLOW_GIT_PLATFORM: auto
    WORKFLOW_LEARNINGS_THRESHOLD: 10
```

**Step 4: Write the defaults module that loads and exports the YAML**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { PipelineConfig } from '../types/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultYamlPath = path.resolve(__dirname, '../../config/default-pipeline.yaml');

function loadDefaultConfig(): PipelineConfig {
  const raw = fs.readFileSync(defaultYamlPath, 'utf-8');
  return parseYaml(raw) as PipelineConfig;
}

export const defaultPipelineConfig: PipelineConfig = loadDefaultConfig();
```

**Step 5: Run all tests to verify they pass**

Run: `cd tools/kanban-cli && npx vitest run`
Expected: All tests PASS (schema tests + loader tests + defaults tests).

**Step 6: Verify the project compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 7: Commit**

```bash
git add tools/kanban-cli/src/config/defaults.ts tools/kanban-cli/config/default-pipeline.yaml tools/kanban-cli/tests/config/defaults.test.ts
git commit -m "feat(kanban-cli): add default pipeline config (Design→...→Done)"
```

---

### Task 6: Create Index Exports

**Files:**
- Create: `tools/kanban-cli/src/index.ts`

**Step 1: Create the barrel export file**

```typescript
// Types
export type {
  PipelineConfig,
  PipelineState,
  WorkflowDefaults,
  SkillState,
  ResolverState,
} from './types/pipeline.js';
export {
  RESERVED_STATUSES,
  DONE_TARGET,
  isSkillState,
  isResolverState,
} from './types/pipeline.js';

// Config
export { pipelineConfigSchema } from './config/schema.js';
export type { ValidatedPipelineConfig } from './config/schema.js';
export { loadConfig, mergeConfigs, CONFIG_PATHS } from './config/loader.js';
export { defaultPipelineConfig } from './config/defaults.js';
```

**Step 2: Verify it compiles**

Run: `cd tools/kanban-cli && npx tsc --noEmit`
Expected: No errors.

**Step 3: Run all tests**

Run: `cd tools/kanban-cli && npm run verify`
Expected: Lint passes, all tests pass.

**Step 4: Commit**

```bash
git add tools/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): add barrel exports for config schema and types"
```

---

### Completion Checklist

- [ ] TypeScript project initialized with dependencies
- [ ] Core pipeline types defined (PipelineState, PipelineConfig, type guards)
- [ ] Zod schema validates config structure (skill XOR resolver, reserved statuses, non-empty arrays)
- [ ] Config loader reads global + repo YAML with merge semantics (phases replace, defaults merge)
- [ ] Default pipeline YAML created and embedded (Design → ... → Done)
- [ ] All tests passing
- [ ] All code compiles cleanly
- [ ] Each task committed incrementally
