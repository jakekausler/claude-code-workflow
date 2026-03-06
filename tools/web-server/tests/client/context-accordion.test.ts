import { describe, it, expect } from 'vitest';

describe('ContextAccordion', () => {
  it('exports ContextAccordion component', async () => {
    const mod = await import('../../src/client/components/chat/context/ContextAccordion.js');
    expect(typeof mod.ContextAccordion).toBe('function');
  });
});
