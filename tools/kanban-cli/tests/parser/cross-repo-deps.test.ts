import { describe, it, expect } from 'vitest';
import {
  parseDependencyRef,
  isCrossRepoDep,
  formatCrossRepoDep,
} from '../../src/parser/cross-repo-deps.js';

describe('parseDependencyRef', () => {
  it('parses a local dependency (no slash)', () => {
    const result = parseDependencyRef('STAGE-001-001-001');
    expect(result).toEqual({ type: 'local', itemId: 'STAGE-001-001-001' });
  });

  it('parses a cross-repo stage dependency', () => {
    const result = parseDependencyRef('backend/STAGE-002-001-001');
    expect(result).toEqual({
      type: 'cross-repo',
      repoName: 'backend',
      itemId: 'STAGE-002-001-001',
    });
  });

  it('parses a cross-repo ticket dependency', () => {
    const result = parseDependencyRef('backend/TICKET-002-001');
    expect(result).toEqual({
      type: 'cross-repo',
      repoName: 'backend',
      itemId: 'TICKET-002-001',
    });
  });

  it('handles repo names with hyphens', () => {
    const result = parseDependencyRef('my-service/EPIC-003');
    expect(result).toEqual({
      type: 'cross-repo',
      repoName: 'my-service',
      itemId: 'EPIC-003',
    });
  });
});

describe('isCrossRepoDep', () => {
  it('returns false for a local dependency', () => {
    expect(isCrossRepoDep('STAGE-001-001-001')).toBe(false);
  });

  it('returns true for a cross-repo dependency', () => {
    expect(isCrossRepoDep('backend/STAGE-002-001-001')).toBe(true);
  });

  it('returns true for a cross-repo ticket dependency', () => {
    expect(isCrossRepoDep('backend/TICKET-002-001')).toBe(true);
  });
});

describe('formatCrossRepoDep', () => {
  it('formats a cross-repo dependency string', () => {
    expect(formatCrossRepoDep('backend', 'STAGE-001')).toBe('backend/STAGE-001');
  });

  it('roundtrips through parseDependencyRef', () => {
    const formatted = formatCrossRepoDep('backend', 'STAGE-001');
    const parsed = parseDependencyRef(formatted);
    expect(parsed).toEqual({
      type: 'cross-repo',
      repoName: 'backend',
      itemId: 'STAGE-001',
    });
  });
});
