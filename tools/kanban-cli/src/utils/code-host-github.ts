import { execFileSync } from 'node:child_process';
import type { CodeHostAdapter, PRStatus } from '../resolvers/types.js';

/**
 * JSON shape returned by `gh pr view --json state,mergedAt,reviewDecision,reviews,reviewThreads`.
 */
interface GhPrViewOutput {
  state: string;           // 'OPEN' | 'CLOSED' | 'MERGED'
  mergedAt: string | null; // ISO date or null
  reviewDecision: string;  // 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  reviews: Array<{
    state: string;         // 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
    author: { login: string };
  }>;
  // Optional for backward compatibility: older gh CLI versions (< 2.21)
  // don't support the reviewThreads JSON field.
  reviewThreads?: Array<{
    isResolved: boolean;
  }>;
}

/**
 * Options for constructing the GitHub adapter.
 */
export interface GitHubAdapterOptions {
  /**
   * Function to execute the `gh` CLI. Defaults to execFileSync.
   * Injected for testing.
   */
  execFn?: (command: string, args: string[]) => string;
}

/**
 * Extract the owner/repo and PR number from a GitHub PR URL.
 *
 * Accepts formats:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files (trailing path segments)
 *
 * Returns null if the URL doesn't match.
 */
export function parseGitHubPrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

function defaultExec(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Code host adapter that uses the `gh` CLI to query GitHub PR status.
 */
export function createGitHubAdapter(options: GitHubAdapterOptions = {}): CodeHostAdapter {
  const exec = options.execFn ?? defaultExec;

  return {
    getPRStatus(prUrl: string): PRStatus {
      const parsed = parseGitHubPrUrl(prUrl);
      if (!parsed) {
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'unknown' };
      }

      try {
        const json = exec('gh', [
          'pr', 'view',
          String(parsed.number),
          '--repo', `${parsed.owner}/${parsed.repo}`,
          '--json', 'state,mergedAt,reviewDecision,reviews,reviewThreads',
        ]);

        const data: GhPrViewOutput = JSON.parse(json);

        const merged = data.state === 'MERGED' || data.mergedAt !== null;
        const hasUnresolvedComments = data.reviewDecision === 'CHANGES_REQUESTED';
        const unresolvedThreadCount = (data.reviewThreads ?? [])
          .filter(t => !t.isResolved).length;
        const state = data.state.toLowerCase();

        return { merged, hasUnresolvedComments, unresolvedThreadCount, state };
      } catch {
        // gh CLI not installed, not authenticated, network error, etc.
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'error' };
      }
    },

    editPRBase(prNumber: number, newBase: string): void {
      exec('gh', ['pr', 'edit', String(prNumber), '--base', newBase]);
    },

    markPRReady(prNumber: number): void {
      exec('gh', ['pr', 'ready', String(prNumber)]);
    },

    getBranchHead(branch: string): string {
      try {
        const json = exec('gh', [
          'api', `repos/{owner}/{repo}/git/ref/heads/${branch}`,
        ]);
        const data = JSON.parse(json) as { object: { sha: string } };
        return data.object.sha;
      } catch {
        return '';
      }
    },
  };
}
