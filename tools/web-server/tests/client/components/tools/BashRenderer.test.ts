import { describe, it, expect } from 'vitest';
import { stripAnsi, isStderrLine } from '../../../../src/client/components/tools/BashRenderer.js';

describe('stripAnsi', () => {
  it('removes basic color codes', () => {
    expect(stripAnsi('\u001b[32mhello\u001b[0m')).toBe('hello');
  });

  it('removes bold and reset sequences', () => {
    expect(stripAnsi('\u001b[1mBold\u001b[0m text')).toBe('Bold text');
  });

  it('removes multi-parameter sequences', () => {
    expect(stripAnsi('\u001b[38;5;200mcolored\u001b[0m')).toBe('colored');
  });

  it('removes cursor-movement sequences', () => {
    expect(stripAnsi('\u001b[2Aup two lines')).toBe('up two lines');
  });

  it('leaves plain strings unchanged', () => {
    expect(stripAnsi('no escape codes here')).toBe('no escape codes here');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multiple sequences in one string', () => {
    expect(stripAnsi('\u001b[31mERROR\u001b[0m: \u001b[33mwarning\u001b[0m')).toBe(
      'ERROR: warning',
    );
  });
});

describe('isStderrLine', () => {
  it('detects Error: prefix', () => {
    expect(isStderrLine('Error: something went wrong')).toBe(true);
  });

  it('detects error: prefix (lowercase)', () => {
    expect(isStderrLine('error: file not found')).toBe(true);
  });

  it('detects ERR! prefix (npm style)', () => {
    expect(isStderrLine('ERR! missing package')).toBe(true);
  });

  it('detects ERR  prefix (with space)', () => {
    expect(isStderrLine('ERR  something')).toBe(true);
  });

  it('detects WARN prefix', () => {
    expect(isStderrLine('WARN: deprecated usage')).toBe(true);
  });

  it('detects Warning: prefix', () => {
    expect(isStderrLine('Warning: this is deprecated')).toBe(true);
  });

  it('detects warning: prefix (lowercase)', () => {
    expect(isStderrLine('warning: implicit conversion')).toBe(true);
  });

  it('detects fatal: prefix', () => {
    expect(isStderrLine('fatal: not a git repository')).toBe(true);
  });

  it('detects Fatal: prefix', () => {
    expect(isStderrLine('Fatal: unrecoverable error')).toBe(true);
  });

  it('detects stack trace lines (   at ...)', () => {
    expect(isStderrLine('    at Object.<anonymous> (index.js:1:1)')).toBe(true);
  });

  it('does not flag normal stdout lines', () => {
    expect(isStderrLine('Build succeeded')).toBe(false);
  });

  it('does not flag empty lines', () => {
    expect(isStderrLine('')).toBe(false);
  });

  it('does not flag lines that contain but do not start with error keywords', () => {
    expect(isStderrLine('No error occurred')).toBe(false);
  });
});
