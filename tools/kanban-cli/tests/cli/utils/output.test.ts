import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeOutput } from '../../../src/cli/utils/output.js';

describe('writeOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to stdout when no path is given', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writeOutput('hello world');
    expect(spy).toHaveBeenCalledWith('hello world');
  });

  it('writes to file when path is given', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-test-'));
    const filePath = path.join(tmpDir, 'out.txt');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeOutput('file content', filePath);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('file content');

    expect(stderrSpy).toHaveBeenCalledWith(`Written to ${path.resolve(filePath)}\n`);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates parent directories when they do not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-test-'));
    const filePath = path.join(tmpDir, 'nested', 'deep', 'out.txt');

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeOutput('nested content', filePath);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('nested content');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('prints confirmation to stderr when writing to file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-test-'));
    const filePath = path.join(tmpDir, 'confirm.txt');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    writeOutput('data', filePath);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(`Written to ${path.resolve(filePath)}\n`);
    expect(stdoutSpy).not.toHaveBeenCalled();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
