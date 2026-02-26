import { describe, it, expect } from 'vitest';

describe('DrawerTabs', () => {
  it('exports DrawerTabs component', async () => {
    const mod = await import('../../src/client/components/detail/DrawerTabs.js');
    expect(typeof mod.DrawerTabs).toBe('function');
  });

});
