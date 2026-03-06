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
