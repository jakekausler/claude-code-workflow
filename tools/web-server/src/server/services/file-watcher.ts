import type { FSWatcher } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { FileSystemProvider } from '../deployment/types.js';
import { DirectFileSystemProvider } from '../deployment/local/direct-fs-provider.js';

export interface FileChangeEvent {
  projectId: string;
  sessionId: string;
  filePath: string;
  isSubagent: boolean;
}

export interface FileWatcherOptions {
  rootDir: string; // ~/.claude/projects
  debounceMs?: number; // default 100
  catchUpIntervalMs?: number; // default 30000
  fileSystem?: FileSystemProvider;
}

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private catchUpTimer: ReturnType<typeof setInterval> | null = null;
  private fileOffsets = new Map<string, number>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private options: Required<Omit<FileWatcherOptions, 'fileSystem'>>;
  private fileSystem: FileSystemProvider;

  constructor(options: FileWatcherOptions) {
    super();
    const { fileSystem, ...rest } = options;
    this.fileSystem = fileSystem ?? new DirectFileSystemProvider();
    this.options = {
      debounceMs: 100,
      catchUpIntervalMs: 30000,
      ...rest,
    };
  }

  async start(): Promise<void> {
    // Guard against double-start: tear down existing watcher before re-initialising
    if (this.watcher) {
      this.stop();
    }

    const { rootDir } = this.options;

    const exists = await this.fileSystem.exists(rootDir);
    if (!exists) {
      this.emit('warning', `Root directory does not exist: ${rootDir}. File watcher is not active.`);
      return;
    }

    try {
      this.watcher = this.fileSystem.watch(rootDir, { recursive: true });

      this.watcher.on('change', (eventType, filename) => {
        this.handleChange(eventType as string, filename as string | null);
      });

      this.watcher.on('error', (err) => {
        this.emit('error', err);
      });
    } catch {
      // Root directory may have disappeared between exists check and watch
      return;
    }

    this.catchUpTimer = setInterval(() => {
      this.catchUpScan().catch((err) => {
        this.emit('error', err);
      });
    }, this.options.catchUpIntervalMs);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.catchUpTimer) {
      clearInterval(this.catchUpTimer);
      this.catchUpTimer = null;
    }

    // Intentionally clear offsets for clean resource release — callers that need
    // to preserve offsets across restart cycles should snapshot them before stop().
    this.fileOffsets.clear();
  }

  /** Get current byte offset for a file (for incremental parsing) */
  getOffset(filePath: string): number {
    return this.fileOffsets.get(filePath) ?? 0;
  }

  /** Update byte offset after successful parse */
  setOffset(filePath: string, offset: number): void {
    this.fileOffsets.set(filePath, offset);
  }

  private handleChange(_eventType: string, filename: string | null): void {
    if (!filename || !filename.endsWith('.jsonl')) {
      return;
    }

    const parsed = this.parseFilePath(filename);
    if (!parsed) {
      return;
    }

    const filePath = join(this.options.rootDir, filename);

    // Debounce per file
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.emit('file-change', {
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
        filePath,
        isSubagent: parsed.isSubagent,
      } satisfies FileChangeEvent);
    }, this.options.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private parseFilePath(relativePath: string): {
    projectId: string;
    sessionId: string;
    isSubagent: boolean;
  } | null {
    // Normalize separators for cross-platform compatibility
    const parts = relativePath.split(/[\\/]/);

    // Must have at least projectId/filename.jsonl
    if (parts.length < 2) {
      return null;
    }

    const projectId = parts[0];
    const filename = parts[parts.length - 1];
    const basename = filename.replace(/\.jsonl$/, '');
    const isSubagent = filename.startsWith('agent-');

    // New-style subagent: {projectId}/{sessionId}/subagents/agent-{agentId}.jsonl
    if (
      parts.length >= 4 &&
      parts[parts.length - 2] === 'subagents' &&
      isSubagent
    ) {
      return {
        projectId,
        sessionId: parts[parts.length - 3],
        isSubagent: true,
      };
    }

    // Main session: {projectId}/{sessionId}.jsonl
    // Legacy subagent: {projectId}/agent-{agentId}.jsonl
    return {
      projectId,
      sessionId: basename,
      isSubagent,
    };
  }

  /**
   * Perform an on-demand catch-up scan of all JSONL files under rootDir.
   *
   * Intentionally public so consumers can trigger a scan explicitly — e.g.
   * after reconnecting a WebSocket or when a manual refresh is requested.
   * Also called internally on a timer via `start()`.
   */
  async catchUpScan(): Promise<void> {
    const { rootDir } = this.options;

    const exists = await this.fileSystem.exists(rootDir);
    if (!exists) {
      return;
    }

    let entryNames: string[];
    try {
      entryNames = await this.fileSystem.readdir(rootDir);
    } catch {
      return;
    }

    // Filter to directories only
    const projectDirs: string[] = [];
    for (const name of entryNames) {
      try {
        const entryStat = await this.fileSystem.stat(join(rootDir, name));
        if (entryStat.isDirectory) {
          projectDirs.push(name);
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    for (const projectDir of projectDirs) {
      await this.scanDirectory(join(rootDir, projectDir), projectDir);
    }
  }

  private static readonly MAX_SCAN_DEPTH = 4;

  private async scanDirectory(
    dirPath: string,
    projectId: string,
    subPath: string = '',
    depth: number = 0,
  ): Promise<void> {
    // Guard against unbounded recursion. Expected max depth is 3
    // (projectId/sessionId/subagents/agent-*.jsonl), so 4 is a safe ceiling.
    if (depth >= FileWatcher.MAX_SCAN_DEPTH) {
      return;
    }

    let entryNames: string[];
    try {
      entryNames = await this.fileSystem.readdir(dirPath);
    } catch {
      return;
    }

    for (const name of entryNames) {
      const fullPath = join(dirPath, name);

      let entryStat: { size: number; mtimeMs: number; isDirectory: boolean };
      try {
        entryStat = await this.fileSystem.stat(fullPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory) {
        const nextSubPath = subPath ? join(subPath, name) : name;
        await this.scanDirectory(fullPath, projectId, nextSubPath, depth + 1);
        continue;
      }

      if (!name.endsWith('.jsonl')) {
        continue;
      }

      const relativePath = subPath
        ? join(projectId, subPath, name)
        : join(projectId, name);

      const parsed = this.parseFilePath(relativePath);
      if (!parsed) {
        continue;
      }

      const currentOffset = this.getOffset(fullPath);
      if (entryStat.size > currentOffset) {
        this.emit('file-change', {
          projectId: parsed.projectId,
          sessionId: parsed.sessionId,
          filePath: fullPath,
          isSubagent: parsed.isSubagent,
        } satisfies FileChangeEvent);
      }
    }
  }
}
