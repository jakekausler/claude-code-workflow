import { describe, it, expect } from 'vitest';

describe('Board SSE integration', () => {
  it('should import Board without errors', async () => {
    const mod = await import('../../src/client/pages/Board.js');
    expect(mod.Board).toBeDefined();
  });
});
