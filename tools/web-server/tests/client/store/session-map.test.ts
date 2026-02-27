import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardStore, SessionMapEntry } from '../../../src/client/store/board-store.js';

function makeEntry(overrides: Partial<SessionMapEntry> = {}): SessionMapEntry {
  return {
    status: 'active',
    waitingType: null,
    sessionId: 'sess-001',
    spawnedAt: Date.now(),
    ...overrides,
  };
}

describe('session-map store', () => {
  beforeEach(() => {
    useBoardStore.setState({
      sessionMap: new Map(),
      orchestratorConnected: false,
    });
  });

  it('starts with empty session map', () => {
    const state = useBoardStore.getState();
    expect(state.sessionMap.size).toBe(0);
  });

  it('updates session status for a stage', () => {
    const entry = makeEntry();
    useBoardStore.getState().updateSessionStatus('STAGE-A', entry);

    const map = useBoardStore.getState().sessionMap;
    expect(map.size).toBe(1);
    expect(map.get('STAGE-A')).toEqual(entry);
  });

  it('updates waitingType when approval arrives', () => {
    const entry = makeEntry({ waitingType: null });
    useBoardStore.getState().updateSessionStatus('STAGE-A', entry);

    const updated = makeEntry({ waitingType: 'permission' });
    useBoardStore.getState().updateSessionStatus('STAGE-A', updated);

    const result = useBoardStore.getState().sessionMap.get('STAGE-A');
    expect(result?.waitingType).toBe('permission');
  });

  it('removes session on ended status', () => {
    const entry = makeEntry();
    useBoardStore.getState().updateSessionStatus('STAGE-A', entry);
    expect(useBoardStore.getState().sessionMap.size).toBe(1);

    const ended = makeEntry({ status: 'ended' });
    useBoardStore.getState().updateSessionStatus('STAGE-A', ended);
    expect(useBoardStore.getState().sessionMap.size).toBe(0);
    expect(useBoardStore.getState().sessionMap.has('STAGE-A')).toBe(false);
  });

  it('sets full session map from REST response', () => {
    const map = new Map<string, SessionMapEntry>();
    map.set('STAGE-A', makeEntry({ sessionId: 'sess-a' }));
    map.set('STAGE-B', makeEntry({ sessionId: 'sess-b', status: 'starting' }));

    useBoardStore.getState().setSessionMap(map);

    const result = useBoardStore.getState().sessionMap;
    expect(result.size).toBe(2);
    expect(result.get('STAGE-A')?.sessionId).toBe('sess-a');
    expect(result.get('STAGE-B')?.status).toBe('starting');
  });

  it('getSessionStatus returns null for unknown stage', () => {
    const result = useBoardStore.getState().getSessionStatus('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('getSessionStatus returns entry for known stage', () => {
    const entry = makeEntry({ sessionId: 'sess-xyz' });
    useBoardStore.getState().updateSessionStatus('STAGE-A', entry);

    const result = useBoardStore.getState().getSessionStatus('STAGE-A');
    expect(result).toEqual(entry);
  });

  it('clearSessionMap resets to empty', () => {
    useBoardStore.getState().updateSessionStatus('STAGE-A', makeEntry());
    useBoardStore.getState().updateSessionStatus('STAGE-B', makeEntry());
    expect(useBoardStore.getState().sessionMap.size).toBe(2);

    useBoardStore.getState().clearSessionMap();
    expect(useBoardStore.getState().sessionMap.size).toBe(0);
  });

  it('orchestratorConnected tracks connection state', () => {
    expect(useBoardStore.getState().orchestratorConnected).toBe(false);

    useBoardStore.getState().setOrchestratorConnected(true);
    expect(useBoardStore.getState().orchestratorConnected).toBe(true);

    useBoardStore.getState().setOrchestratorConnected(false);
    expect(useBoardStore.getState().orchestratorConnected).toBe(false);
  });

  it('setSessionMap creates a copy (does not share reference)', () => {
    const map = new Map<string, SessionMapEntry>();
    map.set('STAGE-A', makeEntry());

    useBoardStore.getState().setSessionMap(map);

    // Mutating the original should not affect the store
    map.set('STAGE-B', makeEntry());
    expect(useBoardStore.getState().sessionMap.size).toBe(1);
  });

  it('updateSessionStatus does not affect other entries', () => {
    useBoardStore.getState().updateSessionStatus('STAGE-A', makeEntry({ sessionId: 'a' }));
    useBoardStore.getState().updateSessionStatus('STAGE-B', makeEntry({ sessionId: 'b' }));

    const ended = makeEntry({ status: 'ended' });
    useBoardStore.getState().updateSessionStatus('STAGE-A', ended);

    const map = useBoardStore.getState().sessionMap;
    expect(map.size).toBe(1);
    expect(map.has('STAGE-A')).toBe(false);
    expect(map.get('STAGE-B')?.sessionId).toBe('b');
  });
});
