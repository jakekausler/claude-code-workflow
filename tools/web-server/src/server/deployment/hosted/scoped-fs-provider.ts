import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type { ReadStream, FSWatcher } from 'fs';
import type { FileSystemProvider } from '../types.js';

/**
 * Scoped filesystem provider for hosted (multi-user) deployment.
 * Restricts all filesystem operations to the user's root directory
 * with path traversal protection using realpathSync + startsWith checks.
 */
export class ScopedFileSystemProvider implements FileSystemProvider {
  readonly type = 'scoped' as const;
  private resolvedRoot: string;

  constructor(private rootDir: string) {
    this.resolvedRoot = fs.realpathSync(rootDir);
  }

  /**
   * Validates that the requested path resolves within the scoped root.
   * - Rejects paths containing '..' segments (defense in depth)
   * - Resolves symlinks via realpathSync before checking prefix
   * - Throws on violation and logs the attempt (does not expose paths to client)
   */
  private assertWithinScope(requestedPath: string): string {
    // Defense in depth: reject '..' segments even if they would resolve within scope
    const segments = requestedPath.split('/');
    if (segments.includes('..')) {
      console.error(`[ScopedFS] Path traversal attempt blocked (.. segment): request for path outside scope`);
      throw new Error('Access denied: path traversal not allowed');
    }

    let resolved: string;
    try {
      resolved = fs.realpathSync(requestedPath);
    } catch {
      console.error(`[ScopedFS] Path resolution failed for requested path`);
      throw new Error('Access denied: path could not be resolved');
    }

    if (!resolved.startsWith(this.resolvedRoot)) {
      console.error(`[ScopedFS] Path traversal attempt blocked: resolved path is outside scoped root`);
      throw new Error('Access denied: path outside allowed scope');
    }

    return resolved;
  }

  async readFile(path: string): Promise<Buffer> {
    const safe = this.assertWithinScope(path);
    return fsp.readFile(safe);
  }

  async readdir(path: string): Promise<string[]> {
    const safe = this.assertWithinScope(path);
    return fsp.readdir(safe);
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean }> {
    const safe = this.assertWithinScope(path);
    const stats = await fsp.stat(safe);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      isDirectory: stats.isDirectory(),
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      this.assertWithinScope(path);
      return true;
    } catch {
      return false;
    }
  }

  createReadStream(path: string, options?: { start?: number; encoding?: BufferEncoding }): ReadStream {
    const safe = this.assertWithinScope(path);
    return fs.createReadStream(safe, options);
  }

  watch(path: string, options?: { recursive?: boolean }): FSWatcher {
    const safe = this.assertWithinScope(path);
    return fs.watch(safe, { recursive: options?.recursive });
  }
}
