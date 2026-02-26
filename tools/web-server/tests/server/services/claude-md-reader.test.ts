import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverClaudeMdFiles, decodeProjectRoot } from '../../../src/server/services/claude-md-reader.js';

// Mock fs/promises so we don't touch the real filesystem
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  constants: { R_OK: 4 },
}));

// Mock synchronous fs for decodeProjectRoot
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn(),
    statSync: vi.fn(),
  };
});

// Mock os to control homedir
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

import { access, readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);

afterEach(() => {
  vi.clearAllMocks();
});

describe('discoverClaudeMdFiles', () => {
  it('returns both files when both exist', async () => {
    // Mock access to succeed for both files
    mockAccess.mockResolvedValue(undefined);
    // Mock readFile with content of different sizes
    mockReadFile.mockImplementation(async (path) => {
      const pathStr = String(path);
      if (pathStr.includes('.claude/CLAUDE.md')) {
        return 'A'.repeat(400); // ~100 tokens
      }
      if (pathStr.endsWith('CLAUDE.md')) {
        return 'B'.repeat(800); // ~200 tokens
      }
      throw new Error('File not found');
    });

    const result = await discoverClaudeMdFiles('/storage/programs/my-project');

    expect(result.length).toBe(2);
    expect(result[0].path).toBe('/home/testuser/.claude/CLAUDE.md');
    expect(result[0].estimatedTokens).toBe(100); // 400 / 4
    expect(result[1].path).toBe('/storage/programs/my-project/CLAUDE.md');
    expect(result[1].estimatedTokens).toBe(200); // 800 / 4
  });

  it('returns only existing files', async () => {
    // User CLAUDE.md exists, project CLAUDE.md does not
    mockAccess.mockImplementation(async (path) => {
      const pathStr = String(path);
      if (pathStr.includes('.claude/CLAUDE.md')) {
        return undefined;
      }
      throw new Error('ENOENT');
    });
    mockReadFile.mockImplementation(async (path) => {
      const pathStr = String(path);
      if (pathStr.includes('.claude/CLAUDE.md')) {
        return 'User config content here';
      }
      throw new Error('ENOENT');
    });

    const result = await discoverClaudeMdFiles('/some/project');

    expect(result.length).toBe(1);
    expect(result[0].path).toBe('/home/testuser/.claude/CLAUDE.md');
    expect(result[0].estimatedTokens).toBeGreaterThan(0);
  });

  it('returns empty array when no files exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await discoverClaudeMdFiles('/nonexistent/project');

    expect(result).toEqual([]);
  });

  it('excludes empty files', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('');

    const result = await discoverClaudeMdFiles('/some/project');

    expect(result).toEqual([]);
  });

  it('checks only user CLAUDE.md when projectRoot is undefined', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('User CLAUDE.md content');

    const result = await discoverClaudeMdFiles(undefined);

    // Only the user CLAUDE.md should be checked
    expect(result.length).toBe(1);
    expect(result[0].path).toBe('/home/testuser/.claude/CLAUDE.md');

    // readFile should only have been called once (for user CLAUDE.md)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('checks only user CLAUDE.md when projectRoot is not provided', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('Content here');

    const result = await discoverClaudeMdFiles();

    expect(result.length).toBe(1);
    expect(result[0].path).toBe('/home/testuser/.claude/CLAUDE.md');
  });
});

describe('decodeProjectRoot', () => {
  /** Helper to set up the filesystem mock so that the given directories exist. */
  function mockDirectories(existingDirs: string[]): void {
    const dirSet = new Set(existingDirs);
    mockExistsSync.mockImplementation((p: unknown) => dirSet.has(String(p)));
    mockStatSync.mockImplementation((p: unknown) => {
      if (dirSet.has(String(p))) {
        return { isDirectory: () => true } as ReturnType<typeof statSync>;
      }
      throw new Error('ENOENT');
    });
  }

  it('decodes a simple path without hyphens', () => {
    // -storage-programs-myproject -> /storage/programs/myproject
    mockDirectories(['/storage', '/storage/programs', '/storage/programs/myproject']);

    const result = decodeProjectRoot('/home/user/.claude/projects/-storage-programs-myproject');
    expect(result).toBe('/storage/programs/myproject');
  });

  it('decodes a path where a directory name contains hyphens', () => {
    // -storage-programs-claude-code-workflow -> /storage/programs/claude-code-workflow
    mockDirectories([
      '/storage',
      '/storage/programs',
      '/storage/programs/claude-code-workflow',
    ]);

    const result = decodeProjectRoot(
      '/home/user/.claude/projects/-storage-programs-claude-code-workflow',
    );
    expect(result).toBe('/storage/programs/claude-code-workflow');
  });

  it('decodes a home directory path', () => {
    // -home-jakekausler -> /home/jakekausler
    mockDirectories(['/home', '/home/jakekausler']);

    const result = decodeProjectRoot('/home/user/.claude/projects/-home-jakekausler');
    expect(result).toBe('/home/jakekausler');
  });

  it('returns undefined when the directory name does not start with a hyphen', () => {
    mockDirectories([]);

    const result = decodeProjectRoot('/home/user/.claude/projects/not-encoded');
    expect(result).toBeUndefined();
  });

  it('returns undefined when the decoded path does not exist', () => {
    // No matching directories on disk
    mockDirectories([]);

    const result = decodeProjectRoot('/home/user/.claude/projects/-tmp-deleted-project');
    expect(result).toBeUndefined();
  });

  it('prefers the shortest valid path when multiple decodings are possible', () => {
    // -a-b could decode to /a/b or /a-b
    // If /a exists as a directory and /a/b exists, it should find /a/b
    // If /a-b also exists, the first valid decode wins (depth-first)
    mockDirectories(['/a', '/a/b']);

    const result = decodeProjectRoot('/x/-a-b');
    expect(result).toBe('/a/b');
  });

  it('finds a path with multiple hyphenated segments', () => {
    // -home-user-my-cool-project -> /home/user/my-cool-project
    mockDirectories([
      '/home',
      '/home/user',
      '/home/user/my-cool-project',
    ]);

    const result = decodeProjectRoot('/x/-home-user-my-cool-project');
    expect(result).toBe('/home/user/my-cool-project');
  });
});
