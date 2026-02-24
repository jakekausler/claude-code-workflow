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
    // Should have errors from Layer 1 (bad entry_phase) and Layer 4 (missing resolver)
  });

  it('accepts a pipeline config with a valid cron section', async () => {
    const configWithCron = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Build'] },
          { name: 'Build', skill: 'phase-build', status: 'Build', transitions_to: ['Done'] },
        ],
      },
      cron: {
        mr_comment_poll: { enabled: true, interval_seconds: 300 },
        insights_threshold: { enabled: false, interval_seconds: 600 },
      },
    };
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    const result = await validatePipeline(configWithCron as any, { registry });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
