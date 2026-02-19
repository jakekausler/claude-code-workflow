import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectOldFormatEpics, isOldFormatRepo } from '../../src/migration/detector.js';

const TEST_DIR = '/tmp/kanban-migrate-detector-test';

function setupDir(structure: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('isOldFormatRepo', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns true when stage files exist directly in epic directory without ticket subdirs', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Some Stage\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Another Stage\n',
    });
    expect(isOldFormatRepo(TEST_DIR)).toBe(true);
  });

  it('returns false when repo uses new format with ticket subdirectories', () => {
    setupDir({
      'epics/EPIC-001/EPIC-001.md': '---\nid: EPIC-001\ntitle: Test\nstatus: Not Started\n---\n',
      'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': '---\nid: TICKET-001-001\n---\n',
      'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': '---\nid: STAGE-001-001-001\n---\n',
    });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('returns false when epics directory does not exist', () => {
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('returns false for empty epics directory', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });
});

describe('detectOldFormatEpics', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('detects epic directories containing old-format stage files', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Cart UI\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(2);
    expect(epics[0].id).toBe('EPIC-001');
    expect(epics[0].stages).toHaveLength(2);
    expect(epics[1].id).toBe('EPIC-002');
    expect(epics[1].stages).toHaveLength(1);
  });

  it('sorts epics by ID', () => {
    setupDir({
      'epics/EPIC-003/STAGE-003-001.md': '# Stage\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics.map((e) => e.id)).toEqual(['EPIC-001', 'EPIC-002', 'EPIC-003']);
  });

  it('sorts stages within an epic by stage number', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-003.md': '# Third\n',
      'epics/EPIC-001/STAGE-001-001.md': '# First\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Second\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].stages.map((s) => s.oldId)).toEqual([
      'STAGE-001-001',
      'STAGE-001-002',
      'STAGE-001-003',
    ]);
  });

  it('picks up title from existing epic markdown if present', () => {
    setupDir({
      'epics/EPIC-001/EPIC-001.md': '# User Authentication\n\nSome description.\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].title).toBe('User Authentication');
    expect(epics[0].hadEpicFile).toBe(true);
  });

  it('derives title from directory name when no epic file exists', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].title).toBe('EPIC-001');
    expect(epics[0].hadEpicFile).toBe(false);
  });

  it('ignores directories that are not EPIC-* format', () => {
    setupDir({
      'epics/random-dir/some-file.md': '# Not an epic\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe('EPIC-001');
  });

  it('skips epic directories that already have ticket subdirectories (new format)', () => {
    setupDir({
      'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': '---\nid: STAGE-001-001-001\n---\n',
      'epics/EPIC-001/EPIC-001.md': '---\nid: EPIC-001\ntitle: Auth\nstatus: Not Started\n---\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Old format stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe('EPIC-002');
  });

  it('returns empty array when no old-format epics found', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(0);
  });
});
