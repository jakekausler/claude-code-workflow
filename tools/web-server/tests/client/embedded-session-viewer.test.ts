import { describe, it, expect } from 'vitest';

describe('EmbeddedSessionViewer', () => {
  it('exports EmbeddedSessionViewer component', async () => {
    const mod = await import('../../src/client/components/chat/EmbeddedSessionViewer.js');
    expect(typeof mod.EmbeddedSessionViewer).toBe('function');
  });
});
