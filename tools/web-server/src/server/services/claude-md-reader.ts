import { existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ClaudeMdFileEstimate } from '../types/jsonl.js';
import type { FileSystemProvider } from '../deployment/types.js';
import { DirectFileSystemProvider } from '../deployment/local/direct-fs-provider.js';

/**
 * Rough token estimation matching the convention used elsewhere:
 * ~4 UTF-16 code units per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const defaultFs = new DirectFileSystemProvider();

/**
 * Attempt to read a file and return its token estimate.
 * Returns null if the file does not exist or cannot be read.
 */
async function readFileTokens(
  filePath: string,
  fs: FileSystemProvider,
): Promise<ClaudeMdFileEstimate | null> {
  try {
    const exists = await fs.exists(filePath);
    if (!exists) return null;
    const buf = await fs.readFile(filePath);
    const content = buf.toString('utf-8');
    const tokens = estimateTokens(content);
    if (tokens <= 0) return null;
    return { path: filePath, estimatedTokens: tokens };
  } catch {
    return null;
  }
}

/**
 * Decode the project root path from a Claude projects directory name.
 *
 * Claude Code encodes project paths by replacing '/' with '-' in the
 * absolute path: `/storage/programs/claude-code-workflow` becomes
 * `-storage-programs-claude-code-workflow`.
 *
 * Since hyphens can also appear in directory names, the encoding is
 * ambiguous. This function resolves the ambiguity by checking which
 * split points correspond to actual directories on the filesystem.
 *
 * Returns undefined if the encoded name cannot be decoded to a valid
 * directory (e.g., the original directory was deleted).
 */
export function decodeProjectRoot(projectDir: string): string | undefined {
  const dirName = basename(projectDir);
  if (!dirName.startsWith('-')) return undefined;

  // Remove leading '-' (represents the leading '/' in the absolute path)
  const segments = dirName.slice(1).split('-');
  return tryDecodePath('/', segments, 0);
}

/**
 * Recursively try segment groupings to reconstruct the original path.
 * At each level, consume 1..N segments joined by '-' as a single
 * directory component and verify it exists on disk before continuing.
 */
function tryDecodePath(
  currentPath: string,
  segments: string[],
  startIdx: number,
): string | undefined {
  if (startIdx >= segments.length) {
    try {
      if (existsSync(currentPath) && statSync(currentPath).isDirectory()) {
        return currentPath;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  for (let endIdx = startIdx; endIdx < segments.length; endIdx++) {
    const component = segments.slice(startIdx, endIdx + 1).join('-');
    const candidatePath = join(currentPath, component);

    try {
      if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
        const result = tryDecodePath(candidatePath, segments, endIdx + 1);
        if (result !== undefined) return result;
      }
    } catch { /* ignore */ }
  }

  return undefined;
}

/**
 * Discover CLAUDE.md files on disk for a given project root path.
 *
 * Checks the standard locations that Claude Code injects at API time:
 * 1. ~/.claude/CLAUDE.md (user global)
 * 2. <projectRoot>/CLAUDE.md (project root)
 *
 * Returns an array of files with their estimated token counts.
 * Files that don't exist or are empty are excluded.
 *
 * @param projectRoot - The absolute project root path (from the session's cwd field).
 *   If not available, only the user-global CLAUDE.md is checked.
 * @param fileSystem - FileSystemProvider for file I/O. Defaults to DirectFileSystemProvider.
 */
export async function discoverClaudeMdFiles(
  projectRoot?: string,
  fileSystem?: FileSystemProvider,
): Promise<ClaudeMdFileEstimate[]> {
  const fs = fileSystem ?? defaultFs;
  const home = homedir();

  const candidates = [
    join(home, '.claude', 'CLAUDE.md'),
  ];

  if (projectRoot) {
    candidates.push(join(projectRoot, 'CLAUDE.md'));
  }

  const results = await Promise.all(candidates.map((c) => readFileTokens(c, fs)));
  return results.filter((r): r is ClaudeMdFileEstimate => r !== null);
}
