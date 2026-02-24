import { describe, it, expect } from 'vitest';
import { createCodeHostAdapter } from '../../src/utils/code-host-factory.js';
import { detectGitPlatform } from '../../src/utils/git-platform.js';
import { createGitHubAdapter } from '../../src/utils/code-host-github.js';
import { createGitLabAdapter } from '../../src/utils/code-host-gitlab.js';
import { prStatusResolver } from '../../src/resolvers/builtins/pr-status.js';
import type { ResolverStageInput, ResolverContext } from '../../src/resolvers/types.js';

describe('createCodeHostAdapter', () => {
  it('returns GitHub adapter for github platform', () => {
    const adapter = createCodeHostAdapter('github');
    expect(adapter).not.toBeNull();
  });

  it('returns GitLab adapter for gitlab platform', () => {
    const adapter = createCodeHostAdapter('gitlab');
    expect(adapter).not.toBeNull();
  });

  it('returns null for unknown platform', () => {
    const adapter = createCodeHostAdapter('unknown');
    expect(adapter).toBeNull();
  });
});

describe('end-to-end: platform detection -> adapter -> resolver', () => {
  it('GitHub flow: detects platform, creates adapter, resolves PR merged', async () => {
    // 1. Detect platform
    const platform = detectGitPlatform({
      envValue: 'github',
      getRemoteUrl: () => null,
    });
    expect(platform).toBe('github');

    // 2. Create adapter with mock CLI
    const adapter = createGitHubAdapter({
      execFn: () => JSON.stringify({
        state: 'MERGED',
        mergedAt: '2026-02-18T10:00:00Z',
        reviewDecision: 'APPROVED',
        reviews: [],
      }),
    });

    // 3. Run resolver
    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://github.com/org/repo/pull/42',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter,
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBe('Done');
  });

  it('GitLab flow: detects platform, creates adapter, resolves MR not merged', async () => {
    // 1. Detect platform
    const platform = detectGitPlatform({
      getRemoteUrl: () => 'git@gitlab.com:org/repo.git',
    });
    expect(platform).toBe('gitlab');

    // 2. Create adapter with mock CLI
    const adapter = createGitLabAdapter({
      execFn: () => JSON.stringify({
        state: 'opened',
        merged_at: null,
        has_conflicts: false,
        blocking_discussions_resolved: false,
      }),
    });

    // 3. Run resolver — pr-status only checks merge, so open MR returns null
    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://gitlab.com/org/repo/-/merge_requests/7',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter,
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });

  it('unknown platform: no adapter, resolver returns null', async () => {
    const platform = detectGitPlatform({
      getRemoteUrl: () => 'https://bitbucket.org/org/repo.git',
    });
    expect(platform).toBe('unknown');

    const adapter = createCodeHostAdapter(platform);
    expect(adapter).toBeNull();

    const stage: ResolverStageInput = {
      id: 'STAGE-001',
      status: 'PR Created',
      pr_url: 'https://bitbucket.org/org/repo/pull/1',
    };
    const ctx: ResolverContext = {
      env: {},
      codeHost: adapter ?? undefined,
    };
    const result = await prStatusResolver(stage, ctx);
    expect(result).toBeNull();
  });
});
