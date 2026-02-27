import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

import { DirectFileSystemProvider } from '../../../src/server/deployment/local/direct-fs-provider.js';

describe('DirectFileSystemProvider', () => {
  let provider: DirectFileSystemProvider;
  let tmpDir: string;

  beforeEach(async () => {
    provider = new DirectFileSystemProvider();
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'direct-fs-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has type "local"', () => {
    expect(provider.type).toBe('local');
  });

  it('reads a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world');
    const result = await provider.readFile(filePath);
    expect(result.toString()).toBe('hello world');
  });

  it('reads a directory', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), '');
    await writeFile(path.join(tmpDir, 'b.txt'), '');
    const entries = await provider.readdir(tmpDir);
    expect(entries.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('stats a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello');
    const stat = await provider.stat(filePath);
    expect(stat.size).toBe(5);
    expect(stat.isDirectory).toBe(false);
    expect(typeof stat.mtimeMs).toBe('number');
  });

  it('stats a directory', async () => {
    const dirPath = path.join(tmpDir, 'subdir');
    await mkdir(dirPath);
    const stat = await provider.stat(dirPath);
    expect(stat.isDirectory).toBe(true);
  });

  it('checks existence of existing file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, '');
    expect(await provider.exists(filePath)).toBe(true);
  });

  it('checks existence of missing file', async () => {
    expect(await provider.exists(path.join(tmpDir, 'nope.txt'))).toBe(false);
  });

  it('creates a read stream', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'stream content');
    const stream = provider.createReadStream(filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe('stream content');
  });

  it('watches a directory for changes', async () => {
    const watcher = provider.watch(tmpDir);
    expect(typeof watcher.close).toBe('function');
    watcher.close();
  });
});
