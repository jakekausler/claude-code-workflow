import { describe, it, expect } from 'vitest';
import { computeDiff, getDiffStats } from '../../src/client/utils/diff.js';
import type { DiffLine } from '../../src/client/utils/diff.js';

describe('diff', () => {
  describe('computeDiff', () => {
    it('detects added lines', () => {
      const result = computeDiff('a\nb', 'a\nb\nc');
      expect(result).toEqual<DiffLine[]>([
        { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'context', content: 'b', oldLineNum: 2, newLineNum: 2 },
        { type: 'added', content: 'c', newLineNum: 3 },
      ]);
    });

    it('detects removed lines', () => {
      const result = computeDiff('a\nb\nc', 'a\nc');
      expect(result).toEqual<DiffLine[]>([
        { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'removed', content: 'b', oldLineNum: 2 },
        { type: 'context', content: 'c', oldLineNum: 3, newLineNum: 2 },
      ]);
    });

    it('detects replaced lines (remove + add)', () => {
      const result = computeDiff('a\nb\nc', 'a\nx\nc');
      // b is removed, x is added
      const types = result.map((l) => l.type);
      expect(types).toContain('removed');
      expect(types).toContain('added');
      expect(types).toContain('context');
      // Context lines should be 'a' and 'c'
      const contextLines = result.filter((l) => l.type === 'context');
      expect(contextLines.map((l) => l.content)).toEqual(['a', 'c']);
    });

    it('returns all context for identical strings', () => {
      const result = computeDiff('a\nb\nc', 'a\nb\nc');
      expect(result).toEqual<DiffLine[]>([
        { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'context', content: 'b', oldLineNum: 2, newLineNum: 2 },
        { type: 'context', content: 'c', oldLineNum: 3, newLineNum: 3 },
      ]);
    });

    it('returns all removed for empty new string', () => {
      const result = computeDiff('a\nb', '');
      const types = result.map((l) => l.type);
      expect(types).toEqual(['removed', 'removed', 'added']);
      // The empty string splits into [''], so there's one "added" empty line
    });

    it('returns all added for empty old string', () => {
      const result = computeDiff('', 'a\nb');
      const types = result.map((l) => l.type);
      expect(types).toEqual(['removed', 'added', 'added']);
      // The empty string splits into [''], so there's one "removed" empty line
    });

    it('handles both strings empty', () => {
      const result = computeDiff('', '');
      expect(result).toEqual<DiffLine[]>([
        { type: 'context', content: '', oldLineNum: 1, newLineNum: 1 },
      ]);
    });

    it('handles completely different strings', () => {
      const result = computeDiff('a\nb\nc', 'x\ny\nz');
      const removed = result.filter((l) => l.type === 'removed');
      const added = result.filter((l) => l.type === 'added');
      expect(removed.length).toBe(3);
      expect(added.length).toBe(3);
    });

    it('assigns correct line numbers for context lines', () => {
      const result = computeDiff('a\nb\nc', 'a\nx\nb\nc');
      const contextLines = result.filter((l) => l.type === 'context');
      for (const line of contextLines) {
        expect(line.oldLineNum).toBeDefined();
        expect(line.newLineNum).toBeDefined();
      }
    });

    it('only sets oldLineNum for removed lines', () => {
      const result = computeDiff('a\nb', 'a');
      const removed = result.filter((l) => l.type === 'removed');
      for (const line of removed) {
        expect(line.oldLineNum).toBeDefined();
        expect(line.newLineNum).toBeUndefined();
      }
    });

    it('only sets newLineNum for added lines', () => {
      const result = computeDiff('a', 'a\nb');
      const added = result.filter((l) => l.type === 'added');
      for (const line of added) {
        expect(line.newLineNum).toBeDefined();
        expect(line.oldLineNum).toBeUndefined();
      }
    });
  });

  describe('getDiffStats', () => {
    it('counts added and removed lines', () => {
      const lines: DiffLine[] = [
        { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'removed', content: 'b', oldLineNum: 2 },
        { type: 'added', content: 'x', newLineNum: 2 },
        { type: 'added', content: 'y', newLineNum: 3 },
        { type: 'context', content: 'c', oldLineNum: 3, newLineNum: 4 },
      ];
      expect(getDiffStats(lines)).toEqual({ added: 2, removed: 1 });
    });

    it('returns zeros for all context', () => {
      const lines: DiffLine[] = [
        { type: 'context', content: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'context', content: 'b', oldLineNum: 2, newLineNum: 2 },
      ];
      expect(getDiffStats(lines)).toEqual({ added: 0, removed: 0 });
    });

    it('returns zeros for empty array', () => {
      expect(getDiffStats([])).toEqual({ added: 0, removed: 0 });
    });
  });
});
