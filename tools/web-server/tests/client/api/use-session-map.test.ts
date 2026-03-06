import { describe, it, expect } from 'vitest';
import {
  useSessionMap,
  parseSessionStatusEvent,
} from '../../../src/client/api/use-session-map.js';

// ---------------------------------------------------------------------------
// Module smoke tests
// ---------------------------------------------------------------------------

describe('useSessionMap', () => {
  it('is exported as a function', () => {
    expect(typeof useSessionMap).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// parseSessionStatusEvent (pure logic — no React rendering required)
// ---------------------------------------------------------------------------

describe('parseSessionStatusEvent', () => {
  it('parses a complete session-status event', () => {
    const raw = {
      stageId: 'STAGE-001',
      sessionId: 'sess-abc',
      status: 'active',
      waitingType: 'permission',
      spawnedAt: 1700000000,
    };
    const result = parseSessionStatusEvent(raw);
    expect(result).toEqual({
      stageId: 'STAGE-001',
      entry: {
        status: 'active',
        waitingType: 'permission',
        sessionId: 'sess-abc',
        spawnedAt: 1700000000,
      },
    });
  });

  it('fills defaults for optional fields', () => {
    const raw = {
      stageId: 'STAGE-002',
      status: 'starting',
    };
    const result = parseSessionStatusEvent(raw);
    expect(result).not.toBeNull();
    expect(result!.stageId).toBe('STAGE-002');
    expect(result!.entry.status).toBe('starting');
    expect(result!.entry.waitingType).toBeNull();
    expect(result!.entry.sessionId).toBe('');
    expect(typeof result!.entry.spawnedAt).toBe('number');
  });

  it('returns null for null input', () => {
    expect(parseSessionStatusEvent(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseSessionStatusEvent(undefined)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseSessionStatusEvent('bad')).toBeNull();
    expect(parseSessionStatusEvent(42)).toBeNull();
    expect(parseSessionStatusEvent(true)).toBeNull();
  });

  it('returns null when stageId is missing', () => {
    const raw = { status: 'active' };
    expect(parseSessionStatusEvent(raw)).toBeNull();
  });

  it('returns null when status is missing', () => {
    const raw = { stageId: 'STAGE-001' };
    expect(parseSessionStatusEvent(raw)).toBeNull();
  });

  it('defaults waitingType to null when absent', () => {
    const raw = { stageId: 'STAGE-003', status: 'active' };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.waitingType).toBeNull();
  });

  it('defaults waitingType to null when explicitly undefined', () => {
    const raw = { stageId: 'STAGE-003', status: 'active', waitingType: undefined };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.waitingType).toBeNull();
  });

  it('preserves waitingType when set to user_input', () => {
    const raw = { stageId: 'STAGE-004', status: 'active', waitingType: 'user_input' };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.waitingType).toBe('user_input');
  });

  it('preserves waitingType when explicitly null', () => {
    const raw = { stageId: 'STAGE-004', status: 'active', waitingType: null };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.waitingType).toBeNull();
  });

  it('handles ended status', () => {
    const raw = { stageId: 'STAGE-005', status: 'ended', waitingType: null };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.status).toBe('ended');
  });

  it('defaults sessionId to empty string when non-string', () => {
    const raw = { stageId: 'STAGE-006', status: 'active', sessionId: 123 };
    const result = parseSessionStatusEvent(raw);
    expect(result!.entry.sessionId).toBe('');
  });

  it('defaults spawnedAt to current timestamp when non-number', () => {
    const before = Date.now();
    const raw = { stageId: 'STAGE-007', status: 'starting', spawnedAt: 'bad' };
    const result = parseSessionStatusEvent(raw);
    const after = Date.now();
    expect(result!.entry.spawnedAt).toBeGreaterThanOrEqual(before);
    expect(result!.entry.spawnedAt).toBeLessThanOrEqual(after);
  });
});
