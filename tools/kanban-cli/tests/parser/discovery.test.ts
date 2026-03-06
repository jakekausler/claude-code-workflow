import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { discoverWorkItems, type DiscoveredFile } from '../../src/parser/discovery.js';

describe('discoverWorkItems', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-discovery-test-' + Date.now());
  const epicsDir = path.join(tmpDir, 'epics');

  beforeEach(() => {
    fs.mkdirSync(epicsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers epic files matching EPIC-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const epics = result.filter((f) => f.type === 'epic');
    expect(epics).toHaveLength(1);
    expect(epics[0].filePath).toContain('EPIC-001.md');
  });

  it('discovers ticket files matching TICKET-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'TICKET-001-001.md'), '---\nid: TICKET-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const tickets = result.filter((f) => f.type === 'ticket');
    expect(tickets).toHaveLength(1);
  });

  it('discovers stage files matching STAGE-*.md pattern', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    const stages = result.filter((f) => f.type === 'stage');
    expect(stages).toHaveLength(1);
  });

  it('discovers files in nested subdirectories', () => {
    const nestedDir = path.join(epicsDir, 'auth', 'login');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(1);
  });

  it('ignores non-matching markdown files', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(epicDir, 'notes.md'), '# Notes');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when epics directory does not exist', () => {
    const emptyDir = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = discoverWorkItems(emptyDir);
    expect(result).toEqual([]);
  });

  it('discovers all types in a mixed directory', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'TICKET-001-001.md'), '---\nid: TICKET-001-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-001.md'), '---\nid: STAGE-001-001-001\n---\n');
    fs.writeFileSync(path.join(epicDir, 'STAGE-001-001-002.md'), '---\nid: STAGE-001-001-002\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(4);
    expect(result.filter((f) => f.type === 'epic')).toHaveLength(1);
    expect(result.filter((f) => f.type === 'ticket')).toHaveLength(1);
    expect(result.filter((f) => f.type === 'stage')).toHaveLength(2);
  });

  it('returns absolute file paths', () => {
    const epicDir = path.join(epicsDir, 'auth');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.writeFileSync(path.join(epicDir, 'EPIC-001.md'), '---\nid: EPIC-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(path.isAbsolute(result[0].filePath)).toBe(true);
  });

  it('discovers in deeply nested directories', () => {
    const deepDir = path.join(epicsDir, 'auth', 'login', 'oauth', 'google');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'EPIC-002.md'), '---\nid: EPIC-002\n---\n');
    fs.writeFileSync(path.join(deepDir, 'TICKET-002-001.md'), '---\nid: TICKET-002-001\n---\n');

    const result = discoverWorkItems(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.filter((f) => f.type === 'epic')).toHaveLength(1);
    expect(result.filter((f) => f.type === 'ticket')).toHaveLength(1);
  });
});
