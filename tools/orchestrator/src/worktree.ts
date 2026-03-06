import { execFile } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Information about a single git worktree managed by the orchestrator.
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  index: number;
}

/**
 * Injectable dependencies for the WorktreeManager.
 * Defaults to real implementations; tests can override.
 */
export interface WorktreeDeps {
  execGit: (args: string[], cwd?: string) => Promise<string>;
  readFile: (filePath: string) => Promise<string>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  rmrf: (path: string) => Promise<void>;
}

/**
 * Manages git worktrees for parallel stage execution.
 */
export interface WorktreeManager {
  create(branch: string, repoPath: string): Promise<WorktreeInfo>;
  remove(worktreePath: string): Promise<void>;
  validateIsolationStrategy(repoPath: string): Promise<boolean>;
  listActive(): WorktreeInfo[];
  acquireIndex(): number;
  releaseIndex(index: number): void;
  releaseAll(): void;
}

function defaultExecGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { encoding: 'utf-8', cwd, timeout: 60000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function defaultMkdir(dirPath: string, options: { recursive: boolean }): Promise<void> {
  await mkdir(dirPath, options);
}

async function defaultRmrf(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

async function defaultReadFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

const defaultDeps: WorktreeDeps = {
  execGit: defaultExecGit,
  readFile: defaultReadFile,
  mkdir: defaultMkdir,
  rmrf: defaultRmrf,
};

/**
 * Create a WorktreeManager that manages git worktrees with an index pool
 * for parallel execution.
 */
export function createWorktreeManager(maxParallel: number, deps: Partial<WorktreeDeps> = {}): WorktreeManager {
  if (maxParallel < 1) {
    throw new Error(`maxParallel must be >= 1, got ${maxParallel}`);
  }

  const resolved: WorktreeDeps = { ...defaultDeps, ...deps };
  const inUseIndices = new Set<number>();
  const activeWorktrees = new Map<string, WorktreeInfo>();
  const worktreeRepoPaths = new Map<string, string>();

  return {
    acquireIndex(): number {
      for (let i = 1; i <= maxParallel; i++) {
        if (!inUseIndices.has(i)) {
          inUseIndices.add(i);
          return i;
        }
      }
      throw new Error(`Index pool exhausted: all ${maxParallel} indices in use`);
    },

    releaseIndex(index: number): void {
      if (!inUseIndices.has(index)) {
        throw new Error(`Cannot release index ${index}: not currently acquired`);
      }
      inUseIndices.delete(index);
    },

    releaseAll(): void {
      inUseIndices.clear();
      activeWorktrees.clear();
      worktreeRepoPaths.clear();
    },

    listActive(): WorktreeInfo[] {
      return Array.from(activeWorktrees.values());
    },

    async create(branch: string, repoPath: string): Promise<WorktreeInfo> {
      const index = this.acquireIndex();

      try {
        const worktreePath = path.join(repoPath, '.worktrees', `worktree-${index}`);
        const worktreeDir = path.join(repoPath, '.worktrees');

        await resolved.mkdir(worktreeDir, { recursive: true });

        const branchListOutput = await resolved.execGit(['branch', '--list', branch], repoPath);

        if (branchListOutput.trim().length > 0) {
          await resolved.execGit(['worktree', 'add', worktreePath, branch], repoPath);
        } else {
          await resolved.execGit(['worktree', 'add', '-b', branch, worktreePath], repoPath);
        }

        const info: WorktreeInfo = { path: worktreePath, branch, index };
        activeWorktrees.set(worktreePath, info);
        worktreeRepoPaths.set(worktreePath, repoPath);
        return info;
      } catch (err) {
        this.releaseIndex(index);
        throw err;
      }
    },

    async remove(worktreePath: string): Promise<void> {
      const info = activeWorktrees.get(worktreePath);
      if (!info) {
        throw new Error(`Cannot remove untracked worktree: ${worktreePath}`);
      }

      const repoPath = worktreeRepoPaths.get(worktreePath)!;

      try {
        await resolved.execGit(['worktree', 'remove', worktreePath, '--force'], repoPath);
      } catch {
        await resolved.rmrf(worktreePath);
        await resolved.execGit(['worktree', 'prune'], repoPath);
      }

      this.releaseIndex(info.index);
      activeWorktrees.delete(worktreePath);
      worktreeRepoPaths.delete(worktreePath);
    },

    async validateIsolationStrategy(repoPath: string): Promise<boolean> {
      let content: string;
      try {
        content = await resolved.readFile(path.join(repoPath, 'CLAUDE.md'));
      } catch {
        return false;
      }

      const headingPattern = /^##\s+Worktree Isolation Strategy/im;
      const match = headingPattern.exec(content);
      if (!match) {
        return false;
      }

      // Extract content after the heading until the next ## heading or end of file
      const afterHeading = content.slice(match.index + match[0].length);
      const nextH2 = afterHeading.search(/^##\s+/m);
      const sectionContent = nextH2 === -1 ? afterHeading : afterHeading.slice(0, nextH2);

      // Count ### sub-headings within the section
      const subHeadings = sectionContent.match(/^###\s+/gm);
      return subHeadings !== null && subHeadings.length >= 3;
    },
  };
}
