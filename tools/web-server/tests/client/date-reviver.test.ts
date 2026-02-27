import { describe, it, expect } from 'vitest';
import { reviveDates } from '../../src/client/api/client';

describe('JSON date reviver', () => {
  it('converts ISO-8601 strings to Date objects', () => {
    const json = '{"ts":"2026-02-27T15:30:45.123Z","name":"test"}';
    const result = JSON.parse(json, reviveDates);
    expect(result.ts).toBeInstanceOf(Date);
    expect(result.ts.getTime()).toBe(
      new Date('2026-02-27T15:30:45.123Z').getTime(),
    );
    expect(result.name).toBe('test');
  });

  it('preserves non-date strings', () => {
    const json = '{"id":"not-a-date","count":42}';
    const result = JSON.parse(json, reviveDates);
    expect(result.id).toBe('not-a-date');
    expect(result.count).toBe(42);
  });

  it('handles dates without fractional seconds', () => {
    const json = '{"ts":"2026-02-27T15:30:45Z"}';
    const result = JSON.parse(json, reviveDates);
    expect(result.ts).toBeInstanceOf(Date);
  });

  it('handles dates without Z suffix', () => {
    const json = '{"ts":"2026-02-27T15:30:45"}';
    const result = JSON.parse(json, reviveDates);
    expect(result.ts).toBeInstanceOf(Date);
  });

  it('does not convert partial date-like strings', () => {
    const json = '{"ts":"2026-02-27","name":"test"}';
    const result = JSON.parse(json, reviveDates);
    expect(result.ts).toBe('2026-02-27'); // Not a full ISO datetime
  });

  it('handles high-precision fractional seconds', () => {
    const json = '{"ts":"2026-02-27T15:30:45.123456789Z"}';
    const result = JSON.parse(json, reviveDates);
    expect(result.ts).toBeInstanceOf(Date);
  });
});
