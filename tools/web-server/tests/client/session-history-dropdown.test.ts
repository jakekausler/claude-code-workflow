import { describe, it, expect } from 'vitest';

describe('SessionHistoryDropdown', () => {
  it('exports SessionHistoryDropdown component', async () => {
    const mod = await import('../../src/client/components/chat/SessionHistoryDropdown.js');
    expect(typeof mod.SessionHistoryDropdown).toBe('function');
  });
});
