import { describe, it, expect } from 'vitest';
import {
  parseGrepLine,
  groupGrepMatches,
  splitForHighlight,
} from '../../../../src/client/components/tools/GrepRenderer.js';

describe('parseGrepLine', () => {
  it('parses file:linenum:content format', () => {
    const result = parseGrepLine('src/foo.ts:42:  const x = 1;');
    expect(result).toEqual({ filePath: 'src/foo.ts', lineNumber: 42, text: '  const x = 1;' });
  });

  it('parses file:content format (no line number)', () => {
    const result = parseGrepLine('src/foo.ts:some match text');
    expect(result).toEqual({ filePath: 'src/foo.ts', lineNumber: null, text: 'some match text' });
  });

  it('returns null for empty string', () => {
    expect(parseGrepLine('')).toBeNull();
  });

  it('handles content with colons after the line number', () => {
    const result = parseGrepLine('path/to/file.ts:10:http://example.com');
    expect(result).toEqual({
      filePath: 'path/to/file.ts',
      lineNumber: 10,
      text: 'http://example.com',
    });
  });

  it('parses nested path with line number', () => {
    const result = parseGrepLine('a/b/c/d.js:1:export default {}');
    expect(result).toEqual({ filePath: 'a/b/c/d.js', lineNumber: 1, text: 'export default {}' });
  });
});

describe('groupGrepMatches', () => {
  it('returns empty array for empty input', () => {
    expect(groupGrepMatches([])).toEqual([]);
  });

  it('groups matches by file path', () => {
    const lines = [
      'src/a.ts:1:match one',
      'src/b.ts:5:match two',
      'src/a.ts:10:match three',
    ];
    const groups = groupGrepMatches(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].filePath).toBe('src/a.ts');
    expect(groups[0].matches).toHaveLength(2);
    expect(groups[1].filePath).toBe('src/b.ts');
    expect(groups[1].matches).toHaveLength(1);
  });

  it('preserves insertion order for file groups', () => {
    const lines = [
      'z.ts:1:first',
      'a.ts:2:second',
      'z.ts:3:third',
    ];
    const groups = groupGrepMatches(lines);
    expect(groups[0].filePath).toBe('z.ts');
    expect(groups[1].filePath).toBe('a.ts');
  });

  it('collects unparseable lines under empty-string key', () => {
    const lines = ['plaintext line with no colon'];
    const groups = groupGrepMatches(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].filePath).toBe('');
    expect(groups[0].matches[0].text).toBe('plaintext line with no colon');
  });

  it('includes correct line numbers in matches', () => {
    const lines = ['src/foo.ts:7:  return value;'];
    const groups = groupGrepMatches(lines);
    expect(groups[0].matches[0].lineNumber).toBe(7);
    expect(groups[0].matches[0].text).toBe('  return value;');
  });

  it('handles multiple files with multiple matches each', () => {
    const lines = [
      'x.ts:1:alpha',
      'x.ts:2:beta',
      'y.ts:3:gamma',
      'y.ts:4:delta',
      'y.ts:5:epsilon',
    ];
    const groups = groupGrepMatches(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].matches).toHaveLength(2);
    expect(groups[1].matches).toHaveLength(3);
  });
});

describe('splitForHighlight', () => {
  it('returns single non-highlighted segment when term is empty', () => {
    const parts = splitForHighlight('hello world', '');
    expect(parts).toEqual([{ text: 'hello world', highlight: false }]);
  });

  it('highlights a single occurrence', () => {
    const parts = splitForHighlight('foo bar baz', 'bar');
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe('bar');
  });

  it('highlights multiple occurrences', () => {
    const parts = splitForHighlight('foo foo foo', 'foo');
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted).toHaveLength(3);
  });

  it('is case-insensitive', () => {
    const parts = splitForHighlight('Hello HELLO hello', 'hello');
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted).toHaveLength(3);
  });

  it('returns non-highlighted segment when term not found', () => {
    const parts = splitForHighlight('hello world', 'xyz');
    expect(parts).toEqual([{ text: 'hello world', highlight: false }]);
  });

  it('handles regex special characters in term', () => {
    const parts = splitForHighlight('price is $5.00', '$5.00');
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe('$5.00');
  });

  it('returns empty segments correctly for match at start', () => {
    const parts = splitForHighlight('foobar', 'foo');
    // split with capture group produces ['', 'foo', 'bar'] — first highlighted segment is at index 1
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted[0]).toMatchObject({ highlight: true, text: 'foo' });
  });

  it('returns empty segments correctly for match at end', () => {
    const parts = splitForHighlight('foobar', 'bar');
    const highlighted = parts.filter((p) => p.highlight);
    expect(highlighted[0]).toMatchObject({ text: 'bar' });
  });
});
