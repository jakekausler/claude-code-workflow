import { describe, it, expect } from 'vitest';
import type { MessageInputProps } from '../../src/client/components/chat/MessageInput.js';

describe('MessageInput', () => {
  it('exports MessageInputProps type', () => {
    const props: MessageInputProps = {
      stageId: 'STAGE-001',
      disabled: false,
      queuedMessage: undefined,
    };
    expect(props.stageId).toBe('STAGE-001');
  });
});
