import { describe, it, expect } from 'vitest';

describe('InteractionOverlay', () => {
  it('module exports InteractionOverlay component', async () => {
    const mod = await import('../../src/client/components/interaction/InteractionOverlay.js');
    expect(mod.InteractionOverlay).toBeDefined();
    expect(typeof mod.InteractionOverlay).toBe('function');
  });
});
