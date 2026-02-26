import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import { FileWatcher } from '../../src/server/services/file-watcher.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileWatcher decoration', () => {
  let app: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sse-test-'));
  });

  afterEach(async () => {
    await app?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('decorates fileWatcher on app when provided', async () => {
    const fw = new FileWatcher({ rootDir: tempDir });
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
      fileWatcher: fw,
    });
    expect(app.fileWatcher).toBe(fw);
  });

  it('decorates fileWatcher as null when not provided', async () => {
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
    });
    expect(app.fileWatcher).toBeNull();
  });
});
