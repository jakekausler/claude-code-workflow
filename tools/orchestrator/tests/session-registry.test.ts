import { describe, it, expect, vi } from 'vitest';
import { SessionRegistry, type SessionEntry } from '../src/session-registry.js';

function makeEntry(overrides: Partial<Omit<SessionEntry, 'status' | 'lastActivity'>> = {}) {
  return {
    stageId: overrides.stageId ?? 'stage-1',
    sessionId: overrides.sessionId ?? '',
    processId: overrides.processId ?? 1234,
    worktreePath: overrides.worktreePath ?? '/tmp/wt-1',
    spawnedAt: overrides.spawnedAt ?? 1000,
  };
}

describe('SessionRegistry', () => {
  it('register() adds entry with "starting" status and emits "session-registered"', () => {
    const registry = new SessionRegistry();
    const handler = vi.fn();
    registry.on('session-registered', handler);

    const result = registry.register(makeEntry());

    expect(result.status).toBe('starting');
    expect(result.lastActivity).toBe(1000); // matches spawnedAt
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(result);
  });

  it('activate() transitions to "active", updates sessionId, emits "session-status"', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 'stage-a', sessionId: '' }));

    const handler = vi.fn();
    registry.on('session-status', handler);

    registry.activate('stage-a', 'sess-xyz');

    const entry = registry.get('stage-a')!;
    expect(entry.status).toBe('active');
    expect(entry.sessionId).toBe('sess-xyz');
    expect(entry.lastActivity).toBeGreaterThan(0);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(entry);
  });

  it('end() transitions to "ended", emits "session-ended", removes from map', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 'stage-b' }));

    const handler = vi.fn();
    registry.on('session-ended', handler);

    registry.end('stage-b');

    expect(handler).toHaveBeenCalledOnce();
    const emitted = handler.mock.calls[0][0] as SessionEntry;
    expect(emitted.status).toBe('ended');
    expect(emitted.stageId).toBe('stage-b');
    // Entry removed from map after end
    expect(registry.get('stage-b')).toBeUndefined();
    expect(registry.size()).toBe(0);
  });

  it('get() returns entry by stageId', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 'lookup-me' }));

    const entry = registry.get('lookup-me');
    expect(entry).toBeDefined();
    expect(entry!.stageId).toBe('lookup-me');
  });

  it('get() returns undefined for unknown stageId', () => {
    const registry = new SessionRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getBySessionId() finds correct entry', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 'stage-x', sessionId: '' }));
    registry.register(makeEntry({ stageId: 'stage-y', sessionId: '' }));
    registry.activate('stage-x', 'sess-111');
    registry.activate('stage-y', 'sess-222');

    const found = registry.getBySessionId('sess-222');
    expect(found).toBeDefined();
    expect(found!.stageId).toBe('stage-y');
  });

  it('getBySessionId() returns undefined for unknown sessionId', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 'stage-z' }));

    expect(registry.getBySessionId('no-such-session')).toBeUndefined();
  });

  it('getAll() returns all active entries', () => {
    const registry = new SessionRegistry();
    registry.register(makeEntry({ stageId: 's1' }));
    registry.register(makeEntry({ stageId: 's2' }));
    registry.register(makeEntry({ stageId: 's3' }));

    const all = registry.getAll();
    expect(all).toHaveLength(3);

    const ids = all.map((e) => e.stageId).sort();
    expect(ids).toEqual(['s1', 's2', 's3']);
  });

  it('size() returns correct count', () => {
    const registry = new SessionRegistry();
    expect(registry.size()).toBe(0);

    registry.register(makeEntry({ stageId: 'a' }));
    expect(registry.size()).toBe(1);

    registry.register(makeEntry({ stageId: 'b' }));
    expect(registry.size()).toBe(2);

    registry.end('a');
    expect(registry.size()).toBe(1);
  });

  it('end() on unknown stageId is a no-op (no event, no error)', () => {
    const registry = new SessionRegistry();
    const handler = vi.fn();
    registry.on('session-ended', handler);

    // Should not throw
    registry.end('ghost-stage');

    expect(handler).not.toHaveBeenCalled();
  });

  it('activate() on unknown stageId is a no-op', () => {
    const registry = new SessionRegistry();
    const handler = vi.fn();
    registry.on('session-status', handler);

    // Should not throw
    registry.activate('ghost-stage', 'sess-nope');

    expect(handler).not.toHaveBeenCalled();
  });

  it('register() overwrites existing entry for same stageId', () => {
    const registry = new SessionRegistry();
    const handler = vi.fn();
    registry.on('session-registered', handler);

    registry.register(makeEntry({ stageId: 'dup', processId: 100 }));
    registry.register(makeEntry({ stageId: 'dup', processId: 200 }));

    expect(registry.size()).toBe(1);
    const entry = registry.get('dup')!;
    expect(entry.processId).toBe(200);
    expect(entry.status).toBe('starting');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
