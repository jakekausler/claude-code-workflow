import { describe, it, expect } from 'vitest';
import {
  createGitLabAdapter,
  parseGitLabMrUrl,
} from '../../src/utils/code-host-gitlab.js';

describe('parseGitLabMrUrl', () => {
  it('parses standard GitLab MR URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.com/mygroup/myproject/-/merge_requests/42');
    expect(result).toEqual({ project: 'mygroup/myproject', number: 42 });
  });

  it('parses self-hosted GitLab URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.mycompany.com/team/project/-/merge_requests/7');
    expect(result).toEqual({ project: 'team/project', number: 7 });
  });

  it('parses nested subgroup URL', () => {
    const result = parseGitLabMrUrl('https://gitlab.com/group/subgroup/project/-/merge_requests/99');
    expect(result).toEqual({ project: 'group/subgroup/project', number: 99 });
  });

  it('returns null for non-GitLab URL', () => {
    expect(parseGitLabMrUrl('https://github.com/org/repo/pull/1')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseGitLabMrUrl('not-a-url')).toBeNull();
  });
});

describe('createGitLabAdapter', () => {
  const mergedResponse = JSON.stringify({
    state: 'merged',
    merged_at: '2026-02-18T10:00:00Z',
    has_conflicts: false,
    blocking_discussions_resolved: true,
  });

  const openResponse = JSON.stringify({
    state: 'opened',
    merged_at: null,
    has_conflicts: false,
    blocking_discussions_resolved: true,
  });

  const unresolvedResponse = JSON.stringify({
    state: 'opened',
    merged_at: null,
    has_conflicts: false,
    blocking_discussions_resolved: false,
  });

  it('returns merged=true when MR is merged', () => {
    const adapter = createGitLabAdapter({
      execFn: () => mergedResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(true);
    expect(status.state).toBe('merged');
  });

  it('returns merged=false for open MR', () => {
    const adapter = createGitLabAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
  });

  it('returns hasUnresolvedComments=true when discussions unresolved', () => {
    const adapter = createGitLabAdapter({
      execFn: () => unresolvedResponse,
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(true);
  });

  it('passes correct args to glab CLI', () => {
    let capturedArgs: string[] = [];
    const adapter = createGitLabAdapter({
      execFn: (_cmd, args) => {
        capturedArgs = args;
        return openResponse;
      },
    });
    adapter.getPRStatus('https://gitlab.com/mygroup/myproject/-/merge_requests/42');
    expect(capturedArgs).toEqual([
      'mr', 'view', '42',
      '--repo', 'mygroup/myproject',
      '--output', 'json',
    ]);
  });

  it('returns error state when CLI throws', () => {
    const adapter = createGitLabAdapter({
      execFn: () => { throw new Error('glab not found'); },
    });
    const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
    expect(status.merged).toBe(false);
    expect(status.hasUnresolvedComments).toBe(false);
    expect(status.state).toBe('error');
  });

  it('returns unknown state for unparseable URL', () => {
    const adapter = createGitLabAdapter({
      execFn: () => openResponse,
    });
    const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
    expect(status.state).toBe('unknown');
  });
});
