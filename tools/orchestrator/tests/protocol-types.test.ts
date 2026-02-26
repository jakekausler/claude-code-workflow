import { describe, it, expect } from 'vitest';
import type {
  UserMessage,
  ControlRequest,
  ControlResponse,
  CanUseToolRequest,
  HookCallbackRequest,
  ControlCancelRequest,
  ResultMessage,
  OutboundMessage,
  InboundMessage,
  InboundControlRequest,
  PermissionResult,
  PendingApproval,
  PendingQuestion,
  QueuedMessage,
  ProtocolHandler,
} from '../src/protocol-types.js';

describe('Protocol Types', () => {
  describe('UserMessage', () => {
    it('creates a valid UserMessage', () => {
      const msg: UserMessage = {
        type: 'user',
        message: { role: 'user', content: 'Hello Claude' },
      };
      expect(msg.type).toBe('user');
      expect(msg.message.role).toBe('user');
      expect(msg.message.content).toBe('Hello Claude');
    });

    it('supports multi-line content', () => {
      const msg: UserMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Line 1\nLine 2\nLine 3',
        },
      };
      expect(msg.message.content).toContain('Line 2');
    });
  });

  describe('ControlRequest', () => {
    it('creates initialize control request', () => {
      const req: ControlRequest = {
        type: 'control_request',
        request_id: 'req-123',
        request: { subtype: 'initialize', hooks: { some: 'hook' } },
      };
      expect(req.type).toBe('control_request');
      expect(req.request_id).toBe('req-123');
      expect(req.request.subtype).toBe('initialize');
    });

    it('creates interrupt control request', () => {
      const req: ControlRequest = {
        type: 'control_request',
        request_id: 'req-456',
        request: { subtype: 'interrupt' },
      };
      expect(req.request.subtype).toBe('interrupt');
    });

    it('creates set_permission_mode control request', () => {
      const req: ControlRequest = {
        type: 'control_request',
        request_id: 'req-789',
        request: { subtype: 'set_permission_mode', mode: 'interactive' },
      };
      expect(req.request.subtype).toBe('set_permission_mode');
      expect((req.request as { mode: string }).mode).toBe('interactive');
    });
  });

  describe('ControlResponse', () => {
    it('creates allow response', () => {
      const resp: ControlResponse = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-123',
          response: { behavior: 'allow' },
        },
      };
      expect(resp.type).toBe('control_response');
      expect(resp.response.subtype).toBe('success');
      expect(resp.response.response.behavior).toBe('allow');
    });

    it('creates allow response with updatedInput', () => {
      const resp: ControlResponse = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-456',
          response: {
            behavior: 'allow',
            updatedInput: { modified: 'input' },
          },
        },
      };
      expect(resp.response.response.updatedInput).toEqual({
        modified: 'input',
      });
    });

    it('creates deny response', () => {
      const resp: ControlResponse = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-789',
          response: {
            behavior: 'deny',
            message: 'Not allowed',
          },
        },
      };
      expect(resp.response.response.behavior).toBe('deny');
      expect(resp.response.response.message).toBe('Not allowed');
    });
  });

  describe('CanUseToolRequest', () => {
    it('creates a valid CanUseToolRequest', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-abc',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'ls' },
        },
      };
      expect(req.request.subtype).toBe('can_use_tool');
      expect(req.request.tool_name).toBe('bash');
      expect(req.request.input).toEqual({ command: 'ls' });
    });

    it('supports optional tool_use_id', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-def',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'read',
          input: { file_path: '/etc/passwd' },
          tool_use_id: 'use-456',
        },
      };
      expect(req.request.tool_use_id).toBe('use-456');
    });

    it('supports optional permission_suggestions', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-ghi',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'edit',
          input: { file_path: '/src/app.ts' },
          permission_suggestions: [{ type: 'allow' }],
        },
      };
      expect(req.request.permission_suggestions).toBeDefined();
    });

    it('supports optional blocked_paths', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-jkl',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'read',
          input: { file_path: '/secret' },
          blocked_paths: '/secrets/**',
        },
      };
      expect(req.request.blocked_paths).toBe('/secrets/**');
    });

    it('supports null blocked_paths', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-mno',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'pwd' },
          blocked_paths: null,
        },
      };
      expect(req.request.blocked_paths).toBeNull();
    });
  });

  describe('HookCallbackRequest', () => {
    it('creates a valid HookCallbackRequest', () => {
      const req: HookCallbackRequest = {
        type: 'control_request',
        request_id: 'hook-123',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb-xyz',
          input: { some: 'data' },
        },
      };
      expect(req.request.subtype).toBe('hook_callback');
      expect(req.request.callback_id).toBe('cb-xyz');
      expect(req.request.input).toEqual({ some: 'data' });
    });

    it('supports optional tool_use_id', () => {
      const req: HookCallbackRequest = {
        type: 'control_request',
        request_id: 'hook-456',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb-abc',
          input: { value: 42 },
          tool_use_id: 'use-999',
        },
      };
      expect(req.request.tool_use_id).toBe('use-999');
    });
  });

  describe('ControlCancelRequest', () => {
    it('creates a valid ControlCancelRequest', () => {
      const req: ControlCancelRequest = {
        type: 'control_cancel_request',
        request_id: 'req-cancel-123',
      };
      expect(req.type).toBe('control_cancel_request');
      expect(req.request_id).toBe('req-cancel-123');
    });
  });

  describe('ResultMessage', () => {
    it('creates a valid ResultMessage with object result', () => {
      const msg: ResultMessage = {
        type: 'result',
        result: { status: 'success', data: [1, 2, 3] },
      };
      expect(msg.type).toBe('result');
      expect(msg.result).toEqual({ status: 'success', data: [1, 2, 3] });
    });

    it('creates a valid ResultMessage with string result', () => {
      const msg: ResultMessage = {
        type: 'result',
        result: 'Completed successfully',
      };
      expect(msg.result).toBe('Completed successfully');
    });

    it('creates a valid ResultMessage with null result', () => {
      const msg: ResultMessage = {
        type: 'result',
        result: null,
      };
      expect(msg.result).toBeNull();
    });
  });

  describe('PermissionResult', () => {
    it('creates allow behavior', () => {
      const perm: PermissionResult = { behavior: 'allow' };
      expect(perm.behavior).toBe('allow');
    });

    it('creates allow with updatedInput', () => {
      const perm: PermissionResult = {
        behavior: 'allow',
        updatedInput: { key: 'value' },
      };
      expect(perm.behavior).toBe('allow');
      expect(perm.updatedInput).toEqual({ key: 'value' });
    });

    it('creates deny behavior', () => {
      const perm: PermissionResult = { behavior: 'deny' };
      expect(perm.behavior).toBe('deny');
    });

    it('creates deny with message', () => {
      const perm: PermissionResult = {
        behavior: 'deny',
        message: 'User rejected',
      };
      expect(perm.behavior).toBe('deny');
      expect(perm.message).toBe('User rejected');
    });
  });

  describe('PendingApproval', () => {
    it('creates a valid PendingApproval', () => {
      const approval: PendingApproval = {
        stageId: 'stage-1',
        requestId: 'req-123',
        toolName: 'bash',
        input: { command: 'rm -rf /' },
        createdAt: 1000,
      };
      expect(approval.stageId).toBe('stage-1');
      expect(approval.requestId).toBe('req-123');
      expect(approval.toolName).toBe('bash');
      expect(approval.createdAt).toBe(1000);
    });

    it('supports complex input', () => {
      const approval: PendingApproval = {
        stageId: 'stage-2',
        requestId: 'req-456',
        toolName: 'edit',
        input: { file_path: '/src/app.ts', lines: [1, 2, 3] },
        createdAt: 2000,
      };
      expect(approval.input).toEqual({
        file_path: '/src/app.ts',
        lines: [1, 2, 3],
      });
    });
  });

  describe('PendingQuestion', () => {
    it('creates a valid PendingQuestion', () => {
      const question: PendingQuestion = {
        stageId: 'stage-1',
        requestId: 'req-789',
        questions: [{ q: 'Continue?' }],
        input: { context: 'test' },
        createdAt: 3000,
      };
      expect(question.stageId).toBe('stage-1');
      expect(question.requestId).toBe('req-789');
      expect(question.questions).toEqual([{ q: 'Continue?' }]);
      expect(question.createdAt).toBe(3000);
    });

    it('supports multiple questions', () => {
      const question: PendingQuestion = {
        stageId: 'stage-2',
        requestId: 'req-000',
        questions: [
          { id: 1, text: 'Approve?' },
          { id: 2, text: 'Continue?' },
        ],
        input: { data: 'value' },
        createdAt: 4000,
      };
      expect(question.questions).toHaveLength(2);
    });
  });

  describe('QueuedMessage', () => {
    it('creates a valid QueuedMessage', () => {
      const queued: QueuedMessage = {
        message: 'Hello from user',
        queuedAt: 5000,
      };
      expect(queued.message).toBe('Hello from user');
      expect(queued.queuedAt).toBe(5000);
    });

    it('supports multi-line messages', () => {
      const queued: QueuedMessage = {
        message: 'Line 1\nLine 2\nLine 3',
        queuedAt: 6000,
      };
      expect(queued.message).toContain('Line 2');
    });
  });

  describe('Discriminated Unions - OutboundMessage', () => {
    it('discriminates UserMessage', () => {
      const msg: OutboundMessage = {
        type: 'user',
        message: { role: 'user', content: 'Test' },
      };
      expect(msg.type).toBe('user');
    });

    it('discriminates ControlRequest with initialize', () => {
      const msg: OutboundMessage = {
        type: 'control_request',
        request_id: 'id-1',
        request: { subtype: 'initialize' },
      };
      expect(msg.type).toBe('control_request');
    });

    it('discriminates ControlRequest with interrupt', () => {
      const msg: OutboundMessage = {
        type: 'control_request',
        request_id: 'id-2',
        request: { subtype: 'interrupt' },
      };
      expect(msg.type).toBe('control_request');
    });

    it('discriminates ControlResponse', () => {
      const msg: OutboundMessage = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'id-3',
          response: { behavior: 'allow' },
        },
      };
      expect(msg.type).toBe('control_response');
    });
  });

  describe('Discriminated Unions - InboundControlRequest', () => {
    it('discriminates CanUseToolRequest', () => {
      const req: InboundControlRequest = {
        type: 'control_request',
        request_id: 'id-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'ls' },
        },
      };
      expect(req.request.subtype).toBe('can_use_tool');
    });

    it('discriminates HookCallbackRequest', () => {
      const req: InboundControlRequest = {
        type: 'control_request',
        request_id: 'id-2',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb-1',
          input: {},
        },
      };
      expect(req.request.subtype).toBe('hook_callback');
    });
  });

  describe('Discriminated Unions - InboundMessage', () => {
    it('discriminates CanUseToolRequest', () => {
      const msg: InboundMessage = {
        type: 'control_request',
        request_id: 'id-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'ls' },
        },
      };
      expect(msg.type).toBe('control_request');
    });

    it('discriminates HookCallbackRequest', () => {
      const msg: InboundMessage = {
        type: 'control_request',
        request_id: 'id-2',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb-1',
          input: {},
        },
      };
      expect(msg.type).toBe('control_request');
    });

    it('discriminates ControlCancelRequest', () => {
      const msg: InboundMessage = {
        type: 'control_cancel_request',
        request_id: 'id-3',
      };
      expect(msg.type).toBe('control_cancel_request');
    });

    it('discriminates ResultMessage', () => {
      const msg: InboundMessage = {
        type: 'result',
        result: { status: 'ok' },
      };
      expect(msg.type).toBe('result');
    });
  });

  describe('ProtocolHandler interface', () => {
    it('defines handleControlRequest method', () => {
      const handler: ProtocolHandler = {
        handleControlRequest: async () => {},
        handleCancelRequest: () => {},
        handleResult: () => {},
      };
      expect(typeof handler.handleControlRequest).toBe('function');
    });

    it('defines handleCancelRequest method', () => {
      const handler: ProtocolHandler = {
        handleControlRequest: async () => {},
        handleCancelRequest: () => {},
        handleResult: () => {},
      };
      expect(typeof handler.handleCancelRequest).toBe('function');
    });

    it('defines handleResult method', () => {
      const handler: ProtocolHandler = {
        handleControlRequest: async () => {},
        handleCancelRequest: () => {},
        handleResult: () => {},
      };
      expect(typeof handler.handleResult).toBe('function');
    });

    it('handleControlRequest is async', async () => {
      const handler: ProtocolHandler = {
        handleControlRequest: async () => {
          return Promise.resolve();
        },
        handleCancelRequest: () => {},
        handleResult: () => {},
      };
      const result = handler.handleControlRequest('id', {
        subtype: 'can_use_tool',
        tool_name: 'bash',
        input: {},
      });
      expect(result instanceof Promise).toBe(true);
    });
  });

  describe('Type compatibility', () => {
    it('CanUseToolRequest is assignable to InboundControlRequest', () => {
      const req: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'id',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: {},
        },
      };
      const inbound: InboundControlRequest = req;
      expect(inbound.request_id).toBe('id');
    });

    it('HookCallbackRequest is assignable to InboundControlRequest', () => {
      const req: HookCallbackRequest = {
        type: 'control_request',
        request_id: 'id',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb',
          input: {},
        },
      };
      const inbound: InboundControlRequest = req;
      expect(inbound.request_id).toBe('id');
    });

    it('InboundControlRequest is assignable to InboundMessage', () => {
      const req: HookCallbackRequest = {
        type: 'control_request',
        request_id: 'id',
        request: {
          subtype: 'hook_callback',
          callback_id: 'cb',
          input: {},
        },
      };
      const msg: InboundMessage = req;
      expect(msg.type).toBe('control_request');
    });
  });
});
