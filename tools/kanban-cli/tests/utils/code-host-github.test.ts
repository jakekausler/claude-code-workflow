import { describe, it, expect } from 'vitest';
import {
  createGitHubAdapter,
  parseGitHubPrUrl,
} from '../../src/utils/code-host-github.js';

describe('parseGitHubPrUrl', () => {
  it('parses standard GitHub PR URL', () => {
    const result = parseGitHubPrUrl('https://github.com/myorg/myrepo/pull/42');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 42 });
  });

  it('parses URL with trailing path segments', () => {
    const result = parseGitHubPrUrl('https://github.com/myorg/myrepo/pull/42/files');
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 42 });
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubPrUrl('https://gitlab.com/org/repo/-/merge_requests/1')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseGitHubPrUrl('not-a-url')).toBeNull();
  });

  it('returns null for GitHub URL without PR number', () => {
    expect(parseGitHubPrUrl('https://github.com/org/repo')).toBeNull();
  });
});

describe('createGitHubAdapter', () => {
  const mergedResponse = JSON.stringify({
    state: 'MERGED',
    mergedAt: '2026-02-18T10:00:00Z',
    reviewDecision: 'APPROVED',
    reviews: [],
  });

  const openResponse = JSON.stringify({
    state: 'OPEN',
    mergedAt: null,
    reviewDecision: '',
    reviews: [],
  });

  const changesRequestedResponse = JSON.stringify({
    state: 'OPEN',
    mergedAt: null,
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [
      { state: 'CHANGES_REQUESTED', author: { login: 'reviewer1' } },
    ],
  });

  it('returns merged=true when PR is merged', () => {
    const adapter = createGitHubAdapter({
      execFn: () => mergedResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(true);
    expect(status.state).toBe('merged');
  });

  it('returns merged=false for open PR', () => {
    const adapter = createGitHubAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('open');
  });

  it('returns hasUnresolvedComments=true when changes requested', () => {
    const adapter = createGitHubAdapter({
      execFn: () => changesRequestedResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(true);
  });

  it('passes correct args to gh CLI', () => {
    let capturedArgs: string[] = [];
    const adapter = createGitHubAdapter({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return openResponse;
      },
    });
    adapter.getPRStatus('https://github.com/myorg/myrepo/pull/42');
    expect(capturedArgs).toEqual([
      'pr', 'view', '42',
      '--repo', 'myorg/myrepo',
      '--json', 'state,mergedAt,reviewDecision,reviews',
    ]);
  });

  it('returns error state when CLI throws', () => {
    const adapter = createGitHubAdapter({
      execFn: () => { throw new Error('gh not found'); },
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('error');
  });

  it('returns unknown state for unparseable URL', () => {
    const adapter = createGitHubAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://bitbucket.org/org/repo/pull/1');
    expect(status.state).toBe('unknown');
  });
});
