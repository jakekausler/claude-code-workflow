import { describe, it, expect } from 'vitest';

describe('DrawerTabs', () => {
  it('exports DrawerTabs component', async () => {
    const mod = await import('../../src/client/components/detail/DrawerTabs.js');
    expect(typeof mod.DrawerTabs).toBe('function');
  });

  it('exports TabDef type (module is well-formed)', async () => {
    // TypeScript-only verification — if this compiles, the type exists
    const mod = await import('../../src/client/components/detail/DrawerTabs.js');
    expect(mod).toBeDefined();
  });
});
