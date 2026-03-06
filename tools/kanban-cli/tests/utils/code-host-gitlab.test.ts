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
    const allCalls: Array<{ cmd: string; args: string[] }> = [];
    const emptyDiscussions = JSON.stringify([]);
    const adapter = createGitLabAdapter({
      execFn: (cmd, args) => {
        allCalls.push({ cmd, args });
        // First call is mr view, second is discussions API
        if (args[0] === 'mr') return openResponse;
        return emptyDiscussions;
      },
    });
    adapter.getPRStatus('https://gitlab.com/mygroup/myproject/-/merge_requests/42');
    expect(allCalls).toHaveLength(2);
    expect(allCalls[0].args).toEqual([
      'mr', 'view', '42',
      '--repo', 'mygroup/myproject',
      '--output', 'json',
    ]);
    expect(allCalls[1].args).toEqual([
      'api', 'projects/mygroup%2Fmyproject/merge_requests/42/discussions?per_page=100',
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

  describe('unresolvedThreadCount', () => {
    it('returns 0 when no unresolved discussions', () => {
      const discussions = JSON.stringify([
        { notes: [{ resolvable: true, resolved: true }] },
        { notes: [{ resolvable: false, resolved: false }] },
      ]);
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          if (args[0] === 'mr') return openResponse;
          return discussions;
        },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      expect(status.unresolvedThreadCount).toBe(0);
    });

    it('counts unresolved discussions correctly', () => {
      const discussions = JSON.stringify([
        { notes: [{ resolvable: true, resolved: false }] },
        { notes: [{ resolvable: true, resolved: true }] },
        { notes: [{ resolvable: true, resolved: false }] },
        { notes: [{ resolvable: false, resolved: false }] },
      ]);
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          if (args[0] === 'mr') return unresolvedResponse;
          return discussions;
        },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      expect(status.unresolvedThreadCount).toBe(2);
    });

    it('returns 0 when discussions API returns empty array', () => {
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          if (args[0] === 'mr') return openResponse;
          return '[]';
        },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      expect(status.unresolvedThreadCount).toBe(0);
    });

    it('falls back to boolean signal when discussions API fails', () => {
      let callCount = 0;
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          callCount++;
          if (args[0] === 'mr') return unresolvedResponse;
          throw new Error('api error');
        },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      expect(callCount).toBe(2);
      // Falls back: hasUnresolvedComments=true -> count=1
      expect(status.unresolvedThreadCount).toBe(1);
    });

    it('falls back to 0 when discussions API fails and no unresolved comments', () => {
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          if (args[0] === 'mr') return openResponse;
          throw new Error('api error');
        },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      // Falls back: hasUnresolvedComments=false -> count=0
      expect(status.unresolvedThreadCount).toBe(0);
    });

    it('returns 0 for error state', () => {
      const adapter = createGitLabAdapter({
        execFn: () => { throw new Error('glab not found'); },
      });
      const status = adapter.getPRStatus('https://gitlab.com/org/repo/-/merge_requests/1');
      expect(status.unresolvedThreadCount).toBe(0);
    });

    it('returns 0 for unparseable URL', () => {
      const adapter = createGitLabAdapter({ execFn: () => '' });
      const status = adapter.getPRStatus('https://github.com/org/repo/pull/1');
      expect(status.unresolvedThreadCount).toBe(0);
    });
  });

  describe('editPRBase', () => {
    it('passes correct args to glab CLI', () => {
      let capturedCmd = '';
      let capturedArgs: string[] = [];
      const adapter = createGitLabAdapter({
        execFn: (cmd, args) => {
          capturedCmd = cmd;
          capturedArgs = args;
          return '';
        },
      });
      adapter.editPRBase(42, 'main');
      expect(capturedCmd).toBe('glab');
      expect(capturedArgs).toEqual([
        'mr', 'update', '42',
        '--target-branch', 'main',
      ]);
    });

    it('throws when CLI fails', () => {
      const adapter = createGitLabAdapter({
        execFn: () => { throw new Error('glab not found'); },
      });
      expect(() => adapter.editPRBase(42, 'main')).toThrow('glab not found');
    });
  });

  describe('markPRReady', () => {
    it('passes correct args to glab CLI', () => {
      let capturedArgs: string[] = [];
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          capturedArgs = args;
          return '';
        },
      });
      adapter.markPRReady(42);
      expect(capturedArgs).toEqual(['mr', 'update', '42', '--ready']);
    });

    it('throws when CLI fails', () => {
      const adapter = createGitLabAdapter({
        execFn: () => { throw new Error('glab not found'); },
      });
      expect(() => adapter.markPRReady(42)).toThrow('glab not found');
    });
  });

  describe('getBranchHead', () => {
    it('extracts SHA from glab api response', () => {
      const apiResponse = JSON.stringify({
        commit: { id: 'abc123def456' },
      });
      const adapter = createGitLabAdapter({
        execFn: () => apiResponse,
      });
      expect(adapter.getBranchHead('feature/auth')).toBe('abc123def456');
    });

    it('passes correct args to glab api', () => {
      let capturedArgs: string[] = [];
      const adapter = createGitLabAdapter({
        execFn: (_cmd, args) => {
          capturedArgs = args;
          return JSON.stringify({ commit: { id: 'abc123' } });
        },
      });
      adapter.getBranchHead('feature/auth');
      expect(capturedArgs).toEqual([
        'api', 'projects/:id/repository/branches/feature%2Fauth',
      ]);
    });

    it('returns empty string when CLI fails', () => {
      const adapter = createGitLabAdapter({
        execFn: () => { throw new Error('glab not found'); },
      });
      expect(adapter.getBranchHead('feature/auth')).toBe('');
    });

    it('returns empty string for malformed JSON response', () => {
      const adapter = createGitLabAdapter({
        execFn: () => 'not valid json',
      });
      expect(adapter.getBranchHead('feature/auth')).toBe('');
    });
  });
});
