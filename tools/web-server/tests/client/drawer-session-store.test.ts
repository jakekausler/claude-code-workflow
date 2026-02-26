import { describe, it, expect, beforeEach } from 'vitest';
import { useDrawerSessionStore } from '../../src/client/store/drawer-session-store.js';

describe('drawer-session-store', () => {
  beforeEach(() => {
    useDrawerSessionStore.getState().reset();
  });

  it('defaults to details tab', () => {
    const state = useDrawerSessionStore.getState();
    expect(state.activeStageSession).toBeNull();
    expect(state.activeTicketSession).toBeNull();
    expect(state.stageActiveTab).toBe('details');
    expect(state.ticketActiveTab).toBe('details');
  });

  it('setStageSession updates active stage session', () => {
    useDrawerSessionStore.getState().setStageSession('proj-1', 'sess-1');
    const state = useDrawerSessionStore.getState();
    expect(state.activeStageSession).toEqual({ projectId: 'proj-1', sessionId: 'sess-1' });
  });

  it('setTicketSession updates active ticket session', () => {
    useDrawerSessionStore.getState().setTicketSession('proj-1', 'sess-t1');
    const state = useDrawerSessionStore.getState();
    expect(state.activeTicketSession).toEqual({ projectId: 'proj-1', sessionId: 'sess-t1' });
  });

  it('setStageActiveTab updates tab', () => {
    useDrawerSessionStore.getState().setStageActiveTab('session');
    expect(useDrawerSessionStore.getState().stageActiveTab).toBe('session');
  });

  it('setTicketActiveTab updates tab', () => {
    useDrawerSessionStore.getState().setTicketActiveTab('session');
    expect(useDrawerSessionStore.getState().ticketActiveTab).toBe('session');
  });

  it('reset clears all state', () => {
    const store = useDrawerSessionStore.getState();
    store.setStageSession('p', 's');
    store.setTicketSession('p', 't');
    store.setStageActiveTab('session');
    store.setTicketActiveTab('session');

    store.reset();

    const after = useDrawerSessionStore.getState();
    expect(after.activeStageSession).toBeNull();
    expect(after.activeTicketSession).toBeNull();
    expect(after.stageActiveTab).toBe('details');
    expect(after.ticketActiveTab).toBe('details');
  });
});
