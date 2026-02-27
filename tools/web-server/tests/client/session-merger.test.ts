import { describe, it, expect } from 'vitest';
import type { SSESessionUpdate } from '../../src/client/utils/session-merger.js';

describe('SSESessionUpdate', () => {
  it('has the correct shape', () => {
    const event: SSESessionUpdate = {
      projectId: 'test',
      sessionId: 'test',
      type: 'session-change',
    };
    expect(event.type).toBe('session-change');
  });
});
