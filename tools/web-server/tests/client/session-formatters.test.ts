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
    it('generates Write summary', () => {
      const input = { file_path: '/src/new-file.ts', content: 'abc' };
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
    it('falls back to tool name for unknown tools', () => {
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
