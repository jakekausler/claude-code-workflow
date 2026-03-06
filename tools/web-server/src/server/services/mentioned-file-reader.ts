import { resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import type { ParsedMessage } from '../types/jsonl.js';
import type { MentionedFileEstimate } from '../types/jsonl.js';
import type { FileSystemProvider } from '../deployment/types.js';
import { DirectFileSystemProvider } from '../deployment/local/direct-fs-provider.js';

/** Maximum file size to read (100 KB). Larger files are skipped. */
const MAX_FILE_SIZE = 100 * 1024;

/**
 * Binary file extensions to skip (not exhaustive, but covers common cases).
 * Files with these extensions won't be read for token estimation.
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.pyo', '.class', '.jar',
  '.db', '.sqlite', '.sqlite3',
]);

/**
 * Rough token estimation matching the convention used elsewhere:
 * ~4 UTF-16 code units per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if a file path has a binary extension.
 */
function isBinaryExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/**
 * Extract unique @-mentioned file paths from all user messages in a session.
 *
 * Matches the same `@path` pattern used by the client-side extractFileReferences()
 * in group-transformer.ts: @([~a-zA-Z0-9._/-]+)
 */
export function extractMentionedFilePaths(messages: ParsedMessage[]): string[] {
  const paths = new Set<string>();
  const regex = /@([~a-zA-Z0-9._/-]+)/g;

  for (const msg of messages) {
    if (msg.type !== 'user') continue;

    let text: string;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    } else {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      paths.add(match[1]);
    }
  }

  return Array.from(paths);
}

/**
 * Resolve a potentially relative file path to an absolute path.
 * Handles ~ expansion and resolves relative to projectRoot.
 */
function resolveFilePath(filePath: string, projectRoot: string): string {
  if (filePath.startsWith('~')) {
    return resolve(homedir(), filePath.slice(2)); // skip ~/
  }
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(projectRoot, filePath);
}

const defaultFs = new DirectFileSystemProvider();

/**
 * Read a single file and return its token estimate.
 * Returns null if the file doesn't exist, is too large, or is binary.
 */
async function readMentionedFileTokens(
  rawPath: string,
  projectRoot: string,
  fs: FileSystemProvider,
): Promise<MentionedFileEstimate | null> {
  if (isBinaryExtension(rawPath)) return null;

  const absolutePath = resolveFilePath(rawPath, projectRoot);

  try {
    const exists = await fs.exists(absolutePath);
    if (!exists) return null;

    const fileStat = await fs.stat(absolutePath);

    // Skip directories
    if (fileStat.isDirectory) return null;

    // Skip files larger than MAX_FILE_SIZE
    if (fileStat.size > MAX_FILE_SIZE) return null;

    const buf = await fs.readFile(absolutePath);
    const content = buf.toString('utf-8');
    const tokens = estimateTokens(content);
    if (tokens <= 0) return null;

    return { path: rawPath, estimatedTokens: tokens };
  } catch {
    return null;
  }
}

/**
 * Read all @-mentioned files from a session and return their token estimates.
 *
 * Extracts unique file paths from user messages, resolves them relative to
 * the project root, reads file contents, and estimates tokens.
 *
 * @param messages - All parsed messages from the session
 * @param projectRoot - The project root directory (from session cwd) for resolving relative paths
 * @param fileSystem - FileSystemProvider for file I/O. Defaults to DirectFileSystemProvider.
 * @returns Array of file estimates (files that don't exist or can't be read are excluded)
 */
export async function readMentionedFiles(
  messages: ParsedMessage[],
  projectRoot: string,
  fileSystem?: FileSystemProvider,
): Promise<MentionedFileEstimate[]> {
  const fs = fileSystem ?? defaultFs;
  const rawPaths = extractMentionedFilePaths(messages);
  if (rawPaths.length === 0) return [];

  const results = await Promise.all(
    rawPaths.map((p) => readMentionedFileTokens(p, projectRoot, fs)),
  );

  return results.filter((r): r is MentionedFileEstimate => r !== null);
}
