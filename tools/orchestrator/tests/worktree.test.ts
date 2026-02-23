import { describe, it, expect, vi } from 'vitest';
import { createWorktreeManager, type WorktreeDeps } from '../src/worktree.js';

/** Build mock deps with sensible defaults. */
function makeDeps(overrides: Partial<WorktreeDeps> = {}): WorktreeDeps & {
  execGit: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  rmrf: ReturnType<typeof vi.fn>;
} {
  return {
    execGit: vi.fn(async () => ''),
    readFile: vi.fn(async () => ''),
    mkdir: vi.fn(async () => {}),
    rmrf: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createWorktreeManager', () => {
  describe('acquireIndex', () => {
    it('returns sequential indices starting at 1', () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      expect(mgr.acquireIndex()).toBe(1);
      expect(mgr.acquireIndex()).toBe(2);
      expect(mgr.acquireIndex()).toBe(3);
    });

    it('throws when pool is exhausted', () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(2, deps);

      mgr.acquireIndex(); // 1
      mgr.acquireIndex(); // 2

      expect(() => mgr.acquireIndex()).toThrow('Index pool exhausted: all 2 indices in use');
    });
  });

  describe('releaseIndex', () => {
    it('makes index available again', () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(2, deps);

      mgr.acquireIndex(); // 1
      mgr.acquireIndex(); // 2
      mgr.releaseIndex(1);

      expect(mgr.acquireIndex()).toBe(1);
    });
  });

  describe('releaseAll', () => {
    it('clears all indices and active worktrees', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      await mgr.create('feature-a', '/repo');
      await mgr.create('feature-b', '/repo');
      expect(mgr.listActive()).toHaveLength(2);

      mgr.releaseAll();

      expect(mgr.listActive()).toHaveLength(0);
      // Indices are available again
      expect(mgr.acquireIndex()).toBe(1);
      expect(mgr.acquireIndex()).toBe(2);
    });
  });

  describe('create', () => {
    it('runs correct git commands for a new branch (git worktree add -b)', async () => {
      const deps = makeDeps({
        execGit: vi.fn(async (args: string[]) => {
          // branch --list returns empty for non-existent branch
          if (args[0] === 'branch' && args[1] === '--list') return '';
          return '';
        }),
      });
      const mgr = createWorktreeManager(3, deps);

      const info = await mgr.create('new-branch', '/repo');

      expect(info.path).toBe('/repo/.worktrees/worktree-1');
      expect(info.branch).toBe('new-branch');
      expect(info.index).toBe(1);

      // Verify mkdir called for .worktrees directory
      expect(deps.mkdir).toHaveBeenCalledWith('/repo/.worktrees', { recursive: true });

      // Verify branch existence check
      expect(deps.execGit).toHaveBeenCalledWith(['branch', '--list', 'new-branch'], '/repo');

      // Verify worktree add with -b flag for new branch
      expect(deps.execGit).toHaveBeenCalledWith(
        ['worktree', 'add', '-b', 'new-branch', '/repo/.worktrees/worktree-1'],
        '/repo',
      );
    });

    it('runs correct git commands for an existing branch (git worktree add)', async () => {
      const deps = makeDeps({
        execGit: vi.fn(async (args: string[]) => {
          // branch --list returns the branch name for existing branch
          if (args[0] === 'branch' && args[1] === '--list') return '  existing-branch\n';
          return '';
        }),
      });
      const mgr = createWorktreeManager(3, deps);

      const info = await mgr.create('existing-branch', '/repo');

      expect(info.path).toBe('/repo/.worktrees/worktree-1');
      expect(info.branch).toBe('existing-branch');
      expect(info.index).toBe(1);

      // Verify worktree add without -b flag for existing branch
      expect(deps.execGit).toHaveBeenCalledWith(
        ['worktree', 'add', '/repo/.worktrees/worktree-1', 'existing-branch'],
        '/repo',
      );
    });

    it('releases index on failure', async () => {
      const deps = makeDeps({
        execGit: vi.fn(async (args: string[]) => {
          if (args[0] === 'branch') return '';
          throw new Error('worktree add failed');
        }),
      });
      const mgr = createWorktreeManager(2, deps);

      await expect(mgr.create('fail-branch', '/repo')).rejects.toThrow('worktree add failed');

      // Index should be released — acquiring should give index 1 again
      expect(mgr.acquireIndex()).toBe(1);
    });

    it('tracks created worktree in active list', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      await mgr.create('feature-a', '/repo');

      const active = mgr.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].branch).toBe('feature-a');
      expect(active[0].path).toBe('/repo/.worktrees/worktree-1');
      expect(active[0].index).toBe(1);
    });

    it('assigns incremental indices to multiple worktrees', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      const info1 = await mgr.create('branch-a', '/repo');
      const info2 = await mgr.create('branch-b', '/repo');

      expect(info1.index).toBe(1);
      expect(info2.index).toBe(2);
      expect(info1.path).toBe('/repo/.worktrees/worktree-1');
      expect(info2.path).toBe('/repo/.worktrees/worktree-2');
    });
  });

  describe('remove', () => {
    it('runs git worktree remove --force', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      await mgr.create('feature-a', '/repo');
      const worktreePath = '/repo/.worktrees/worktree-1';

      await mgr.remove(worktreePath);

      expect(deps.execGit).toHaveBeenCalledWith(
        ['worktree', 'remove', worktreePath, '--force'],
        '/repo/.worktrees',
      );
      expect(mgr.listActive()).toHaveLength(0);
    });

    it('falls back to rmrf + prune on failure', async () => {
      let callCount = 0;
      const deps = makeDeps({
        execGit: vi.fn(async (args: string[]) => {
          callCount++;
          // First calls are for create; the worktree remove call should fail
          if (args[0] === 'worktree' && args[1] === 'remove') {
            throw new Error('worktree remove failed');
          }
          if (args[0] === 'worktree' && args[1] === 'prune') {
            return '';
          }
          return '';
        }),
      });
      const mgr = createWorktreeManager(3, deps);

      await mgr.create('feature-a', '/repo');
      const worktreePath = '/repo/.worktrees/worktree-1';

      await mgr.remove(worktreePath);

      expect(deps.rmrf).toHaveBeenCalledWith(worktreePath);
      expect(deps.execGit).toHaveBeenCalledWith(['worktree', 'prune'], '/repo/.worktrees');
      expect(mgr.listActive()).toHaveLength(0);
    });

    it('releases index after removal', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(1, deps);

      await mgr.create('feature-a', '/repo');
      // Pool is now full (maxParallel=1)
      expect(() => mgr.acquireIndex()).toThrow('Index pool exhausted');

      await mgr.remove('/repo/.worktrees/worktree-1');

      // Index should be available again
      expect(mgr.acquireIndex()).toBe(1);
    });
  });

  describe('validateIsolationStrategy', () => {
    it('returns true for valid CLAUDE.md with isolation strategy section', async () => {
      const validContent = `# Project

## Worktree Isolation Strategy

### Port Allocation
Each worktree uses unique ports.

### Database Isolation
Each worktree uses a separate database.

### Environment Configuration
Each worktree has its own .env file.

### Verification
Run the verification script.

## Other Section
`;
      const deps = makeDeps({
        readFile: vi.fn(async () => validContent),
      });
      const mgr = createWorktreeManager(3, deps);

      const result = await mgr.validateIsolationStrategy('/repo');

      expect(result).toBe(true);
      expect(deps.readFile).toHaveBeenCalledWith('/repo/CLAUDE.md');
    });

    it('returns false when isolation strategy section is missing', async () => {
      const noSectionContent = `# Project

## Development Guidelines
Some guidelines here.

## Testing
Some testing info.
`;
      const deps = makeDeps({
        readFile: vi.fn(async () => noSectionContent),
      });
      const mgr = createWorktreeManager(3, deps);

      const result = await mgr.validateIsolationStrategy('/repo');

      expect(result).toBe(false);
    });

    it('returns false when file does not exist', async () => {
      const deps = makeDeps({
        readFile: vi.fn(async () => { throw new Error('ENOENT: no such file or directory'); }),
      });
      const mgr = createWorktreeManager(3, deps);

      const result = await mgr.validateIsolationStrategy('/repo');

      expect(result).toBe(false);
    });

    it('returns false when section has fewer than 3 sub-headings', async () => {
      const insufficientContent = `# Project

## Worktree Isolation Strategy

### Port Allocation
Each worktree uses unique ports.

### Database Isolation
Each worktree uses a separate database.

## Other Section
`;
      const deps = makeDeps({
        readFile: vi.fn(async () => insufficientContent),
      });
      const mgr = createWorktreeManager(3, deps);

      const result = await mgr.validateIsolationStrategy('/repo');

      expect(result).toBe(false);
    });

    it('returns true with exactly 3 sub-headings', async () => {
      const exactContent = `# Project

## Worktree Isolation Strategy

### Ports
Port info.

### Database
DB info.

### Environment
Env info.

## Other Section
`;
      const deps = makeDeps({
        readFile: vi.fn(async () => exactContent),
      });
      const mgr = createWorktreeManager(3, deps);

      const result = await mgr.validateIsolationStrategy('/repo');

      expect(result).toBe(true);
    });
  });

  describe('listActive', () => {
    it('returns tracked worktrees', async () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(5, deps);

      await mgr.create('branch-a', '/repo');
      await mgr.create('branch-b', '/repo');
      await mgr.create('branch-c', '/repo');

      const active = mgr.listActive();

      expect(active).toHaveLength(3);
      expect(active.map((w) => w.branch)).toEqual(['branch-a', 'branch-b', 'branch-c']);
      expect(active.map((w) => w.index)).toEqual([1, 2, 3]);
    });

    it('returns empty array when no worktrees are active', () => {
      const deps = makeDeps();
      const mgr = createWorktreeManager(3, deps);

      expect(mgr.listActive()).toEqual([]);
    });
  });
});
