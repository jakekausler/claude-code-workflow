import { describe, it, expect } from 'vitest';

describe('SessionDetail SSE integration', () => {
  it('should import SessionDetail without errors', async () => {
    const mod = await import('../../src/client/pages/SessionDetail.js');
    expect(mod).toBeDefined();
  });
});
