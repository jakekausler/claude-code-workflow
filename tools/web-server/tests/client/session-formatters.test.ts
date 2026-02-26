import { describe, it, expect } from 'vitest';
import {
  formatTokenCount,
  formatDuration,
  formatCost,
  generateToolSummary,
  formatTimestamp,
} from '../../src/client/utils/session-formatters.js';

describe('session-formatters', () => {
  describe('formatTokenCount', () => {
    it('formats small numbers directly', () => {
      expect(formatTokenCount(500)).toBe('500');
    });
    it('formats thousands with K suffix', () => {
      expect(formatTokenCount(12300)).toBe('12.3K');
    });
    it('formats millions with M suffix', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M');
    });
    it('returns 0 for zero', () => {
      expect(formatTokenCount(0)).toBe('0');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
    });
    it('formats minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });
    it('formats hours', () => {
      expect(formatDuration(3661000)).toBe('1h 1m');
    });
    it('returns 0s for zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
    it('formats sub-second durations in milliseconds', () => {
      expect(formatDuration(150)).toBe('150ms');
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(1)).toBe('1ms');
      expect(formatDuration(999)).toBe('999ms');
    });
  });

  describe('formatCost', () => {
    it('formats cost with dollar sign and 2 decimal places', () => {
      expect(formatCost(1.5)).toBe('$1.50');
    });
    it('formats small costs with 4 decimal places', () => {
      expect(formatCost(0.0023)).toBe('$0.0023');
    });
    it('formats zero', () => {
      expect(formatCost(0)).toBe('$0.00');
    });
  });

  describe('generateToolSummary', () => {
    it('generates Edit summary', () => {
      const input = { file_path: '/src/app.ts', old_string: 'abc', new_string: 'abcdef' };
      expect(generateToolSummary('Edit', input)).toBe('app.ts');
    });
    it('generates Read summary with line range', () => {
      const input = { file_path: '/src/utils.ts', offset: 1, limit: 100 };
      expect(generateToolSummary('Read', input)).toBe('utils.ts \u2014 lines 1-100');
    });
    it('generates Read summary without line range', () => {
      const input = { file_path: '/src/utils.ts' };
      expect(generateToolSummary('Read', input)).toBe('utils.ts');
    });
    it('generates Bash summary with truncated command', () => {
      const input = { command: 'npm run build && npm run test -- --coverage --reporter=verbose' };
      expect(generateToolSummary('Bash', input)).toBe('npm run build && npm run test -- --cove\u2026');
    });
    it('generates Bash summary for short commands', () => {
      const input = { command: 'git status' };
      expect(generateToolSummary('Bash', input)).toBe('git status');
    });
    it('generates Grep summary', () => {
      const input = { pattern: 'TODO', glob: '*.ts' };
      expect(generateToolSummary('Grep', input)).toBe('"TODO" in *.ts');
    });
    it('generates Glob summary', () => {
      const input = { pattern: 'src/**/*.tsx' };
      expect(generateToolSummary('Glob', input)).toBe('src/**/*.tsx');
    });
    it('generates Write summary with line count', () => {
      const input = { file_path: '/src/new-file.ts', content: 'line1\nline2\nline3' };
      expect(generateToolSummary('Write', input)).toBe('new-file.ts - 3 lines');
    });
    it('generates Write summary for single-line content', () => {
      const input = { file_path: '/src/new-file.ts', content: 'single' };
      expect(generateToolSummary('Write', input)).toBe('new-file.ts - 1 line');
    });
    it('generates Write summary without content', () => {
      const input = { file_path: '/src/new-file.ts' };
      expect(generateToolSummary('Write', input)).toBe('new-file.ts');
    });
    it('generates Task summary', () => {
      const input = { description: 'Explore the authentication system', subagent_type: 'Explore' };
      expect(generateToolSummary('Task', input)).toBe('Explore \u2014 Explore the authentication sy\u2026');
    });
    it('generates Skill summary', () => {
      const input = { skill: 'commit' };
      expect(generateToolSummary('Skill', input)).toBe('commit');
    });
    it('generates WebFetch summary with hostname and pathname', () => {
      const input = { url: 'https://example.com/docs/guide' };
      expect(generateToolSummary('WebFetch', input)).toBe('example.com/docs/guide');
    });
    it('generates WebFetch summary with invalid URL', () => {
      const input = { url: 'not-a-url' };
      expect(generateToolSummary('WebFetch', input)).toBe('not-a-url');
    });
    it('generates WebFetch summary without url', () => {
      expect(generateToolSummary('WebFetch', {})).toBe('WebFetch');
    });
    it('generates WebSearch summary', () => {
      const input = { query: 'how to test react components' };
      expect(generateToolSummary('WebSearch', input)).toBe('"how to test react components"');
    });
    it('generates WebSearch summary truncated', () => {
      const input = { query: 'a very long search query that exceeds the forty character limit for truncation' };
      const result = generateToolSummary('WebSearch', input);
      expect(result.startsWith('"a very long')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(43); // 40 + quotes + ellipsis
    });
    it('generates NotebookEdit summary with edit mode', () => {
      const input = { notebook_path: '/notebooks/analysis.ipynb', edit_mode: 'replace' };
      expect(generateToolSummary('NotebookEdit', input)).toBe('replace - analysis.ipynb');
    });
    it('generates NotebookEdit summary without edit mode', () => {
      const input = { notebook_path: '/notebooks/analysis.ipynb' };
      expect(generateToolSummary('NotebookEdit', input)).toBe('analysis.ipynb');
    });
    it('generates TodoWrite summary', () => {
      const input = { todos: [{ id: '1' }, { id: '2' }, { id: '3' }] };
      expect(generateToolSummary('TodoWrite', input)).toBe('3 items');
    });
    it('generates TodoWrite summary for single item', () => {
      const input = { todos: [{ id: '1' }] };
      expect(generateToolSummary('TodoWrite', input)).toBe('1 item');
    });
    it('generates TaskCreate summary', () => {
      const input = { subject: 'Fix authentication bug in login flow' };
      expect(generateToolSummary('TaskCreate', input)).toBe('Fix authentication bug in login flow');
    });
    it('generates TaskUpdate summary with status', () => {
      const input = { taskId: '42', status: 'completed' };
      expect(generateToolSummary('TaskUpdate', input)).toBe('#42 completed');
    });
    it('generates TaskUpdate summary without status', () => {
      const input = { taskId: '42' };
      expect(generateToolSummary('TaskUpdate', input)).toBe('#42');
    });
    it('generates TaskList summary', () => {
      expect(generateToolSummary('TaskList', {})).toBe('List tasks');
    });
    it('generates TaskGet summary', () => {
      const input = { taskId: '7' };
      expect(generateToolSummary('TaskGet', input)).toBe('Get task #7');
    });
    it('uses fallback for unknown tools with common field names', () => {
      const input = { path: '/some/path/to/file.txt' };
      expect(generateToolSummary('mcp__custom_tool', input)).toBe('/some/path/to/file.txt');
    });
    it('uses fallback for unknown tools with query field', () => {
      const input = { query: 'SELECT * FROM users' };
      expect(generateToolSummary('mcp__custom_tool', input)).toBe('SELECT * FROM users');
    });
    it('falls back to tool name for unknown tools with no recognized fields', () => {
      const input = { foo: 'bar' };
      expect(generateToolSummary('mcp__custom_tool', input)).toBe('mcp__custom_tool');
    });
  });

  describe('formatTimestamp', () => {
    it('formats a Date object as time string', () => {
      const date = new Date('2026-02-26T14:30:00Z');
      const result = formatTimestamp(date);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('formats an ISO string as time string', () => {
      const result = formatTimestamp('2026-02-26T14:30:00Z');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('formats a numeric timestamp (ms) as time string', () => {
      const ms = new Date('2026-02-26T14:30:00Z').getTime();
      const result = formatTimestamp(ms);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('returns empty string for invalid date', () => {
      expect(formatTimestamp('not-a-date')).toBe('');
    });

    it('returns empty string for NaN', () => {
      expect(formatTimestamp(NaN)).toBe('');
    });

    it('returns empty string for invalid Date object', () => {
      expect(formatTimestamp(new Date('invalid'))).toBe('');
    });
  });
});
