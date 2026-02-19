import { describe, it, expect } from 'vitest';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import { stageRouterResolver } from '../../src/resolvers/builtins/stage-router.js';
import { registerBuiltinResolvers } from '../../src/resolvers/builtins/index.js';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import type { ResolverStageInput, ResolverContext } from '../../src/resolvers/types.js';

const baseContext: ResolverContext = { env: {} };

describe('prStatusResolver', () => {
  it('returns Done when PR is merged', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: true, hasUnresolvedComments: false, state: 'merged' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('returns Addressing Comments when PR has unresolved comments', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: true, state: 'open' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Addressing Comments');
  });

  it('returns null when no changes', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: false, hasUnresolvedComments: false, state: 'open' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });

  it('returns null when no code host available', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const result = prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  it('returns null when no pr_url on stage', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created' };
    const result = prStatusResolver(stage, baseContext);
    expect(result).toBeNull();
  });

  it('prioritizes merged over unresolved comments', () => {
    const stage: ResolverStageInput = { id: 'STAGE-001', status: 'PR Created', pr_url: 'https://github.com/org/repo/pull/1' };
    const ctx: ResolverContext = {
      env: {},
      codeHost: {
        getPRStatus: () => ({ merged: true, hasUnresolvedComments: true, state: 'merged' }),
      },
    };
    const result = prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
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
