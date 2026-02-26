import { describe, it, expect } from 'vitest';
import { toDate, truncateText, sanitizeDisplayContent, formatToolInput, formatToolResult } from '../../src/client/utils/display-helpers.js';

describe('toDate', () => {
  it('passes through Date objects', () => {
    const d = new Date('2025-01-01');
    expect(toDate(d)).toBe(d);
  });

  it('converts ISO strings', () => {
    const result = toDate('2025-06-15T10:30:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2025-06-15T10:30:00.000Z');
  });

  it('converts epoch numbers', () => {
    const epoch = 1718450000000;
    const result = toDate(epoch);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(epoch);
  });

  it('returns epoch 0 for invalid values', () => {
    expect(toDate('not-a-date').getTime()).toBe(0);
  });
});

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis', () => {
    expect(truncateText('hello world', 5)).toBe('hello\u2026');
  });

  it('handles exact length', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });
});

describe('sanitizeDisplayContent', () => {
  it('strips local-command-caveat', () => {
    const input = 'before<local-command-caveat>noise</local-command-caveat>after';
    expect(sanitizeDisplayContent(input)).toBe('beforeafter');
  });

  it('strips system-reminder', () => {
    const input = 'before<system-reminder>noise</system-reminder>after';
    expect(sanitizeDisplayContent(input)).toBe('beforeafter');
  });

  it('converts command-name to slash', () => {
    const input = '<command-name>commit</command-name>';
    expect(sanitizeDisplayContent(input)).toBe('/commit');
  });

  it('handles multiline noise', () => {
    const input = 'text\n<system-reminder>\nlong\nnoise\n</system-reminder>\nmore';
    expect(sanitizeDisplayContent(input)).toBe('text\n\nmore');
  });

  it('trims result', () => {
    const input = '  <system-reminder>x</system-reminder>  text  ';
    expect(sanitizeDisplayContent(input)).toBe('text');
  });
});

describe('formatToolInput', () => {
  it('formats JSON with truncation', () => {
    const input = { path: '/very/long/path/to/some/deeply/nested/file/that/exceeds/limit' };
    const result = formatToolInput(input);
    expect(result.length).toBeLessThanOrEqual(101); // 100 + ellipsis
  });

  it('handles short input', () => {
    expect(formatToolInput({ a: 1 })).toContain('"a"');
  });

  it('handles circular references gracefully', () => {
    const obj: any = {};
    obj.self = obj;
    const result = formatToolInput(obj);
    expect(typeof result).toBe('string');
  });
});

describe('formatToolResult', () => {
  it('truncates string content', () => {
    const long = 'x'.repeat(300);
    const result = formatToolResult(long);
    expect(result.length).toBeLessThanOrEqual(201); // 200 + ellipsis
  });

  it('extracts text from content blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'image', source: {} },
      { type: 'text', text: 'world' },
    ];
    expect(formatToolResult(blocks)).toBe('hello\nworld');
  });

  it('falls back to JSON for non-text blocks', () => {
    const blocks = [{ type: 'image', source: {} }];
    const result = formatToolResult(blocks);
    expect(result).toContain('image');
  });

  it('returns empty string for non-array non-string', () => {
    expect(formatToolResult(42 as any)).toBe('');
  });
});
