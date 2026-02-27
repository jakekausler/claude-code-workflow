import { describe, it, expect, vi } from 'vitest';
import { ApprovalService } from '../src/approval-service.js';
import type { CanUseToolRequest, HookCallbackRequest } from '../src/protocol-types.js';

describe('ApprovalService', () => {
  // ── handleControlRequest — tool approval ────────────────────────────

  it('handleControlRequest emits "approval-requested" for can_use_tool', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const handler = vi.fn();
    service.on('approval-requested', handler);

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/etc/passwd' },
    };

    await service.handleControlRequest('req-123', request);

    expect(handler).toHaveBeenCalledOnce();
    const emitted = handler.mock.calls[0][0];
    expect(emitted).toEqual({
      type: 'approval',
      stageId: 'stage-1',
      requestId: 'req-123',
      toolName: 'read_file',
      input: { path: '/etc/passwd' },
      createdAt: expect.any(Number),
    });
  });

  it('handleControlRequest stores approval in pending', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/etc/passwd' },
    };

    await service.handleControlRequest('req-123', request);

    const pending = service.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe('req-123');
  });

  // ── handleControlRequest — AskUserQuestion ──────────────────────────

  it('handleControlRequest emits "question-requested" when tool_name is "AskUserQuestion"', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-2');

    const handler = vi.fn();
    service.on('question-requested', handler);

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [{ id: 'q1', question: 'What is your name?' }] },
    };

    await service.handleControlRequest('req-456', request);

    expect(handler).toHaveBeenCalledOnce();
    const emitted = handler.mock.calls[0][0];
    expect(emitted).toEqual({
      type: 'question',
      stageId: 'stage-2',
      requestId: 'req-456',
      questions: [{ id: 'q1', question: 'What is your name?' }],
      input: { questions: [{ id: 'q1', question: 'What is your name?' }] },
      createdAt: expect.any(Number),
    });
  });

  it('handleControlRequest stores question in pending', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-2');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [{ id: 'q1', question: 'What is your name?' }] },
    };

    await service.handleControlRequest('req-456', request);

    const pending = service.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe('req-456');
  });

  // ── handleControlRequest — ignores non-can_use_tool subtypes ────────

  it('handleControlRequest ignores hook_callback subtype', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const approvalHandler = vi.fn();
    const questionHandler = vi.fn();
    service.on('approval-requested', approvalHandler);
    service.on('question-requested', questionHandler);

    const request: HookCallbackRequest['request'] = {
      subtype: 'hook_callback',
      callback_id: 'hook-123',
      input: { some: 'data' },
    };

    await service.handleControlRequest('req-789', request);

    expect(approvalHandler).not.toHaveBeenCalled();
    expect(questionHandler).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(0);
  });

  // ── resolveApproval ─────────────────────────────────────────────────

  it('resolveApproval with "allow" decision returns allow PermissionResult', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/test' },
    };

    await service.handleControlRequest('req-allow', request);

    const result = service.resolveApproval('req-allow', 'allow');

    expect(result).toEqual({ behavior: 'allow' });
  });

  it('resolveApproval with "deny" decision returns deny PermissionResult', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/etc/passwd' },
    };

    await service.handleControlRequest('req-deny', request);

    const result = service.resolveApproval('req-deny', 'deny', 'Access to /etc/passwd denied');

    expect(result).toEqual({
      behavior: 'deny',
      message: 'Access to /etc/passwd denied',
    });
  });

  it('resolveApproval removes entry from pending after resolution', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/test' },
    };

    await service.handleControlRequest('req-clean', request);
    expect(service.getPending()).toHaveLength(1);

    service.resolveApproval('req-clean', 'allow');
    expect(service.getPending()).toHaveLength(0);
  });

  it('resolveApproval throws for unknown requestId', () => {
    const service = new ApprovalService();

    expect(() => {
      service.resolveApproval('unknown-req', 'allow');
    }).toThrow('Unknown approval request');
  });

  // ── resolveQuestion ─────────────────────────────────────────────────

  it('resolveQuestion returns allow with updatedInput', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: {
        questions: [{ id: 'q1', question: 'What is your name?' }],
        other: 'data',
      },
    };

    await service.handleControlRequest('req-q1', request);

    const result = service.resolveQuestion('req-q1', { q1: 'Alice' });

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [{ id: 'q1', question: 'What is your name?' }],
        other: 'data',
        answers: { q1: 'Alice' },
      },
    });
  });

  it('resolveQuestion removes entry from pending after resolution', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [{ id: 'q1', question: 'Name?' }] },
    };

    await service.handleControlRequest('req-q2', request);
    expect(service.getPending()).toHaveLength(1);

    service.resolveQuestion('req-q2', { q1: 'Bob' });
    expect(service.getPending()).toHaveLength(0);
  });

  it('resolveQuestion throws for unknown requestId', () => {
    const service = new ApprovalService();

    expect(() => {
      service.resolveQuestion('unknown-question', { answer: 'yes' });
    }).toThrow('Unknown approval request');
  });

  it('throws when resolveApproval is called on a question entry', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('STAGE-A');
    await service.handleControlRequest('req-q', {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [] },
    });
    expect(() => service.resolveApproval('req-q', 'allow')).toThrow('Request is not a tool approval');
  });

  it('throws when resolveQuestion is called on an approval entry', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('STAGE-A');
    await service.handleControlRequest('req-a', {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: {},
    });
    expect(() => service.resolveQuestion('req-a', { q: 'a' })).toThrow('Request is not a question');
  });

  // ── handleCancelRequest ─────────────────────────────────────────────

  it('handleCancelRequest removes entry from pending', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/test' },
    };

    await service.handleControlRequest('req-cancel', request);
    expect(service.getPending()).toHaveLength(1);

    service.handleCancelRequest('req-cancel');
    expect(service.getPending()).toHaveLength(0);
  });

  it('handleCancelRequest emits "approval-cancelled"', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/test' },
    };

    await service.handleControlRequest('req-emit-cancel', request);

    const handler = vi.fn();
    service.on('approval-cancelled', handler);

    service.handleCancelRequest('req-emit-cancel');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('req-emit-cancel');
  });

  it('handleCancelRequest on unknown requestId is a no-op', () => {
    const service = new ApprovalService();

    const handler = vi.fn();
    service.on('approval-cancelled', handler);

    // Should not throw
    service.handleCancelRequest('nonexistent-req');

    expect(handler).not.toHaveBeenCalled();
  });

  // ── handleResult ────────────────────────────────────────────────────

  it('handleResult emits "result" event', () => {
    const service = new ApprovalService();

    const handler = vi.fn();
    service.on('result', handler);

    const resultMsg = {
      type: 'result' as const,
      result: { success: true, data: 'done' },
    };

    service.handleResult(resultMsg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(resultMsg);
  });

  // ── Query methods ───────────────────────────────────────────────────

  it('getPending returns all pending entries', async () => {
    const service = new ApprovalService();
    service.setCurrentStageId('stage-1');

    const request1: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/a' },
    };

    const request2: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      input: { questions: [{ id: 'q1', question: 'Q?' }] },
    };

    await service.handleControlRequest('req-1', request1);
    await service.handleControlRequest('req-2', request2);

    const pending = service.getPending();
    expect(pending).toHaveLength(2);
    expect(pending[0].requestId).toBe('req-1');
    expect(pending[1].requestId).toBe('req-2');
  });

  it('getPendingForStage filters by stageId', async () => {
    const service = new ApprovalService();

    service.setCurrentStageId('stage-a');
    const request1: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/a' },
    };
    await service.handleControlRequest('req-a1', request1);

    service.setCurrentStageId('stage-b');
    const request2: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/b' },
    };
    await service.handleControlRequest('req-b1', request2);

    service.setCurrentStageId('stage-a');
    const request3: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/a2' },
    };
    await service.handleControlRequest('req-a2', request3);

    const stageAPending = service.getPendingForStage('stage-a');
    expect(stageAPending).toHaveLength(2);
    expect(stageAPending.map((e) => e.requestId).sort()).toEqual(['req-a1', 'req-a2']);

    const stageBPending = service.getPendingForStage('stage-b');
    expect(stageBPending).toHaveLength(1);
    expect(stageBPending[0].requestId).toBe('req-b1');
  });

  it('clearForStage removes all entries for a given stageId', async () => {
    const service = new ApprovalService();

    service.setCurrentStageId('stage-x');
    const request1: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/x1' },
    };
    await service.handleControlRequest('req-x1', request1);

    service.setCurrentStageId('stage-y');
    const request2: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/y1' },
    };
    await service.handleControlRequest('req-y1', request2);

    service.setCurrentStageId('stage-x');
    const request3: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/x2' },
    };
    await service.handleControlRequest('req-x2', request3);

    expect(service.getPending()).toHaveLength(3);

    service.clearForStage('stage-x');

    expect(service.getPending()).toHaveLength(1);
    expect(service.getPending()[0].requestId).toBe('req-y1');
  });

  it('setCurrentStageId tags subsequent requests with correct stageId', async () => {
    const service = new ApprovalService();

    service.setCurrentStageId('stage-first');
    const request1: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/a' },
    };
    await service.handleControlRequest('req-1', request1);

    service.setCurrentStageId('stage-second');
    const request2: CanUseToolRequest['request'] = {
      subtype: 'can_use_tool',
      tool_name: 'read_file',
      input: { path: '/tmp/b' },
    };
    await service.handleControlRequest('req-2', request2);

    const pending = service.getPending();
    expect(pending[0].stageId).toBe('stage-first');
    expect(pending[1].stageId).toBe('stage-second');
  });
});
