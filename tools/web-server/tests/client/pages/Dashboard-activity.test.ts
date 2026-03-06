import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatStageTransitionEvent,
  formatSessionStatusEvent,
  formatSessionEvent,
} from '../../../src/client/utils/activity-formatters.js';

describe('activity-formatters', () => {
  // Freeze Date.now() so fallback timestamps are deterministic
  const NOW = 1700000000000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // formatStageTransitionEvent
  // -----------------------------------------------------------------------
  describe('formatStageTransitionEvent', () => {
    it('formats session_started events', () => {
      const result = formatStageTransitionEvent({
        stageId: 'STAGE-001',
        type: 'session_started',
        timestamp: 1700000001000,
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Session started for STAGE-001');
      expect(result!.timestamp).toBe(1700000001000);
    });

    it('formats session_ended events', () => {
      const result = formatStageTransitionEvent({
        stageId: 'STAGE-002',
        type: 'session_ended',
        timestamp: 1700000002000,
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Session completed for STAGE-002');
      expect(result!.timestamp).toBe(1700000002000);
    });

    it('falls back to Date.now() when timestamp is missing', () => {
      const result = formatStageTransitionEvent({
        stageId: 'STAGE-003',
        type: 'session_started',
      });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBe(NOW);
    });

    it('returns null for unknown type', () => {
      const result = formatStageTransitionEvent({
        stageId: 'STAGE-004',
        type: 'unknown_event',
      });
      expect(result).toBeNull();
    });

    it('returns null for null input', () => {
      expect(formatStageTransitionEvent(null)).toBeNull();
    });

    it('returns null for missing stageId', () => {
      expect(formatStageTransitionEvent({ type: 'session_started' })).toBeNull();
    });

    it('returns null for missing type', () => {
      expect(formatStageTransitionEvent({ stageId: 'STAGE-005' })).toBeNull();
    });

    it('produces a unique id per event', () => {
      const a = formatStageTransitionEvent({
        stageId: 'STAGE-006',
        type: 'session_started',
        timestamp: 1000,
      });
      const b = formatStageTransitionEvent({
        stageId: 'STAGE-006',
        type: 'session_ended',
        timestamp: 2000,
      });
      expect(a!.id).not.toBe(b!.id);
    });
  });

  // -----------------------------------------------------------------------
  // formatSessionStatusEvent
  // -----------------------------------------------------------------------
  describe('formatSessionStatusEvent', () => {
    it('formats user_input waiting type', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-010',
        waitingType: 'user_input',
        spawnedAt: 1700000010000,
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Waiting for user input on STAGE-010');
      expect(result!.timestamp).toBe(1700000010000);
    });

    it('formats permission waiting type', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-011',
        waitingType: 'permission',
        spawnedAt: 1700000011000,
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Waiting for approval on STAGE-011');
      expect(result!.timestamp).toBe(1700000011000);
    });

    it('returns null for idle waitingType', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-012',
        waitingType: 'idle',
      });
      expect(result).toBeNull();
    });

    it('returns null for null waitingType', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-013',
        waitingType: null,
      });
      expect(result).toBeNull();
    });

    it('returns null for missing waitingType', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-014',
        status: 'active',
      });
      expect(result).toBeNull();
    });

    it('returns null for null input', () => {
      expect(formatSessionStatusEvent(null)).toBeNull();
    });

    it('returns null for missing stageId', () => {
      expect(formatSessionStatusEvent({ waitingType: 'user_input' })).toBeNull();
    });

    it('falls back to Date.now() when spawnedAt is missing', () => {
      const result = formatSessionStatusEvent({
        stageId: 'STAGE-015',
        waitingType: 'permission',
      });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBe(NOW);
    });
  });

  // -----------------------------------------------------------------------
  // formatSessionEvent (unified dispatcher)
  // -----------------------------------------------------------------------
  describe('formatSessionEvent', () => {
    it('dispatches stage-transition events', () => {
      const result = formatSessionEvent('stage-transition', {
        stageId: 'STAGE-020',
        type: 'session_started',
        timestamp: 100,
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Session started for STAGE-020');
    });

    it('dispatches session-status events', () => {
      const result = formatSessionEvent('session-status', {
        stageId: 'STAGE-021',
        waitingType: 'user_input',
      });
      expect(result).not.toBeNull();
      expect(result!.message).toBe('Waiting for user input on STAGE-021');
    });

    it('returns null for unknown channel', () => {
      const result = formatSessionEvent('board-update', {
        stageId: 'STAGE-022',
        type: 'session_started',
      });
      expect(result).toBeNull();
    });
  });
});
