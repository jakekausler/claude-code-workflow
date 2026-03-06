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

/**
 * Recursively collects all string text from a React element tree.
 * Handles strings, numbers, arrays, and nested elements.
 */
function collectText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const el = node as { props?: { children?: unknown } };
    return collectText(el.props?.children);
  }
  return '';
}

describe('ActiveSessionsList', () => {
  it('exports ActiveSessionsList as a function', () => {
    expect(ActiveSessionsList).toBeDefined();
    expect(typeof ActiveSessionsList).toBe('function');
  });

  it('renders "No active sessions" text for empty map', () => {
    const result = ActiveSessionsList({ sessions: new Map() });
    expect(result).not.toBeNull();

    // The empty state renders a <p> with "No active sessions"
    const text = collectText(result);
    expect(text).toContain('No active sessions');
  });

  it('renders count badge showing 0 for empty map', () => {
    const result = ActiveSessionsList({ sessions: new Map() });
    expect(result).not.toBeNull();

    const text = collectText(result);
    // Badge text is "0" in the empty case
    expect(text).toContain('0');
  });

  it('delegates to ActiveSessionsListContent when sessions exist', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-1', makeEntry());
    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();

    // Non-empty case delegates to the inner component
    expect((result as { type?: { name?: string } })?.type?.name).toBe('ActiveSessionsListContent');
  });

  it('passes sessions map to ActiveSessionsListContent with correct stage IDs', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-alpha', makeEntry({ sessionId: 'sess-aaa' }));
    sessions.set('stage-beta', makeEntry({ sessionId: 'sess-bbb' }));

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();

    // Verify the delegated component receives the sessions prop
    const props = (result as { props?: { sessions?: Map<string, SessionMapEntry> } })?.props;
    expect(props?.sessions).toBe(sessions);
    expect(props?.sessions?.has('stage-alpha')).toBe(true);
    expect(props?.sessions?.has('stage-beta')).toBe(true);
    expect(props?.sessions?.size).toBe(2);
  });

  it('passes correct count via sessions.size for badge rendering', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-a', makeEntry());
    sessions.set('stage-b', makeEntry());
    sessions.set('stage-c', makeEntry());

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();

    // ActiveSessionsListContent receives 3 sessions for badge rendering
    const props = (result as { props?: { sessions?: Map<string, SessionMapEntry> } })?.props;
    expect(props?.sessions?.size).toBe(3);
  });

  it('handles sessions with various waiting types', () => {
    const sessions = new Map<string, SessionMapEntry>();
    sessions.set('stage-input', makeEntry({ waitingType: 'user_input' }));
    sessions.set('stage-perm', makeEntry({ waitingType: 'permission' }));
    sessions.set('stage-idle', makeEntry({ waitingType: 'idle' }));

    const result = ActiveSessionsList({ sessions });
    expect(result).not.toBeNull();

    // All three entries are passed through to the content component
    const props = (result as { props?: { sessions?: Map<string, SessionMapEntry> } })?.props;
    expect(props?.sessions?.get('stage-input')?.waitingType).toBe('user_input');
    expect(props?.sessions?.get('stage-perm')?.waitingType).toBe('permission');
    expect(props?.sessions?.get('stage-idle')?.waitingType).toBe('idle');
  });

  it('renders "Active Sessions" heading in empty state', () => {
    const result = ActiveSessionsList({ sessions: new Map() });
    const text = collectText(result);
    expect(text).toContain('Active Sessions');
  });
});
