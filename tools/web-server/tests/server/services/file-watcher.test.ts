import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileWatcher } from '../../../src/server/services/file-watcher.js';
import type { FileChangeEvent } from '../../../src/server/services/file-watcher.js';

describe('FileWatcher', () => {
  let tempDir: string;
  let watcher: FileWatcher;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'file-watcher-test-'));
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('file change events', () => {
    it('emits file-change for new JSONL files', async () => {
      // Create the project directory structure before starting the watcher
      const projectDir = join(tempDir, 'my-project');
      mkdirSync(projectDir, { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        debounceMs: 10,
      });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      watcher.start();

      // Write a JSONL file after starting the watcher
      const filePath = join(projectDir, 'session-abc.jsonl');
      writeFileSync(filePath, '{"type":"user"}\n');

      // Wait for debounce + fs.watch propagation
      await delay(200);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events[0];
      expect(event.projectId).toBe('my-project');
      expect(event.sessionId).toBe('session-abc');
      expect(event.isSubagent).toBe(false);
      expect(event.filePath).toBe(filePath);
    });

    it('ignores non-JSONL files', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        debounceMs: 10,
      });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      watcher.start();

      // Write a non-JSONL file
      writeFileSync(join(projectDir, 'notes.txt'), 'hello');

      await delay(200);

      expect(events).toHaveLength(0);
    });
  });

  describe('debouncing', () => {
    it('debounces rapid changes to same file', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        debounceMs: 50,
      });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      watcher.start();

      const filePath = join(projectDir, 'session.jsonl');
      writeFileSync(filePath, '{"line":1}\n');

      // Rapid successive writes within debounce window
      await delay(10);
      appendFileSync(filePath, '{"line":2}\n');
      await delay(10);
      appendFileSync(filePath, '{"line":3}\n');

      // Wait for debounce to settle
      await delay(200);

      // Should have coalesced into one (or very few) event(s) rather than one per write
      // fs.watch may fire multiple raw events, but debounce should collapse them
      expect(events.length).toBeGreaterThanOrEqual(1);
      // The key assertion: debounce reduces events. Without debounce we'd get ~3+.
      // With 50ms debounce and 10ms between writes, we expect 1-2 events max.
      expect(events.length).toBeLessThanOrEqual(2);
    });
  });

  describe('byte offset tracking', () => {
    it('returns 0 for unknown file paths', () => {
      watcher = new FileWatcher({ rootDir: tempDir });
      expect(watcher.getOffset('/some/unknown/path.jsonl')).toBe(0);
    });

    it('stores and retrieves offsets', () => {
      watcher = new FileWatcher({ rootDir: tempDir });
      const filePath = '/some/path/session.jsonl';

      watcher.setOffset(filePath, 1024);
      expect(watcher.getOffset(filePath)).toBe(1024);

      watcher.setOffset(filePath, 2048);
      expect(watcher.getOffset(filePath)).toBe(2048);
    });

    it('clears offsets on stop', () => {
      watcher = new FileWatcher({ rootDir: tempDir });
      watcher.setOffset('/path/file.jsonl', 500);
      watcher.stop();
      expect(watcher.getOffset('/path/file.jsonl')).toBe(0);
    });
  });

  describe('catch-up scan', () => {
    it('detects files larger than stored offset', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      const filePath = join(projectDir, 'session.jsonl');
      writeFileSync(filePath, '{"line":1}\n{"line":2}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      // Offset is 0 by default, file has content — should trigger event
      await watcher.catchUpScan();

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('proj');
      expect(events[0].sessionId).toBe('session');
      expect(events[0].filePath).toBe(filePath);
    });

    it('skips files when offset matches file size', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      const filePath = join(projectDir, 'session.jsonl');
      const content = '{"line":1}\n';
      writeFileSync(filePath, content);

      watcher = new FileWatcher({ rootDir: tempDir });
      // Set offset to match file size — no new data
      watcher.setOffset(filePath, Buffer.byteLength(content));

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      expect(events).toHaveLength(0);
    });

    it('scans nested subagent directories', async () => {
      const sessionDir = join(tempDir, 'proj', 'session-1', 'subagents');
      mkdirSync(sessionDir, { recursive: true });

      const filePath = join(sessionDir, 'agent-abc.jsonl');
      writeFileSync(filePath, '{"type":"assistant"}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('proj');
      expect(events[0].sessionId).toBe('session-1');
      expect(events[0].isSubagent).toBe(true);
    });
  });

  describe('path parsing', () => {
    it('parses main session file paths', async () => {
      const projectDir = join(tempDir, 'my-project');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'abc-123.jsonl'), '{"x":1}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('my-project');
      expect(events[0].sessionId).toBe('abc-123');
      expect(events[0].isSubagent).toBe(false);
    });

    it('parses legacy subagent file paths', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'agent-xyz.jsonl'), '{"x":1}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('proj');
      expect(events[0].sessionId).toBe('agent-xyz');
      expect(events[0].isSubagent).toBe(true);
    });

    it('parses new-style subagent file paths', async () => {
      const subagentDir = join(tempDir, 'proj', 'session-main', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      writeFileSync(join(subagentDir, 'agent-sub1.jsonl'), '{"x":1}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('proj');
      expect(events[0].sessionId).toBe('session-main');
      expect(events[0].isSubagent).toBe(true);
    });
  });

  describe('stop()', () => {
    it('prevents events after stop', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        debounceMs: 10,
      });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      watcher.start();
      watcher.stop();

      // Write file after stop
      writeFileSync(join(projectDir, 'session.jsonl'), '{"x":1}\n');

      await delay(200);

      expect(events).toHaveLength(0);
    });
  });

  describe('non-existent root directory', () => {
    it('handles non-existent root directory gracefully', () => {
      const nonExistentDir = join(tempDir, 'does-not-exist');

      watcher = new FileWatcher({ rootDir: nonExistentDir });

      // Should not throw
      expect(() => watcher.start()).not.toThrow();
    });

    it('emits a warning when root directory does not exist', () => {
      const nonExistentDir = join(tempDir, 'does-not-exist');

      watcher = new FileWatcher({ rootDir: nonExistentDir });

      const warnings: string[] = [];
      watcher.on('warning', (msg: string) => {
        warnings.push(msg);
      });

      watcher.start();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('does-not-exist');
      expect(warnings[0]).toContain('not active');
    });

    it('catch-up scan handles non-existent root gracefully', async () => {
      const nonExistentDir = join(tempDir, 'does-not-exist');

      watcher = new FileWatcher({ rootDir: nonExistentDir });

      // Should not throw
      await expect(watcher.catchUpScan()).resolves.toBeUndefined();
    });
  });

  describe('double-start protection', () => {
    it('stops the previous watcher when start() is called twice', async () => {
      const projectDir = join(tempDir, 'proj');
      mkdirSync(projectDir, { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        debounceMs: 10,
      });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      watcher.start();
      // Calling start() again should not throw and should cleanly restart
      watcher.start();

      writeFileSync(join(projectDir, 'session.jsonl'), '{"x":1}\n');

      await delay(200);

      // Events should still be emitted — the watcher is active after restart
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('max depth guard', () => {
    it('does not recurse beyond max depth during catch-up scan', async () => {
      // Create a directory tree deeper than MAX_SCAN_DEPTH (4)
      // Depth 0: projectDir, Depth 1: a, Depth 2: b, Depth 3: c, Depth 4: d (should not be scanned)
      const deepDir = join(tempDir, 'proj', 'a', 'b', 'c', 'd');
      mkdirSync(deepDir, { recursive: true });

      // File at depth 4 — beyond the limit, should NOT be found
      writeFileSync(join(deepDir, 'deep.jsonl'), '{"x":1}\n');

      // File at depth 3 — within the limit, should be found
      const shallowDir = join(tempDir, 'proj', 'a', 'b', 'c');
      writeFileSync(join(shallowDir, 'shallow.jsonl'), '{"x":1}\n');

      watcher = new FileWatcher({ rootDir: tempDir });

      const events: FileChangeEvent[] = [];
      watcher.on('file-change', (event: FileChangeEvent) => {
        events.push(event);
      });

      await watcher.catchUpScan();

      const filePaths = events.map((e) => e.filePath);
      expect(filePaths).toContain(join(shallowDir, 'shallow.jsonl'));
      expect(filePaths).not.toContain(join(deepDir, 'deep.jsonl'));
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
