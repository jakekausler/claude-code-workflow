import { describe, it, expect } from 'vitest';
import {
  getIndicatorConfig,
  SessionStatusIndicator,
} from '../../src/client/components/board/SessionStatusIndicator.js';
import type { SessionStatusProps } from '../../src/client/components/board/SessionStatusIndicator.js';

describe('SessionStatusIndicator', () => {
  it('exports SessionStatusIndicator component', () => {
    expect(SessionStatusIndicator).toBeDefined();
    expect(typeof SessionStatusIndicator).toBe('function');
  });

  it('returns null when status is null', () => {
    const result = SessionStatusIndicator({ status: null });
    expect(result).toBeNull();
  });

  it('returns null for ended status', () => {
    const result = SessionStatusIndicator({
      status: { status: 'ended', waitingType: null },
    });
    expect(result).toBeNull();
  });
});

describe('getIndicatorConfig', () => {
  it('returns green pulsing dot for active status with no waiting', () => {
    const config = getIndicatorConfig('active', null);
    expect(config.dotClass).toContain('bg-green-500');
    expect(config.dotClass).toContain('animate-pulse');
    expect(config.label).toBeNull();
  });

  it('returns yellow dot with "Needs input" for user_input waiting', () => {
    const config = getIndicatorConfig('active', 'user_input');
    expect(config.dotClass).toBe('bg-yellow-500');
    expect(config.label).toBe('Needs input');
  });

  it('returns blue dot with "Needs approval" for permission waiting', () => {
    const config = getIndicatorConfig('active', 'permission');
    expect(config.dotClass).toBe('bg-blue-500');
    expect(config.label).toBe('Needs approval');
  });

  it('returns gray dot for idle waiting', () => {
    const config = getIndicatorConfig('active', 'idle');
    expect(config.dotClass).toBe('bg-gray-400');
    expect(config.label).toBeNull();
  });

  it('returns green dot without pulse for starting status', () => {
    const config = getIndicatorConfig('starting', null);
    expect(config.dotClass).toBe('bg-green-500');
    expect(config.dotClass).not.toContain('animate-pulse');
    expect(config.label).toBeNull();
  });

  it('prioritizes waitingType over session status for starting', () => {
    const config = getIndicatorConfig('starting', 'user_input');
    expect(config.dotClass).toBe('bg-yellow-500');
    expect(config.label).toBe('Needs input');
  });
});

describe('SessionStatusProps type', () => {
  it('accepts compact prop', () => {
    const props: SessionStatusProps = {
      status: { status: 'active', waitingType: null },
      compact: true,
    };
    expect(props.compact).toBe(true);
  });

  it('compact defaults to false when not provided', () => {
    const props: SessionStatusProps = {
      status: { status: 'active', waitingType: 'user_input' },
    };
    expect(props.compact).toBeUndefined();
  });
});
