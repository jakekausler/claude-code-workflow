import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readStageFileContent } from '../../../src/cli/logic/summary.js';
import { computeHash } from '../../../src/cli/logic/summary-engine.js';

describe('readStageFileContent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-read-stage-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns content with filename header when no sister files exist', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main stage content.');

    const result = readStageFileContent(mainFile, tmpDir);

    expect(result).toBe('--- STAGE-001-001-001.md ---\nMain stage content.');
  });

  it('returns concatenated content with headers when sister files exist', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main content.');

    const sisterFile = path.join(stageDir, 'STAGE-001-001-001-design.md');
    fs.writeFileSync(sisterFile, 'Design notes.');

    // Set mtime: main first, sister second
    const baseTime = Date.now();
    fs.utimesSync(mainFile, baseTime / 1000, baseTime / 1000);
    fs.utimesSync(sisterFile, (baseTime + 1000) / 1000, (baseTime + 1000) / 1000);

    const result = readStageFileContent(mainFile, tmpDir);

    expect(result).toContain('--- STAGE-001-001-001.md ---\nMain content.');
    expect(result).toContain('--- STAGE-001-001-001-design.md ---\nDesign notes.');
    // Main should come before sister (earlier mtime)
    const mainIdx = result!.indexOf('STAGE-001-001-001.md ---');
    const sisterIdx = result!.indexOf('STAGE-001-001-001-design.md ---');
    expect(mainIdx).toBeLessThan(sisterIdx);
  });

  it('sorts sister files by mtime, not alphabetically', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main.');

    // Create sisters with alphabetical order opposite to mtime order
    const alphaFirst = path.join(stageDir, 'STAGE-001-001-001-aaa.md');
    const alphaSecond = path.join(stageDir, 'STAGE-001-001-001-bbb.md');
    fs.writeFileSync(alphaFirst, 'Alpha first.');
    fs.writeFileSync(alphaSecond, 'Alpha second.');

    // Set mtime: bbb first (oldest), main middle, aaa last (newest)
    const baseTime = Date.now();
    fs.utimesSync(alphaSecond, (baseTime - 2000) / 1000, (baseTime - 2000) / 1000);
    fs.utimesSync(mainFile, (baseTime - 1000) / 1000, (baseTime - 1000) / 1000);
    fs.utimesSync(alphaFirst, baseTime / 1000, baseTime / 1000);

    const result = readStageFileContent(mainFile, tmpDir);

    // bbb should come first (oldest mtime), then main, then aaa (newest)
    const bbbIdx = result!.indexOf('STAGE-001-001-001-bbb.md ---');
    const mainIdx = result!.indexOf('STAGE-001-001-001.md ---');
    const aaaIdx = result!.indexOf('STAGE-001-001-001-aaa.md ---');

    expect(bbbIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(aaaIdx);
  });

  it('returns null when stage file does not exist', () => {
    const result = readStageFileContent(
      path.join(tmpDir, 'nonexistent', 'STAGE-001-001-001.md'),
      tmpDir
    );

    expect(result).toBeNull();
  });

  it('handles relative path using repoPath', () => {
    const stageDir = path.join(tmpDir, 'epics', 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Relative path content.');

    const result = readStageFileContent('epics/stages/STAGE-001-001-001.md', tmpDir);

    expect(result).toBe('--- STAGE-001-001-001.md ---\nRelative path content.');
  });

  it('does not include unrelated files in the same directory', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main content.');

    // These should NOT be included
    fs.writeFileSync(path.join(stageDir, 'STAGE-001-001-002.md'), 'Different stage.');
    fs.writeFileSync(path.join(stageDir, 'TICKET-001-001.md'), 'Ticket file.');
    fs.writeFileSync(path.join(stageDir, 'README.md'), 'Readme.');

    const result = readStageFileContent(mainFile, tmpDir);

    // Only the main file should appear
    expect(result).toBe('--- STAGE-001-001-001.md ---\nMain content.');
    expect(result).not.toContain('STAGE-001-001-002');
    expect(result).not.toContain('TICKET');
    expect(result).not.toContain('README');
  });

  it('includes multiple sister files from different phases', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main.');

    const designFile = path.join(stageDir, 'STAGE-001-001-001-design.md');
    const buildFile = path.join(stageDir, 'STAGE-001-001-001-build.md');
    const testFile = path.join(stageDir, 'STAGE-001-001-001-testing.md');
    fs.writeFileSync(designFile, 'Design notes.');
    fs.writeFileSync(buildFile, 'Build notes.');
    fs.writeFileSync(testFile, 'Test notes.');

    // Set mtimes in known order
    const baseTime = Date.now();
    fs.utimesSync(mainFile, (baseTime - 3000) / 1000, (baseTime - 3000) / 1000);
    fs.utimesSync(designFile, (baseTime - 2000) / 1000, (baseTime - 2000) / 1000);
    fs.utimesSync(buildFile, (baseTime - 1000) / 1000, (baseTime - 1000) / 1000);
    fs.utimesSync(testFile, baseTime / 1000, baseTime / 1000);

    const result = readStageFileContent(mainFile, tmpDir);

    expect(result).toContain('--- STAGE-001-001-001.md ---');
    expect(result).toContain('--- STAGE-001-001-001-design.md ---');
    expect(result).toContain('--- STAGE-001-001-001-build.md ---');
    expect(result).toContain('--- STAGE-001-001-001-testing.md ---');

    // Verify order: main, design, build, testing
    const mainIdx = result!.indexOf('STAGE-001-001-001.md ---');
    const designIdx = result!.indexOf('STAGE-001-001-001-design.md ---');
    const buildIdx = result!.indexOf('STAGE-001-001-001-build.md ---');
    const testIdx = result!.indexOf('STAGE-001-001-001-testing.md ---');

    expect(mainIdx).toBeLessThan(designIdx);
    expect(designIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(testIdx);
  });

  it('separates file sections with double newline', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main.');

    const sisterFile = path.join(stageDir, 'STAGE-001-001-001-design.md');
    fs.writeFileSync(sisterFile, 'Design.');

    const baseTime = Date.now();
    fs.utimesSync(mainFile, (baseTime - 1000) / 1000, (baseTime - 1000) / 1000);
    fs.utimesSync(sisterFile, baseTime / 1000, baseTime / 1000);

    const result = readStageFileContent(mainFile, tmpDir);

    // Files should be separated by \n\n
    expect(result).toBe(
      '--- STAGE-001-001-001.md ---\nMain.\n\n--- STAGE-001-001-001-design.md ---\nDesign.'
    );
  });

  it('content hash changes when a sister file is added', () => {
    const stageDir = path.join(tmpDir, 'stages');
    fs.mkdirSync(stageDir, { recursive: true });

    const mainFile = path.join(stageDir, 'STAGE-001-001-001.md');
    fs.writeFileSync(mainFile, 'Main stage content.');

    // Compute hash without sister files
    const contentBefore = readStageFileContent(mainFile, tmpDir);
    expect(contentBefore).not.toBeNull();
    const hashBefore = computeHash(contentBefore!);

    // Add a sister file
    const sisterFile = path.join(stageDir, 'STAGE-001-001-001-design.md');
    fs.writeFileSync(sisterFile, 'Design notes.');

    // Compute hash with sister file present
    const contentAfter = readStageFileContent(mainFile, tmpDir);
    expect(contentAfter).not.toBeNull();
    const hashAfter = computeHash(contentAfter!);

    // Hashes must differ — summary cache auto-invalidates when sisters are added
    expect(hashBefore).not.toBe(hashAfter);
  });
});
