import { describe, it, expect, vi } from 'vitest';
import { createLocker, type LockerDeps, type FrontmatterData } from '../src/locking.js';

/** Helper to build mock deps with a given frontmatter state. */
function makeDeps(frontmatter: FrontmatterData): LockerDeps & {
  readFrontmatter: ReturnType<typeof vi.fn>;
  writeFrontmatter: ReturnType<typeof vi.fn>;
} {
  return {
    readFrontmatter: vi.fn(async () => ({
      data: { ...frontmatter.data },
      content: frontmatter.content,
    })),
    writeFrontmatter: vi.fn(async () => {}),
  };
}

describe('createLocker', () => {
  describe('acquireLock', () => {
    it('sets session_active to true and writes', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'ready', session_active: false },
        content: '# Stage content\n',
      });
      const locker = createLocker(deps);

      await locker.acquireLock('/path/to/stage.md');

      expect(deps.writeFrontmatter).toHaveBeenCalledTimes(1);
      const [filePath, data, content] = deps.writeFrontmatter.mock.calls[0];
      expect(filePath).toBe('/path/to/stage.md');
      expect(data.session_active).toBe(true);
      expect(content).toBe('# Stage content\n');
    });

    it('throws "Stage already locked" when session_active is already true', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'in_progress', session_active: true },
        content: '# Stage content\n',
      });
      const locker = createLocker(deps);

      await expect(locker.acquireLock('/path/to/stage.md')).rejects.toThrow(
        'Stage already locked: /path/to/stage.md',
      );
      expect(deps.writeFrontmatter).not.toHaveBeenCalled();
    });
  });

  describe('releaseLock', () => {
    it('sets session_active to false and writes', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'in_progress', session_active: true },
        content: '# Stage content\n',
      });
      const locker = createLocker(deps);

      await locker.releaseLock('/path/to/stage.md');

      expect(deps.writeFrontmatter).toHaveBeenCalledTimes(1);
      const [filePath, data, content] = deps.writeFrontmatter.mock.calls[0];
      expect(filePath).toBe('/path/to/stage.md');
      expect(data.session_active).toBe(false);
      expect(content).toBe('# Stage content\n');
    });

    it('still writes when already unlocked (idempotent)', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'ready', session_active: false },
        content: '# Stage content\n',
      });
      const locker = createLocker(deps);

      await locker.releaseLock('/path/to/stage.md');

      expect(deps.writeFrontmatter).toHaveBeenCalledTimes(1);
      const [, data] = deps.writeFrontmatter.mock.calls[0];
      expect(data.session_active).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('returns true when session_active is true', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'in_progress', session_active: true },
        content: '',
      });
      const locker = createLocker(deps);

      const result = await locker.isLocked('/path/to/stage.md');

      expect(result).toBe(true);
    });

    it('returns false when session_active is false', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'ready', session_active: false },
        content: '',
      });
      const locker = createLocker(deps);

      const result = await locker.isLocked('/path/to/stage.md');

      expect(result).toBe(false);
    });

    it('returns false when session_active is missing', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'ready' },
        content: '',
      });
      const locker = createLocker(deps);

      const result = await locker.isLocked('/path/to/stage.md');

      expect(result).toBe(false);
    });
  });

  describe('readStatus', () => {
    it('returns the status field value', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'in_progress', session_active: false },
        content: '',
      });
      const locker = createLocker(deps);

      const status = await locker.readStatus('/path/to/stage.md');

      expect(status).toBe('in_progress');
    });

    it('throws when status field is missing', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', session_active: false },
        content: '',
      });
      const locker = createLocker(deps);

      await expect(locker.readStatus('/path/to/stage.md')).rejects.toThrow(
        'Missing status field in frontmatter of /path/to/stage.md',
      );
    });

    it('throws when status is not a string', async () => {
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 42, session_active: false },
        content: '',
      });
      const locker = createLocker(deps);

      await expect(locker.readStatus('/path/to/stage.md')).rejects.toThrow(
        'Invalid status type in frontmatter of /path/to/stage.md: expected string, got number',
      );
    });
  });

  describe('error propagation', () => {
    it('propagates read errors', async () => {
      const deps = {
        readFrontmatter: vi.fn(async () => { throw new Error('ENOENT'); }),
        writeFrontmatter: vi.fn(async () => {}),
      };
      const locker = createLocker(deps);
      await expect(locker.acquireLock('/missing.md')).rejects.toThrow('ENOENT');
    });
  });

  describe('data preservation', () => {
    it('preserves all other frontmatter fields during acquireLock write', async () => {
      const deps = makeDeps({
        data: {
          id: 'STAGE-001',
          ticket: 'TICKET-001',
          epic: 'EPIC-001',
          title: 'Implement feature',
          status: 'ready',
          session_active: false,
          priority: 5,
          worktree_branch: 'epic-001/stage-001',
        },
        content: '# Stage content\n\nSome details here.',
      });
      const locker = createLocker(deps);

      await locker.acquireLock('/path/to/stage.md');

      const [, data] = deps.writeFrontmatter.mock.calls[0];
      expect(data.id).toBe('STAGE-001');
      expect(data.ticket).toBe('TICKET-001');
      expect(data.epic).toBe('EPIC-001');
      expect(data.title).toBe('Implement feature');
      expect(data.status).toBe('ready');
      expect(data.session_active).toBe(true);
      expect(data.priority).toBe(5);
      expect(data.worktree_branch).toBe('epic-001/stage-001');
    });

    it('preserves markdown content during acquireLock write', async () => {
      const markdownContent = '# Stage content\n\nSome details here.\n\n- Item 1\n- Item 2\n';
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'ready', session_active: false },
        content: markdownContent,
      });
      const locker = createLocker(deps);

      await locker.acquireLock('/path/to/stage.md');

      const [, , content] = deps.writeFrontmatter.mock.calls[0];
      expect(content).toBe(markdownContent);
    });

    it('preserves all other frontmatter fields during releaseLock write', async () => {
      const deps = makeDeps({
        data: {
          id: 'STAGE-001',
          ticket: 'TICKET-001',
          epic: 'EPIC-001',
          title: 'Implement feature',
          status: 'in_progress',
          session_active: true,
          priority: 5,
        },
        content: '# Content',
      });
      const locker = createLocker(deps);

      await locker.releaseLock('/path/to/stage.md');

      const [, data] = deps.writeFrontmatter.mock.calls[0];
      expect(data.id).toBe('STAGE-001');
      expect(data.ticket).toBe('TICKET-001');
      expect(data.epic).toBe('EPIC-001');
      expect(data.title).toBe('Implement feature');
      expect(data.status).toBe('in_progress');
      expect(data.session_active).toBe(false);
      expect(data.priority).toBe(5);
    });

    it('preserves markdown content during releaseLock write', async () => {
      const markdownContent = '# Stage\n\nDetailed description.';
      const deps = makeDeps({
        data: { id: 'STAGE-001', status: 'in_progress', session_active: true },
        content: markdownContent,
      });
      const locker = createLocker(deps);

      await locker.releaseLock('/path/to/stage.md');

      const [, , content] = deps.writeFrontmatter.mock.calls[0];
      expect(content).toBe(markdownContent);
    });
  });
});
