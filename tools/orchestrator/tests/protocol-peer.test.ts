import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { ProtocolPeer } from '../src/protocol-peer.js';
import type { ProtocolHandler, CanUseToolRequest, HookCallbackRequest } from '../src/protocol-types.js';

function createMockHandler(): ProtocolHandler {
  return {
    handleControlRequest: vi.fn(),
    handleCancelRequest: vi.fn(),
    handleResult: vi.fn(),
  };
}

describe('ProtocolPeer', () => {
  let stdin: PassThrough;
  let stdout: PassThrough;
  let handler: ReturnType<typeof createMockHandler>;
  let peer: ProtocolPeer;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    handler = createMockHandler();
    peer = new ProtocolPeer(stdin, stdout, handler);
  });

  describe('sendUserMessage', () => {
    it('writes correct JSON line to stdin with newline terminator', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.sendUserMessage('Hello, Claude!');

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      expect(written).toMatch(/\n$/);

      const msg = JSON.parse(written.trimEnd());
      expect(msg.type).toBe('user');
      expect(msg.message.role).toBe('user');
      expect(msg.message.content).toBe('Hello, Claude!');

      peer.destroy();
    });
  });

  describe('sendApprovalResponse', () => {
    it('sends allow response with correct structure', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.sendApprovalResponse('req-123', { behavior: 'allow' });

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.type).toBe('control_response');
      expect(msg.response.subtype).toBe('success');
      expect(msg.response.request_id).toBe('req-123');
      expect(msg.response.response.behavior).toBe('allow');

      peer.destroy();
    });

    it('sends deny response with message', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.sendApprovalResponse('req-456', {
        behavior: 'deny',
        message: 'Permission denied',
      });

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.response.response.behavior).toBe('deny');
      expect(msg.response.response.message).toBe('Permission denied');

      peer.destroy();
    });

    it('sends allow response with updatedInput', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      const updatedInput = { modified: true };
      await peer.sendApprovalResponse('req-789', {
        behavior: 'allow',
        updatedInput,
      });

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.response.response.behavior).toBe('allow');
      expect(msg.response.response.updatedInput).toEqual(updatedInput);

      peer.destroy();
    });
  });

  describe('interrupt', () => {
    it('sends interrupt control request with uuid request_id', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.interrupt();

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.type).toBe('control_request');
      expect(msg.request.subtype).toBe('interrupt');
      // Check that request_id looks like a UUID (basic check)
      expect(msg.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      peer.destroy();
    });
  });

  describe('initialize', () => {
    it('sends initialize control request without hooks', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.initialize();

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.type).toBe('control_request');
      expect(msg.request.subtype).toBe('initialize');

      peer.destroy();
    });

    it('sends initialize control request with hooks', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      const hooks = { custom: 'hook' };
      await peer.initialize(hooks);

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.request.subtype).toBe('initialize');
      expect(msg.request.hooks).toEqual(hooks);

      peer.destroy();
    });
  });

  describe('setPermissionMode', () => {
    it('sends set_permission_mode control request', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.setPermissionMode('tool-approval');

      expect(stdinSpy).toHaveBeenCalledOnce();
      const written = stdinSpy.mock.calls[0][0] as string;
      const msg = JSON.parse(written.trimEnd());

      expect(msg.type).toBe('control_request');
      expect(msg.request.subtype).toBe('set_permission_mode');
      expect(msg.request.mode).toBe('tool-approval');

      peer.destroy();
    });
  });

  describe('read loop - inbound messages', () => {
    it('dispatches can_use_tool request to handleControlRequest', async () => {
      const request: CanUseToolRequest = {
        type: 'control_request',
        request_id: 'req-tool-123',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'ls' },
        },
      };

      stdout.write(JSON.stringify(request) + '\n');

      // readline's async iterator processes lines asynchronously;
      // a short delay ensures the handler has been called before assertions
      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).toHaveBeenCalledOnce();
      expect(handler.handleControlRequest).toHaveBeenCalledWith('req-tool-123', request.request);

      peer.destroy();
    });

    it('dispatches hook_callback request to handleControlRequest', async () => {
      const request: HookCallbackRequest = {
        type: 'control_request',
        request_id: 'req-hook-456',
        request: {
          subtype: 'hook_callback',
          callback_id: 'hook-123',
          input: { data: 'test' },
        },
      };

      stdout.write(JSON.stringify(request) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).toHaveBeenCalledOnce();
      expect(handler.handleControlRequest).toHaveBeenCalledWith('req-hook-456', request.request);

      peer.destroy();
    });

    it('dispatches control_cancel_request to handleCancelRequest', async () => {
      const cancelMsg = {
        type: 'control_cancel_request',
        request_id: 'req-cancel-789',
      };

      stdout.write(JSON.stringify(cancelMsg) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleCancelRequest).toHaveBeenCalledOnce();
      expect(handler.handleCancelRequest).toHaveBeenCalledWith('req-cancel-789');

      peer.destroy();
    });

    it('dispatches result message to handleResult', async () => {
      const resultMsg = {
        type: 'result',
        result: { success: true, data: 'finished' },
      };

      stdout.write(JSON.stringify(resultMsg) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleResult).toHaveBeenCalledOnce();
      expect(handler.handleResult).toHaveBeenCalledWith(resultMsg);

      peer.destroy();
    });

    it('ignores non-JSON lines gracefully', async () => {
      // Write some non-JSON lines
      stdout.write('This is not JSON\n');
      stdout.write('Another garbage line\n');
      stdout.write('{ incomplete json\n');

      await new Promise((r) => setTimeout(r, 50));

      // None of the handler methods should be called
      expect(handler.handleControlRequest).not.toHaveBeenCalled();
      expect(handler.handleCancelRequest).not.toHaveBeenCalled();
      expect(handler.handleResult).not.toHaveBeenCalled();

      peer.destroy();
    });

    it('ignores JSON lines without recognized type', async () => {
      // Write valid JSON but with unrecognized type (assistant, system, etc)
      stdout.write(JSON.stringify({ type: 'assistant', content: 'Hello' }) + '\n');
      stdout.write(JSON.stringify({ type: 'system', content: 'Processing' }) + '\n');
      stdout.write(JSON.stringify({ type: 'progress', message: 'Loading' }) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      // None of the handler methods should be called
      expect(handler.handleControlRequest).not.toHaveBeenCalled();
      expect(handler.handleCancelRequest).not.toHaveBeenCalled();
      expect(handler.handleResult).not.toHaveBeenCalled();

      peer.destroy();
    });

    it('ignores JSON lines without type field', async () => {
      // Write valid JSON but without type field
      stdout.write(JSON.stringify({ message: 'no type here' }) + '\n');
      stdout.write(JSON.stringify({ data: 123 }) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).not.toHaveBeenCalled();
      expect(handler.handleCancelRequest).not.toHaveBeenCalled();
      expect(handler.handleResult).not.toHaveBeenCalled();

      peer.destroy();
    });

    it('skips control_request with missing request_id', async () => {
      // control_request without request_id
      stdout.write(
        JSON.stringify({
          type: 'control_request',
          request: { subtype: 'can_use_tool', tool_name: 'bash', input: {} },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).not.toHaveBeenCalled();

      peer.destroy();
    });

    it('skips control_cancel_request with missing request_id', async () => {
      // control_cancel_request without request_id
      stdout.write(JSON.stringify({ type: 'control_cancel_request' }) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleCancelRequest).not.toHaveBeenCalled();

      peer.destroy();
    });

    it('skips control_request with missing request field', async () => {
      // control_request without request field
      stdout.write(JSON.stringify({ type: 'control_request', request_id: 'req-123' }) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      expect(handler.handleControlRequest).not.toHaveBeenCalled();

      peer.destroy();
    });
  });

  describe('destroy', () => {
    it('stops read loop and prevents further message dispatch', async () => {
      // Send a message before destroy
      const msg1 = { type: 'result', result: 'first' };
      stdout.write(JSON.stringify(msg1) + '\n');

      await new Promise((r) => setTimeout(r, 50));
      expect(handler.handleResult).toHaveBeenCalledOnce();

      // Destroy the peer
      peer.destroy();

      // Wait a bit
      await new Promise((r) => setTimeout(r, 50));

      // Send another message after destroy
      const msg2 = { type: 'result', result: 'second' };
      stdout.write(JSON.stringify(msg2) + '\n');

      // Wait for potential processing
      await new Promise((r) => setTimeout(r, 50));

      // Still only called once (message after destroy was not processed)
      expect(handler.handleResult).toHaveBeenCalledOnce();
    });
  });

  describe('multiple operations', () => {
    it('sends multiple messages in sequence', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      await peer.sendUserMessage('Message 1');
      await peer.interrupt();
      await peer.setPermissionMode('auto-approve');

      expect(stdinSpy).toHaveBeenCalledTimes(3);

      const msg1 = JSON.parse((stdinSpy.mock.calls[0][0] as string).trimEnd());
      const msg2 = JSON.parse((stdinSpy.mock.calls[1][0] as string).trimEnd());
      const msg3 = JSON.parse((stdinSpy.mock.calls[2][0] as string).trimEnd());

      expect(msg1.type).toBe('user');
      expect(msg2.request.subtype).toBe('interrupt');
      expect(msg3.request.subtype).toBe('set_permission_mode');

      peer.destroy();
    });

    it('handles mixed inbound and outbound operations', async () => {
      const stdinSpy = vi.spyOn(stdin, 'write');

      // Send message
      await peer.sendUserMessage('Hello');

      // Simulate inbound approval request
      const request = {
        type: 'control_request',
        request_id: 'req-in',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'bash',
          input: { command: 'echo test' },
        },
      };
      stdout.write(JSON.stringify(request) + '\n');

      await new Promise((r) => setTimeout(r, 50));

      // Respond to approval
      await peer.sendApprovalResponse('req-in', { behavior: 'allow' });

      expect(stdinSpy).toHaveBeenCalledTimes(2);
      expect(handler.handleControlRequest).toHaveBeenCalledOnce();

      peer.destroy();
    });
  });
});
