import { describe, it, expect } from 'vitest';

describe('session history hooks', () => {
  it('useStageSessionHistory is exported', async () => {
    const mod = await import('../../src/client/api/hooks.js');
    expect(typeof mod.useStageSessionHistory).toBe('function');
  });

  it('useTicketSessions is exported', async () => {
    const mod = await import('../../src/client/api/hooks.js');
    expect(typeof mod.useTicketSessions).toBe('function');
  });
});
