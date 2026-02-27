import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionMapEntry } from '../../../src/client/store/board-store.js';
import {
  formatDuration,
  LiveSessionSection,
} from '../../../src/client/components/stage/LiveSessionSection.js';

// ---------------------------------------------------------------------------
// formatDuration — pure function tests
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('returns "0s" for zero milliseconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns seconds only when under a minute', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('returns minutes and seconds when under an hour', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('returns hours and minutes when >= 1 hour', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m');
  });

  it('treats negative values as 0s', () => {
    expect(formatDuration(-5000)).toBe('0s');
  });
});

// ---------------------------------------------------------------------------
// LiveSessionSection — component tests
// ---------------------------------------------------------------------------

describe('LiveSessionSection', () => {
  it('exports LiveSessionSection component', () => {
    expect(LiveSessionSection).toBeDefined();
    expect(typeof LiveSessionSection).toBe('function');
  });

  it('returns null when sessionStatus is null', () => {
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: null });
    expect(result).toBeNull();
  });

  it('returns null when session status is ended', () => {
    const ended: SessionMapEntry = {
      status: 'ended',
      waitingType: null,
      sessionId: 'abc123456789xyz',
      spawnedAt: Date.now() - 60_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: ended });
    expect(result).toBeNull();
  });

  it('renders a non-null element when session is active', () => {
    const active: SessionMapEntry = {
      status: 'active',
      waitingType: null,
      sessionId: 'abc123456789xyz',
      spawnedAt: Date.now() - 30_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: active });
    expect(result).not.toBeNull();
  });
});
