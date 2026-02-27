import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardStore, selectSessionStatus } from '../../../src/client/store/board-store.js';
import type { SessionMapEntry } from '../../../src/client/store/board-store.js';
import { BoardCard } from '../../../src/client/components/board/BoardCard.js';
import { getIndicatorConfig } from '../../../src/client/components/board/SessionStatusIndicator.js';

function makeEntry(overrides: Partial<SessionMapEntry> = {}): SessionMapEntry {
  return {
    status: 'active',
    waitingType: null,
    sessionId: 'sess-001',
    spawnedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BoardCard — sessionStatus prop
// ---------------------------------------------------------------------------

describe('BoardCard sessionStatus prop', () => {
  it('accepts sessionStatus prop without error', () => {
    // Calling the component function with sessionStatus should not throw
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: null },
    });
    expect(result).not.toBeNull();
  });

  it('renders without sessionStatus (backward compatible)', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
    });
    expect(result).not.toBeNull();
  });

  it('accepts null sessionStatus', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: null,
    });
    expect(result).not.toBeNull();
  });

  it('accepts sessionStatus with user_input waiting type', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: 'user_input' },
    });
    expect(result).not.toBeNull();
  });

  it('accepts sessionStatus with permission waiting type', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: 'permission' },
    });
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Highlight ring logic — when waitingType demands attention
// ---------------------------------------------------------------------------

describe('BoardCard highlight ring', () => {
  it('applies highlight ring class when waitingType is user_input', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: 'user_input' },
    });
    // The root div props should contain the highlight ring classes
    const className: string = result?.props?.className ?? '';
    expect(className).toContain('ring-yellow-300');
  });

  it('applies highlight ring class when waitingType is permission', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: 'permission' },
    });
    const className: string = result?.props?.className ?? '';
    expect(className).toContain('ring-yellow-300');
  });

  it('does not apply highlight ring when waitingType is idle', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: { status: 'active', waitingType: 'idle' },
    });
    const className: string = result?.props?.className ?? '';
    expect(className).not.toContain('ring-yellow-300');
  });

  it('does not apply highlight ring when sessionStatus is null', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
      sessionStatus: null,
    });
    const className: string = result?.props?.className ?? '';
    expect(className).not.toContain('ring-yellow-300');
  });

  it('does not apply highlight ring when no sessionStatus prop', () => {
    const result = BoardCard({
      id: 'STAGE-001',
      title: 'Test Stage',
      onClick: () => {},
    });
    const className: string = result?.props?.className ?? '';
    expect(className).not.toContain('ring-yellow-300');
  });
});

// ---------------------------------------------------------------------------
// SessionStatusIndicator compact mode in BoardCard context
// ---------------------------------------------------------------------------

describe('SessionStatusIndicator compact rendering', () => {
  it('getIndicatorConfig returns correct config for active session', () => {
    const config = getIndicatorConfig('active', null);
    expect(config.dotClass).toContain('bg-green-500');
  });

  it('getIndicatorConfig returns correct config for user_input', () => {
    const config = getIndicatorConfig('active', 'user_input');
    expect(config.dotClass).toBe('bg-yellow-500');
    expect(config.label).toBe('Needs input');
  });
});

// ---------------------------------------------------------------------------
// Board page reads session status from Zustand store via selectSessionStatus
// ---------------------------------------------------------------------------

describe('Board page session status from store', () => {
  beforeEach(() => {
    useBoardStore.setState({
      sessionMap: new Map(),
    });
  });

  it('selectSessionStatus returns null when no session exists', () => {
    const selector = selectSessionStatus('STAGE-001');
    const result = selector(useBoardStore.getState());
    expect(result).toBeNull();
  });

  it('selectSessionStatus returns entry when session exists', () => {
    const entry = makeEntry({ status: 'active', waitingType: 'permission' });
    useBoardStore.getState().updateSessionStatus('STAGE-001', entry);

    const selector = selectSessionStatus('STAGE-001');
    const result = selector(useBoardStore.getState());
    expect(result).toEqual(entry);
  });

  it('selectSessionStatus returns null after session ends', () => {
    const entry = makeEntry();
    useBoardStore.getState().updateSessionStatus('STAGE-001', entry);

    const ended = makeEntry({ status: 'ended' });
    useBoardStore.getState().updateSessionStatus('STAGE-001', ended);

    const selector = selectSessionStatus('STAGE-001');
    const result = selector(useBoardStore.getState());
    expect(result).toBeNull();
  });

  it('selectSessionStatus isolates by stageId', () => {
    useBoardStore.getState().updateSessionStatus('STAGE-A', makeEntry({ waitingType: 'user_input' }));
    useBoardStore.getState().updateSessionStatus('STAGE-B', makeEntry({ waitingType: 'permission' }));

    const selectorA = selectSessionStatus('STAGE-A');
    const selectorB = selectSessionStatus('STAGE-B');

    expect(selectorA(useBoardStore.getState())?.waitingType).toBe('user_input');
    expect(selectorB(useBoardStore.getState())?.waitingType).toBe('permission');
  });
});
