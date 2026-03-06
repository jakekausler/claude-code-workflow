import type { WorktreeManager, WorktreeInfo } from './worktree.js';

/**
 * Create a mock WorktreeManager that returns the repo path as the worktree path
 * without creating any real git worktrees.
 */
export function createMockWorktreeManager(): WorktreeManager {
  return {
    async create(branch: string, repoPath: string): Promise<WorktreeInfo> {
      return { path: repoPath, branch, index: 1 };
    },

    async remove(): Promise<void> {
      // no-op
    },

    async validateIsolationStrategy(): Promise<boolean> {
      return true;
    },

    listActive(): WorktreeInfo[] {
      return [];
    },

    acquireIndex(): number {
      return 1;
    },

    releaseIndex(): void {
      // no-op
    },

    releaseAll(): void {
      // no-op
    },
  };
}
