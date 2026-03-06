import { describe, it, expect } from 'vitest';
import { createMockWorktreeManager } from '../src/mock-worktree.js';

describe('createMockWorktreeManager', () => {
  describe('create', () => {
    it('returns repoPath as path', async () => {
      const manager = createMockWorktreeManager();
      const info = await manager.create('feature-branch', '/my/repo');

      expect(info.path).toBe('/my/repo');
    });

    it('returns the provided branch name', async () => {
      const manager = createMockWorktreeManager();
      const info = await manager.create('my-branch', '/repo');

      expect(info.branch).toBe('my-branch');
    });

    it('returns index 1', async () => {
      const manager = createMockWorktreeManager();
      const info = await manager.create('branch', '/repo');

      expect(info.index).toBe(1);
    });
  });

  describe('remove', () => {
    it('is a no-op (does not throw)', async () => {
      const manager = createMockWorktreeManager();

      // Should not throw even with any path
      await manager.remove('/some/worktree/path');
    });
  });

  describe('validateIsolationStrategy', () => {
    it('always returns true', async () => {
      const manager = createMockWorktreeManager();

      const result = await manager.validateIsolationStrategy('/any/repo');
      expect(result).toBe(true);
    });
  });

  describe('listActive', () => {
    it('returns empty array', () => {
      const manager = createMockWorktreeManager();

      expect(manager.listActive()).toEqual([]);
    });
  });

  describe('acquireIndex', () => {
    it('returns 1', () => {
      const manager = createMockWorktreeManager();

      expect(manager.acquireIndex()).toBe(1);
    });
  });

  describe('releaseIndex', () => {
    it('is a no-op (does not throw)', () => {
      const manager = createMockWorktreeManager();

      // Should not throw
      manager.releaseIndex(1);
      manager.releaseIndex(42);
    });
  });

  describe('releaseAll', () => {
    it('is a no-op (does not throw)', () => {
      const manager = createMockWorktreeManager();

      // Should not throw
      manager.releaseAll();
    });
  });
});
