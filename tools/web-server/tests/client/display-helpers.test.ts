import { describe, it, expect } from 'vitest';
import {
  toDate, truncateText, sanitizeDisplayContent, formatToolInput, formatToolResult,
  isCommandContent, isCommandOutputContent, extractSlashInfo,
} from '../../src/client/utils/display-helpers.js';

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

describe('isCommandContent', () => {
  it('detects command-name tag', () => {
    expect(isCommandContent('<command-name>/clear</command-name>')).toBe(true);
  });

  it('detects command-message tag', () => {
    expect(isCommandContent('<command-message>clear</command-message>')).toBe(true);
  });

  it('rejects regular text', () => {
    expect(isCommandContent('Hello world')).toBe(false);
  });

  it('rejects text with command tags not at start', () => {
    expect(isCommandContent('text <command-name>/clear</command-name>')).toBe(false);
  });
});

describe('isCommandOutputContent', () => {
  it('detects stdout', () => {
    expect(isCommandOutputContent('<local-command-stdout>output</local-command-stdout>')).toBe(true);
  });

  it('detects stderr', () => {
    expect(isCommandOutputContent('<local-command-stderr>error</local-command-stderr>')).toBe(true);
  });

  it('rejects regular text', () => {
    expect(isCommandOutputContent('Hello world')).toBe(false);
  });
});

describe('extractSlashInfo', () => {
  it('extracts command name', () => {
    const result = extractSlashInfo('<command-name>/clear</command-name>');
    expect(result).toEqual({ name: 'clear' });
  });

  it('extracts command name with message and args', () => {
    const result = extractSlashInfo(
      '<command-name>/model</command-name><command-message>model</command-message><command-args>sonnet</command-args>',
    );
    expect(result).toEqual({ name: 'model', message: 'model', args: 'sonnet' });
  });

  it('returns null for non-command content', () => {
    expect(extractSlashInfo('Hello world')).toBeNull();
  });

  it('handles empty/default args tag (e.g., <> inside args)', () => {
    const result = extractSlashInfo(
      '<command-name>/clear</command-name><command-message>clear</command-message><command-args><></command-args>',
    );
    // The regex [^<]* does not match <> content, so args is undefined
    expect(result).toEqual({ name: 'clear', message: 'clear' });
  });

  it('extracts non-empty args', () => {
    const result = extractSlashInfo(
      '<command-name>/model</command-name><command-message>model</command-message><command-args>sonnet</command-args>',
    );
    expect(result).toEqual({ name: 'model', message: 'model', args: 'sonnet' });
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

  it('handles multiline noise', () => {
    const input = 'text\n<system-reminder>\nlong\nnoise\n</system-reminder>\nmore';
    expect(sanitizeDisplayContent(input)).toBe('text\n\nmore');
  });

  it('trims result', () => {
    const input = '  <system-reminder>x</system-reminder>  text  ';
    expect(sanitizeDisplayContent(input)).toBe('text');
  });

  it('extracts /clear from command content', () => {
    const input = '<command-name>/clear</command-name><command-message>clear</command-message><command-args><></command-args>';
    expect(sanitizeDisplayContent(input)).toBe('/clear');
  });

  it('extracts /model sonnet from command+args', () => {
    const input = '<command-name>/model</command-name><command-args>sonnet</command-args>';
    expect(sanitizeDisplayContent(input)).toBe('/model sonnet');
  });

  it('strips command tags from mixed content', () => {
    const input = 'Hello <command-message>noise</command-message> world <command-args>stuff</command-args>';
    expect(sanitizeDisplayContent(input)).toBe('Hello  world');
  });

  it('extracts stdout from command output', () => {
    const input = '<local-command-stdout>output text</local-command-stdout>';
    expect(sanitizeDisplayContent(input)).toBe('output text');
  });

  it('extracts stderr from command output', () => {
    const input = '<local-command-stderr>error text</local-command-stderr>';
    expect(sanitizeDisplayContent(input)).toBe('error text');
  });

  it('strips command-name tags from non-command mixed content', () => {
    const input = 'Check this <command-name>/foo</command-name> out';
    expect(sanitizeDisplayContent(input)).toBe('Check this  out');
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
