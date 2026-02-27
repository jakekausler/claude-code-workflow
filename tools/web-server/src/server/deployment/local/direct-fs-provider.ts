import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type { ReadStream, FSWatcher } from 'fs';
import type { FileSystemProvider } from '../types.js';

/**
 * Direct filesystem provider for local (single-user) deployment.
 * Thin wrapper over Node.js fs with no access restrictions.
 */
export class DirectFileSystemProvider implements FileSystemProvider {
  readonly type = 'local' as const;

  async readFile(path: string): Promise<Buffer> {
    return fsp.readFile(path);
  }

  async readdir(path: string): Promise<string[]> {
    return fsp.readdir(path);
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean }> {
    const stats = await fsp.stat(path);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      isDirectory: stats.isDirectory(),
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  }

  createReadStream(path: string, options?: { start?: number; encoding?: BufferEncoding }): ReadStream {
    return fs.createReadStream(path, options);
  }

  watch(path: string, options?: { recursive?: boolean }): FSWatcher {
    return fs.watch(path, { recursive: options?.recursive });
  }
}
