import { execFileSync } from 'node:child_process';
import type { CodeHostAdapter, PRStatus } from '../resolvers/types.js';

/**
 * JSON shape returned by `glab mr view --output json`.
 *
 * glab returns a flat JSON with these relevant fields (among others).
 */
interface GlabMrViewOutput {
  state: string;                // 'opened' | 'closed' | 'merged'
  merged_at: string | null;     // ISO date or null
  has_conflicts: boolean;
  blocking_discussions_resolved: boolean;
}

/**
 * JSON shape for a single discussion from the GitLab discussions API.
 */
interface GlabDiscussion {
  notes: Array<{
    resolvable: boolean;
    resolved: boolean;
  }>;
}

/**
 * Options for constructing the GitLab adapter.
 */
export interface GitLabAdapterOptions {
  /**
   * Function to execute the `glab` CLI. Defaults to execFileSync.
   * Injected for testing.
   */
  execFn?: (command: string, args: string[]) => string;
}

/**
 * Extract the project path and MR number from a GitLab MR URL.
 *
 * Accepts formats:
 * - https://gitlab.com/group/project/-/merge_requests/123
 * - https://gitlab.company.com/group/subgroup/project/-/merge_requests/123
 *
 * Returns null if the URL doesn't match.
 */
export function parseGitLabMrUrl(url: string): { project: string; number: number } | null {
  const match = url.match(/gitlab\.[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!match) return null;
  return { project: match[1], number: parseInt(match[2], 10) };
}

function defaultExec(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Code host adapter that uses the `glab` CLI to query GitLab MR status.
 */
export function createGitLabAdapter(options: GitLabAdapterOptions = {}): CodeHostAdapter {
  const exec = options.execFn ?? defaultExec;

  return {
    getPRStatus(prUrl: string): PRStatus {
      const parsed = parseGitLabMrUrl(prUrl);
      if (!parsed) {
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'unknown' };
      }

      try {
        const json = exec('glab', [
          'mr', 'view',
          String(parsed.number),
          '--repo', parsed.project,
          '--output', 'json',
        ]);

        const data: GlabMrViewOutput = JSON.parse(json);

        const merged = data.state === 'merged' || data.merged_at !== null;
        const hasUnresolvedComments = !data.blocking_discussions_resolved;
        const state = data.state;

        // Fetch unresolved discussion count via API
        let unresolvedThreadCount = 0;
        try {
          const encodedProject = encodeURIComponent(parsed.project);
          // per_page=100 to reduce chance of missing threads; GitLab API
          // paginates but glab doesn't auto-paginate for raw API calls.
          const discussionsJson = exec('glab', [
            'api', `projects/${encodedProject}/merge_requests/${parsed.number}/discussions?per_page=100`,
          ]);
          const discussions: GlabDiscussion[] = JSON.parse(discussionsJson);
          unresolvedThreadCount = discussions.filter(d =>
            d.notes.some(n => n.resolvable && !n.resolved),
          ).length;
        } catch {
          // If discussions API fails, fall back to boolean signal
          unresolvedThreadCount = hasUnresolvedComments ? 1 : 0;
        }

        return { merged, hasUnresolvedComments, unresolvedThreadCount, state };
      } catch {
        // glab CLI not installed, not authenticated, network error, etc.
        return { merged: false, hasUnresolvedComments: false, unresolvedThreadCount: 0, state: 'error' };
      }
    },

    editPRBase(prNumber: number, newBase: string): void {
      exec('glab', ['mr', 'update', String(prNumber), '--target-branch', newBase]);
    },

    markPRReady(prNumber: number): void {
      exec('glab', ['mr', 'update', String(prNumber), '--ready']);
    },

    getBranchHead(branch: string): string {
      try {
        const encoded = encodeURIComponent(branch);
        // :id is resolved by glab CLI to the current project ID
        const json = exec('glab', [
          'api', `projects/:id/repository/branches/${encoded}`,
        ]);
        const data = JSON.parse(json) as { commit: { id: string } };
        return data.commit.id;
      } catch {
        return '';
      }
    },
  };
}
