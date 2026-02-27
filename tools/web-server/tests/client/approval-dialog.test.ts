import { describe, it, expect } from 'vitest';
import type { ApprovalDialogProps } from '../../src/client/components/interaction/ApprovalDialog.js';

describe('ApprovalDialog', () => {
  it('exports ApprovalDialogProps type', () => {
    const props: ApprovalDialogProps = {
      stageId: 'STAGE-001',
      requestId: 'req-001',
      toolName: 'Bash',
      input: { command: 'npm test' },
      onClose: () => {},
    };
    expect(props.toolName).toBe('Bash');
  });
});
