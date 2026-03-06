import { describe, it, expect } from 'vitest';

describe('Dashboard SSE integration', () => {
  it('should import Dashboard without errors', async () => {
    const mod = await import('../../src/client/pages/Dashboard.js');
    expect(mod.Dashboard).toBeDefined();
  });
});
