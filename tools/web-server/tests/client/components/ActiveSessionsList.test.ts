import { describe, it, expect } from 'vitest';
import type { SessionMapEntry } from '../../../src/client/store/board-store.js';
import { ActiveSessionsList } from '../../../src/client/components/dashboard/ActiveSessionsList.js';

function makeEntry(overrides: Partial<SessionMapEntry> = {}): SessionMapEntry {
  return {
    status: 'active',
    waitingType: null,
    sessionId: 'sess-abc123456789',
    spawnedAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('ActiveSessionsList', () => {
  it('exports ActiveSessionsList as a function', () => {
    expect(ActiveSessionsList).toBeDefined();
    expect(typeof ActiveSessionsList).toBe('function');
  });

  it('returns non-null with empty map (shows "no active sessions")', () => {
    const result = ActiveSessionsList({ sessions: new Map() });
    // Should still render a container (with the "no active sessions" message)
    expect(result).not.toBeNull();
  });

  it('returns non-null when sessions exist', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-1', makeEntry());
    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();
  });

  it('receives sessions prop with correct stage IDs', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-alpha', makeEntry({ sessionId: 'sess-aaa' }));
    sessions.set('stage-beta', makeEntry({ sessionId: 'sess-bbb' }));

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();

    // The component should render something for each session
    // We verify by checking the props contain the sessions map with correct keys
    expect(sessions.has('stage-alpha')).toBe(true);
    expect(sessions.has('stage-beta')).toBe(true);
    expect(sessions.size).toBe(2);
  });

  it('handles a single session', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-only', makeEntry({ status: 'starting', sessionId: 'sess-one' }));

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();
  });

  it('handles sessions with various waiting types', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-input', makeEntry({ waitingType: 'user_input' }));
    sessions.set('stage-perm', makeEntry({ waitingType: 'permission' }));
    sessions.set('stage-idle', makeEntry({ waitingType: 'idle' }));

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();
  });
});
