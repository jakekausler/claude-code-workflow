import { describe, it, expect } from 'vitest';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import { testingRouterResolver } from '../../src/resolvers/builtins/testing-router.js';
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
        getPRStatus: () => ({ merged: true, hasUnresolvedComments: false, state: 'merged' }),
      },
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('returns null when PR is open (no comment check)', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: true, state: 'open' }),
      },
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });

  it('returns null when no changes', async () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: false, state: 'open' }),
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

describe('testingRouterResolver', () => {
  it('returns Manual Testing when refinement_type includes frontend', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: ['frontend'] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Manual Testing');
  });

  it('returns Manual Testing when refinement_type includes ux', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: ['ux'] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Manual Testing');
  });

  it('returns Manual Testing when refinement_type includes accessibility', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: ['accessibility'] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Manual Testing');
  });

  it('returns Manual Testing when refinement_type has mixed types including a manual one', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: ['backend', 'frontend', 'api'] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Manual Testing');
  });

  it('returns Finalize when refinement_type has no manual testing types', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: ['backend', 'api'] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Finalize');
  });

  it('returns Finalize when refinement_type is empty', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing', refinement_type: [] };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Finalize');
  });

  it('returns Finalize when refinement_type is undefined', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'Routing' };
    const result = testingRouterResolver(stage, baseContext);
    expect(result).toBe('Finalize');
  });
});

describe('registerBuiltinResolvers', () => {
  it('registers all built-in resolvers', () => {
    const registry = new ResolverRegistry();
    registerBuiltinResolvers(registry);
    expect(registry.has('pr-status')).toBe(true);
    expect(registry.has('testing-router')).toBe(true);
  });
});
