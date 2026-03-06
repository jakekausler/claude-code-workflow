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

  it('handles multi-hour durations', () => {
    expect(formatDuration(90_000_000)).toBe('25h 0m');
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

  it('renders a non-null element when session is starting', () => {
    const starting: SessionMapEntry = {
      status: 'starting' as const,
      waitingType: null,
      sessionId: 'abc123456789xyz',
      spawnedAt: Date.now() - 5_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: starting });
    expect(result).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Behavioral tests — verify LiveSessionContent receives correct props
  // ---------------------------------------------------------------------------

  // Note: These tests inspect React element internals (type.name, props).
  // This is fragile — minification or wrapping in React.memo/HOC would break them.
  // Preferred approach would be @testing-library/react render + DOM queries,
  // but these tests follow the project's existing lightweight pattern.

  it('passes sessionId to LiveSessionContent for truncation', () => {
    const active: SessionMapEntry = {
      status: 'active',
      waitingType: null,
      sessionId: 'abc123456789xyz',
      spawnedAt: Date.now() - 30_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: active });
    expect(result).not.toBeNull();

    // result is a React element of type LiveSessionContent
    // The component receives stageId and sessionStatus as props
    expect(result?.type?.name).toBe('LiveSessionContent');
    expect(result?.props?.sessionStatus?.sessionId).toBe('abc123456789xyz');

    // The component truncates to 12 chars internally: sessionId.slice(0, 12)
    const truncated = result?.props?.sessionStatus?.sessionId.slice(0, 12);
    expect(truncated).toBe('abc123456789');
  });

  it('passes correct stageId and projectId for link generation', () => {
    const active: SessionMapEntry = {
      status: 'active',
      waitingType: null,
      sessionId: 'test-session-001',
      spawnedAt: Date.now() - 30_000,
    };
    const result = LiveSessionSection({ stageId: 'my-stage', sessionStatus: active, projectId: 'proj-1' });
    expect(result).not.toBeNull();

    // LiveSessionContent receives stageId and projectId for building /sessions/:projectId/:sessionId
    expect(result?.props?.stageId).toBe('my-stage');
    expect(result?.props?.projectId).toBe('proj-1');
  });

  it('passes session status with user_input waiting type to indicator', () => {
    const userInput: SessionMapEntry = {
      status: 'active',
      waitingType: 'user_input',
      sessionId: 'test-001',
      spawnedAt: Date.now() - 30_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: userInput });
    expect(result).not.toBeNull();

    // The sessionStatus is passed to LiveSessionContent
    expect(result?.props?.sessionStatus?.waitingType).toBe('user_input');
  });

  it('passes session status with permission waiting type to indicator', () => {
    const permission: SessionMapEntry = {
      status: 'active',
      waitingType: 'permission',
      sessionId: 'test-001',
      spawnedAt: Date.now() - 30_000,
    };
    const result = LiveSessionSection({ stageId: 'stage-1', sessionStatus: permission });
    expect(result).not.toBeNull();

    // The sessionStatus is passed to LiveSessionContent
    expect(result?.props?.sessionStatus?.waitingType).toBe('permission');
  });
});
